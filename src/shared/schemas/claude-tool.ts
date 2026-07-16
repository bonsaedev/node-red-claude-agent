import { defineSchema, SchemaType } from "@bonsae/nrg/schema";
import type ClaudeAgentConfiguration from "../../server/nodes/claude-agent-configuration";

/**
 * `claude-tool` config. Binding is BY IDENTITY: the tool carries a NodeRef to the
 * same config node the agent references, and the config node pulls its tools back
 * out of the native `_users` reverse index at assembly time — no wire, no
 * registration protocol.
 */
export const ConfigsSchema = defineSchema(
  {
    agent: SchemaType.NodeRef<ClaudeAgentConfiguration>(
      "claude-agent-configuration",
      {
        description: "The agent identity this tool extends",
        "x-nrg-form": { icon: "cog" },
      },
    ),
    // Becomes the MCP tool id `mcp__flow__<name>`; the pattern keeps it valid.
    name: SchemaType.String({
      pattern: "^[A-Za-z0-9_-]{1,64}$",
      description: "Tool name the model calls (becomes mcp__flow__<name>).",
    }),
    description: SchemaType.String({
      description:
        "What the tool does — Claude reads this to decide when to call it.",
    }),
    // A flat parameter table, turned into a Zod raw shape by zodShapeFrom().
    params: SchemaType.Array(
      SchemaType.Object({
        name: SchemaType.String(),
        type: SchemaType.String({
          enum: ["string", "number", "boolean", "enum"],
        }),
        // Surfaced to the model via .describe().
        description: SchemaType.String({ default: "" }),
        required: SchemaType.Boolean({ default: true }),
        // Comma-separated allowed values, only used when type = "enum".
        values: SchemaType.String({ default: "" }),
      }),
      { default: [], description: "The tool's inputs, one row per parameter." },
    ),
    // ALWAYS finite: the SDK applies no timeout to in-process tools, so this is the
    // only clock we own. Default 55 stays under the ~60s stream-close.
    timeoutSeconds: SchemaType.Number({
      default: 55,
      minimum: 1,
      description:
        "Max seconds to wait for claude-tool-return before returning a timeout error to the model. Keep <= 55 unless the config's stream-close is bumped (raising this above 55 does so automatically).",
    }),
    preApproved: SchemaType.Boolean({
      default: true,
      description: "Pre-approve so the call skips the permission pipeline.",
    }),
    readOnly: SchemaType.Boolean({
      default: false,
      description:
        "Mark side-effect-free so Claude may batch it in parallel with other reads.",
    }),
    errorPort: SchemaType.Boolean({ default: true }),
  },
  { $id: "claude-tool:config" },
);
