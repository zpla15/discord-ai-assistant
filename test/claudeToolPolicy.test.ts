import { describe, expect, it } from "vitest";
import {
  CLAUDE_ALLOWED_TOOLS,
  CLAUDE_DISALLOWED_TOOLS,
  CLAUDE_SYSTEM_PROMPT,
  CLAUDE_TOOLS,
} from "../src/providers/claudeToolPolicy.js";

describe("claudeToolPolicy", () => {
  // Regression guard: under --permission-mode dontAsk, a tool absent from
  // allowedTools is denied. Read-only tools auto-approve but the mutating ones
  // do not, so dropping these entries silently reduces the bot to "can
  // diagnose, cannot fix" — which is exactly the bug this list was added for.
  it("pre-approves the mutating file tools so the agent can actually apply fixes", () => {
    for (const tool of ["Edit", "Write"]) {
      expect(CLAUDE_ALLOWED_TOOLS).toContain(tool);
    }
  });

  it("enables the file tools it pre-approves", () => {
    for (const tool of ["Read", "Edit", "Write", "Glob", "Grep"]) {
      expect(CLAUDE_TOOLS).toContain(tool);
    }
  });

  it("never allows a privilege-escalation or destructive command", () => {
    for (const pattern of ["Bash(sudo*)", "Bash(rm*)"]) {
      expect(CLAUDE_DISALLOWED_TOOLS).toContain(pattern);
      expect(CLAUDE_ALLOWED_TOOLS).not.toContain(pattern);
    }
  });

  // `cd` must never be pre-approved: allow/deny both match on the command-string
  // prefix, so `Bash(cd*)` would let `cd /tmp && rm -rf ~` past the deny-list,
  // since that string does not start with `rm`.
  it("does not pre-approve any command that would let a chain bypass the deny-list", () => {
    for (const entry of CLAUDE_ALLOWED_TOOLS) {
      expect(entry).not.toMatch(/^Bash\((cd|sh|bash|env|eval|xargs)\b/);
    }
  });

  it("tells the model the one-command-per-call constraint the allowlist implies", () => {
    expect(CLAUDE_SYSTEM_PROMPT).toContain("&&");
    expect(CLAUDE_SYSTEM_PROMPT).toContain("절대 경로");
    expect(CLAUDE_SYSTEM_PROMPT).toContain("git push");
  });
});
