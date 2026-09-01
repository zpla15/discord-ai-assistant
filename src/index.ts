import { DiscordAdapter } from "./adapters/discord/discordAdapter.js";
import { loadConfig } from "./config.js";
import { createAccessPolicy } from "./core/accessControl.js";
import { createCommandRouter } from "./core/commandRouter.js";
import { TaskQueue } from "./core/taskQueue.js";
import { createLogger } from "./logging/logger.js";
import { ClaudeCodeProvider } from "./providers/claudeCodeProvider.js";
import { CLAUDE_ALLOWED_TOOLS, CLAUDE_DISALLOWED_TOOLS, CLAUDE_TOOLS } from "./providers/claudeToolPolicy.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const accessPolicy = createAccessPolicy(config.allowedUserId, config.allowedChannelIds);
  const queue = new TaskQueue();

  const provider = new ClaudeCodeProvider(
    {
      claudeBin: config.claudeBin,
      workspaceDir: config.claudeWorkspaceDir,
      maxOutputBytes: config.claudeMaxOutputBytes,
      tools: CLAUDE_TOOLS,
      allowedTools: CLAUDE_ALLOWED_TOOLS,
      disallowedTools: CLAUDE_DISALLOWED_TOOLS,
    },
    logger,
  );

  const router = createCommandRouter({
    accessPolicy,
    queue,
    provider,
    taskTimeoutMs: config.taskTimeoutMs,
    logger,
  });

  const adapter = new DiscordAdapter({ token: config.discordBotToken }, router, logger);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("종료 신호 수신, 정상 종료 진행", { signal, pendingTasks: queue.pendingCount });
    try {
      await adapter.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await adapter.start();
  logger.info("Discord AI 비서 시작됨", { allowedChannels: config.allowedChannelIds.length });
}

main().catch((error: unknown) => {
  console.error("치명적 오류로 종료합니다:", error);
  process.exit(1);
});
