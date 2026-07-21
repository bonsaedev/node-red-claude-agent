import { ConfigNode, type Infer } from "@bonsae/nrg/server";
import type {
  McpServerConfig,
  McpStdioServerConfig,
  McpHttpServerConfig,
  McpSSEServerConfig,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ConfigsSchema,
  CredentialsSchema,
} from "../../shared/schemas/claude-mcp";
import { splitList } from "../lib/split-list";

type ClaudeMcpConfig = Infer<typeof ConfigsSchema>;
type ClaudeMcpCredentials = Infer<typeof CredentialsSchema>;

/**
 * `claude-mcp` — a pure ConfigNode that points a bound agent at an EXTERNAL MCP
 * server (stdio / http / sse). It contributes ONE `options.mcpServers[serverName]`
 * entry at `assembleContributions()` time and has no ports, no live bridge, and no
 * mid-run round-trip — the SDK/CLI owns the whole tool-call. Binds by identity via
 * a NodeRef to the same `claude-agent-configuration` the agent references.
 */
export default class ClaudeMcp extends ConfigNode<
  ClaudeMcpConfig,
  ClaudeMcpCredentials
> {
  static override readonly type = "claude-mcp";
  static override readonly configSchema = ConfigsSchema;
  static override readonly credentialsSchema = CredentialsSchema;

  /** The Record<serverName, …> key. Read by the config node's collision guard. */
  get serverName(): string {
    return this.config.serverName;
  }

  /**
   * Build the SDK server config for `options.mcpServers[serverName]`. Called once
   * at assembly, before `query()`. Reads the credential secret here (never stored
   * in config). No `run` needed — an external server has no correlation / abort /
   * timeout of ours (the SDK owns all three).
   */
  toConfig(): McpServerConfig {
    const c = this.config;
    const timeout = c.timeout >= 1000 ? c.timeout : undefined; // <1000 is ignored
    const secret = this.credentials?.secret;

    if (c.transport === "stdio") {
      const env: Record<string, string> = {};
      if (secret && c.envName) env[c.envName] = secret;
      const cfg: McpStdioServerConfig = {
        type: "stdio",
        command: c.command,
        ...(splitList(c.args).length ? { args: splitList(c.args) } : {}),
        ...(Object.keys(env).length ? { env } : {}),
        ...(timeout ? { timeout } : {}),
        ...(c.alwaysLoad ? { alwaysLoad: true } : {}),
      };
      return cfg;
    }

    // http | sse — identical shape bar the `type` literal.
    const headers: Record<string, string> = {};
    if (secret) {
      const name = c.headerName || "Authorization";
      headers[name] = name === "Authorization" ? `Bearer ${secret}` : secret;
    }
    const common = {
      url: c.url,
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(timeout ? { timeout } : {}),
      ...(c.alwaysLoad ? { alwaysLoad: true } : {}),
    };
    return c.transport === "http"
      ? ({ type: "http", ...common } satisfies McpHttpServerConfig)
      : ({ type: "sse", ...common } satisfies McpSSEServerConfig);
  }

  /** The allowedTools grant for this server when preApproveAll is on
   *  (`mcp__<serverName>__*` allows every tool). */
  allowedToolGrant(): string | undefined {
    return this.config.preApproveAll
      ? `mcp__${this.config.serverName}__*`
      : undefined;
  }
}
