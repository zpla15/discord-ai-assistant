import { describe, expect, it } from "vitest";
import { createAccessPolicy, getChannelConfig, isAllowed } from "../src/core/accessControl.js";

describe("accessControl", () => {
  const policy = createAccessPolicy(
    "owner-1",
    new Map([
      ["chan-1", "/workspaces/work"],
      ["chan-2", "/workspaces/personal"],
    ]),
  );

  it("allows the owner in an allowed channel", () => {
    expect(isAllowed(policy, "owner-1", "chan-1")).toBe(true);
    expect(isAllowed(policy, "owner-1", "chan-2")).toBe(true);
  });

  it("rejects a different user even in an allowed channel", () => {
    expect(isAllowed(policy, "intruder", "chan-1")).toBe(false);
  });

  it("rejects the owner in a non-allowed channel", () => {
    expect(isAllowed(policy, "owner-1", "chan-99")).toBe(false);
  });

  it("rejects when both user and channel are wrong", () => {
    expect(isAllowed(policy, "intruder", "chan-99")).toBe(false);
  });

  it("exposes each channel's own workspace directory", () => {
    expect(getChannelConfig(policy, "chan-1")?.workspaceDir).toBe("/workspaces/work");
    expect(getChannelConfig(policy, "chan-2")?.workspaceDir).toBe("/workspaces/personal");
    expect(getChannelConfig(policy, "chan-99")).toBeUndefined();
  });
});
