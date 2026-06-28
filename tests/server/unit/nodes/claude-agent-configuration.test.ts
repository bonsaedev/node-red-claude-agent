import { describe, it, expect } from "vitest";
import { createNode } from "@bonsae/nrg/test/server/unit";
import ClaudeAgentConfiguration from "../../../../src/server/nodes/claude-agent-configuration";

/**
 * Build the SDK Options from a config (schema defaults fill the rest) and an
 * optional credentials bag. buildOptions() is pure, so this is all we need.
 */
async function buildOptions(
  config: Record<string, unknown> = {},
  credentials: Record<string, unknown> = { apiKey: "sk-test" },
) {
  const { node } = await createNode(ClaudeAgentConfiguration, {
    config,
    credentials,
  });
  return node.buildOptions();
}

describe("claude-agent-configuration", () => {
  describe("defaults", () => {
    it("assembles the documented defaults", async () => {
      const o = await buildOptions();

      // permission mode and the claude_code preset come straight from defaults —
      // the default is the SAFE "default" mode (bypassPermissions is opt-in)
      expect(o.permissionMode).toBe("default");
      expect(o.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
      // "user,project,local" splits into the loaded sources
      expect(o.settingSources).toEqual(["user", "project", "local"]);
      // the API key rides the spawned process env
      expect(o.env?.ANTHROPIC_API_KEY).toBe("sk-test");

      // nothing optional is set when left at defaults
      expect(o.model).toBeUndefined();
      expect(o.fallbackModel).toBeUndefined();
      expect(o.cwd).toBeUndefined();
      expect(o.allowedTools).toBeUndefined();
      expect(o.disallowedTools).toBeUndefined();
      expect(o.maxTurns).toBeUndefined();
      expect(o.maxBudgetUsd).toBeUndefined();
      expect(o.additionalDirectories).toBeUndefined();
      expect(o.supportedDialogKinds).toBeUndefined();
    });
  });

  describe("model + fallback", () => {
    it("sets the model when provided", async () => {
      const o = await buildOptions({ model: "claude-opus-4-8" });
      expect(o.model).toBe("claude-opus-4-8");
    });

    it("keeps a fallback that differs from the primary model", async () => {
      const o = await buildOptions({
        model: "claude-opus-4-8",
        fallbackModel: "claude-sonnet-4-6",
      });
      expect(o.fallbackModel).toBe("claude-sonnet-4-6");
    });

    it("drops a fallback equal to the primary model (the SDK rejects it)", async () => {
      const o = await buildOptions({
        model: "claude-opus-4-8",
        fallbackModel: "claude-opus-4-8",
      });
      expect(o.fallbackModel).toBeUndefined();
    });
  });

  describe("system prompt", () => {
    it("appends to the claude_code preset", async () => {
      const o = await buildOptions({
        systemPromptPreset: "claude_code",
        appendSystemPrompt: "Be terse.",
      });
      expect(o.systemPrompt).toEqual({
        type: "preset",
        preset: "claude_code",
        append: "Be terse.",
      });
    });

    it("uses a custom system prompt string", async () => {
      const o = await buildOptions({
        systemPromptPreset: "custom",
        customSystemPrompt: "You are a CSV analyst.",
      });
      expect(o.systemPrompt).toBe("You are a CSV analyst.");
    });

    it("omits the system prompt when custom is selected but empty", async () => {
      const o = await buildOptions({
        systemPromptPreset: "custom",
        customSystemPrompt: "",
      });
      expect(o.systemPrompt).toBeUndefined();
    });

    it("omits the system prompt for the minimal preset", async () => {
      const o = await buildOptions({ systemPromptPreset: "minimal" });
      expect(o.systemPrompt).toBeUndefined();
    });
  });

  describe("working dir, tools, dirs", () => {
    it("sets the working directory", async () => {
      const o = await buildOptions({ cwd: "/srv/agent" });
      expect(o.cwd).toBe("/srv/agent");
    });

    it("splits allow/deny tool lists on commas and newlines", async () => {
      const o = await buildOptions({
        allowedTools: "Read, Glob\nGrep",
        disallowedTools: "Bash(rm *)",
      });
      expect(o.allowedTools).toEqual(["Read", "Glob", "Grep"]);
      expect(o.disallowedTools).toEqual(["Bash(rm *)"]);
    });

    it("splits additional directories", async () => {
      const o = await buildOptions({ additionalDirectories: "/data,/tmp/in" });
      expect(o.additionalDirectories).toEqual(["/data", "/tmp/in"]);
    });
  });

  describe("setting sources", () => {
    it("loads none when the field is cleared", async () => {
      const o = await buildOptions({ settingSources: "" });
      expect(o.settingSources).toEqual([]);
    });

    it("drops unknown sources, keeping only user/project/local", async () => {
      const o = await buildOptions({ settingSources: "user, bogus, local" });
      expect(o.settingSources).toEqual(["user", "local"]);
    });
  });

  describe("limits", () => {
    it("sets positive turn and budget caps", async () => {
      const o = await buildOptions({ maxTurns: 5, maxBudgetUsd: 1.5 });
      expect(o.maxTurns).toBe(5);
      expect(o.maxBudgetUsd).toBe(1.5);
    });

    it("omits zero caps (treated as unlimited)", async () => {
      const o = await buildOptions({ maxTurns: 0, maxBudgetUsd: 0 });
      expect(o.maxTurns).toBeUndefined();
      expect(o.maxBudgetUsd).toBeUndefined();
    });
  });

  describe("dialog kinds", () => {
    it("opts into the onUserDialog channel when kinds are listed", async () => {
      const o = await buildOptions({ supportedDialogKinds: "AskUserQuestion" });
      expect(o.supportedDialogKinds).toEqual(["AskUserQuestion"]);
    });

    it("omits dialog kinds when empty (keeps the canUseTool path)", async () => {
      const o = await buildOptions({ supportedDialogKinds: "" });
      expect(o.supportedDialogKinds).toBeUndefined();
    });
  });

  describe("provider env", () => {
    it("does not set a cloud flag for the anthropic provider", async () => {
      const o = await buildOptions({ provider: "anthropic" });
      expect(o.env?.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
      expect(o.env?.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
      expect(o.env?.CLAUDE_CODE_USE_FOUNDRY).toBeUndefined();
    });

    it("flags Bedrock", async () => {
      const o = await buildOptions({ provider: "bedrock" });
      expect(o.env?.CLAUDE_CODE_USE_BEDROCK).toBe("1");
    });

    it("flags Vertex", async () => {
      const o = await buildOptions({ provider: "vertex" });
      expect(o.env?.CLAUDE_CODE_USE_VERTEX).toBe("1");
    });

    it("flags Foundry", async () => {
      const o = await buildOptions({ provider: "foundry" });
      expect(o.env?.CLAUDE_CODE_USE_FOUNDRY).toBe("1");
    });
  });
});
