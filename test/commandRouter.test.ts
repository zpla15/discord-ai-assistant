import { describe, expect, it, vi } from "vitest";
import { createAccessPolicy } from "../src/core/accessControl.js";
import { ChannelSessionStore } from "../src/core/channelSessionStore.js";
import { createCommandRouter, RESTART_COMMAND } from "../src/core/commandRouter.js";
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

function createPolicy() {
  return createAccessPolicy("owner-1", new Map([["chan-1", "/workspaces/work"]]));
}

describe("commandRouter", () => {
  it("silently ignores messages from unauthorized senders", () => {
    const queue = new TaskQueue();
    const provider: AIProvider = { run: vi.fn() };
    const responder = createResponder();
    const logger = createLogger();
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue,
      provider,
      sessions: new ChannelSessionStore(),
      taskTimeoutMs: 1000,
      logger,
      onRestart: vi.fn(),
    });

    router.handle({ text: "hi", userId: "intruder", channelId: "chan-1", configChannelId: "chan-1" }, responder);

    expect(provider.run).not.toHaveBeenCalled();
    expect(responder.sent).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("runs the provider with the channel's workspace and sends the result", async () => {
    const queue = new TaskQueue();
    const provider: AIProvider = { run: vi.fn().mockResolvedValue({ ok: true, text: "결과" }) };
    const responder = createResponder();
    const logger = createLogger();
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue,
      provider,
      sessions: new ChannelSessionStore(),
      taskTimeoutMs: 1000,
      logger,
      onRestart: vi.fn(),
    });

    router.handle({ text: "서버 상태 알려줘", userId: "owner-1", channelId: "chan-1", configChannelId: "chan-1" }, responder);
    await new Promise((r) => setTimeout(r, 0));

    expect(provider.run).toHaveBeenCalledWith("서버 상태 알려줘", {
      timeoutMs: 1000,
      workspaceDir: "/workspaces/work",
      sessionId: undefined,
    });
    expect(responder.sent).toEqual(["결과"]);
    expect(responder.queuedAt).toEqual([]);
  });

  it("resumes the channel's last session id on the next message", async () => {
    const queue = new TaskQueue();
    const provider: AIProvider = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: "첫 응답", sessionId: "session-abc" })
        .mockResolvedValueOnce({ ok: true, text: "이어진 응답" }),
    };
    const responder = createResponder();
    const logger = createLogger();
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue,
      provider,
      sessions: new ChannelSessionStore(),
      taskTimeoutMs: 1000,
      logger,
      onRestart: vi.fn(),
    });

    router.handle({ text: "첫 메시지", userId: "owner-1", channelId: "chan-1", configChannelId: "chan-1" }, responder);
    await new Promise((r) => setTimeout(r, 0));
    router.handle({ text: "이어서", userId: "owner-1", channelId: "chan-1", configChannelId: "chan-1" }, responder);
    await new Promise((r) => setTimeout(r, 0));

    expect(provider.run).toHaveBeenNthCalledWith(2, "이어서", {
      timeoutMs: 1000,
      workspaceDir: "/workspaces/work",
      sessionId: "session-abc",
    });
    expect(responder.sent).toEqual(["첫 응답", "이어진 응답"]);
  });

  it("drops a stale session and retries fresh when the provider reports sessionExpired", async () => {
    const queue = new TaskQueue();
    const provider: AIProvider = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, text: "", sessionExpired: true })
        .mockResolvedValueOnce({ ok: true, text: "새 세션 응답", sessionId: "session-new" }),
    };
    const sessions = new ChannelSessionStore();
    sessions.set("chan-1", "session-stale");
    const responder = createResponder();
    const logger = createLogger();
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue,
      provider,
      sessions,
      taskTimeoutMs: 1000,
      logger,
      onRestart: vi.fn(),
    });

    router.handle({ text: "안녕", userId: "owner-1", channelId: "chan-1", configChannelId: "chan-1" }, responder);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(provider.run).toHaveBeenNthCalledWith(1, "안녕", {
      timeoutMs: 1000,
      workspaceDir: "/workspaces/work",
      sessionId: "session-stale",
    });
    expect(provider.run).toHaveBeenNthCalledWith(2, "안녕", {
      timeoutMs: 1000,
      workspaceDir: "/workspaces/work",
      sessionId: undefined,
    });
    expect(responder.sent).toEqual(["새 세션 응답"]);
    expect(sessions.get("chan-1")).toBe("session-new");
  });

  it("clears the channel's session on !reset without calling the provider", async () => {
    const queue = new TaskQueue();
    const provider: AIProvider = { run: vi.fn() };
    const sessions = new ChannelSessionStore();
    sessions.set("chan-1", "session-abc");
    const responder = createResponder();
    const logger = createLogger();
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue,
      provider,
      sessions,
      taskTimeoutMs: 1000,
      logger,
      onRestart: vi.fn(),
    });

    router.handle({ text: "!reset", userId: "owner-1", channelId: "chan-1", configChannelId: "chan-1" }, responder);
    await new Promise((r) => setTimeout(r, 0));

    expect(provider.run).not.toHaveBeenCalled();
    expect(sessions.get("chan-1")).toBeUndefined();
    expect(responder.sent).toEqual(["이 채널의 대화 맥락을 초기화했습니다."]);
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
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue,
      provider,
      sessions: new ChannelSessionStore(),
      taskTimeoutMs: 1000,
      logger,
      onRestart: vi.fn(),
    });

    router.handle({ text: "A", userId: "owner-1", channelId: "chan-1", configChannelId: "chan-1" }, responderA);
    router.handle({ text: "B", userId: "owner-1", channelId: "chan-1", configChannelId: "chan-1" }, responderB);

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
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue,
      provider,
      sessions: new ChannelSessionStore(),
      taskTimeoutMs: 1000,
      logger,
      onRestart: vi.fn(),
    });

    router.handle({ text: "hi", userId: "owner-1", channelId: "chan-1", configChannelId: "chan-1" }, responder);
    await new Promise((r) => setTimeout(r, 0));

    expect(responder.sent).toEqual(["작업 처리 중 오류가 발생했습니다."]);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("replies before restarting, so the user is not left staring at silence", async () => {
    const queue = new TaskQueue();
    const provider: AIProvider = { run: vi.fn() };
    const responder = createResponder();
    const sendOrder: string[] = [];
    responder.send = async (text: string) => {
      sendOrder.push(`sent:${text}`);
    };
    const onRestart = vi.fn(() => {
      sendOrder.push("restarted");
    });
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue,
      provider,
      sessions: new ChannelSessionStore(),
      taskTimeoutMs: 1000,
      logger: createLogger(),
      onRestart,
    });

    router.handle({ text: RESTART_COMMAND, userId: "owner-1", channelId: "chan-1", configChannelId: "chan-1" }, responder);
    await new Promise((r) => setTimeout(r, 0));

    expect(onRestart).toHaveBeenCalledOnce();
    expect(sendOrder[0]).toContain("재시작합니다");
    expect(sendOrder[1]).toBe("restarted");
    expect(provider.run).not.toHaveBeenCalled();
  });

  it("restarts even if the confirmation message fails to send", async () => {
    const queue = new TaskQueue();
    const responder = createResponder();
    responder.send = async () => {
      throw new Error("discord down");
    };
    const onRestart = vi.fn();
    const logger = createLogger();
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue,
      provider: { run: vi.fn() },
      sessions: new ChannelSessionStore(),
      taskTimeoutMs: 1000,
      logger,
      onRestart,
    });

    router.handle({ text: RESTART_COMMAND, userId: "owner-1", channelId: "chan-1", configChannelId: "chan-1" }, responder);
    await new Promise((r) => setTimeout(r, 0));

    expect(onRestart).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("accepts a thread message via its parent channel's config", async () => {
    const provider: AIProvider = { run: vi.fn().mockResolvedValue({ ok: true, text: "스레드 응답" }) };
    const responder = createResponder();
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue: new TaskQueue(),
      provider,
      sessions: new ChannelSessionStore(),
      taskTimeoutMs: 1000,
      logger: createLogger(),
      onRestart: vi.fn(),
    });

    // A thread inside chan-1: its own id, but chan-1 owns the configuration.
    router.handle(
      { text: "스레드에서", userId: "owner-1", channelId: "thread-99", configChannelId: "chan-1" },
      responder,
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(provider.run).toHaveBeenCalledWith("스레드에서", {
      timeoutMs: 1000,
      workspaceDir: "/workspaces/work",
      sessionId: undefined,
    });
    expect(responder.sent).toEqual(["스레드 응답"]);
  });

  it("gives each thread its own session, separate from its parent channel", async () => {
    const provider: AIProvider = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: "부모", sessionId: "session-parent" })
        .mockResolvedValueOnce({ ok: true, text: "스레드", sessionId: "session-thread" })
        .mockResolvedValueOnce({ ok: true, text: "스레드 계속" }),
    };
    const sessions = new ChannelSessionStore();
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue: new TaskQueue(),
      provider,
      sessions,
      taskTimeoutMs: 1000,
      logger: createLogger(),
      onRestart: vi.fn(),
    });

    const send = async (channelId: string, text: string) => {
      router.handle({ text, userId: "owner-1", channelId, configChannelId: "chan-1" }, createResponder());
      await new Promise((r) => setTimeout(r, 0));
    };

    await send("chan-1", "부모 채널에서");
    await send("thread-99", "스레드에서");
    await send("thread-99", "스레드에서 또");

    // The thread's second message resumes the thread's session, not the parent's.
    expect(provider.run).toHaveBeenNthCalledWith(3, "스레드에서 또", {
      timeoutMs: 1000,
      workspaceDir: "/workspaces/work",
      sessionId: "session-thread",
    });
    expect(sessions.get("chan-1")).toBe("session-parent");
    expect(sessions.get("thread-99")).toBe("session-thread");
  });

  it("ignores a thread whose parent channel is not configured", () => {
    const provider: AIProvider = { run: vi.fn() };
    const logger = createLogger();
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue: new TaskQueue(),
      provider,
      sessions: new ChannelSessionStore(),
      taskTimeoutMs: 1000,
      logger,
      onRestart: vi.fn(),
    });

    router.handle(
      { text: "몰래", userId: "owner-1", channelId: "thread-99", configChannelId: "other-channel" },
      createResponder(),
    );

    expect(provider.run).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("ignores !restart from an unauthorized sender", () => {
    const onRestart = vi.fn();
    const router = createCommandRouter({
      accessPolicy: createPolicy(),
      queue: new TaskQueue(),
      provider: { run: vi.fn() },
      sessions: new ChannelSessionStore(),
      taskTimeoutMs: 1000,
      logger: createLogger(),
      onRestart,
    });

    router.handle({ text: RESTART_COMMAND, userId: "intruder", channelId: "chan-1", configChannelId: "chan-1" }, createResponder());

    expect(onRestart).not.toHaveBeenCalled();
  });
});
