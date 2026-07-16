import { defineSchema, SchemaType } from "@bonsae/nrg/schema";

/**
 * `mcp-server` config. A pure ConfigNode that hosts a StreamableHTTP MCP endpoint
 * on Node-RED's Express app; its `mcp-tool-in` nodes bind to it by identity and
 * are exposed as MCP tools any client (including a `claude-agent` via `claude-mcp`)
 * can call. Stateless request/response — no session bookkeeping.
 */
export const ConfigsSchema = defineSchema(
  {
    // The server name advertised to connecting clients in the `initialize` reply.
    serverName: SchemaType.String({
      default: "node-red",
      description:
        "The MCP server name advertised to connecting clients (in the initialize reply).",
    }),
    // The HTTP path the MCP endpoint is mounted on (Node-RED's httpNode Express app).
    // Clients POST JSON-RPC here (StreamableHTTP). GET/DELETE return 405 (stateless).
    path: SchemaType.String({
      default: "/mcp",
      pattern: "^/.*",
      description:
        "HTTP path to mount the MCP endpoint on (e.g. /mcp). Clients connect here via StreamableHTTP.",
    }),
  },
  { $id: "mcp-server:config" },
);
