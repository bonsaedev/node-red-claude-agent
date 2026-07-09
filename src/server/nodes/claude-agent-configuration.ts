import { ConfigNode, type Infer } from "@bonsae/nrg/server";
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
 * via {@link buildOptions}. Credentials (API key or subscription OAuth token)
 * are injected through the spawned process environment, which is how the SDK
 * authenticates.
 */
export default class ClaudeAgentConfiguration extends ConfigNode<
  Config,
  Credentials
> {
  static override readonly type = "claude-agent-configuration";
  static override readonly configSchema = ConfigsSchema;
  static override readonly credentialsSchema = CredentialsSchema;

  /** Environment for the spawned Claude Code process: host env + auth. */
  private buildEnv(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };
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
      case "anthropic":
        this.applyAnthropicAuth(env);
        break;
    }
    return env;
  }

  /**
   * Anthropic-provider auth. The CLI's credential precedence is
   * ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > apiKeyHelper >
   * CLAUDE_CODE_OAUTH_TOKEN > `claude /login` credentials, so the subscription
   * modes must scrub the higher-precedence variables inherited from the host —
   * otherwise a stray host key silently hijacks the run (and bills the API org
   * instead of the subscription).
   */
  private applyAnthropicAuth(env: Record<string, string | undefined>): void {
    switch (this.config.authMethod) {
      case "apiKey": {
        const apiKey = this.credentials?.apiKey;
        if (apiKey) {
          env.ANTHROPIC_API_KEY = apiKey;
          // A host-level bearer token outranks the key pasted into this node.
          delete env.ANTHROPIC_AUTH_TOKEN;
        }
        break;
      }
      case "subscriptionToken": {
        const oauthToken = this.credentials?.oauthToken;
        // Fail loudly instead of falling through to whatever account is on the
        // host (credentials do not travel with exported flows, so an imported
        // flow lands here with an empty credential).
        if (!oauthToken) {
          throw new Error(
            "claude-agent-configuration: auth method is 'subscriptionToken' but no subscription token is set — run `claude setup-token` and paste the token into the node's credentials",
          );
        }
        env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
        this.scrubHostOverrides(env);
        break;
      }
      case "claudeCodeLogin": {
        delete env.CLAUDE_CODE_OAUTH_TOKEN;
        this.scrubHostOverrides(env);
        break;
      }
    }
  }

  /**
   * Remove host-env vars that would outrank or reroute subscription auth:
   * higher-precedence credentials, provider-selection flags (a host
   * CLAUDE_CODE_USE_BEDROCK=1 would silently reroute the run), and a gateway
   * base URL (a subscription token must only ever reach Anthropic's API).
   */
  private scrubHostOverrides(env: Record<string, string | undefined>): void {
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_BASE_URL;
    for (const key of Object.keys(env)) {
      if (key.startsWith("CLAUDE_CODE_USE_")) delete env[key];
    }
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

    // Reasoning effort. Empty = leave unset so the SDK/model default applies.
    if (c.effort) options.effort = c.effort;

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
