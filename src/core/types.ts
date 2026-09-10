export interface IncomingMessage {
  readonly text: string;
  readonly userId: string;
  /**
   * Where this conversation lives. A Discord thread has its own channel id, so
   * each thread is automatically its own session — the equivalent of a Telegram
   * forum topic.
   */
  readonly channelId: string;
  /**
   * The channel whose access + workspace configuration applies. Identical to
   * `channelId` for a normal channel; for a thread it is the *parent* channel,
   * so threads inherit their parent's permission and workspace without every
   * thread id having to be listed in CHANNEL_WORKSPACES (they are created on
   * the fly and could never be pre-configured).
   */
  readonly configChannelId: string;
}

export interface OutgoingResponder {
  send(text: string): Promise<void>;
  notifyQueued(position: number): Promise<void>;
  /** Wraps a running task with adapter-specific "in progress" feedback (e.g. Discord typing indicator). */
  withProgress<T>(fn: () => Promise<T>): Promise<T>;
}
