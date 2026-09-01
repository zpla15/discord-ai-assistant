export interface TypingCapableChannel {
  sendTyping(): Promise<void>;
}

const REFRESH_INTERVAL_MS = 8000;

/**
 * Keeps Discord's "typing..." indicator alive (it expires after ~10s) for the
 * duration of `fn`, so long-running tasks show visible progress.
 */
export async function withTypingIndicator<T>(channel: TypingCapableChannel, fn: () => Promise<T>): Promise<T> {
  void channel.sendTyping().catch(() => {});
  const interval = setInterval(() => {
    void channel.sendTyping().catch(() => {});
  }, REFRESH_INTERVAL_MS);

  try {
    return await fn();
  } finally {
    clearInterval(interval);
  }
}
