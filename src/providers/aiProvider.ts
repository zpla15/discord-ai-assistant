export interface TaskResult {
  readonly ok: boolean;
  readonly text: string;
  /** The Claude session id this run created/continued, for the caller to persist and pass back via `sessionId`. */
  readonly sessionId?: string;
  /** Set when a `sessionId` was passed in but Claude no longer has that conversation (e.g. pruned). The caller should drop it and retry fresh. */
  readonly sessionExpired?: boolean;
}

export interface AIProviderOptions {
  readonly timeoutMs: number;
  /** Directory this run is confined to (cwd + --add-dir). */
  readonly workspaceDir: string;
  /** When set, continues that Claude session instead of starting fresh. */
  readonly sessionId?: string;
}

/**
 * Abstraction over an AI coding-agent backend. `claudeCodeProvider` is the only
 * implementation today; a future `codexProvider` can implement the same
 * interface so `index.ts` only needs to swap one constructor call.
 */
export interface AIProvider {
  run(prompt: string, options: AIProviderOptions): Promise<TaskResult>;
}
