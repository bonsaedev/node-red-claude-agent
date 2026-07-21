import { IONode, type Infer, type Input, type Port } from "@bonsae/nrg/server";
import { PendingIndex, type ToolAnswer } from "../lib/tool-dispatch";
import { ConfigsSchema } from "../../shared/schemas/claude-tool-return";

type ClaudeToolReturnConfig = Infer<typeof ConfigsSchema>;

/**
 * The value rides on the record's root `payload` — an nrg body node merges it
 * there, a core node sets it directly — like `http-out`. `_claudeTool.callId`
 * correlates the answer back to the parked call: `claude-tool` registered the live
 * resolver in the package `PendingIndex` under that id and rides the id on the wire.
 */
type ClaudeToolReturnInput = Input<
  Port<{
    payload?: unknown;
    isError?: boolean;
    _claudeTool: { callId: string };
  }>
>;

/**
 * `claude-tool-return` — the SINK (like `http-out`/`mcp-tool-out`). It wraps the
 * flow's value into the tool's answer and settles the parked call by its `callId`,
 * looking the live resolver up in the package `PendingIndex` (take-once).
 */
export default class ClaudeToolReturn extends IONode<
  ClaudeToolReturnConfig,
  never,
  ClaudeToolReturnInput,
  never
> {
  static override readonly type = "claude-tool-return";
  static override readonly category = "claude";
  static override readonly color = "#d9b8ff";
  static override readonly configSchema = ConfigsSchema;

  override input(msg: ClaudeToolReturnInput): void {
    // The record model: the answer rides `payload` at the ROOT — a core node
    // sets it (`msg.payload = result`), an nrg body node merges it
    // (`send(port, { payload })`, overwriting the tool ARGS the source put
    // there). `callId` provenance is carried on `_claudeTool` by the same merges.
    const answer: ToolAnswer = {
      value: msg.payload,
      format: this.config.format,
      isError: !!msg.isError,
    };

    // Settle the parked call by its transaction key `_claudeTool.callId`: the live
    // resolver lives in the package `PendingIndex`, take-once — like http-out reads
    // back `res` from its store then drops it. The key is a declared wire field, so
    // a wire check verifies this return node is fed by a `claude-tool`.
    const settle = PendingIndex.take(msg._claudeTool.callId);
    if (!settle) {
      this.status({ fill: "yellow", shape: "dot", text: "no pending call" });
      return void this.warn(
        "claude-tool-return: no pending tool call (already answered, timed out, or callId lost) — check the return wire carries msg._claudeTool.callId",
      );
    }
    this.status({ fill: "green", shape: "dot", text: "returned" });
    settle(answer);
  }
}
