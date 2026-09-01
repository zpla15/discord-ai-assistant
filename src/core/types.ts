export interface IncomingMessage {
  readonly text: string;
  readonly userId: string;
  readonly channelId: string;
}

export interface OutgoingResponder {
  send(text: string): Promise<void>;
  notifyQueued(position: number): Promise<void>;
  /** Wraps a running task with adapter-specific "in progress" feedback (e.g. Discord typing indicator). */
  withProgress<T>(fn: () => Promise<T>): Promise<T>;
}
