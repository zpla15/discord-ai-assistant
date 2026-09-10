import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { ClaudeCodeProvider } = await import("../src/providers/claudeCodeProvider.js");

const WORKSPACE_DIR = "/home/nova/projects/work";

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
    maxOutputBytes: 1000,
    tools: ["Read", "Edit", "Bash"],
    allowedTools: ["Bash(npm test:*)", "Bash(git status)"],
    disallowedTools: ["Bash(sudo*)", "Bash(rm -rf*)"],
    killGraceMs: 50,
    ...overrides,
  };
}

function runOptions(overrides: Partial<Record<string, unknown>> = {}) {
  return { timeoutMs: 5000, workspaceDir: WORKSPACE_DIR, ...overrides };
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
    const resultPromise = provider.run("서버 상태 알려줘", runOptions());

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
      WORKSPACE_DIR,
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
    expect(options.cwd).toBe(WORKSPACE_DIR);

    fakeChild.stdout.emit("data", Buffer.from(JSON.stringify({ is_error: false, result: "ok" })));
    fakeChild.emit("close", 0);
    await expect(resultPromise).resolves.toEqual({ ok: true, text: "ok", sessionId: undefined });
  });

  it("passes the system prompt through --append-system-prompt when configured", async () => {
    const provider = new ClaudeCodeProvider(
      baseConfig({ systemPrompt: "한 번에 명령어 하나만 실행하세요." }) as any,
      createLogger(),
    );
    const resultPromise = provider.run("확인해줘", runOptions());

    const [, args] = spawnMock.mock.calls[0]!;
    expect(args).toEqual(
      expect.arrayContaining(["--append-system-prompt", "한 번에 명령어 하나만 실행하세요."]),
    );

    fakeChild.stdout.emit("data", Buffer.from(JSON.stringify({ is_error: false, result: "ok" })));
    fakeChild.emit("close", 0);
    await resultPromise;
  });

  it("omits --append-system-prompt when no system prompt is configured", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("확인해줘", runOptions());

    const [, args] = spawnMock.mock.calls[0]!;
    expect(args).not.toContain("--append-system-prompt");

    fakeChild.stdout.emit("data", Buffer.from(JSON.stringify({ is_error: false, result: "ok" })));
    fakeChild.emit("close", 0);
    await resultPromise;
  });

  it("appends --resume when a session id is given", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("이어서", runOptions({ sessionId: "session-abc" }));

    const [, args] = spawnMock.mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["--resume", "session-abc"]));

    fakeChild.stdout.emit("data", Buffer.from(JSON.stringify({ is_error: false, result: "ok" })));
    fakeChild.emit("close", 0);
    await resultPromise;
  });

  it("returns the new session id from the result payload", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("hi", runOptions());

    fakeChild.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ is_error: false, result: "ok", session_id: "new-session-id" })),
    );
    fakeChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({ ok: true, text: "ok", sessionId: "new-session-id" });
  });

  it("passes only a minimal, curated environment to the child process", () => {
    process.env.SOME_UNRELATED_SECRET = "should-not-leak";
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    void provider.run("hi", runOptions());

    const [, , options] = spawnMock.mock.calls[0]!;
    expect(Object.keys(options.env).sort()).toEqual(["HOME", "LANG", "LC_ALL", "PATH"].sort());
    delete process.env.SOME_UNRELATED_SECRET;

    fakeChild.stdout.emit("data", Buffer.from(JSON.stringify({ is_error: false, result: "ok" })));
    fakeChild.emit("close", 0);
  });

  it("maps is_error:true to ok:false while still returning the text", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("hi", runOptions());

    fakeChild.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ is_error: true, result: "허용되지 않은 작업입니다." })),
    );
    fakeChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      text: "허용되지 않은 작업입니다.",
      sessionId: undefined,
    });
  });

  it("reports sessionExpired when --resume can't find the given session", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("이어서", runOptions({ sessionId: "session-gone" }));

    fakeChild.stderr.emit("data", Buffer.from("No conversation found with session ID: session-gone\n"));
    fakeChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({ ok: false, text: "", sessionExpired: true });
  });

  it("does not report sessionExpired for an empty-output failure with no session resumed", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("hi", runOptions());

    fakeChild.stderr.emit("data", Buffer.from("some unrelated crash\n"));
    fakeChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      text: "Claude Code로부터 응답을 받지 못했습니다.",
    });
  });

  it("falls back to raw stdout text when JSON parsing fails", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("hi", runOptions());

    fakeChild.stdout.emit("data", Buffer.from("not json"));
    fakeChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({ ok: true, text: "not json" });
  });

  it("reports failure when the process errors before spawning succeeds", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("hi", runOptions());

    fakeChild.emit("error", new Error("ENOENT"));

    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.text).toContain("ENOENT");
  });

  it("kills with SIGTERM on timeout and reports a timeout message", async () => {
    const provider = new ClaudeCodeProvider(baseConfig() as any, createLogger());
    const resultPromise = provider.run("긴 작업", runOptions({ timeoutMs: 1000 }));

    await vi.advanceTimersByTimeAsync(1000);
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");

    fakeChild.emit("close", null);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.text).toContain("제한 시간");
  });

  it("escalates to SIGKILL if the process ignores SIGTERM past the grace period", async () => {
    const provider = new ClaudeCodeProvider(baseConfig({ killGraceMs: 50 }) as any, createLogger());
    const resultPromise = provider.run("긴 작업", runOptions({ timeoutMs: 1000 }));

    await vi.advanceTimersByTimeAsync(1000);
    expect(fakeChild.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    await vi.advanceTimersByTimeAsync(50);
    expect(fakeChild.kill).toHaveBeenNthCalledWith(2, "SIGKILL");

    fakeChild.emit("close", null);
    await resultPromise;
  });

  it("kills and reports failure when combined output exceeds the byte limit", async () => {
    const provider = new ClaudeCodeProvider(baseConfig({ maxOutputBytes: 10 }) as any, createLogger());
    const resultPromise = provider.run("hi", runOptions());

    fakeChild.stdout.emit("data", Buffer.from("this is definitely over ten bytes"));
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");

    fakeChild.emit("close", null);
    const result = await resultPromise;
    expect(result.ok).toBe(false);
    expect(result.text).toContain("크기");
  });
});
