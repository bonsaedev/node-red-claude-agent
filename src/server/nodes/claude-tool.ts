import {
  IONode,
  type Infer,
  type Port,
  type Outputs,
} from "@bonsae/nrg/server";
import { randomUUID } from "node:crypto";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { ConfigsSchema } from "../../shared/schemas/claude-tool";
import {
  PendingIndex,
  settleOnce,
  zodShapeFrom,
  toCallToolResult,
  errorResult,
  type Settle,
  type RunContext,
  type ToolAnswer,
} from "../lib/tool-dispatch";

type ClaudeToolConfig = Infer<typeof ConfigsSchema>;

/**
 * The clone-safe call payload emitted on `call`. `_claudeTool` is the Model-B
 * transaction object — a node-type-named, `_`-prefixed root field whose `callId`
 * rides the wire so `claude-tool-return` looks the parked live resolver up in the
 * package `PendingIndex`. A wire check verifies a return node reads it; the resolver
 * itself never rides the message (it can't survive a fan-out clone).
 */
type ClaudeToolOutput = {
  payload: Record<string, unknown>;
  _claudeTool: {
    callId: string;
    name: string;
    toolUseId?: string;
    agent: { nodeId: string; correlationId?: string; sessionId?: string };
  };
};

/**
 * `claude-tool` — a 0-input SOURCE node (like `http-in`). It declares an MCP tool
 * on the agent's in-process "flow" server; when the model calls the tool, it parks
 * a per-`callId` promise and emits the call on `call`. Settlement is GUARANTEED via
 * four paths (return / finite timer / abort / teardown) so a call never hangs the
 * run.
 */
export default class ClaudeTool extends IONode<
  ClaudeToolConfig,
  never,
  never,
  Outputs<{ call: Port<ClaudeToolOutput> }>
> {
  static override readonly type = "claude-tool";
  static override readonly category = "claude";
  static override readonly color = "#d9b8ff";
  static override readonly configSchema = ConfigsSchema;

  readonly #pending = new Map<string, Settle>();
  #closed = false;

  /**
   * Build the SDK tool bound to a run. The handler runs ON THE AGENT'S STACK when
   * the model calls the tool. Every path returns a `CallToolResult` — a throw would
   * be caught by the in-process MCP server, but we never rely on that.
   */
  toSdkTool(run: RunContext) {
    return tool(
      this.config.name,
      this.config.description,
      zodShapeFrom(this.config.params),
      async (args: Record<string, unknown>, extra: unknown) => {
        const mcpSignal = (extra as { signal?: AbortSignal } | undefined)
          ?.signal;
        const toolUseId = (extra as { requestId?: string } | undefined)
          ?.requestId;
        try {
          const ans = await this.dispatch(args, run, mcpSignal, toolUseId);
          return toCallToolResult(ans.value, ans.format, ans.isError);
        } catch (e) {
          // The only throw here is dispatch rejecting (timeout/abort/closed) —
          // turn it into isError so the model gets an answer and the run continues.
          return errorResult(e instanceof Error ? e.message : String(e));
        }
      },
      { annotations: { readOnlyHint: this.config.readOnly } },
    );
  }

  /**
   * Called by the MCP handler on the agent's stack (no `input()` ALS frame). Parks
   * a per-`callId` settle-once promise, emits on `call`, and guarantees settlement.
   * Rejects (never hangs) on timeout/abort/teardown.
   */
  dispatch(
    args: Record<string, unknown>,
    run: RunContext,
    mcpSignal?: AbortSignal,
    toolUseId?: string,
  ): Promise<ToolAnswer> {
    if (this.#closed) {
      return Promise.reject(
        new Error(`claude-tool "${this.config.name}" was undeployed`),
      );
    }

    return new Promise<ToolAnswer>((resolve, reject) => {
      const callId = randomUUID();
      const settle = settleOnce(
        (value) => {
          // Only the success path claims "ok" — a failure settle (timeout/abort/
          // teardown) already set its own status, so don't paint over it green.
          if (value instanceof Error) reject(value);
          else {
            this.status({
              fill: "green",
              shape: "dot",
              text: `${this.config.name} ok`,
            });
            resolve(value as ToolAnswer);
          }
        },
        () => {
          this.#pending.delete(callId);
          PendingIndex.drop(callId);
        },
      );

      // Path 2 — the mandatory finite timer, always armed, kept under the ~60s
      // stream-close. On fire: red status + warn + reject (the wrapper turns it into
      // isError). The framework-managed timer is also auto-cleared on teardown; we
      // clear it explicitly on any settle so it never fires after the call is done.
      const timer = this.setTimeout(() => {
        this.status({
          fill: "red",
          shape: "ring",
          text: `${this.config.name}: timed out`,
        });
        this.warn(
          `claude-tool "${this.config.name}": no claude-tool-return within ${this.config.timeoutSeconds}s — returning a timeout error to the model (broken/missing return wire, or a stalled flow)`,
        );
        settle(
          new Error(
            `tool "${this.config.name}" timed out after ${this.config.timeoutSeconds}s`,
          ),
        );
      }, this.config.timeoutSeconds * 1000);
      settle.onCleanup(() => this.clearTimeout(timer));

      // Path 3 — both abort layers settle the parked call.
      const onAbort = () => {
        this.status({
          fill: "grey",
          shape: "ring",
          text: `${this.config.name} aborted`,
        });
        settle(new Error("run aborted"));
      };
      // Detach on ANY settlement path (not just when abort fires): `{ once: true }`
      // only auto-removes on fire, and run.signal outlives a single call, so the
      // return-sink path would otherwise leak a listener per call for the whole run.
      mcpSignal?.addEventListener("abort", onAbort, { once: true });
      settle.onCleanup(() => mcpSignal?.removeEventListener("abort", onAbort));
      run.signal.addEventListener("abort", onAbort, { once: true });
      settle.onCleanup(() => run.signal.removeEventListener("abort", onAbort));

      this.#pending.set(callId, settle);
      PendingIndex.put(callId, settle);
      this.status({
        fill: "blue",
        shape: "dot",
        text: `calling ${this.config.name}`,
      });

      // The live resolver is parked in `PendingIndex` under `callId` (above); the
      // wire carries only that id inside `_claudeTool`, so a return node correlates
      // back by looking it up — nothing un-cloneable rides the message.
      this.send("call", {
        payload: args,
        _claudeTool: {
          callId,
          name: this.config.name,
          toolUseId,
          agent: run.public(),
        },
      });
    });
  }

  override closed(): void {
    // Redeploy/teardown: settle every parked call to isError and block late
    // dispatch, so nothing hangs across a redeploy.
    this.#closed = true;
    for (const settle of this.#pending.values())
      settle(new Error("claude-tool redeployed"));
    this.#pending.clear();
  }
}
