import { describe, expect, it } from "vitest";
import { parseChannelWorkspaces } from "../src/config.js";

describe("parseChannelWorkspaces", () => {
  it("parses multiple channelId:path pairs", () => {
    const result = parseChannelWorkspaces("111:/home/nova/projects/work,222:/home/nova/projects/personal");
    expect(result.get("111")).toBe("/home/nova/projects/work");
    expect(result.get("222")).toBe("/home/nova/projects/personal");
    expect(result.size).toBe(2);
  });

  it("trims whitespace around entries", () => {
    const result = parseChannelWorkspaces(" 111 : /home/nova/projects/work , 222:/home/nova/projects/personal ");
    expect(result.get("111")).toBe("/home/nova/projects/work");
    expect(result.get("222")).toBe("/home/nova/projects/personal");
  });

  it("rejects an entry missing the channelId:path separator", () => {
    expect(() => parseChannelWorkspaces("111-missing-colon")).toThrow(/형식 오류/);
  });

  it("rejects an entry with an empty channelId or path", () => {
    expect(() => parseChannelWorkspaces(":/home/nova/projects/work")).toThrow(/형식 오류/);
    expect(() => parseChannelWorkspaces("111:")).toThrow(/형식 오류/);
  });

  it("rejects an empty configuration", () => {
    expect(() => parseChannelWorkspaces("")).toThrow(/유효한 채널이 하나도/);
    expect(() => parseChannelWorkspaces("  ,  ")).toThrow(/유효한 채널이 하나도/);
  });
});
