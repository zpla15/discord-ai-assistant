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
  /** Directory Claude is confined to (passed to --add-dir and used as cwd). */
  readonly workspaceDir: string;
  /** Kill the process if combined stdout+stderr exceeds this many bytes. */
  readonly maxOutputBytes: number;
  /** Built-in tool names to enable at all, e.g. ["Read", "Edit", "Bash"]. Anything not listed does not exist for the model. */
  readonly tools: readonly string[];
  /** Fine-grained pre-approved patterns, e.g. ["Bash(npm test:*)", "Bash(git status)"]. */
  readonly allowedTools: readonly string[];
  /** Defense-in-depth denials, e.g. ["Bash(sudo*)", "Bash(rm -rf*)"]. */
  readonly disallowedTools: readonly string[];
  /** Grace period after SIGTERM before escalating to SIGKILL. */
  readonly killGraceMs?: number;
}

interface ClaudeResultPayload {
  readonly is_error: boolean;
  readonly result: string;
  readonly permission_denials?: readonly unknown[];
}

const DEFAULT_KILL_GRACE_MS = 5000;

/**
 * Runs the Claude Code CLI non-interactively, one prompt per invocation
 * (stateless by design — see plan doc). Never uses
 * --dangerously-skip-permissions: the tool surface is locked down via
 * --restricted + an explicit --tools allowlist so out-of-scope actions are
 * simply unavailable to the model rather than something to approve.
 */
export class ClaudeCodeProvider implements AIProvider {
  constructor(
    private readonly config: ClaudeCodeProviderConfig,
    private readonly logger: ClaudeCodeLogger,
  ) {}

  async run(prompt: string, options: AIProviderOptions): Promise<TaskResult> {
    return this.execute(this.buildArgs(prompt), options.timeoutMs);
  }

  private buildArgs(prompt: string): string[] {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "json",
      "--restricted",
      "--add-dir",
      this.config.workspaceDir,
      "--tools",
      this.config.tools.join(","),
      "--permission-mode",
      "dontAsk",
    ];

    if (this.config.allowedTools.length > 0) {
      args.push("--allowedTools", this.config.allowedTools.join(","));
    }
    if (this.config.disallowedTools.length > 0) {
      args.push("--disallowedTools", this.config.disallowedTools.join(","));
    }

    return args;
  }

  private execute(args: readonly string[], timeoutMs: number): Promise<TaskResult> {
    return new Promise((resolve) => {
      const child = spawn(this.config.claudeBin, args, {
        cwd: this.config.workspaceDir,
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
        finish(this.parseResult(code, stdout, stderr));
      });
    });
  }

  private parseResult(exitCode: number | null, stdout: string, stderr: string): TaskResult {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) {
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

    return { ok: !parsed.is_error, text: parsed.result };
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
