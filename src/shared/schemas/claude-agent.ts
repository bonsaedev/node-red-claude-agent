import { defineSchema, SchemaType } from "@bonsae/nrg/schema";
import type ClaudeAgentConfiguration from "../../server/nodes/claude-agent-configuration";

/**
 * A `claude-agent` node runs the Claude Agent SDK `query()` for an incoming
 * prompt and emits the response. It supports a streamed or single response, and
 * non-interactive (autonomous) or interactive (approvals/questions surfaced to a
 * downstream UI) operation.
 */
export const ConfigsSchema = defineSchema(
  {
    config: SchemaType.NodeRef<ClaudeAgentConfiguration>(
      "claude-agent-configuration",
      {
        description:
          "The configuration to use (sign-in and run settings). Pick one or add a new configuration.",
        // TODO(nrg-upgrade): add `required: true` here once this package is on
        // the nrg release that carries `x-nrg-form.required` — it makes an unset
        // configuration show the error triangle + inline error.
        "x-nrg-form": { icon: "cog" },
      },
    ),
    prompt: SchemaType.TypedInput<string>({
      description:
        "What to ask the assistant. By default it uses the incoming message's payload; you can also type a fixed prompt or point to another message property.",
      "x-nrg-form": {
        icon: "comment-o",
        typedInputTypes: ["msg", "str"],
      },
    }),
    responseMode: SchemaType.Union(
      [SchemaType.Literal("single"), SchemaType.Literal("stream")],
      {
        default: "single",
        description:
          "How the reply comes out. 'Single reply' sends just the final answer. 'Streaming' sends each part as it arrives, then the final answer — good for showing progress.",
        "x-nrg-form": { icon: "exchange" },
      },
    ),
    interactive: SchemaType.Boolean({
      default: false,
      description:
        "When on, the assistant can pause to ask for approval or a clarifying question — these go out the second (ask) port for your UI to answer, and you send the answer back into this node. Works best with tool permissions set to ask before acting.",
      "x-nrg-form": { icon: "hand-paper-o" },
    }),
    includePartial: SchemaType.Boolean({
      default: false,
      description:
        "While streaming, send text word-by-word as it's generated for a live typing effect.",
      "x-nrg-form": { icon: "ellipsis-h" },
    }),
    permissionMode: SchemaType.Union(
      [
        SchemaType.Literal("inherit"),
        SchemaType.Literal("default"),
        SchemaType.Literal("acceptEdits"),
        SchemaType.Literal("bypassPermissions"),
        SchemaType.Literal("plan"),
        SchemaType.Literal("dontAsk"),
      ],
      {
        default: "inherit",
        description:
          "Tool permissions just for this node. 'Use configuration's setting' keeps whatever the configuration says; the others override it here.",
        "x-nrg-form": { icon: "shield" },
      },
    ),
    // errorPort is the one built-in we still declare — it OVERRIDES the framework
    // default (false) to default the error port ON, which several tests + the
    // demo flows rely on. name/completePort/statusPort are dropped: the framework
    // merges them with identical defaults.
    errorPort: SchemaType.Boolean({
      default: true,
      description: "Add a separate output for errors (failed or stopped runs).",
    }),
  },
  { $id: "claude-agent:config" },
);
