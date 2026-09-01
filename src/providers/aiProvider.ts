export interface TaskResult {
  readonly ok: boolean;
  readonly text: string;
}

export interface AIProviderOptions {
  readonly timeoutMs: number;
}

/**
 * Abstraction over an AI coding-agent backend. `claudeCodeProvider` is the only
 * implementation today; a future `codexProvider` can implement the same
 * interface so `index.ts` only needs to swap one constructor call.
 */
export interface AIProvider {
  run(prompt: string, options: AIProviderOptions): Promise<TaskResult>;
}
