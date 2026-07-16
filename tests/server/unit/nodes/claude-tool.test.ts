import { describe, it, expect, vi, afterEach } from "vitest";
import { createNode } from "@bonsae/nrg/test/server/unit";
import { Channels } from "@bonsae/nrg/server";

// The SDK's `tool()` is a pure definition builder; mock it to a passthrough so
// the test can invoke the produced handler directly (no MCP server / subprocess).
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (
    name: string,
    description: string,
    inputSchema: unknown,
    handler: unknown,
    config: unknown,
  ) => ({ name, description, inputSchema, handler, config }),
}));

import ClaudeTool from "../../../../src/server/nodes/claude-tool";
import {
  PendingIndex,
  type RunContext,
  type Settle,
  type ToolAnswer,
} from "../../../../src/server/lib/tool-dispatch";

function makeRun(overrides: Partial<RunContext> = {}): RunContext {
  const controller = new AbortController();
  return {
    correlationId: "corr-1",
    signal: controller.signal,
    agentNodeId: "agent-1",
    public: () => ({
      nodeId: "agent-1",
      correlationId: "corr-1",
      sessionId: "sess-1",
    }),
    ...overrides,
  };
}

/** The live resolver the tool parked on the private channel of a `call` emission. */
function resolverOf(frame: unknown): Settle {
  return (frame as Record<symbol, { private: { claudeReturn: Settle } }>)[
    Channels
  ].private.claudeReturn;
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

describe("claude-tool", () => {
  afterEach(() => vi.useRealTimers());

  describe("dispatch → call emission", () => {
    it("emits the call payload with provenance and parks a per-call resolver", async () => {
      const { node } = await createNode(ClaudeTool, { config: TOOL_CONFIG });
      node.dispatch({ city: "SF" }, makeRun());

      const [frame] = node.sent("call");
      expect(frame.output.payload).toEqual({ city: "SF" });
      expect(frame.output.claudeTool).toMatchObject({
        name: "get_weather",
        agent: {
          nodeId: "agent-1",
          correlationId: "corr-1",
          sessionId: "sess-1",
        },
      });
      expect(typeof frame.output.claudeTool.callId).toBe("string");
      expect(node.statuses().at(-1)).toMatchObject({
        text: "calling get_weather",
      });
    });

    it("carries the SDK toolUseId when the handler supplies one", async () => {
      const { node } = await createNode(ClaudeTool, { config: TOOL_CONFIG });
      node.dispatch({ city: "SF" }, makeRun(), undefined, "tu-42");

      expect(node.sent("call")[0].output.claudeTool.toolUseId).toBe("tu-42");
    });

    it("resolves with the answer settled on the private channel", async () => {
      const { node } = await createNode(ClaudeTool, { config: TOOL_CONFIG });
      const p = node.dispatch({ city: "SF" }, makeRun());

      resolverOf(node.sent("call")[0])(answer("sunny"));

      await expect(p).resolves.toEqual(answer("sunny"));
      expect(node.statuses().at(-1)).toMatchObject({ text: "get_weather ok" });
    });

    it("detaches its abort listeners on normal settlement (no per-run leak)", async () => {
      // run.signal outlives a single call (one agent run makes many tool calls),
      // so a listener left attached per call leaks for the whole run.
      const ctrl = new AbortController();
      const removeSpy = vi.spyOn(ctrl.signal, "removeEventListener");
      const { node } = await createNode(ClaudeTool, { config: TOOL_CONFIG });

      const p = node.dispatch({ city: "SF" }, makeRun({ signal: ctrl.signal }));
      resolverOf(node.sent("call")[0])(answer("sunny"));
      await p;

      expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    });
  });

  describe("toSdkTool", () => {
    it("builds a tool whose handler runs the round-trip and wraps a text result", async () => {
      const { node } = await createNode(ClaudeTool, {
        config: { ...TOOL_CONFIG, readOnly: true },
      });
      const t = node.toSdkTool(makeRun()) as {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        handler: (a: unknown, extra: unknown) => Promise<unknown>;
        config: { annotations: { readOnlyHint: boolean } };
      };

      expect(t.name).toBe("get_weather");
      expect(t.description).toBe("Look up the weather");
      expect(t.config.annotations.readOnlyHint).toBe(true);
      // params → zod raw shape
      expect(t.inputSchema.city).toBeDefined();

      const resultP = t.handler({ city: "SF" }, { requestId: "tu-1" });
      await vi.waitFor(() => expect(node.sent("call")).toHaveLength(1));
      expect(node.sent("call")[0].output.claudeTool.toolUseId).toBe("tu-1");

      resolverOf(node.sent("call")[0])(answer("sunny"));
      await expect(resultP).resolves.toEqual({
        content: [{ type: "text", text: "sunny" }],
      });
    });

    it("turns a rejected dispatch into an isError result (never a throw)", async () => {
      vi.useFakeTimers();
      const { node } = await createNode(ClaudeTool, {
        config: { ...TOOL_CONFIG, timeoutSeconds: 1 },
      });
      const t = node.toSdkTool(makeRun()) as {
        handler: (a: unknown, extra: unknown) => Promise<{ isError?: boolean }>;
      };

      const resultP = t.handler({ city: "SF" }, {});
      await vi.advanceTimersByTimeAsync(1000);

      const result = await resultP;
      expect(result.isError).toBe(true);
    });
  });

  describe("settlement guarantees", () => {
    it("rejects with a timeout when no return arrives in time", async () => {
      vi.useFakeTimers();
      const { node } = await createNode(ClaudeTool, {
        config: { ...TOOL_CONFIG, timeoutSeconds: 1 },
      });
      const p = node.dispatch({ city: "SF" }, makeRun());
      const assertion = expect(p).rejects.toThrow(/timed out after 1s/);

      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(node.statuses().at(-1)).toMatchObject({ fill: "red" });
      expect(
        node.warned().some((w) => w.includes("no claude-tool-return")),
      ).toBe(true);
    });

    it("rejects when the run's abort signal fires", async () => {
      const controller = new AbortController();
      const { node } = await createNode(ClaudeTool, { config: TOOL_CONFIG });
      const p = node.dispatch(
        { city: "SF" },
        makeRun({ signal: controller.signal }),
      );

      controller.abort();
      await expect(p).rejects.toThrow(/run aborted/);
    });

    it("rejects when the MCP request signal fires", async () => {
      const mcp = new AbortController();
      const { node } = await createNode(ClaudeTool, { config: TOOL_CONFIG });
      const p = node.dispatch({ city: "SF" }, makeRun(), mcp.signal);

      mcp.abort();
      await expect(p).rejects.toThrow(/run aborted/);
    });
  });

  describe("teardown", () => {
    it("settles every parked call on close and refuses new dispatch after", async () => {
      const { node } = await createNode(ClaudeTool, { config: TOOL_CONFIG });
      const p = node.dispatch({ city: "SF" }, makeRun());

      await node.close();
      await expect(p).rejects.toThrow(/redeployed/);
      await expect(node.dispatch({ city: "NYC" }, makeRun())).rejects.toThrow(
        /undeployed/,
      );
    });
  });

  describe("concurrency", () => {
    // NOTE: settled here via the callId `PendingIndex` (the fallback route), not
    // the private channel. The unit harness mints a fixed `_msgid` for every
    // emission, so two concurrent private-channel resolvers would collide on the
    // same key — the callId is the per-call-unique route the real runtime also
    // relies on for fresh-message answers.
    it("keys concurrent calls independently — settling one leaves the other parked", async () => {
      const { node } = await createNode(ClaudeTool, { config: TOOL_CONFIG });
      const p1 = node.dispatch({ city: "SF" }, makeRun());
      const p2 = node.dispatch({ city: "NYC" }, makeRun());

      const [f1, f2] = node.sent("call");
      const id1 = f1.output.claudeTool.callId as string;
      const id2 = f2.output.claudeTool.callId as string;
      expect(id1).not.toBe(id2);

      PendingIndex.take(id1)!(answer("sunny"));
      await expect(p1).resolves.toEqual(answer("sunny"));

      // settling p1 left p2 untouched — it settles independently by its own key
      let p2Settled = false;
      void p2.then(() => (p2Settled = true));
      await Promise.resolve();
      expect(p2Settled).toBe(false);

      PendingIndex.take(id2)!(answer("rain"));
      await expect(p2).resolves.toEqual(answer("rain"));
    });
  });
});
