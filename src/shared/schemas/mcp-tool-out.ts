import { defineSchema, SchemaType } from "@bonsae/nrg/schema";

/**
 * `mcp-tool-out` config. Minimal, like `claude-tool-return`: the resolver is
 * recovered from the package `PendingIndex` by the wire's `_mcpTool.callId`; only
 * the output FORMAT is a config choice. `isError` is driven per message
 * (`msg.isError`), not config.
 */
export const ConfigsSchema = defineSchema(
  {
    format: SchemaType.Union(
      [SchemaType.Literal("text"), SchemaType.Literal("json")],
      {
        default: "text",
        description:
          "Return msg.payload as a text block, or as structuredContent (machine-readable JSON).",
      },
    ),
  },
  { $id: "mcp-tool-out:config" },
);
