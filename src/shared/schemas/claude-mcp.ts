import { defineSchema, SchemaType } from "@bonsae/nrg/schema";
import type ClaudeAgentConfiguration from "../../server/nodes/claude-agent-configuration";

/**
 * `claude-mcp` config. Points a bound agent at an EXTERNAL MCP server (stdio /
 * http / sse) — e.g. the `mcp-server` this package also ships. Binding is BY
 * IDENTITY: a NodeRef to the same `claude-agent-configuration` the agent uses; the
 * config node pulls its `claude-mcp` nodes from `_users` at assembly time and folds
 * each into `options.mcpServers`. No ports, no wire, no live bridge — the SDK owns
 * the whole tool-call round-trip.
 */
export const ConfigsSchema = defineSchema(
  {
    agent: SchemaType.NodeRef<ClaudeAgentConfiguration>(
      "claude-agent-configuration",
      {
        description: "The agent identity this MCP server extends",
        "x-nrg-form": { icon: "cog" },
      },
    ),
    // The Record<serverName, config> KEY + the middle segment of every tool name
    // mcp__<serverName>__<tool>. MUST be unique among claude-mcp nodes and MUST NOT
    // be "flow" (both are loud deploy-time errors in assembleContributions).
    serverName: SchemaType.String({
      pattern: "^[A-Za-z0-9_-]{1,64}$",
      description:
        "A unique name for this server (used as mcp__<name>__<tool>). Cannot be 'flow'.",
      "x-nrg-form": { icon: "tag" },
    }),
    transport: SchemaType.Union(
      [
        SchemaType.Literal("stdio"),
        SchemaType.Literal("http"),
        SchemaType.Literal("sse"),
      ],
      {
        default: "http",
        description:
          "How to reach the server: a local command (stdio) or a remote URL (http/sse).",
        "x-nrg-form": { icon: "exchange" },
      },
    ),
    // stdio only
    command: SchemaType.String({
      default: "",
      description: "stdio: the executable to run (e.g. npx, node, python).",
      "x-nrg-form": { icon: "terminal" },
    }),
    args: SchemaType.String({
      default: "",
      description:
        "stdio: arguments, comma or newline separated (e.g. -y, @modelcontextprotocol/server-filesystem, /data).",
    }),
    // http/sse only
    url: SchemaType.String({
      default: "",
      description: "http/sse: the server URL (e.g. http://localhost:1880/mcp).",
      "x-nrg-form": { icon: "globe" },
    }),
    // How the secret is carried (not secret themselves, so they live in config).
    headerName: SchemaType.String({
      default: "Authorization",
      description:
        "http/sse: the header the secret is sent in (default Authorization: Bearer).",
    }),
    envName: SchemaType.String({
      default: "",
      description:
        "stdio: the environment variable the secret is set as (e.g. GITHUB_TOKEN).",
    }),
    // Per-server per-call ceiling in MILLISECONDS. A real SDK timeout for a
    // process-transport server; values under 1000 are ignored by the SDK.
    timeout: SchemaType.Number({
      default: 30000,
      minimum: 1000,
      description:
        "Max milliseconds per tool call before the SDK aborts it. Values under 1000 are ignored.",
    }),
    // Force this server's tools always-in-prompt AND block startup until it
    // connects. Default false = deferred behind tool search.
    alwaysLoad: SchemaType.Boolean({
      default: false,
      description:
        "Always include this server's tools in the prompt (blocks startup until it connects). Off = loaded on demand.",
    }),
    // -> allowedTools: ["mcp__<serverName>__*"]. Off = each tool falls through the
    // permission pipeline to the agent's ask port.
    preApproveAll: SchemaType.Boolean({
      default: false,
      description:
        "Pre-approve every tool on this server (skip the approval prompt). Off = the agent asks before each call.",
    }),
  },
  { $id: "claude-mcp:config" },
);

/**
 * The secret NEVER lives in config (it doesn't travel with exported flows). One
 * secret carries a stdio env var OR an http/sse Authorization header (the carrier
 * is chosen by the config `headerName`/`envName`), assembled at `toConfig()` time.
 */
export const CredentialsSchema = defineSchema(
  {
    secret: SchemaType.String({
      format: "password",
      description:
        "A token/API key for this server (Bearer header for http/sse, or an env var for stdio).",
    }),
  },
  { $id: "claude-mcp:credentials" },
);
