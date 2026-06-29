import { defineSchema, SchemaType } from "@bonsae/nrg/schema";
import type ClaudeAgentConfiguration from "../server/nodes/claude-agent-configuration";

/**
 * A `claude-agent` node runs the Claude Agent SDK `query()` for an incoming
 * prompt and emits the response. It supports a streamed or single response, and
 * non-interactive (autonomous) or interactive (approvals/questions surfaced to a
 * downstream UI) operation.
 */
export const ConfigsSchema = defineSchema(
  {
    name: SchemaType.String({ default: "", "x-nrg-form": { icon: "tag" } }),
    config: SchemaType.NodeRef<ClaudeAgentConfiguration>(
      "claude-agent-configuration",
      {
        description: "Claude agent configuration node (auth + run options)",
        "x-nrg-form": { icon: "cog" },
      },
    ),
    prompt: SchemaType.TypedInput<string>({
      description:
        "The prompt to send. Defaults to msg.payload; pick a string or another msg property.",
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
          "single = emit one final result; stream = emit each assistant message as it arrives, then the final result",
        "x-nrg-form": { icon: "exchange" },
      },
    ),
    interactive: SchemaType.Boolean({
      default: false,
      description:
        "When on, tool-approval requests and clarifying questions are emitted on the 'ask' port for a UI to answer (route the answer back into this node). Pair with permission mode 'default' or 'plan'.",
      "x-nrg-form": { icon: "hand-paper-o" },
    }),
    includePartial: SchemaType.Boolean({
      default: false,
      description:
        "Emit partial (token-level) assistant messages while streaming for a live typing effect",
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
          "Override the configuration's permission mode for this node. 'inherit' uses the config's setting.",
        "x-nrg-form": { icon: "shield" },
      },
    ),
    errorPort: SchemaType.Boolean({
      default: true,
      description: "Dedicated output port for errors (failed/aborted runs)",
    }),
    completePort: SchemaType.Boolean({
      default: false,
      description: "Dedicated output port emitted when a run completes",
    }),
    statusPort: SchemaType.Boolean({
      default: false,
      description: "Dedicated output port for status updates",
    }),
  },
  { $id: "claude-agent:config" },
);

export const InputSchema = defineSchema(
  {
    // Optional: a str-prompt run, a control message ({ claudeControl }), or an
    // answer ({ claudeResponse }) carries no prompt payload.
    payload: SchemaType.Optional(
      SchemaType.Any({
        description:
          "Prompt to run (when prompt source is msg.payload). May also carry a control message: { claudeResponse } answers an 'ask', { claudeControl: 'interrupt' } aborts the run.",
      }),
    ),
    correlationId: SchemaType.Optional(
      SchemaType.String({
        description:
          "Opaque token echoed on every emitted message (under output) so a downstream router can return each message to the right client/connection.",
      }),
    ),
  },
  { $id: "claude-agent:input" },
);

/** Port 0 — the agent's response (streamed chunks and/or the final result). */
const ResponseSchema = defineSchema(
  {
    payload: SchemaType.Any({
      description:
        "Assistant text (stream/result) or the raw SDK message, depending on kind",
    }),
    kind: SchemaType.String({
      description: "assistant | partial | result",
    }),
    sessionId: SchemaType.Optional(
      SchemaType.String({
        description:
          "Session id — pass back as msg.sessionId to continue the chat",
      }),
    ),
    correlationId: SchemaType.Optional(
      SchemaType.String({
        description:
          "Echoed from the input — used by a router to address the reply",
      }),
    ),
  },
  { $id: "claude-agent:response" },
);

/** Port 1 — interactive requests Claude is waiting on (approvals / questions). */
const AskSchema = defineSchema(
  {
    payload: SchemaType.Any({
      description:
        "{ requestId, kind: 'permission' | 'question', toolName, input, questions?, suggestions? } — answer via msg.claudeResponse referencing requestId",
    }),
  },
  { $id: "claude-agent:ask" },
);

export const OutputsSchema = [ResponseSchema, AskSchema];
