import { z, type ZodRawShape } from "zod";
// The SDK's tool() handler returns this MCP result type; the SDK imports it from
// here but doesn't re-export it, so take it from the source (a direct dependency).
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Per-run context handed to every flow-tool at assembly time. Mirrors the agent's
 * run vars; `signal` is the agent's per-run AbortController, `public()` returns the
 * clone-safe provenance the emit carries under `claudeTool.agent`.
 */
export type RunContext = {
  correlationId?: string;
  signal: AbortSignal;
  agentNodeId: string;
  public(): { nodeId: string; correlationId?: string; sessionId?: string };
};

/**
 * A settle-once resolver. `resolve(value)` delivers the flow's answer; a
 * timeout/abort/teardown hands an `Error` sentinel so the handler emits `isError`
 * instead of the value. Second settle is a no-op (fan-out safe).
 */
export type Settle = {
  (value: unknown): void;
  onCleanup(fn: () => void): void;
};

export function settleOnce(
  deliver: (v: unknown) => void,
  cleanup: () => void,
): Settle {
  let done = false;
  const cleanups: Array<() => void> = [];
  const s = ((value: unknown) => {
    if (done) return;
    done = true;
    for (const fn of cleanups)
      try {
        fn();
      } catch {
        /* best effort */
      }
    cleanup();
    deliver(value);
  }) as Settle;
  s.onCleanup = (fn) => cleanups.push(fn);
  return s;
}

/**
 * Package-level index: the fallback route that survives fan-out + fresh-message
 * answers. `take()` is get-then-delete (take-once).
 */
export const PendingIndex = (() => {
  const m = new Map<string, Settle>();
  return {
    put(id: string, s: Settle) {
      m.set(id, s);
    },
    take(id: string): Settle | undefined {
      const s = m.get(id);
      m.delete(id);
      return s;
    },
    drop(id: string) {
      m.delete(id);
    },
  };
})();

/** A flat param row (from the tool's `params` config table). */
export type Param = {
  name: string;
  type: string;
  description: string;
  required: boolean;
  values: string;
};

/**
 * Flat param table -> Zod RAW SHAPE. `tool()` wants `{ city: z.string() }`, not
 * `z.object(...)`. Targets zod v4 (the SDK peer-requires zod@^4). `.describe()`
 * reaches the model.
 */
export function zodShapeFrom(params: Param[]): ZodRawShape {
  // Build mutable, return as ZodRawShape (which is readonly in zod v4).
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of params) {
    let field: z.ZodTypeAny;
    switch (p.type) {
      case "number":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
      case "enum": {
        const vals = p.values
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
        field = vals.length
          ? z.enum(vals as [string, ...string[]])
          : z.string();
        break;
      }
      default:
        field = z.string();
    }
    if (p.description) field = field.describe(p.description);
    shape[p.name] = p.required ? field : field.optional();
  }
  return shape;
}

/**
 * Wrap the flow's value into the `CallToolResult` the model expects. `"json"` ->
 * `structuredContent` (text blocks are then suppressed); else one text block.
 * `isError` is a RESULT-object field (the model sees it and self-corrects; the run
 * continues), not a protocol error.
 */
export function toCallToolResult(
  value: unknown,
  format: "text" | "json",
  isError = false,
): CallToolResult {
  if (isError) {
    const text =
      typeof value === "string" ? value : JSON.stringify(value ?? "tool error");
    return { content: [{ type: "text", text }], isError: true };
  }
  if (format === "json" && value && typeof value === "object") {
    // Mirror the data as a text block too: a model only receives structuredContent
    // when the tool declares an outputSchema (which flow-authored tools don't), so
    // an empty content[] would make the JSON invisible to the model.
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value as Record<string, unknown>,
    };
  }
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null);
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * The envelope the return sink settles with, so the sink's `format` reaches the
 * wrap while the tool still owns its failure paths. Raw value + format + isError.
 */
export type ToolAnswer = {
  value: unknown;
  format: "text" | "json";
  isError: boolean;
};
