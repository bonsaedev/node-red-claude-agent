import { ConfigNode, type Schema, type Infer } from "@bonsae/nrg/server";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import {
  ConfigsSchema,
  CredentialsSchema,
} from "../../shared/schemas/claude-agent-configuration";

type Config = Infer<typeof ConfigsSchema>;
type Credentials = Infer<typeof CredentialsSchema>;

type SettingSource = "user" | "project" | "local";

/** Split a comma/newline-separated field into a trimmed, non-empty list. */
function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Shared configuration for `claude-agent` nodes. Holds auth + the options that
 * shape every run and assembles them into the Agent SDK {@link Options} object
 * via {@link buildOptions}. Credentials (the API key) are injected through the
 * spawned process environment, which is how the SDK authenticates.
 */
export default class ClaudeAgentConfiguration extends ConfigNode<
  Config,
  Credentials
> {
  static override readonly type = "claude-agent-configuration";
  static override readonly configSchema: Schema = ConfigsSchema;
  static override readonly credentialsSchema: Schema = CredentialsSchema;

  /** Environment for the spawned Claude Code process: host env + auth. */
  private buildEnv(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };
    const apiKey = this.credentials?.apiKey;
    if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
    switch (this.config.provider) {
      case "bedrock":
        env.CLAUDE_CODE_USE_BEDROCK = "1";
        break;
      case "vertex":
        env.CLAUDE_CODE_USE_VERTEX = "1";
        break;
      case "foundry":
        env.CLAUDE_CODE_USE_FOUNDRY = "1";
        break;
    }
    return env;
  }

  /**
   * Assemble the base SDK options from this config. The agent node merges its
   * own per-run overrides (prompt, canUseTool, permission-mode override,
   * session resume, partial messages) on top of this.
   */
  buildOptions(): Options {
    const c = this.config;
    const options: Options = {
      permissionMode: c.permissionMode,
      env: this.buildEnv(),
    };

    if (c.model) options.model = c.model;
    // The SDK rejects a fallback equal to the main model; drop it instead of
    // surfacing an opaque spawn-time error.
    if (c.fallbackModel && c.fallbackModel !== c.model) {
      options.fallbackModel = c.fallbackModel;
    }

    if (c.systemPromptPreset === "claude_code") {
      options.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        ...(c.appendSystemPrompt ? { append: c.appendSystemPrompt } : {}),
      };
    } else if (c.systemPromptPreset === "custom" && c.customSystemPrompt) {
      options.systemPrompt = c.customSystemPrompt;
    }

    if (c.cwd) options.cwd = c.cwd;

    const allowed = splitList(c.allowedTools);
    if (allowed.length) options.allowedTools = allowed;

    const disallowed = splitList(c.disallowedTools);
    if (disallowed.length) options.disallowedTools = disallowed;

    // Always set settingSources: omitting it makes the SDK load ALL sources,
    // so a deliberately-cleared field must map to [] (load none), not "default".
    options.settingSources = splitList(c.settingSources).filter(
      (s): s is SettingSource =>
        s === "user" || s === "project" || s === "local",
    );

    if (c.maxTurns > 0) options.maxTurns = c.maxTurns;
    if (c.maxBudgetUsd > 0) options.maxBudgetUsd = c.maxBudgetUsd;

    const dirs = splitList(c.additionalDirectories);
    if (dirs.length) options.additionalDirectories = dirs;

    // Declaring dialog kinds opts the session into the onUserDialog channel.
    // The SDK requires onUserDialog whenever this is non-empty (the agent wires
    // it), so only set it when the consumer listed kinds to handle.
    const dialogKinds = splitList(c.supportedDialogKinds);
    if (dialogKinds.length) options.supportedDialogKinds = dialogKinds;

    return options;
  }
}
