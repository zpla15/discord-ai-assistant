import { describe, expect, it, vi } from "vitest";
import { createAccessPolicy } from "../src/core/accessControl.js";
import { createCommandRouter } from "../src/core/commandRouter.js";
import { TaskQueue } from "../src/core/taskQueue.js";
import type { OutgoingResponder } from "../src/core/types.js";
import type { AIProvider } from "../src/providers/aiProvider.js";

function createResponder(): OutgoingResponder & { sent: string[]; queuedAt: number[] } {
  const sent: string[] = [];
  const queuedAt: number[] = [];
  return {
    sent,
    queuedAt,
    async send(text) {
      sent.push(text);
    },
    async notifyQueued(position) {
      queuedAt.push(position);
    },
    async withProgress(fn) {
      return fn();
    },
  };
}

function createLogger() {
  return { warn: vi.fn(), error: vi.fn() };
}

describe("commandRouter", () => {
  const policy = createAccessPolicy("owner-1", ["chan-1"]);

  it("silently ignores messages from unauthorized senders", () => {
    const queue = new TaskQueue();
    const provider: AIProvider = { run: vi.fn() };
    const responder = createResponder();
    const logger = createLogger();
    const router = createCommandRouter({ accessPolicy: policy, queue, provider, taskTimeoutMs: 1000, logger });

    router.handle({ text: "hi", userId: "intruder", channelId: "chan-1" }, responder);

    expect(provider.run).not.toHaveBeenCalled();
    expect(responder.sent).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("runs the provider and sends the result for an authorized sender", async () => {
    const queue = new TaskQueue();
    const provider: AIProvider = { run: vi.fn().mockResolvedValue({ ok: true, text: "결과" }) };
    const responder = createResponder();
    const logger = createLogger();
    const router = createCommandRouter({ accessPolicy: policy, queue, provider, taskTimeoutMs: 1000, logger });

    router.handle({ text: "서버 상태 알려줘", userId: "owner-1", channelId: "chan-1" }, responder);
    await new Promise((r) => setTimeout(r, 0));

    expect(provider.run).toHaveBeenCalledWith("서버 상태 알려줘", { timeoutMs: 1000 });
    expect(responder.sent).toEqual(["결과"]);
    expect(responder.queuedAt).toEqual([]);
  });

  it("notifies queue position when a task must wait", async () => {
    const queue = new TaskQueue();
    let resolveFirst!: () => void;
    const provider: AIProvider = {
      run: vi
        .fn()
        .mockImplementationOnce(() => new Promise((res) => (resolveFirst = () => res({ ok: true, text: "A" }))))
        .mockResolvedValueOnce({ ok: true, text: "B" }),
    };
    const responderA = createResponder();
    const responderB = createResponder();
    const logger = createLogger();
    const router = createCommandRouter({ accessPolicy: policy, queue, provider, taskTimeoutMs: 1000, logger });

    router.handle({ text: "A", userId: "owner-1", channelId: "chan-1" }, responderA);
    router.handle({ text: "B", userId: "owner-1", channelId: "chan-1" }, responderB);

    expect(responderB.queuedAt).toEqual([1]);
    expect(responderB.sent).toEqual([]);

    resolveFirst();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(responderA.sent).toEqual(["A"]);
    expect(responderB.sent).toEqual(["B"]);
  });

  it("reports a generic error and logs when the provider throws", async () => {
    const queue = new TaskQueue();
    const provider: AIProvider = { run: vi.fn().mockRejectedValue(new Error("boom")) };
    const responder = createResponder();
    const logger = createLogger();
    const router = createCommandRouter({ accessPolicy: policy, queue, provider, taskTimeoutMs: 1000, logger });

    router.handle({ text: "hi", userId: "owner-1", channelId: "chan-1" }, responder);
    await new Promise((r) => setTimeout(r, 0));

    expect(responder.sent).toEqual(["작업 처리 중 오류가 발생했습니다."]);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
