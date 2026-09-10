import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const EnvSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN이 필요합니다"),
  ALLOWED_USER_ID: z.string().min(1, "ALLOWED_USER_ID가 필요합니다"),
  CHANNEL_WORKSPACES: z.string().min(1, "CHANNEL_WORKSPACES가 필요합니다"),
  CLAUDE_BIN: z.string().min(1).default("claude"),
  TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  CLAUDE_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(2_000_000),
  LOG_LEVEL: z.string().default("info"),
  SESSION_STORE_PATH: z.string().min(1).default("data/sessions.json"),
});

export interface AppConfig {
  readonly discordBotToken: string;
  readonly allowedUserId: string;
  /** channelId -> absolute workspace directory for that channel. */
  readonly channelWorkspaces: ReadonlyMap<string, string>;
  readonly claudeBin: string;
  readonly taskTimeoutMs: number;
  readonly claudeMaxOutputBytes: number;
  readonly logLevel: string;
  /** Absolute path of the JSON file that remembers each channel's last Claude session id across restarts. */
  readonly sessionStorePath: string;
}

/**
 * Parses "channelId:/abs/path,channelId2:/abs/path2" into a channelId -> path
 * map. Each Discord channel gets its own confined Claude workspace (see
 * accessControl / commandRouter).
 */
export function parseChannelWorkspaces(raw: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`CHANNEL_WORKSPACES 형식 오류 - "channelId:/path" 형태여야 합니다: "${trimmed}"`);
    }

    const channelId = trimmed.slice(0, separatorIndex).trim();
    const workspaceDir = trimmed.slice(separatorIndex + 1).trim();
    if (channelId.length === 0 || workspaceDir.length === 0) {
      throw new Error(`CHANNEL_WORKSPACES 형식 오류 - "channelId:/path" 형태여야 합니다: "${trimmed}"`);
    }

    entries.set(channelId, workspaceDir);
  }

  if (entries.size === 0) {
    throw new Error("CHANNEL_WORKSPACES에 유효한 채널이 하나도 없습니다");
  }

  return entries;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
    throw new Error(`환경 변수 설정 오류 - ${issues}`);
  }

  const data = parsed.data;
  return {
    discordBotToken: data.DISCORD_BOT_TOKEN,
    allowedUserId: data.ALLOWED_USER_ID,
    channelWorkspaces: parseChannelWorkspaces(data.CHANNEL_WORKSPACES),
    claudeBin: data.CLAUDE_BIN,
    taskTimeoutMs: data.TASK_TIMEOUT_MS,
    claudeMaxOutputBytes: data.CLAUDE_MAX_OUTPUT_BYTES,
    logLevel: data.LOG_LEVEL,
    sessionStorePath: resolve(data.SESSION_STORE_PATH),
  };
}
