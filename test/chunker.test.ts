import { describe, expect, it } from "vitest";
import { chunkMessage, DISCORD_MAX_MESSAGE_LENGTH } from "../src/adapters/discord/chunker.js";

describe("chunkMessage", () => {
  it("returns an empty array for empty input", () => {
    expect(chunkMessage("")).toEqual([]);
  });

  it("returns a single chunk when text fits", () => {
    expect(chunkMessage("hello")).toEqual(["hello"]);
  });

  it("returns a single chunk at exactly the max length boundary", () => {
    const text = "a".repeat(DISCORD_MAX_MESSAGE_LENGTH);
    const chunks = chunkMessage(text);
    expect(chunks).toEqual([text]);
  });

  it("splits on line boundaries once the limit is exceeded", () => {
    const line = "a".repeat(1000);
    const text = [line, line, line].join("\n");
    const chunks = chunkMessage(text, 1500);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1500);
    }
    expect(chunks.join("\n")).toBe(text);
  });

  it("hard-splits a single line longer than max length", () => {
    const longLine = "x".repeat(2500);
    const chunks = chunkMessage(longLine, 1000);

    expect(chunks).toEqual([longLine.slice(0, 1000), longLine.slice(1000, 2000), longLine.slice(2000)]);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
    }
  });
});
