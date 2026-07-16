import { ConfigNode, type Infer, type RED } from "@bonsae/nrg/server";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import ClaudeTool from "./claude-tool";
import ClaudeMcp from "./claude-mcp";
import type { RunContext } from "../lib/tool-dispatch";
import { splitList } from "../lib/split-list";
import {
  ConfigsSchema,
  CredentialsSchema,
} from "../../shared/schemas/claude-agent-configuration";
import { initRoutes } from "../api";
import {
  hasFolder,
  managedDir,
  syncInto,
  clear as clearClaudeFolder,
} from "../lib/claude-folder-store";

type Config = Infer<typeof ConfigsSchema>;
type Credentials = Infer<typeof CredentialsSchema>;

type SettingSource = "user" | "project" | "local";

/** The first value that appears more than once, or undefined if all unique. */
function firstDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) return v;
    seen.add(v);
  }
  return undefined;
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

  /** Register the admin endpoints for the uploaded `.claude` folder (once). */
  static override async registered(RED: RED): Promise<void> {
    initRoutes(RED);
  }

  /** Remove the node's uploaded `.claude` folder from disk on delete (but keep
   *  it across ordinary redeploys). */
  override closed(removed?: boolean): void {
    if (removed) {
      try {
        clearClaudeFolder(this.RED, this.id);
      } catch {
        // best effort — nothing to clean up if it was never uploaded
      }
    }
  }

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

    // Bump the ~60s stream-close ONLY when a flow-tool legitimately needs >55s.
    // Must be inside this { ...process.env } spread — options.env REPLACES the
    // subprocess env entirely, so a host-only value would not be inherited.
    const longestMs = Math.max(
      0,
      ...this.tools.map((t) => t.config.timeoutSeconds * 1000),
    );
    if (longestMs > 55_000) {
      env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = String(longestMs + 10_000);
    }

    return env;
  }

  /** Flow-tools bound to this config, pulled from the native `_users` reverse
   *  index — no registration protocol, recomputed from flow config every deploy. */
  get tools(): ClaudeTool[] {
    return this.users.filter((n): n is ClaudeTool => n instanceof ClaudeTool);
  }

  /** External MCP servers (`claude-mcp`) bound to this config, from the same
   *  `_users` index. Folded into `options.mcpServers` alongside the flow server. */
  get mcps(): ClaudeMcp[] {
    return this.users.filter((n): n is ClaudeMcp => n instanceof ClaudeMcp);
  }

  /** The single reserved in-process MCP server key. */
  static readonly #FLOW_SERVER = "flow";

  /**
   * Build the per-run contributions the agent merges into its `query()` options:
   * the in-process "flow" MCP server (one SDK tool per `claude-tool` bound here),
   * every external `claude-mcp` server under its own key, and the pre-approved
   * `allowedTools`. Throws loudly at run time on a duplicate/reserved server name
   * or duplicate tool name (a deploy-time config error, surfaced before `query()`).
   */
  assembleContributions(run: RunContext): {
    mcpServers: NonNullable<Options["mcpServers"]>;
    allowedTools: string[];
  } {
    const FLOW = ClaudeAgentConfiguration.#FLOW_SERVER;

    const toolNodes = this.tools;
    const dupTool = firstDuplicate(toolNodes.map((t) => t.config.name));
    if (dupTool) {
      throw new Error(
        `claude-agent: two claude-tool nodes on this configuration are both named "${dupTool}" — tool names must be unique`,
      );
    }

    // External MCP server-name collisions are silent Record overwrites, so guard
    // loudly before query(): unique among themselves, and never the reserved key.
    const mcpNodes = this.mcps;
    const mcpNames = mcpNodes.map((m) => m.serverName);
    const dupMcp = firstDuplicate(mcpNames);
    if (dupMcp) {
      throw new Error(
        `claude-agent: two claude-mcp nodes on this configuration both use server name "${dupMcp}" — server names must be unique (a duplicate silently overwrites)`,
      );
    }
    if (mcpNames.includes(FLOW)) {
      throw new Error(
        `claude-agent: a claude-mcp node on this configuration uses the reserved server name "${FLOW}" — rename it (that key is owned by flow-tools)`,
      );
    }

    const mcpServers: NonNullable<Options["mcpServers"]> = {};
    if (toolNodes.length) {
      mcpServers[FLOW] = createSdkMcpServer({
        name: FLOW,
        tools: toolNodes.map((t) => t.toSdkTool(run)),
      });
    }
    for (const m of mcpNodes) mcpServers[m.serverName] = m.toConfig();

    return {
      mcpServers,
      allowedTools: [
        ...toolNodes
          .filter((t) => t.config.preApproved)
          .map((t) => `mcp__${FLOW}__${t.config.name}`),
        ...mcpNodes
          .map((m) => m.allowedToolGrant())
          .filter((g): g is string => g !== undefined),
      ],
    };
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

    // Uploaded `.claude` folder. The SDK only reads project `.claude`/CLAUDE.md
    // relative to cwd, so route it automatically: with a Working folder set,
    // copy the uploaded files into it; with none, point cwd at the per-node
    // managed dir. Either way, force `project` on so CLAUDE.md is loaded.
    if (hasFolder(this.RED, this.id)) {
      if (options.cwd) {
        syncInto(this.RED, this.id, options.cwd);
      } else {
        options.cwd = managedDir(this.RED, this.id);
      }
      if (!options.settingSources.includes("project")) {
        options.settingSources = [...options.settingSources, "project"];
      }
    }

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
