import { defineSchema, SchemaType } from "@bonsae/nrg/schema";

/**
 * `mcp-tool-out` config. Minimal, like `claude-tool-return`: the resolver is
 * recovered off the private channel; only the output FORMAT is a config choice.
 * `isError` is driven per message (`msg.output.isError`), not config.
 */
export const ReturnSchema = defineSchema(
  {
    format: SchemaType.Union(
      [SchemaType.Literal("text"), SchemaType.Literal("json")],
      {
        default: "text",
        description:
          "Return msg.output as a text block, or as structuredContent (machine-readable JSON).",
      },
    ),
  },
  { $id: "mcp-tool-out:config" },
);
