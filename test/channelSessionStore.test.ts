import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelSessionStore } from "../src/core/channelSessionStore.js";

describe("ChannelSessionStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-store-"));
    filePath = join(dir, "nested", "sessions.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("works purely in memory when no file path is given", () => {
    const store = new ChannelSessionStore();
    store.set("chan-1", "sess-a");
    expect(store.get("chan-1")).toBe("sess-a");
    store.clear("chan-1");
    expect(store.get("chan-1")).toBeUndefined();
  });

  it("starts empty when the file does not exist yet", () => {
    const store = new ChannelSessionStore(filePath);
    expect(store.get("chan-1")).toBeUndefined();
    expect(existsSync(filePath)).toBe(false);
  });

  it("persists sessions so a new instance sees them after a restart", () => {
    const first = new ChannelSessionStore(filePath);
    first.set("chan-1", "sess-a");
    first.set("chan-2", "sess-b");

    const second = new ChannelSessionStore(filePath);
    expect(second.get("chan-1")).toBe("sess-a");
    expect(second.get("chan-2")).toBe("sess-b");
  });

  it("persists clears too", () => {
    const first = new ChannelSessionStore(filePath);
    first.set("chan-1", "sess-a");
    first.clear("chan-1");

    const second = new ChannelSessionStore(filePath);
    expect(second.get("chan-1")).toBeUndefined();
  });

  it("writes plain JSON and leaves no temp file behind", () => {
    const store = new ChannelSessionStore(filePath);
    store.set("chan-1", "sess-a");
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({ "chan-1": "sess-a" });
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it("ignores malformed entries in an existing file", () => {
    const flat = join(dir, "sessions.json");
    writeFileSync(flat, JSON.stringify({ "chan-1": "sess-a", "chan-2": 42, "chan-3": "" }));
    const store = new ChannelSessionStore(flat);
    expect(store.get("chan-1")).toBe("sess-a");
    expect(store.get("chan-2")).toBeUndefined();
    expect(store.get("chan-3")).toBeUndefined();
  });

  it("throws on a file that is not a JSON object", () => {
    const flat = join(dir, "sessions.json");
    writeFileSync(flat, JSON.stringify(["not", "an", "object"]));
    expect(() => new ChannelSessionStore(flat)).toThrow(/형식이 잘못/);
  });
});
