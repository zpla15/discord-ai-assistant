export const DISCORD_MAX_MESSAGE_LENGTH = 2000;

/**
 * Splits text into Discord-safe chunks, preferring to break on line boundaries.
 * A single line longer than maxLength is hard-split as a last resort.
 */
export function chunkMessage(text: string, maxLength: number = DISCORD_MAX_MESSAGE_LENGTH): string[] {
  if (text.length === 0) {
    return [];
  }
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }

    if (line.length <= maxLength) {
      current = line;
    } else {
      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.slice(i, i + maxLength));
      }
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
