import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { ClaudeCodeProvider } = await import("../src/providers/claudeCodeProvider.js");

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn();
}

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function baseConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    claudeBin: "/usr/local/bin/claude",
    workspaceDir: "/home/nova/discord-ai-assistant/claude-workspace",
    maxOutputBytes: 1000,
    tools: ["Read", "Edit", "Bash"],
    allowedTools: ["Bash(npm test:*)", "Bash(git status)"],
    disallowedTools: ["Bash(sudo*)", "Bash(rm -rf*)"],
    killGraceMs: 50,
    ...overrides,
  };
}

describe("ClaudeCodeProvider", () => {
  let fakeChild: FakeChild;

  beforeEach(() => {
    fakeChild = new FakeChild();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(fakeChild);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("spawns claude with a locked-down, non-bypassing argument list", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("서버 상태 알려줘", { timeoutMs: 5000 });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args, options] = spawnMock.mock.calls[0]!;
    expect(bin).toBe("/usr/local/bin/claude");
    expect(args).toEqual([
      "-p",
      "서버 상태 알려줘",
      "--output-format",
      "json",
      "--restricted",
      "--add-dir",
      "/home/nova/discord-ai-assistant/claude-workspace",
      "--tools",
      "Read,Edit,Bash",
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      "Bash(npm test:*),Bash(git status)",
      "--disallowedTools",
      "Bash(sudo*),Bash(rm -rf*)",
    ]);
    expect(args.join(" ")).not.toContain("dangerously-skip-permissions");
    expect(options.cwd).toBe("/home/nova/discord-ai-assistant/claude-workspace");

    fakeChild.stdout.emit("data", Buffer.from(JSON.stringify({ is_error: false, result: "ok" })));
    fakeChild.emit("close", 0);
    await expect(resultPromise).resolves.toEqual({ ok: true, text: "ok" });
  });

  it("passes only a minimal, curated environment to the child process", () => {
    process.env.SOME_UNRELATED_SECRET = "should-not-leak";
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    void provider.run("hi", { timeoutMs: 5000 });

    const [, , options] = spawnMock.mock.calls[0]!;
    expect(Object.keys(options.env).sort()).toEqual(["HOME", "LANG", "LC_ALL", "PATH"].sort());
    delete process.env.SOME_UNRELATED_SECRET;

    fakeChild.stdout.emit("data", Buffer.from(JSON.stringify({ is_error: false, result: "ok" })));
    fakeChild.emit("close", 0);
  });

  it("maps is_error:true to ok:false while still returning the text", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("hi", { timeoutMs: 5000 });

    fakeChild.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ is_error: true, result: "허용되지 않은 작업입니다." })),
    );
    fakeChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({ ok: false, text: "허용되지 않은 작업입니다." });
  });

  it("falls back to raw stdout text when JSON parsing fails", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("hi", { timeoutMs: 5000 });

    fakeChild.stdout.emit("data", Buffer.from("not json"));
    fakeChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({ ok: true, text: "not json" });
  });

  it("reports failure when the process errors before spawning succeeds", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("hi", { timeoutMs: 5000 });

    fakeChild.emit("error", new Error("ENOENT"));

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.text).toContain("ENOENT");
  });

  it("kills with SIGTERM on timeout and reports a timeout message", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("긴 작업", { timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");

    fakeChild.emit("close", null);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.text).toContain("제한 시간");
  });

  it("escalates to SIGKILL if the process ignores SIGTERM past the grace period", async () => {
    const provider = new ClaudeCodeProvider(baseConfig({ killGraceMs: 50 }) as any, createLogger());
    const resultPromise = provider.run("긴 작업", { timeoutMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    expect(fakeChild.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(50);
    expect(fakeChild.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    fakeChild.emit("close", null);
    await resultPromise;
  });

  it("kills and reports failure when combined output exceeds the byte limit", async () => {
    const provider = new ClaudeCodeProvider(baseConfig({ maxOutputBytes: 10 }) as any, createLogger());
    const resultPromise = provider.run("hi", { timeoutMs: 5000 });

    fakeChild.stdout.emit("data", Buffer.from("this is definitely over ten bytes"));
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");

    fakeChild.emit("close", null);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.text).toContain("크기");
  });
});
