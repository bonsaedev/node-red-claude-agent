import {
  IONode,
  Channels,
  type Infer,
  type Input,
  type Port,
} from "@bonsae/nrg/server";
import {
  PendingIndex,
  type Settle,
  type ToolAnswer,
} from "../lib/tool-dispatch";
import { ReturnSchema } from "../../shared/schemas/mcp-tool-out";

type ReturnConfig = Infer<typeof ReturnSchema>;

/**
 * The value rides under `output` (from an nrg node) or the top level
 * (raw/injected), like `http-out`. `callId` is the fresh-message fallback key.
 */
type ToolReturnInput = Input<
  Port<{
    payload?: unknown;
    isError?: boolean;
    output?: {
      payload?: unknown;
      isError?: boolean;
      mcpTool?: { callId?: string };
    };
    mcpTool?: { callId?: string };
  }>
>;

/**
 * `mcp-tool-out` — the SINK (like `http-out`/`claude-tool-return`). It wraps the
 * flow's value into the tool's answer and settles the parked call: channel-first
 * (the live resolver on the private channel, keyed by `_msgid`), `callId`-fallback
 * for a fresh message.
 */
export default class McpToolOut extends IONode<
  ReturnConfig,
  never,
  ToolReturnInput,
  never
> {
  static override readonly type = "mcp-tool-out";
  static override readonly category = "mcp";
  static override readonly color = "#8ecae6";
  static override readonly configSchema = ReturnSchema;

  override input(msg: ToolReturnInput): void {
    const src = (msg.output ?? msg) as {
      payload?: unknown;
      isError?: boolean;
      mcpTool?: { callId?: string };
    };
    const answer: ToolAnswer = {
      value: src.payload,
      format: this.config.format,
      isError: !!src.isError,
    };

    // Path 1 (PRIMARY): the live resolver on the private channel, keyed by _msgid,
    // take-once — like http-out reads back `res` then deletes it.
    const ret = msg[Channels].private.mcpReturn as Settle | undefined;
    if (ret) {
      delete msg[Channels].private.mcpReturn;
      this.status({ fill: "green", shape: "dot", text: "returned" });
      return void ret(answer);
    }

    // Path 1-fallback: a FRESH-message answer carrying callId.
    const callId =
      src.mcpTool?.callId ??
      (msg.mcpTool as { callId?: string } | undefined)?.callId;
    const settle = callId ? PendingIndex.take(callId) : undefined;
    if (!settle) {
      this.status({ fill: "yellow", shape: "dot", text: "no pending call" });
      return void this.warn(
        "mcp-tool-out: no pending tool call (already answered, timed out, or callId lost) — check the return wire preserves the private channel or carries msg.output.mcpTool.callId",
      );
    }
    settle(answer);
  }
}
