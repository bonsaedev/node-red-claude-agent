import { describe, it, expect, vi, afterEach } from "vitest";
import { createNode } from "@bonsae/nrg/test/server/unit";
import McpToolIn from "../../../../src/server/nodes/mcp-tool-in";
import {
  PendingIndex,
  type Settle,
  type ToolAnswer,
} from "../../../../src/server/lib/tool-dispatch";

const SERVER_INFO = { nodeId: "srv-1", name: "node-red" };

/** Settle a parked call the way `mcp-tool-out` does — take the live resolver from
 *  the package `PendingIndex` by the `callId` that rode the wire on `_mcpTool`. */
function resolverOf(frame: { _mcpTool: { callId: string } }): Settle {
  return PendingIndex.take(frame._mcpTool.callId)!;
}

const answer = (value: unknown): ToolAnswer => ({
  value,
  format: "text",
  isError: false,
});

const TOOL_CONFIG = {
  name: "get_weather",
  description: "Look up the weather",
  params: [
    {
      name: "city",
      type: "string",
      description: "",
      required: true,
      values: "",
    },
  ],
  timeoutSeconds: 55,
};

/** A stand-in MCP server that captures the registered tool for direct driving. */
function fakeServer() {
  const captured: {
    name?: string;
    config?: {
      description?: string;
      inputSchema?: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean };
    };
    handler?: (a: unknown, extra: unknown) => Promise<unknown>;
  } = {};
  return {
    captured,
    registerTool(name: string, config: unknown, handler: unknown) {
      captured.name = name;
      captured.config = config as typeof captured.config;
      captured.handler = handler as typeof captured.handler;
    },
  };
}

describe("mcp-tool-in", () => {
  afterEach(() => vi.useRealTimers());

  describe("dispatch → call emission", () => {
    it("emits the call payload with server provenance and parks a resolver", async () => {
      const { node } = await createNode(McpToolIn, { config: TOOL_CONFIG });
      node.dispatch({ city: "SF" }, SERVER_INFO);

      const [frame] = node.sent("call");
      expect(frame.payload).toEqual({ city: "SF" });
      expect(frame._mcpTool).toMatchObject({
        name: "get_weather",
        server: { nodeId: "srv-1", name: "node-red" },
      });
      expect(typeof frame._mcpTool.callId).toBe("string");
      expect(node.statuses().at(-1)).toMatchObject({
        text: "calling get_weather",
      });
    });

    it("carries the MCP requestId when supplied", async () => {
      const { node } = await createNode(McpToolIn, { config: TOOL_CONFIG });
      node.dispatch({ city: "SF" }, SERVER_INFO, undefined, undefined, "req-9");

      expect(node.sent("call")[0]._mcpTool.requestId).toBe("req-9");
    });

    it("resolves with the answer when its parked resolver is settled", async () => {
      const { node } = await createNode(McpToolIn, { config: TOOL_CONFIG });
      const p = node.dispatch({ city: "SF" }, SERVER_INFO);

      resolverOf(node.sent("call")[0])(answer("sunny"));

      await expect(p).resolves.toEqual(answer("sunny"));
      expect(node.statuses().at(-1)).toMatchObject({ text: "get_weather ok" });
    });

    it("detaches its abort listeners on normal settlement (no leak on the shared server signal)", async () => {
      // closeSignal is the mcp-server's long-lived teardown signal, shared across
      // every call — a listener left attached per call leaks for the whole deploy.
      const close = new AbortController();
      const removeSpy = vi.spyOn(close.signal, "removeEventListener");
      const { node } = await createNode(McpToolIn, { config: TOOL_CONFIG });

      const p = node.dispatch(
        { city: "SF" },
        SERVER_INFO,
        undefined,
        close.signal,
      );
      resolverOf(node.sent("call")[0])(answer("sunny"));
      await p;

      expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    });
  });

  describe("register", () => {
    it("registers a tool whose handler runs the round-trip and wraps a text result", async () => {
      const { node } = await createNode(McpToolIn, {
        config: { ...TOOL_CONFIG, readOnly: true },
      });
      const server = fakeServer();
      node.register(server as never, SERVER_INFO, new AbortController().signal);

      expect(server.captured.name).toBe("get_weather");
      expect(server.captured.config?.description).toBe("Look up the weather");
      expect(server.captured.config?.annotations?.readOnlyHint).toBe(true);
      expect(server.captured.config?.inputSchema?.city).toBeDefined();

      const resultP = server.captured.handler!(
        { city: "SF" },
        {
          requestId: "req-1",
        },
      );
      await vi.waitFor(() => expect(node.sent("call")).toHaveLength(1));
      expect(node.sent("call")[0]._mcpTool.requestId).toBe("req-1");

      resolverOf(node.sent("call")[0])(answer("sunny"));
      await expect(resultP).resolves.toEqual({
        content: [{ type: "text", text: "sunny" }],
      });
    });

    it("turns a rejected dispatch into an isError result (never a throw)", async () => {
      vi.useFakeTimers();
      const { node } = await createNode(McpToolIn, {
        config: { ...TOOL_CONFIG, timeoutSeconds: 1 },
      });
      const server = fakeServer();
      node.register(server as never, SERVER_INFO, new AbortController().signal);

      const resultP = server.captured.handler!({ city: "SF" }, {}) as Promise<{
        isError?: boolean;
      }>;
      await vi.advanceTimersByTimeAsync(1000);

      expect((await resultP).isError).toBe(true);
    });
  });

  describe("settlement guarantees", () => {
    it("rejects with a timeout when no return arrives in time", async () => {
      vi.useFakeTimers();
      const { node } = await createNode(McpToolIn, {
        config: { ...TOOL_CONFIG, timeoutSeconds: 1 },
      });
      const p = node.dispatch({ city: "SF" }, SERVER_INFO);
      const assertion = expect(p).rejects.toThrow(/timed out after 1s/);

      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(node.statuses().at(-1)).toMatchObject({ fill: "red" });
      expect(node.warned().some((w) => w.includes("no mcp-tool-out"))).toBe(
        true,
      );
    });

    it("rejects when the server's teardown signal fires", async () => {
      const close = new AbortController();
      const { node } = await createNode(McpToolIn, { config: TOOL_CONFIG });
      const p = node.dispatch(
        { city: "SF" },
        SERVER_INFO,
        undefined,
        close.signal,
      );

      close.abort();
      await expect(p).rejects.toThrow(/request aborted/);
    });

    it("rejects when the per-request MCP signal fires", async () => {
      const mcp = new AbortController();
      const { node } = await createNode(McpToolIn, { config: TOOL_CONFIG });
      const p = node.dispatch({ city: "SF" }, SERVER_INFO, mcp.signal);

      mcp.abort();
      await expect(p).rejects.toThrow(/request aborted/);
    });
  });

  describe("teardown", () => {
    it("settles every parked call on close and refuses new dispatch after", async () => {
      const { node } = await createNode(McpToolIn, { config: TOOL_CONFIG });
      const p = node.dispatch({ city: "SF" }, SERVER_INFO);

      await node.close();
      await expect(p).rejects.toThrow(/redeployed/);
      await expect(node.dispatch({ city: "NYC" }, SERVER_INFO)).rejects.toThrow(
        /undeployed/,
      );
    });
  });

  describe("concurrency", () => {
    // Settled via the callId `PendingIndex` — the live resolver never rides the
    // wire (it can't survive a fan-out clone), so a return node always correlates
    // back by the per-call-unique `callId` that rode on `_mcpTool`.
    it("keys concurrent calls independently", async () => {
      const { node } = await createNode(McpToolIn, { config: TOOL_CONFIG });
      const p1 = node.dispatch({ city: "SF" }, SERVER_INFO);
      const p2 = node.dispatch({ city: "NYC" }, SERVER_INFO);

      const [f1, f2] = node.sent("call");
      const id1 = f1._mcpTool.callId as string;
      const id2 = f2._mcpTool.callId as string;
      expect(id1).not.toBe(id2);

      PendingIndex.take(id1)!(answer("sunny"));
      await expect(p1).resolves.toEqual(answer("sunny"));

      let p2Settled = false;
      void p2.then(() => (p2Settled = true));
      await Promise.resolve();
      expect(p2Settled).toBe(false);

      PendingIndex.take(id2)!(answer("rain"));
      await expect(p2).resolves.toEqual(answer("rain"));
    });
  });
});
