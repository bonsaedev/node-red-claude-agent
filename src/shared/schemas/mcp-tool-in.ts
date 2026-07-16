import { defineSchema, SchemaType } from "@bonsae/nrg/schema";
import type McpServer from "../../server/nodes/mcp-server";

/**
 * `mcp-tool-in` config. Binding is BY IDENTITY: the tool carries a NodeRef to the
 * `mcp-server` config node that hosts it, and the server pulls its tools back out
 * of the native `_users` reverse index at request time — no wire, no registration
 * protocol. Mirrors `claude-tool`, minus the agent binding + pre-approval (an MCP
 * client owns its own approval policy).
 */
export const ConfigsSchema = defineSchema(
  {
    server: SchemaType.NodeRef<McpServer>("mcp-server", {
      description: "The MCP server this tool is exposed on",
      "x-nrg-form": { icon: "cog" },
    }),
    // The MCP tool id clients call; the pattern keeps it a valid identifier.
    name: SchemaType.String({
      pattern: "^[A-Za-z0-9_-]{1,64}$",
      description: "Tool name clients call.",
    }),
    description: SchemaType.String({
      description:
        "What the tool does — the client's model reads this to decide when to call it.",
    }),
    // A flat parameter table, turned into a Zod raw shape by zodShapeFrom().
    params: SchemaType.Array(
      SchemaType.Object({
        name: SchemaType.String(),
        type: SchemaType.String({
          enum: ["string", "number", "boolean", "enum"],
        }),
        description: SchemaType.String({ default: "" }),
        required: SchemaType.Boolean({ default: true }),
        values: SchemaType.String({ default: "" }),
      }),
      { default: [], description: "The tool's inputs, one row per parameter." },
    ),
    // ALWAYS finite so a call never hangs the HTTP request forever.
    timeoutSeconds: SchemaType.Number({
      default: 55,
      minimum: 1,
      description:
        "Max seconds to wait for an mcp-tool-out before returning a timeout error to the client.",
    }),
    readOnly: SchemaType.Boolean({
      default: false,
      description:
        "Mark side-effect-free (a hint clients may use to batch calls).",
    }),
    errorPort: SchemaType.Boolean({ default: true }),
  },
  { $id: "mcp-tool-in:config" },
);
