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
    // The author's answer is at top-level `payload` when a core Node-RED node set
    // it (`msg.payload = result; return msg`); `msg.output` still holds the SOURCE's
    // original tool ARGS, so preferring it would silently return the args back to
    // the model. An nrg node re-wraps the answer under `output` and leaves top-level
    // `payload` unset, so the fallback to `msg.output` covers that path. `callId`
    // provenance is separate — it always rides `msg.output.claudeTool`.
    const answeredAtRoot = msg.payload !== undefined;
    const answer: ToolAnswer = {
      value: answeredAtRoot ? msg.payload : msg.output?.payload,
      format: this.config.format,
      isError: answeredAtRoot ? !!msg.isError : !!msg.output?.isError,
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
    const callId = msg.output?.claudeTool?.callId ?? msg.claudeTool?.callId;
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
