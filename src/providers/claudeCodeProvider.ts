import { spawn } from "node:child_process";
import type { AIProvider, AIProviderOptions, TaskResult } from "./aiProvider.js";

export interface ClaudeCodeLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ClaudeCodeProviderConfig {
  /** Absolute path to the claude CLI binary. */
  readonly claudeBin: string;
  /** Kill the process if combined stdout+stderr exceeds this many bytes. */
  readonly maxOutputBytes: number;
  /** Built-in tool names to enable at all, e.g. ["Read", "Edit", "Bash"]. Anything not listed does not exist for the model. */
  readonly tools: readonly string[];
  /** Fine-grained pre-approved patterns, e.g. ["Bash(npm test:*)", "Bash(git status)"]. */
  readonly allowedTools: readonly string[];
  /** Defense-in-depth denials, e.g. ["Bash(sudo*)", "Bash(rm -rf*)"]. */
  readonly disallowedTools: readonly string[];
  /** Appended to Claude Code's built-in system prompt; tells the model the shape of the tool policy so it doesn't fight it. */
  readonly systemPrompt?: string;
  /** Grace period after SIGTERM before escalating to SIGKILL. */
  readonly killGraceMs?: number;
}

interface ClaudeResultPayload {
  readonly is_error: boolean;
  readonly result: string;
  readonly session_id?: string;
  readonly permission_denials?: readonly unknown[];
}

const DEFAULT_KILL_GRACE_MS = 5000;

/**
 * Runs the Claude Code CLI non-interactively. Each call is confined to the
 * `workspaceDir` given in its options (cwd + --add-dir) and, when
 * `sessionId` is given, continues that conversation via --resume instead of
 * starting fresh — the caller (commandRouter, per Discord channel) owns
 * which workspace/session a given prompt belongs to. Never uses
 * --dangerously-skip-permissions: the tool surface is locked down via
 * --restricted + an explicit --tools list so out-of-scope actions are simply
 * unavailable to the model rather than something to approve.
 */
export class ClaudeCodeProvider implements AIProvider {
  constructor(
    private readonly config: ClaudeCodeProviderConfig,
    private readonly logger: ClaudeCodeLogger,
  ) {}

  async run(prompt: string, options: AIProviderOptions): Promise<TaskResult> {
    return this.execute(
      this.buildArgs(prompt, options),
      options.timeoutMs,
      options.workspaceDir,
      options.sessionId,
    );
  }

  private buildArgs(prompt: string, options: AIProviderOptions): string[] {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--restricted",
      "--add-dir",
      options.workspaceDir,
      "--tools",
      this.config.tools.join(","),
      "--permission-mode",
      "dontAsk",
    ];

    if (this.config.systemPrompt) {
      args.push("--append-system-prompt", this.config.systemPrompt);
    }
    if (this.config.allowedTools.length > 0) {
      args.push("--allowedTools", this.config.allowedTools.join(","));
    }
    if (this.config.disallowedTools.length > 0) {
      args.push("--disallowedTools", this.config.disallowedTools.join(","));
    }
    if (options.sessionId) {
      args.push("--resume", options.sessionId);
    }

    return args;
  }

  private execute(
    args: readonly string[],
    timeoutMs: number,
    workspaceDir: string,
    resumedSessionId: string | undefined,
  ): Promise<TaskResult> {
    return new Promise((resolve) => {
      const child = spawn(this.config.claudeBin, args, {
        cwd: workspaceDir,
        env: minimalEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let settled = false;
      let killedForTimeout = false;
      let killedForOutputLimit = false;

      const finish = (result: TaskResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        resolve(result);
      };

      const killGracefully = (): void => {
        child.kill("SIGTERM");
        const graceTimer = setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, this.config.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
        graceTimer.unref();
      };

      const timeoutTimer = setTimeout(() => {
        killedForTimeout = true;
        killGracefully();
      }, timeoutMs);
      timeoutTimer.unref();

      const onData = (chunk: Buffer, append: (text: string) => void): void => {
        outputBytes += chunk.byteLength;
        if (outputBytes > this.config.maxOutputBytes) {
          killedForOutputLimit = true;
          killGracefully();
          return;
        }
        append(chunk.toString("utf8"));
      };

      child.stdout.on("data", (chunk: Buffer) => onData(chunk, (t) => (stdout += t)));
      child.stderr.on("data", (chunk: Buffer) => onData(chunk, (t) => (stderr += t)));

      child.on("error", (err) => {
        this.logger.error("claude 프로세스 실행 실패", { error: err.message });
        finish({ ok: false, text: `Claude Code 실행에 실패했습니다: ${err.message}` });
      });

      child.on("close", (code) => {
        if (killedForTimeout) {
          finish({
            ok: false,
            text: `작업이 제한 시간(${Math.round(timeoutMs / 1000)}초)을 초과해 중단되었습니다.`,
          });
          return;
        }
        if (killedForOutputLimit) {
          finish({ ok: false, text: "응답 크기가 제한을 초과해 작업을 중단했습니다." });
          return;
        }
        finish(this.parseResult(code, stdout, stderr, resumedSessionId));
      });
    });
  }

  private parseResult(
    exitCode: number | null,
    stdout: string,
    stderr: string,
    resumedSessionId: string | undefined,
  ): TaskResult {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
      if (resumedSessionId && /No conversation found with session ID/i.test(stderr)) {
        this.logger.warn("이어가려던 세션을 더 이상 찾을 수 없음, 새 세션으로 재시도 예정", {
          sessionId: resumedSessionId,
        });
        return { ok: false, text: "", sessionExpired: true };
      }
      this.logger.warn("claude 출력이 비어 있음", { exitCode, stderr: stderr.slice(0, 500) });
      return { ok: false, text: "Claude Code로부터 응답을 받지 못했습니다." };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.logger.warn("claude 출력 JSON 파싱 실패", { exitCode });
      return { ok: exitCode === 0, text: trimmed };
    }

    if (!isResultPayload(parsed)) {
      this.logger.warn("claude 출력 형식이 예상과 다름", { exitCode });
      return { ok: exitCode === 0, text: trimmed };
    }

    if (parsed.permission_denials && parsed.permission_denials.length > 0) {
      this.logger.warn("claude 권한 거부 발생", { denials: parsed.permission_denials });
    }

    return { ok: !parsed.is_error, text: parsed.result, sessionId: parsed.session_id };
  }
}

function isResultPayload(value: unknown): value is ClaudeResultPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.result === "string" && typeof record.is_error === "boolean";
}

function minimalEnv(): NodeJS.ProcessEnv {
  const { HOME, PATH, LANG, LC_ALL } = process.env;
  return { HOME, PATH, LANG, LC_ALL };
}
