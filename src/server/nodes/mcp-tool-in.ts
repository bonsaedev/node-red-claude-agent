import {
  IONode,
  type Infer,
  type Port,
  type Outputs,
} from "@bonsae/nrg/server";
import { randomUUID } from "node:crypto";
import type { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConfigsSchema } from "../../shared/schemas/mcp-tool-in";
import {
  PendingIndex,
  settleOnce,
  zodShapeFrom,
  toCallToolResult,
  errorResult,
  type Settle,
  type Param,
  type ToolAnswer,
} from "../lib/tool-dispatch";

type Config = Infer<typeof ConfigsSchema>;

/** Clone-safe provenance for the server hosting this tool. */
type ServerInfo = { nodeId: string; name: string };

/**
 * The clone-safe call payload emitted on `call`. The live resolver rides the
 * PRIVATE channel (keyed by `_msgid`), never this object.
 */
type CallWire = {
  payload: Record<string, unknown>;
  mcpTool: {
    callId: string;
    name: string;
    requestId?: string;
    server: ServerInfo;
  };
};

/**
 * `mcp-tool-in` — a 0-input SOURCE node (like `http-in`/`claude-tool`). It declares
 * an MCP tool on its bound `mcp-server`; when a connected client calls the tool, the
 * server parks a per-`callId` promise and emits the call on `call`. Settlement is
 * GUARANTEED via four paths (return / finite timer / abort / teardown) so a call
 * never hangs the HTTP request.
 */
export default class McpToolIn extends IONode<
  Config,
  never,
  never,
  Outputs<{ call: Port<CallWire> }>
> {
  static override readonly type = "mcp-tool-in";
  static override readonly category = "mcp";
  static override readonly color = "#8ecae6";
  static override readonly configSchema = ConfigsSchema;

  readonly #pending = new Map<string, Settle>();
  #closed = false;

  /**
   * Register this tool on a freshly-built MCP server (the `mcp-server` config node
   * rebuilds one per request). `serverInfo` rides the emitted provenance;
   * `closeSignal` is the server's teardown signal (aborts in-flight calls). The
   * handler runs on the transport's stack when a client calls the tool.
   */
  register(
    server: SdkMcpServer,
    serverInfo: ServerInfo,
    closeSignal: AbortSignal,
  ): void {
    server.registerTool(
      this.config.name,
      {
        description: this.config.description,
        inputSchema: zodShapeFrom(this.config.params as Param[]),
        annotations: { readOnlyHint: this.config.readOnly },
      },
      async (
        args: Record<string, unknown>,
        extra: { signal?: AbortSignal; requestId?: string | number },
      ) => {
        try {
          const ans = await this.dispatch(
            args,
            serverInfo,
            extra.signal,
            closeSignal,
            extra.requestId != null ? String(extra.requestId) : undefined,
          );
          return toCallToolResult(ans.value, ans.format, ans.isError);
        } catch (e) {
          // The only throw is dispatch rejecting (timeout/abort/closed) — turn it
          // into isError so the client's model gets an answer and continues.
          return errorResult(e instanceof Error ? e.message : String(e));
        }
      },
    );
  }

  /**
   * Called by the MCP tool handler on the transport's stack (no `input()` ALS
   * frame). Parks a per-`callId` settle-once promise, emits on `call`, and
   * guarantees settlement. Rejects (never hangs) on timeout/abort/teardown.
   */
  dispatch(
    args: Record<string, unknown>,
    serverInfo: ServerInfo,
    mcpSignal?: AbortSignal,
    closeSignal?: AbortSignal,
    requestId?: string,
  ): Promise<ToolAnswer> {
    if (this.#closed) {
      return Promise.reject(
        new Error(`mcp-tool-in "${this.config.name}" was undeployed`),
      );
    }

    return new Promise<ToolAnswer>((resolve, reject) => {
      const callId = randomUUID();
      const settle = settleOnce(
        (value) => {
          // Only the success path claims "ok" — a failure settle already set its
          // own status, so don't paint over it green.
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

      // Path 2 — the mandatory finite timer, always armed, so a broken/missing
      // return wire returns a timeout error to the client instead of hanging.
      const timer = this.setTimeout(() => {
        this.status({
          fill: "red",
          shape: "ring",
          text: `${this.config.name}: timed out`,
        });
        this.warn(
          `mcp-tool-in "${this.config.name}": no mcp-tool-out within ${this.config.timeoutSeconds}s — returning a timeout error to the client (broken/missing return wire, or a stalled flow)`,
        );
        settle(
          new Error(
            `tool "${this.config.name}" timed out after ${this.config.timeoutSeconds}s`,
          ),
        );
      }, this.config.timeoutSeconds * 1000);
      settle.onCleanup(() => this.clearTimeout(timer));

      // Path 3 — both abort layers (the per-request MCP signal + the server's
      // teardown signal) settle the parked call.
      const onAbort = () => {
        this.status({
          fill: "grey",
          shape: "ring",
          text: `${this.config.name} aborted`,
        });
        settle(new Error("request aborted"));
      };
      // Detach on ANY settlement path (not just when abort fires): `{ once: true }`
      // only auto-removes on fire, and closeSignal is the server's long-lived
      // teardown signal shared across every call — the return-sink path would
      // otherwise leak one listener per call for the whole deploy.
      mcpSignal?.addEventListener("abort", onAbort, { once: true });
      settle.onCleanup(() => mcpSignal?.removeEventListener("abort", onAbort));
      closeSignal?.addEventListener("abort", onAbort, { once: true });
      settle.onCleanup(() =>
        closeSignal?.removeEventListener("abort", onAbort),
      );

      this.#pending.set(callId, settle);
      PendingIndex.put(callId, settle);
      this.status({
        fill: "blue",
        shape: "dot",
        text: `calling ${this.config.name}`,
      });

      // send() runs on the transport's stack (no input() ALS frame), so the
      // framework delivers via node.send and mints a fresh _msgid. The live
      // resolver rides the PRIVATE channel, keyed by that _msgid.
      this.send(
        "call",
        {
          payload: args,
          mcpTool: {
            callId,
            name: this.config.name,
            requestId,
            server: serverInfo,
          },
        },
        { private: { mcpReturn: settle } },
      );
    });
  }

  override closed(): void {
    // Redeploy/teardown: settle every parked call to isError and block late
    // dispatch, so nothing hangs across a redeploy.
    this.#closed = true;
    for (const settle of this.#pending.values())
      settle(new Error("mcp-tool-in redeployed"));
    this.#pending.clear();
  }
}
