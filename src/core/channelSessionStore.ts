import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Map of channelId -> last Claude session id, so each Discord channel can
 * continue its own conversation via `claude --resume`.
 *
 * When constructed with a `filePath`, the map is loaded from that JSON file
 * on startup and rewritten on every change, so a bot restart (deploy,
 * crash, reboot) does not drop every channel back to a fresh conversation.
 * Without a path it is purely in-memory (used by tests).
 */
export class ChannelSessionStore {
  private readonly sessions = new Map<string, string>();

  constructor(private readonly filePath?: string) {
    if (filePath) this.load(filePath);
  }

  get(channelId: string): string | undefined {
    return this.sessions.get(channelId);
  }

  set(channelId: string, sessionId: string): void {
    if (this.sessions.get(channelId) === sessionId) return;
    this.sessions.set(channelId, sessionId);
    this.persist();
  }

  clear(channelId: string): void {
    if (!this.sessions.delete(channelId)) return;
    this.persist();
  }

  private load(filePath: string): void {
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`세션 저장 파일 형식이 잘못되었습니다: ${filePath}`);
    }
    for (const [channelId, sessionId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof sessionId === "string" && sessionId.length > 0) {
        this.sessions.set(channelId, sessionId);
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    // Write to a temp file then rename so a crash mid-write can't leave a
    // truncated JSON file that fails to load on the next start.
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(Object.fromEntries(this.sessions), null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmpPath, this.filePath);
  }
}
