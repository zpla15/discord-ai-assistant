import pino from "pino";

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Thin wrapper around pino that exposes a (message, meta) call order — the
 * opposite of pino's native (mergingObject, message) — so every other module
 * in this codebase can depend on the simple `Logger` interface instead of
 * pino's types directly.
 */
export function createLogger(level: string): Logger {
  const isTty = process.stdout.isTTY === true;
  const pinoLogger = pino({
    level,
    redact: {
      paths: ["token", "*.token", "DISCORD_BOT_TOKEN", "*.DISCORD_BOT_TOKEN"],
      censor: "[REDACTED]",
    },
    transport: isTty ? { target: "pino-pretty" } : undefined,
  });

  return {
    info: (message, meta) => pinoLogger.info(meta ?? {}, message),
    warn: (message, meta) => pinoLogger.warn(meta ?? {}, message),
    error: (message, meta) => pinoLogger.error(meta ?? {}, message),
  };
}
