import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNode } from "@bonsae/nrg/test/server/unit";

// Control the mocked Agent SDK `query()` from each test. `vi.mock` is hoisted
// above imports, so the controllable handle is created with `vi.hoisted`.
const sdk = vi.hoisted(() => {
  let impl:
    | ((params: {
        prompt: string;
        options: any;
      }) => AsyncGenerator<unknown, void>)
    | null = null;
  const queryMock = vi.fn((params: { prompt: string; options: any }) => {
    if (impl) return impl(params);
    return (async function* () {})();
  });
  return {
    queryMock,
    // Yield a fixed list of SDK messages.
    setMessages(messages: unknown[]) {
      impl = async function* () {
        for (const m of messages) yield m;
      };
    },
    // Drive a custom generator (for interactive canUseTool / onUserDialog tests).
    setImpl(
      fn: (params: {
        prompt: string;
        options: any;
      }) => AsyncGenerator<unknown, void>,
    ) {
      impl = fn;
    },
    reset() {
      impl = null;
      queryMock.mockClear();
    },
  };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: sdk.queryMock }));

// Imported after the mock is registered.
import ClaudeAgent from "../../../../src/server/nodes/claude-agent";

/**
 * A stand-in configuration node. The agent calls `buildOptions()` for the base
 * SDK options and `assembleContributions(run)` for the flow-tool MCP server +
 * allowedTools (empty here — no tools bound in these unit tests).
 */
function mockConfig(options: Record<string, unknown> = {}) {
  return {
    id: "cfg-1",
    type: "claude-agent-configuration",
    config: {},
    credentials: { apiKey: "sk-test" },
    buildOptions: vi.fn(() => ({
      permissionMode: "default",
      env: {},
      ...options,
    })),
    assembleContributions: vi.fn(() => ({
      mcpServers: {},
      allowedTools: [],
    })),
  };
}

/** Read each port-N emission's wrapped payload (the node sends under `output`). */
function outputs(
  node: { sent: (p: number) => { output: unknown }[] },
  port: number,
) {
  return node.sent(port).map((m) => m.output as Record<string, any>);
}

const RESULT_OK = {
  type: "result",
  subtype: "success",
  session_id: "s1",
  result: "ok",
  num_turns: 1,
  total_cost_usd: 0,
};

beforeEach(() => sdk.reset());

describe("claude-agent", () => {
  describe("guards", () => {
    it("throws when no configuration node is selected", async () => {
      const { node } = await createNode(ClaudeAgent, {
        config: { config: "", prompt: { type: "str", value: "hi" } },
      });

      // errorPort is on (default), so nrg routes the thrown failure to the error
      // port and `receive()` resolves — the message rides `error.message`.
      await node.receive({ payload: "hi" });
      expect(node.sent("error")[0].error.message).toContain(
        "no configuration node selected",
      );
      expect(node.statuses().at(-1)).toMatchObject({
        text: "no configuration",
      });
      expect(sdk.queryMock).not.toHaveBeenCalled();
    });

    it("throws when the prompt resolves empty", async () => {
      const { node } = await createNode(ClaudeAgent, {
        config: { config: mockConfig(), prompt: { type: "str", value: "" } },
      });

      await node.receive({ payload: 123 });
      expect(node.sent("error")[0].error.message).toContain("prompt is empty");
      expect(node.statuses().at(-1)).toMatchObject({ text: "empty prompt" });
    });

    it("drops the run when assembleContributions throws, so a later interrupt is a no-op", async () => {
      const cfg = mockConfig();
      cfg.assembleContributions = vi.fn(() => {
        throw new Error("two claude-tool nodes both named x — must be unique");
      });
      const { node } = await createNode(ClaudeAgent, {
        config: { config: cfg, prompt: { type: "str", value: "go" } },
      });

      // The config error rides the error port (errorPort is on by default).
      await node.receive({ payload: "go", correlationId: "c-1" });
      expect(node.sent("error")[0].error.message).toContain("must be unique");
      expect(sdk.queryMock).not.toHaveBeenCalled();

      // The run was dropped on the throw, so a later interrupt finds no in-flight
      // run and must NOT report "interrupted" (the leaked-entry bug would).
      await node.receive({ claudeControl: "interrupt", correlationId: "c-1" });
      expect(node.statuses().some((s) => s.text === "interrupted")).toBe(false);
    });
  });

  describe("prompt source", () => {
    it("uses msg.payload when the prompt source is a msg property", async () => {
      sdk.setMessages([RESULT_OK]);
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "msg", value: "payload" },
        },
      });

      await node.receive({ payload: "from payload" });
      expect(sdk.queryMock.mock.calls[0][0].prompt).toBe("from payload");
    });

    it("uses a static string prompt regardless of payload", async () => {
      sdk.setMessages([RESULT_OK]);
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "fixed" },
        },
      });

      await node.receive({ payload: "ignored" });
      expect(sdk.queryMock.mock.calls[0][0].prompt).toBe("fixed");
    });
  });

  describe("single response", () => {
    it("emits only the final result on the response port", async () => {
      sdk.setMessages([
        { type: "system", session_id: "s1" },
        {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "thinking" }] },
        },
        {
          type: "result",
          subtype: "success",
          session_id: "s1",
          result: "Final answer",
          usage: { input_tokens: 1 },
          total_cost_usd: 0.001,
          num_turns: 2,
        },
      ]);
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "hi" },
          responseMode: "single",
        },
      });

      await node.receive({ payload: "hi", correlationId: "c-1" });

      // single mode suppresses intermediate assistant turns
      expect(node.sent(0)).toHaveLength(1);
      expect(outputs(node, 0)[0]).toMatchObject({
        text: "Final answer",
        kind: "result",
        sessionId: "s1",
        correlationId: "c-1",
      });
      expect(node.sent("error")).toHaveLength(0);
      expect(node.statuses().at(-1)).toMatchObject({
        fill: "green",
        text: expect.stringContaining("done"),
      });
    });

    it("resumes from msg.sessionId", async () => {
      sdk.setMessages([RESULT_OK]);
      const { node } = await createNode(ClaudeAgent, {
        config: { config: mockConfig(), prompt: { type: "str", value: "hi" } },
      });

      await node.receive({ payload: "hi", sessionId: "prev-session" });
      expect(sdk.queryMock.mock.calls[0][0].options.resume).toBe(
        "prev-session",
      );
    });

    it("pairs bypassPermissions with allowDangerouslySkipPermissions", async () => {
      sdk.setMessages([RESULT_OK]);
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "hi" },
          permissionMode: "bypassPermissions",
        },
      });

      await node.receive({ payload: "hi" });
      const opts = sdk.queryMock.mock.calls[0][0].options;
      expect(opts.permissionMode).toBe("bypassPermissions");
      expect(opts.allowDangerouslySkipPermissions).toBe(true);
    });
  });

  describe("failure", () => {
    it("throws and routes a failed result to the error port with structured detail", async () => {
      sdk.setMessages([
        {
          type: "result",
          subtype: "error_max_turns",
          session_id: "s1",
          total_cost_usd: 0.02,
          num_turns: 5,
          errors: ["limit"],
          stop_reason: null,
        },
      ]);
      const { node } = await createNode(ClaudeAgent, {
        config: { config: mockConfig(), prompt: { type: "str", value: "hi" } },
      });

      // errorPort is on, so nrg routes the thrown AgentRunError to the error port
      // and `receive()` resolves — the structured detail rides the error port.
      await node.receive({ payload: "hi", correlationId: "c-1" });

      expect(node.sent("error")[0].error).toMatchObject({
        name: "AgentRunError",
        subtype: "error_max_turns",
        correlationId: "c-1",
        numTurns: 5,
        errors: ["limit"],
      });
    });

    it("forwards a fatal assistant error (auth/billing) to the error port even with no result", async () => {
      // A fatal auth/billing error may end the stream WITHOUT a result message;
      // the node must still surface it (structured, with correlationId) instead
      // of only logging and finishing silently.
      sdk.setMessages([
        { type: "system", session_id: "s1" },
        {
          type: "assistant",
          session_id: "s1",
          error: "authentication_failed",
          message: { content: [] },
        },
      ]);
      const { node } = await createNode(ClaudeAgent, {
        config: { config: mockConfig(), prompt: { type: "str", value: "hi" } },
      });

      await node.receive({ payload: "hi", correlationId: "c-2" });

      expect(node.sent("error")[0].error).toMatchObject({
        name: "AgentRunError",
        subtype: "authentication_failed",
        correlationId: "c-2",
      });
    });

    it("only warns on a transient assistant error and still emits the result", async () => {
      sdk.setMessages([
        {
          type: "assistant",
          session_id: "s1",
          error: "overloaded",
          message: { content: [] },
        },
        RESULT_OK,
      ]);
      const { node } = await createNode(ClaudeAgent, {
        config: { config: mockConfig(), prompt: { type: "str", value: "hi" } },
      });

      await node.receive({ payload: "hi" });
      expect(node.sent("error")).toHaveLength(0);
      expect(outputs(node, 0).at(-1)).toMatchObject({ kind: "result" });
      expect(node.warned().some((w) => String(w).includes("overloaded"))).toBe(
        true,
      );
    });

    it.each(["invalid_request", "model_not_found"])(
      "treats the config error %s as fatal and routes it to the error port",
      async (code) => {
        sdk.setMessages([
          {
            type: "assistant",
            session_id: "s1",
            error: code,
            message: { content: [] },
          },
        ]);
        const { node } = await createNode(ClaudeAgent, {
          config: {
            config: mockConfig(),
            prompt: { type: "str", value: "hi" },
          },
        });

        await node.receive({ payload: "hi" });
        expect(node.sent("error")[0].error).toMatchObject({
          name: "AgentRunError",
          subtype: code,
        });
      },
    );

    it("settles on the error port when the stream ends with no result", async () => {
      // A run that streams content but never emits a terminal result must not
      // finish silently — that would hang a UI waiting on result/error.
      sdk.setMessages([
        { type: "system", session_id: "s1" },
        {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "partial work" }] },
        },
      ]);
      const { node } = await createNode(ClaudeAgent, {
        config: { config: mockConfig(), prompt: { type: "str", value: "hi" } },
      });

      await node.receive({ payload: "hi", correlationId: "c-3" });
      expect(node.sent("error")[0].error).toMatchObject({
        name: "AgentRunError",
        subtype: "ended_without_result",
        correlationId: "c-3",
      });
    });
  });

  describe("streaming", () => {
    it("emits each assistant turn's text in stream mode", async () => {
      sdk.setMessages([
        {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "part one " }] },
        },
        {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "part two" }] },
        },
        { ...RESULT_OK, result: "part one part two" },
      ]);
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "hi" },
          responseMode: "stream",
        },
      });

      await node.receive({ payload: "hi", correlationId: "c-1" });
      const out = outputs(node, 0);
      expect(out.map((o) => o.kind)).toEqual([
        "assistant",
        "assistant",
        "result",
      ]);
      expect(out[0]).toMatchObject({ text: "part one ", kind: "assistant" });
    });

    it("emits token deltas (not full turns) when partial streaming is on", async () => {
      sdk.setMessages([
        {
          type: "stream_event",
          session_id: "s1",
          event: { type: "content_block_delta", delta: { text: "He" } },
        },
        {
          type: "stream_event",
          session_id: "s1",
          event: { type: "content_block_delta", delta: { text: "llo" } },
        },
        {
          type: "assistant",
          session_id: "s1",
          message: { content: [{ type: "text", text: "Hello" }] },
        },
        { ...RESULT_OK, result: "Hello" },
      ]);
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "hi" },
          responseMode: "stream",
          includePartial: true,
        },
      });

      await node.receive({ payload: "hi", correlationId: "c-1" });

      const out = outputs(node, 0);
      // deltas emit as 'partial'; the full assistant turn is suppressed (no dupes)
      expect(out.map((o) => o.kind)).toEqual(["partial", "partial", "result"]);
      expect(out.slice(0, 2).map((o) => o.text)).toEqual(["He", "llo"]);
      expect(
        sdk.queryMock.mock.calls[0][0].options.includePartialMessages,
      ).toBe(true);
    });

    it("propagates a sessionId first seen on a stream_event to the result", async () => {
      sdk.setMessages([
        {
          type: "stream_event",
          session_id: "S1",
          event: { type: "content_block_delta", delta: { text: "Hi" } },
        },
        // result carries no session_id of its own
        {
          type: "result",
          subtype: "success",
          result: "done",
          num_turns: 1,
          total_cost_usd: 0,
        },
      ]);
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "hi" },
          responseMode: "stream",
          includePartial: true,
        },
      });

      await node.receive({ payload: "hi", correlationId: "c-1" });
      const result = outputs(node, 0).find((o) => o.kind === "result");
      expect(result).toMatchObject({ sessionId: "S1" });
    });
  });

  describe("interactive — canUseTool", () => {
    it("surfaces a tool-approval request on the ask port and resolves it from the owner", async () => {
      let decision: { behavior: string; updatedInput?: unknown } | undefined;
      sdk.setImpl(async function* (params) {
        decision = await params.options.canUseTool(
          "Bash",
          { command: "ls" },
          {
            signal: new AbortController().signal,
            suggestions: [],
            toolUseID: "tool-use-1",
          },
        );
        yield { ...RESULT_OK, result: "listed" };
      });
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "list" },
          interactive: true,
        },
      });

      const run = node.receive({ payload: "list", correlationId: "owner" });
      await vi.waitFor(() => expect(node.sent(1).length).toBeGreaterThan(0));

      const ask = node.sent(1)[0].output as {
        request: {
          requestId: string;
          kind: string;
          toolName: string;
          toolUseId: string;
        };
      };
      expect(ask.request).toMatchObject({
        kind: "permission",
        toolName: "Bash",
        // the SDK tool-use id is forwarded for UI/audit correlation
        toolUseId: "tool-use-1",
      });

      await node.receive({
        claudeResponse: { requestId: ask.request.requestId, behavior: "allow" },
        correlationId: "owner",
      });
      await run;

      expect(decision).toEqual({
        behavior: "allow",
        updatedInput: { command: "ls" },
      });
      expect(outputs(node, 0)[0]).toMatchObject({
        text: "listed",
        kind: "result",
      });
    });

    it("ignores an answer from a different client (correlation mismatch)", async () => {
      sdk.setImpl(async function* (params) {
        const d = await params.options.canUseTool(
          "Bash",
          { command: "ls" },
          { signal: new AbortController().signal, suggestions: [] },
        );
        yield { ...RESULT_OK, result: (d as { behavior: string }).behavior };
      });
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "list" },
          interactive: true,
        },
      });

      const run = node.receive({ payload: "list", correlationId: "owner" });
      await vi.waitFor(() => expect(node.sent(1).length).toBeGreaterThan(0));
      const requestId = (
        node.sent(1)[0].output as { request: { requestId: string } }
      ).request.requestId;

      // an unrelated client must not be able to answer
      await node.receive({
        claudeResponse: { requestId, behavior: "deny" },
        correlationId: "intruder",
      });
      expect(node.sent(0)).toHaveLength(0);

      // the owner's answer resolves it
      await node.receive({
        claudeResponse: { requestId, behavior: "allow" },
        correlationId: "owner",
      });
      await run;
      expect(outputs(node, 0)[0]).toMatchObject({
        text: "allow",
        kind: "result",
      });
    });

    it("a run that omits correlationId rejects an answer that carries one", async () => {
      // Guards fix #2 specifically: when the pending entry's correlationId is
      // undefined, the pre-fix guard (`!== undefined && !== from`) short-circuited
      // and let ANY client answer. The tightened guard (`!== from`) rejects a
      // mismatched (defined) answer and only accepts one that also omits it.
      sdk.setImpl(async function* (params) {
        const d = await params.options.canUseTool(
          "Bash",
          { command: "ls" },
          { signal: new AbortController().signal, suggestions: [] },
        );
        yield { ...RESULT_OK, result: (d as { behavior: string }).behavior };
      });
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "list" },
          interactive: true,
        },
      });

      // no correlationId on the run
      const run = node.receive({ payload: "list" });
      await vi.waitFor(() => expect(node.sent(1).length).toBeGreaterThan(0));
      const requestId = (
        node.sent(1)[0].output as { request: { requestId: string } }
      ).request.requestId;

      // an answer that carries a correlationId must NOT resolve the un-correlated run
      await node.receive({
        claudeResponse: { requestId, behavior: "deny" },
        correlationId: "someone",
      });
      expect(node.sent(0)).toHaveLength(0);

      // an answer that also omits correlationId resolves it
      await node.receive({ claudeResponse: { requestId, behavior: "allow" } });
      await run;
      expect(outputs(node, 0)[0]).toMatchObject({
        text: "allow",
        kind: "result",
      });
    });

    it("denies a tool when the owner denies", async () => {
      let decision: { behavior: string; message?: string } | undefined;
      sdk.setImpl(async function* (params) {
        decision = await params.options.canUseTool(
          "Bash",
          { command: "rm -rf /" },
          { signal: new AbortController().signal, suggestions: [] },
        );
        yield RESULT_OK;
      });
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "go" },
          interactive: true,
        },
      });

      const run = node.receive({ payload: "go", correlationId: "owner" });
      await vi.waitFor(() => expect(node.sent(1).length).toBeGreaterThan(0));
      const requestId = (
        node.sent(1)[0].output as { request: { requestId: string } }
      ).request.requestId;

      await node.receive({
        claudeResponse: { requestId, behavior: "deny", message: "nope" },
        correlationId: "owner",
      });
      await run;
      expect(decision).toEqual({ behavior: "deny", message: "nope" });
    });
  });

  describe("interactive — onUserDialog", () => {
    it("routes a CLI dialog to the ask port and back", async () => {
      let result: { behavior: string; result?: unknown } | undefined;
      sdk.setImpl(async function* (params) {
        result = await params.options.onUserDialog(
          {
            dialogKind: "AskUserQuestion",
            toolUseID: "tu-1",
            payload: { questions: [{ question: "Pick one" }] },
          },
          { signal: new AbortController().signal },
        );
        yield RESULT_OK;
      });
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig({ supportedDialogKinds: ["AskUserQuestion"] }),
          prompt: { type: "str", value: "ask" },
          interactive: true,
        },
      });

      const run = node.receive({ payload: "ask", correlationId: "c-1" });
      await vi.waitFor(() => expect(node.sent(1).length).toBeGreaterThan(0));

      const ask = node.sent(1)[0].output as {
        request: {
          requestId: string;
          kind: string;
          dialogKind: string;
          toolUseId: string;
        };
      };
      expect(ask.request).toMatchObject({
        kind: "question",
        dialogKind: "AskUserQuestion",
        toolUseId: "tu-1",
      });

      await node.receive({
        claudeResponse: {
          requestId: ask.request.requestId,
          answers: { choice: "A" },
        },
        correlationId: "c-1",
      });
      await run;

      expect(result).toEqual({
        behavior: "completed",
        result: { choice: "A" },
      });
    });

    it("warns when interactive is on but the mode auto-denies (dontAsk)", async () => {
      sdk.setMessages([RESULT_OK]);
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "x" },
          interactive: true,
          permissionMode: "dontAsk",
        },
      });

      await node.receive({ payload: "x" });
      expect(node.warned().some((w) => w.includes("dontAsk"))).toBe(true);
    });
  });

  describe("interrupt & teardown", () => {
    it("aborts the in-flight run without routing to the error port", async () => {
      sdk.setImpl(async function* (params) {
        await new Promise<void>((resolve) => {
          const sig: AbortSignal = params.options.abortController.signal;
          if (sig.aborted) resolve();
          else sig.addEventListener("abort", () => resolve());
        });
        // the real SDK throws once its subprocess is torn down
        throw new Error("aborted");
      });
      const { node } = await createNode(ClaudeAgent, {
        config: { config: mockConfig(), prompt: { type: "str", value: "go" } },
      });

      const run = node.receive({ payload: "go", correlationId: "c-1" });
      await vi.waitFor(() =>
        expect(node.statuses().some((s) => s.text === "running")).toBe(true),
      );

      await node.receive({ claudeControl: "interrupt", correlationId: "c-1" });
      await run;

      expect(node.sent("error")).toHaveLength(0);
      expect(node.statuses().at(-1)).toMatchObject({ text: "interrupted" });
    });

    it("aborts every concurrent run that shares a correlation", async () => {
      // each run records whether its own abort signal fired
      const aborted: boolean[] = [];
      sdk.setImpl(async function* (params) {
        const i = aborted.push(false) - 1;
        await new Promise<void>((resolve) => {
          const sig: AbortSignal = params.options.abortController.signal;
          // guard against the signal already being aborted before we subscribe,
          // so the run can never hang waiting for an event that won't fire
          if (sig.aborted) {
            aborted[i] = true;
            resolve();
            return;
          }
          sig.addEventListener("abort", () => {
            aborted[i] = true;
            resolve();
          });
        });
        throw new Error("aborted");
      });
      const { node } = await createNode(ClaudeAgent, {
        config: { config: mockConfig(), prompt: { type: "str", value: "go" } },
      });

      // two concurrent runs under the SAME correlation key
      const run1 = node.receive({ payload: "go", correlationId: "shared" });
      const run2 = node.receive({ payload: "go", correlationId: "shared" });
      await vi.waitFor(() => expect(aborted).toHaveLength(2));

      await node.receive({
        claudeControl: "interrupt",
        correlationId: "shared",
      });
      await Promise.all([run1, run2]);

      // both runs were aborted — neither is left un-interruptible
      expect(aborted).toEqual([true, true]);
      expect(node.sent("error")).toHaveLength(0);
    });

    it("ignores a stray interrupt for an unknown correlation", async () => {
      const { node } = await createNode(ClaudeAgent, {
        config: { config: mockConfig(), prompt: { type: "str", value: "x" } },
      });

      await node.receive({
        claudeControl: "interrupt",
        correlationId: "nobody",
      });
      // no run existed, so the node never flipped to 'interrupted'
      expect(node.statuses()).toHaveLength(0);
    });

    it("settles an unanswered request when the run ends", async () => {
      let decision: Promise<{ behavior: string; message?: string }> | undefined;
      sdk.setImpl(async function* (params) {
        // fire a request but don't await it; the run ends with it open
        decision = params.options.canUseTool(
          "Bash",
          {},
          { signal: new AbortController().signal, suggestions: [] },
        );
        yield RESULT_OK;
      });
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "x" },
          interactive: true,
        },
      });

      await node.receive({ payload: "x", correlationId: "c-1" });
      await expect(decision!).resolves.toEqual({
        behavior: "deny",
        message: "Run ended",
      });
    });

    it("cancels in-flight pending requests on close", async () => {
      let decision: Promise<{ behavior: string; message?: string }> | undefined;
      sdk.setImpl(async function* (params) {
        decision = params.options.canUseTool(
          "Bash",
          {},
          { signal: new AbortController().signal, suggestions: [] },
        );
        await decision;
      });
      const { node } = await createNode(ClaudeAgent, {
        config: {
          config: mockConfig(),
          prompt: { type: "str", value: "x" },
          interactive: true,
        },
      });

      const run = node.receive({ payload: "x", correlationId: "c-1" });
      await vi.waitFor(() => expect(node.sent(1).length).toBeGreaterThan(0));

      await node.close();
      await expect(decision!).resolves.toEqual({
        behavior: "deny",
        message: "Node closed",
      });
      await run;
    });
  });
});
