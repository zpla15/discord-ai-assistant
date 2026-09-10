import { DiscordAdapter } from "./adapters/discord/discordAdapter.js";
import { loadConfig } from "./config.js";
import { createAccessPolicy } from "./core/accessControl.js";
import { ChannelSessionStore } from "./core/channelSessionStore.js";
import { createCommandRouter, RESTART_COMMAND } from "./core/commandRouter.js";
import { TaskQueue } from "./core/taskQueue.js";
import { createLogger } from "./logging/logger.js";
import { ClaudeCodeProvider } from "./providers/claudeCodeProvider.js";
import {
  CLAUDE_ALLOWED_TOOLS,
  CLAUDE_DISALLOWED_TOOLS,
  CLAUDE_SYSTEM_PROMPT,
  CLAUDE_TOOLS,
} from "./providers/claudeToolPolicy.js";

async function main(): Promise<void> {
  // Assigned once the adapter exists; the router may hold a reference to it
  // before then, so it is called through this indirection rather than captured.
  let restartRequested: () => void = () => process.exit(0);

  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const accessPolicy = createAccessPolicy(config.allowedUserId, config.channelWorkspaces);
  const queue = new TaskQueue();
  const sessions = new ChannelSessionStore(config.sessionStorePath);

  const provider = new ClaudeCodeProvider(
    {
      claudeBin: config.claudeBin,
      maxOutputBytes: config.claudeMaxOutputBytes,
      tools: CLAUDE_TOOLS,
      allowedTools: CLAUDE_ALLOWED_TOOLS,
      disallowedTools: CLAUDE_DISALLOWED_TOOLS,
      systemPrompt: CLAUDE_SYSTEM_PROMPT,
    },
    logger,
  );

  const router = createCommandRouter({
    accessPolicy,
    queue,
    provider,
    sessions,
    taskTimeoutMs: config.taskTimeoutMs,
    logger,
    onRestart: () => restartRequested(),
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

  // `!restart` exits cleanly; the unit's Restart=always brings the process back
  // a few seconds later. Requires no sudo — see CommandRouterDeps.onRestart.
  restartRequested = () => void shutdown(RESTART_COMMAND);

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await adapter.start();
  logger.info("Discord AI 비서 시작됨", { allowedChannels: config.channelWorkspaces.size });
}

main().catch((error: unknown) => {
  console.error("치명적 오류로 종료합니다:", error);
  process.exit(1);
});
