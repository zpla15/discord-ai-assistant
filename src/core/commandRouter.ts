import type { AccessPolicy } from "./accessControl.js";
import { isAllowed } from "./accessControl.js";
import type { TaskQueue } from "./taskQueue.js";
import type { IncomingMessage, OutgoingResponder } from "./types.js";
import type { AIProvider } from "../providers/aiProvider.js";

export interface RouterLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface CommandRouterDeps {
  readonly accessPolicy: AccessPolicy;
  readonly queue: TaskQueue;
  readonly provider: AIProvider;
  readonly taskTimeoutMs: number;
  readonly logger: RouterLogger;
}

export interface CommandRouter {
  handle(message: IncomingMessage, responder: OutgoingResponder): void;
}

/**
 * Discord-agnostic orchestration: access check -> single-flight queue -> AI
 * provider -> respond. Unauthorized senders are silently ignored (no reply),
 * so the bot's presence isn't confirmed to anyone but the owner.
 */
export function createCommandRouter(deps: CommandRouterDeps): CommandRouter {
  return {
    handle(message, responder) {
      if (!isAllowed(deps.accessPolicy, message.userId, message.channelId)) {
        deps.logger.warn("허용되지 않은 발신자의 명령을 무시함", {
          userId: message.userId,
          channelId: message.channelId,
        });
        return;
      }

      const { position } = deps.queue.enqueue(async () => {
        try {
          const result = await responder.withProgress(() =>
            deps.provider.run(message.text, { timeoutMs: deps.taskTimeoutMs }),
          );
          await responder.send(result.text);
        } catch (error) {
          deps.logger.error("작업 실행 중 예외 발생", { error: (error as Error).message });
          await responder.send("작업 처리 중 오류가 발생했습니다.");
        }
      });

      if (position > 0) {
        void responder.notifyQueued(position);
      }
    },
  };
}
