import type { AccessPolicy } from "./accessControl.js";
import { getChannelConfig, isAllowed } from "./accessControl.js";
import type { ChannelSessionStore } from "./channelSessionStore.js";
import type { TaskQueue } from "./taskQueue.js";
import type { IncomingMessage, OutgoingResponder } from "./types.js";
import type { AIProvider } from "../providers/aiProvider.js";

export const RESET_COMMAND = "!reset";
export const RESTART_COMMAND = "!restart";
/** Prefix a message with this to have the reply @mention you once the task finishes. */
export const NOTIFY_PREFIX = "!notify ";

export interface RouterLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface CommandRouterDeps {
  readonly accessPolicy: AccessPolicy;
  readonly queue: TaskQueue;
  readonly provider: AIProvider;
  readonly sessions: ChannelSessionStore;
  readonly taskTimeoutMs: number;
  readonly logger: RouterLogger;
  /**
   * Shuts the process down so systemd (Restart=always) starts it again.
   * Deliberately NOT `sudo systemctl restart`: that kills the unit's whole
   * cgroup, including the claude subprocess handling this very message, so the
   * Discord reply would never be sent. Exiting ourselves lets us reply first,
   * and needs no privilege escalation at all.
   */
  readonly onRestart: () => void;
}

export interface CommandRouter {
  handle(message: IncomingMessage, responder: OutgoingResponder): void;
}

/**
 * Discord-agnostic orchestration: access check -> single-flight queue -> AI
 * provider -> respond. Unauthorized senders are silently ignored (no reply),
 * so the bot's presence isn't confirmed to anyone but the owner.
 *
 * Each Discord channel is its own workspace and its own conversation: the
 * channel's workspaceDir (see accessControl) is passed to the provider as
 * the confinement directory, and the channel's last Claude session id (see
 * channelSessionStore) is resumed on the next message from that channel, so
 * "회사 업무" / "개인프로젝트" / "디자인업무" channels stay independent of
 * each other.
 *
 * Threads work the same way one level down: a thread carries its own channel
 * id, so it gets its own session, while `configChannelId` (its parent) decides
 * whether it is allowed and which workspace it uses. That gives per-topic
 * conversations without listing every thread in CHANNEL_WORKSPACES. Send `!reset` in a channel to drop its remembered session, or
 * `!restart` to restart the bot process itself (see `onRestart`). Both are
 * handled here rather than by the AI provider so they stay deterministic and
 * cannot be triggered by anything the model reads.
 *
 * If the remembered session id has gone stale (Claude no longer has that
 * conversation), the provider reports `sessionExpired` and this router drops
 * it and retries once fresh, so a channel never gets permanently stuck
 * failing on every message.
 */
export function createCommandRouter(deps: CommandRouterDeps): CommandRouter {
  return {
    handle(message, responder) {
      if (!isAllowed(deps.accessPolicy, message.userId, message.configChannelId)) {
        deps.logger.warn("허용되지 않은 발신자의 명령을 무시함", {
          userId: message.userId,
          channelId: message.channelId,
          configChannelId: message.configChannelId,
        });
        return;
      }

      const channelConfig = getChannelConfig(deps.accessPolicy, message.configChannelId);
      if (!channelConfig) {
        deps.logger.error("허용된 채널인데 작업 디렉터리 설정이 없음", {
          configChannelId: message.configChannelId,
        });
        return;
      }

      if (message.text.trim() === RESET_COMMAND) {
        deps.sessions.clear(message.channelId);
        void responder.send("이 채널의 대화 맥락을 초기화했습니다.");
        return;
      }

      if (message.text.trim() === RESTART_COMMAND) {
        // Reply *before* exiting — once the process is gone there is no way to
        // tell Discord anything, and the restart itself is not observable from
        // the user's side.
        const pending = deps.queue.pendingCount;
        const warning = pending > 0 ? ` 대기 중이던 작업 ${pending}건은 취소됩니다.` : "";
        void (async () => {
          try {
            await responder.send(`재시작합니다. 잠시 후 다시 사용할 수 있습니다.${warning}`);
          } catch (error) {
            deps.logger.error("재시작 안내 전송 실패", { error: (error as Error).message });
          }
          deps.onRestart();
        })();
        return;
      }

      const notify = message.text.startsWith(NOTIFY_PREFIX);
      const prompt = notify ? message.text.slice(NOTIFY_PREFIX.length) : message.text;

      const { position } = deps.queue.enqueue(async () => {
        try {
          let result = await responder.withProgress(() =>
            deps.provider.run(prompt, {
              timeoutMs: deps.taskTimeoutMs,
              workspaceDir: channelConfig.workspaceDir,
              sessionId: deps.sessions.get(message.channelId),
            }),
          );
          if (result.sessionExpired) {
            deps.sessions.clear(message.channelId);
            result = await responder.withProgress(() =>
              deps.provider.run(prompt, {
                timeoutMs: deps.taskTimeoutMs,
                workspaceDir: channelConfig.workspaceDir,
                sessionId: undefined,
              }),
            );
          }
          if (result.sessionId) {
            deps.sessions.set(message.channelId, result.sessionId);
          }
          await responder.send(notify ? `<@${message.userId}> ${result.text}` : result.text);
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
