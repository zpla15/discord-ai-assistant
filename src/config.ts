import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const EnvSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN이 필요합니다"),
  ALLOWED_USER_ID: z.string().min(1, "ALLOWED_USER_ID가 필요합니다"),
  ALLOWED_CHANNEL_IDS: z.string().min(1, "ALLOWED_CHANNEL_IDS가 필요합니다"),
  CLAUDE_WORKSPACE_DIR: z.string().min(1, "CLAUDE_WORKSPACE_DIR이 필요합니다"),
  CLAUDE_BIN: z.string().min(1).default("claude"),
  TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  CLAUDE_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(2_000_000),
  LOG_LEVEL: z.string().default("info"),
});

export interface AppConfig {
  readonly discordBotToken: string;
  readonly allowedUserId: string;
  readonly allowedChannelIds: readonly string[];
  readonly claudeWorkspaceDir: string;
  readonly claudeBin: string;
  readonly taskTimeoutMs: number;
  readonly claudeMaxOutputBytes: number;
  readonly logLevel: string;
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
    allowedChannelIds: data.ALLOWED_CHANNEL_IDS.split(",").map((id) => id.trim()).filter((id) => id.length > 0),
    claudeWorkspaceDir: data.CLAUDE_WORKSPACE_DIR,
    claudeBin: data.CLAUDE_BIN,
    taskTimeoutMs: data.TASK_TIMEOUT_MS,
    claudeMaxOutputBytes: data.CLAUDE_MAX_OUTPUT_BYTES,
    logLevel: data.LOG_LEVEL,
  };
}
