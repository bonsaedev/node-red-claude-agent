import { describe, it, expect, vi, afterEach } from "vitest";
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

  describe("auth method", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("apiKey (default) injects the API key, drops a host bearer token, and passes the rest through", async () => {
      vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "host-oat");
      // A host bearer token outranks the configured key — it must not hijack
      // the run once the user pasted a key into the node.
      vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "host-bearer");
      const o = await buildOptions({ authMethod: "apiKey" });
      expect(o.env?.ANTHROPIC_API_KEY).toBe("sk-test");
      expect(o.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      // everything below the injected key stays pass-through (back-compat)
      expect(o.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("host-oat");
    });

    it("apiKey without a credential is pure pass-through (back-compat with host-env auth)", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "host-key");
      vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "host-bearer");
      const o = await buildOptions({ authMethod: "apiKey" }, {});
      expect(o.env?.ANTHROPIC_API_KEY).toBe("host-key");
      expect(o.env?.ANTHROPIC_AUTH_TOKEN).toBe("host-bearer");
    });

    it("subscriptionToken injects CLAUDE_CODE_OAUTH_TOKEN and scrubs everything that outranks or reroutes it", async () => {
      // The CLI prefers ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY over the OAuth
      // token, a host CLAUDE_CODE_USE_* flag reroutes to a cloud provider, and
      // a gateway ANTHROPIC_BASE_URL would receive the subscription token.
      vi.stubEnv("ANTHROPIC_API_KEY", "host-key");
      vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "host-bearer");
      vi.stubEnv("ANTHROPIC_BASE_URL", "https://gateway.example.com");
      vi.stubEnv("CLAUDE_CODE_USE_BEDROCK", "1");
      const o = await buildOptions(
        { authMethod: "subscriptionToken" },
        { apiKey: "sk-test", oauthToken: "sk-ant-oat01-test" },
      );
      expect(o.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-test");
      expect(o.env?.ANTHROPIC_API_KEY).toBeUndefined();
      expect(o.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(o.env?.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(o.env?.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    });

    it("subscriptionToken without a token throws instead of billing whoever is logged in on the host", async () => {
      // Credentials do not travel with exported flows — an imported flow lands
      // here with an empty credential and must fail loudly.
      await expect(
        buildOptions({ authMethod: "subscriptionToken" }, { apiKey: "sk-test" }),
      ).rejects.toThrow(/subscription token/);
    });

    it("claudeCodeLogin scrubs every env credential so the /login store wins", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "host-key");
      vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "host-bearer");
      vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "host-oat");
      vi.stubEnv("ANTHROPIC_BASE_URL", "https://gateway.example.com");
      vi.stubEnv("CLAUDE_CODE_USE_VERTEX", "1");
      const o = await buildOptions({ authMethod: "claudeCodeLogin" });
      expect(o.env?.ANTHROPIC_API_KEY).toBeUndefined();
      expect(o.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(o.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(o.env?.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(o.env?.CLAUDE_CODE_USE_VERTEX).toBeUndefined();
    });

    it("cloud providers ignore the auth method (cloud creds come from the host env)", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", undefined);
      vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", undefined);
      const o = await buildOptions(
        { provider: "bedrock", authMethod: "subscriptionToken" },
        { apiKey: "sk-test", oauthToken: "sk-ant-oat01-test" },
      );
      expect(o.env?.CLAUDE_CODE_USE_BEDROCK).toBe("1");
      // neither credential is injected — cloud selection outranks them anyway
      expect(o.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(o.env?.ANTHROPIC_API_KEY).toBeUndefined();
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
