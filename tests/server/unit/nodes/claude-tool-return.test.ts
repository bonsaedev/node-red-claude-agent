import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNode } from "@bonsae/nrg/test/server/unit";
import ClaudeToolReturn from "../../../../src/server/nodes/claude-tool-return";
import {
  PendingIndex,
  type Settle,
  type ToolAnswer,
} from "../../../../src/server/lib/tool-dispatch";

/** A settle spy shaped like the real `settleOnce` return (callable + onCleanup). */
function settleSpy(): Settle & { mock: ReturnType<typeof vi.fn>["mock"] } {
  return Object.assign(vi.fn(), { onCleanup: () => {} });
}

describe("claude-tool-return", () => {
  describe("private-channel path (primary)", () => {
    it("settles the live resolver riding the private channel and takes it once", async () => {
      const { node } = await createNode(ClaudeToolReturn, { config: {} });
      const settle = settleSpy();

      await node.receive(
        { _msgid: "sig-1", output: { payload: "the answer" } },
        { private: { claudeReturn: settle } },
      );

      expect(settle).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledWith({
        value: "the answer",
        format: "text",
        isError: false,
      } satisfies ToolAnswer);
      expect(node.statuses().at(-1)).toMatchObject({ text: "returned" });
    });

    it("propagates isError from msg.output.isError", async () => {
      const { node } = await createNode(ClaudeToolReturn, { config: {} });
      const settle = settleSpy();

      await node.receive(
        { _msgid: "sig-1", output: { payload: "boom", isError: true } },
        { private: { claudeReturn: settle } },
      );

      expect(settle).toHaveBeenCalledWith(
        expect.objectContaining({ value: "boom", isError: true }),
      );
    });

    it("carries the configured json format into the answer", async () => {
      const { node } = await createNode(ClaudeToolReturn, {
        config: { format: "json" },
      });
      const settle = settleSpy();

      await node.receive(
        { _msgid: "sig-1", output: { payload: { ok: true } } },
        { private: { claudeReturn: settle } },
      );

      expect(settle).toHaveBeenCalledWith(
        expect.objectContaining({ value: { ok: true }, format: "json" }),
      );
    });

    it("reads the value at the top level when there is no output envelope", async () => {
      const { node } = await createNode(ClaudeToolReturn, { config: {} });
      const settle = settleSpy();

      await node.receive(
        { _msgid: "sig-1", payload: "raw" },
        { private: { claudeReturn: settle } },
      );

      expect(settle).toHaveBeenCalledWith(
        expect.objectContaining({ value: "raw" }),
      );
    });

    it("prefers the author's top-level payload over the source's stale output args", async () => {
      // A core Node-RED node did `msg.payload = answer; return msg` — msg.output
      // still holds the source's ORIGINAL tool args. The answer must be the fresh
      // top-level payload, not the echoed args.
      const { node } = await createNode(ClaudeToolReturn, { config: {} });
      const settle = settleSpy();

      await node.receive(
        {
          _msgid: "sig-1",
          payload: "the answer",
          output: { payload: { city: "SF" }, claudeTool: { callId: "c-1" } },
        },
        { private: { claudeReturn: settle } },
      );

      expect(settle).toHaveBeenCalledWith(
        expect.objectContaining({ value: "the answer" }),
      );
    });
  });

  describe("callId fallback path", () => {
    beforeEach(() => {
      // isolate the module-level index between tests
      PendingIndex.drop("call-1");
    });

    it("settles a pending call by callId when no private resolver is present", async () => {
      const settle = settleSpy();
      PendingIndex.put("call-1", settle);

      const { node } = await createNode(ClaudeToolReturn, { config: {} });
      await node.receive({
        _msgid: "sig-1",
        output: { payload: "late answer", claudeTool: { callId: "call-1" } },
      });

      expect(settle).toHaveBeenCalledWith(
        expect.objectContaining({ value: "late answer" }),
      );
      // taken once — a second return finds nothing
      expect(PendingIndex.take("call-1")).toBeUndefined();
    });

    it("warns when there is no pending call to settle", async () => {
      const { node } = await createNode(ClaudeToolReturn, { config: {} });
      await node.receive({
        _msgid: "sig-1",
        output: { payload: "orphan", claudeTool: { callId: "gone" } },
      });

      expect(
        node.warned().some((w) => w.includes("no pending tool call")),
      ).toBe(true);
      expect(node.statuses().at(-1)).toMatchObject({ text: "no pending call" });
    });
  });
});
