import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
import type { CommandRouter } from "../../core/commandRouter.js";
import type { OutgoingResponder } from "../../core/types.js";
import type { MessageAdapter } from "../messageAdapter.js";
import { chunkMessage } from "./chunker.js";
import { withTypingIndicator } from "./typingIndicator.js";

export interface DiscordAdapterLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface DiscordAdapterConfig {
  readonly token: string;
}

/**
 * The only module in this codebase that knows about discord.js. Translates
 * Discord messages into the Discord-agnostic `IncomingMessage`/`OutgoingResponder`
 * shapes the core command router understands.
 */
export class DiscordAdapter implements MessageAdapter {
  private readonly client: Client;

  constructor(
    private readonly config: DiscordAdapterConfig,
    private readonly router: CommandRouter,
    private readonly logger: DiscordAdapterLogger,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.ClientReady, (readyClient) => {
      this.logger.info("Discord 봇 로그인 완료", { tag: readyClient.user.tag });
    });

    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message).catch((error: unknown) => {
        this.logger.error("메시지 처리 중 오류", { error: (error as Error).message });
      });
    });
  }

  async start(): Promise<void> {
    await this.client.login(this.config.token);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (message.content.trim().length === 0) return;
    if (!message.channel.isSendable()) return;

    const channel = message.channel;
    const responder: OutgoingResponder = {
      send: async (text) => {
        for (const chunk of chunkMessage(text)) {
          await channel.send(chunk);
        }
      },
      notifyQueued: async (position) => {
        await channel.send(`현재 다른 작업을 처리 중입니다. 대기열에 추가되었습니다 (대기 순번: ${position}).`);
      },
      withProgress: (fn) => withTypingIndicator(channel, fn),
    };

    // In a thread, message.channelId is the *thread's* id. Access control and
    // the workspace mapping are configured per parent channel, so resolve to
    // the parent for those; the thread id still keys the session, giving each
    // thread its own independent conversation.
    const configChannelId = channel.isThread() ? (channel.parentId ?? message.channelId) : message.channelId;

    this.router.handle(
      {
        text: message.content,
        userId: message.author.id,
        channelId: message.channelId,
        configChannelId,
      },
      responder,
    );
  }
}
