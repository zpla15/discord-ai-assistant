/**
 * Common shape every message-intake adapter (Discord today; Telegram/Slack
 * later) must implement so `index.ts` can wire any of them to the same
 * core command router without core code knowing which platform it is.
 */
export interface MessageAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
}
