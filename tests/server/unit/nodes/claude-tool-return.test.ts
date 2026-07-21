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
  beforeEach(() => {
    // isolate the module-level index between tests
    PendingIndex.drop("call-1");
  });

  it("settles the parked call by its callId, take-once", async () => {
    const settle = settleSpy();
    PendingIndex.put("call-1", settle);

    const { node } = await createNode(ClaudeToolReturn, { config: {} });
    await node.receive({
      payload: "the answer",
      _claudeTool: { callId: "call-1" },
    });

    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith({
      value: "the answer",
      format: "text",
      isError: false,
    } satisfies ToolAnswer);
    expect(node.statuses().at(-1)).toMatchObject({ text: "returned" });
    // taken once — a second return finds nothing
    expect(PendingIndex.take("call-1")).toBeUndefined();
  });

  it("warns when there is no pending call to settle", async () => {
    const { node } = await createNode(ClaudeToolReturn, { config: {} });
    await node.receive({
      payload: "orphan",
      _claudeTool: { callId: "gone" },
    });

    expect(node.warned().some((w) => w.includes("no pending tool call"))).toBe(
      true,
    );
    expect(node.statuses().at(-1)).toMatchObject({ text: "no pending call" });
  });
});
