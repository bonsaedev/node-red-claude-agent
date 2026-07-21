import { IONode, type Infer, type Input, type Port } from "@bonsae/nrg/server";
import { PendingIndex, type ToolAnswer } from "../lib/tool-dispatch";
import { ConfigsSchema } from "../../shared/schemas/mcp-tool-out";

type McpToolOutConfig = Infer<typeof ConfigsSchema>;

/**
 * The value rides on the record's root `payload` — an nrg body node merges it
 * there, a core node sets it directly — like `http-out`. `_mcpTool.callId`
 * correlates the answer back to the parked call: `mcp-tool-in` registered the live
 * resolver in the package `PendingIndex` under that id and rides the id on the wire.
 */
type McpToolOutInput = Input<
  Port<{
    payload?: unknown;
    isError?: boolean;
    _mcpTool: { callId: string };
  }>
>;

/**
 * `mcp-tool-out` — the SINK (like `http-out`/`claude-tool-return`). It wraps the
 * flow's value into the tool's answer and settles the parked call by its `callId`,
 * looking the live resolver up in the package `PendingIndex` (take-once).
 */
export default class McpToolOut extends IONode<
  McpToolOutConfig,
  never,
  McpToolOutInput,
  never
> {
  static override readonly type = "mcp-tool-out";
  static override readonly category = "mcp";
  static override readonly color = "#8ecae6";
  static override readonly configSchema = ConfigsSchema;

  override input(msg: McpToolOutInput): void {
    // The record model: the answer rides `payload` at the ROOT — a core node
    // sets it (`msg.payload = result`), an nrg body node merges it
    // (`send(port, { payload })`, overwriting the tool ARGS the source put
    // there). `callId` provenance is carried on `_mcpTool` by the same merges.
    const answer: ToolAnswer = {
      value: msg.payload,
      format: this.config.format,
      isError: !!msg.isError,
    };

    // Settle the parked call by its transaction key `_mcpTool.callId`: the live
    // resolver lives in the package `PendingIndex`, take-once — like http-out reads
    // back `res` from its store then drops it. The key is a declared wire field, so
    // a wire check verifies this return node is fed by a `mcp-tool-in`.
    const settle = PendingIndex.take(msg._mcpTool.callId);
    if (!settle) {
      this.status({ fill: "yellow", shape: "dot", text: "no pending call" });
      return void this.warn(
        "mcp-tool-out: no pending tool call (already answered, timed out, or callId lost) — check the return wire carries msg._mcpTool.callId",
      );
    }
    this.status({ fill: "green", shape: "dot", text: "returned" });
    settle(answer);
  }
}
