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
import { ReturnSchema } from "../../shared/schemas/claude-tool-return";

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
      claudeTool?: { callId?: string };
    };
    claudeTool?: { callId?: string };
  }>
>;

/**
 * `claude-tool-return` — the SINK (like `http-out`). It wraps the flow's value into
 * the tool's answer and settles the parked call: channel-first (the live resolver
 * on the private channel, keyed by `_msgid`), `callId`-fallback for a fresh message.
 */
export default class ClaudeToolReturn extends IONode<
  ReturnConfig,
  never,
  ToolReturnInput,
  never
> {
  static override readonly type = "claude-tool-return";
  static override readonly category = "claude";
  static override readonly color = "#d9b8ff";
  static override readonly configSchema = ReturnSchema;

  override input(msg: ToolReturnInput): void {
    const src = (msg.output ?? msg) as {
      payload?: unknown;
      isError?: boolean;
      claudeTool?: { callId?: string };
    };
    const answer: ToolAnswer = {
      value: src.payload,
      format: this.config.format,
      isError: !!src.isError,
    };

    // Path 1 (PRIMARY): the live resolver on the private channel, keyed by _msgid,
    // take-once — like http-out reads back `res` then deletes it.
    const ret = msg[Channels].private.claudeReturn as Settle | undefined;
    if (ret) {
      delete msg[Channels].private.claudeReturn;
      this.status({ fill: "green", shape: "dot", text: "returned" });
      return void ret(answer);
    }

    // Path 1-fallback: a FRESH-message answer carrying callId.
    const callId =
      src.claudeTool?.callId ??
      (msg.claudeTool as { callId?: string } | undefined)?.callId;
    const settle = callId ? PendingIndex.take(callId) : undefined;
    if (!settle) {
      this.status({ fill: "yellow", shape: "dot", text: "no pending call" });
      return void this.warn(
        "claude-tool-return: no pending tool call (already answered, timed out, or callId lost) — check the return wire preserves the private channel or carries msg.output.claudeTool.callId",
      );
    }
    settle(answer);
  }
}
