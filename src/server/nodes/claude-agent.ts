import { IONode, type Infer } from "@bonsae/nrg/server";
import type { Schema } from "@bonsae/nrg/schema";
import { randomUUID } from "node:crypto";
import {
  query,
  type Options,
  type PermissionResult,
  type CanUseTool,
} from "@anthropic-ai/claude-agent-sdk";
import type ClaudeAgentConfiguration from "./claude-agent-configuration";
import {
  ConfigsSchema,
  InputSchema,
  OutputsSchema,
} from "../../shared/schemas/claude-agent";

type Config = Infer<typeof ConfigsSchema>;
type Input = Infer<typeof InputSchema>;

// The `onUserDialog` channel — the documented way the CLI asks the host to
// render a blocking dialog (e.g. AskUserQuestion) — derived from the SDK Options
// so we don't depend on the named types being exported.
type OnUserDialog = NonNullable<Options["onUserDialog"]>;
type UserDialogResult = Awaited<ReturnType<OnUserDialog>>;

const RESPONSE_PORT = 0;
const ASK_PORT = 1;

/**
 * Assistant-level error codes that are fatal and user-actionable — the run
 * won't recover and the stream may end WITHOUT a result message, so these are
 * forwarded on the error port (with correlationId for routing) immediately
 * rather than only logged. Transient codes (rate_limit/overloaded/server_error/
 * max_output_tokens/unknown) are left to the SDK's retries and the terminal
 * result, so a recoverable run isn't pre-empted.
 */
const FATAL_ASSISTANT_ERRORS = new Set<string>([
  "authentication_failed",
  "oauth_org_not_allowed",
  "billing_error",
  "invalid_request",
  "model_not_found",
]);

/** A pending interactive request awaiting an answer routed back to this node. */
type PendingRequest =
  | {
      kind: "permission";
      resolve: (result: PermissionResult) => void;
      toolName: string;
      input: Record<string, unknown>;
      correlationId?: string;
    }
  | {
      kind: "dialog";
      resolve: (result: UserDialogResult) => void;
      correlationId?: string;
    };

/** The shape a downstream flow sends back to answer an interactive request. */
interface ClaudeResponse {
  requestId: string;
  behavior?: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
  message?: string;
  answers?: Record<string, unknown>;
  /** Raw dialog result, when answering an onUserDialog request. */
  result?: unknown;
}

/** An in-flight run: its query plus the AbortController used to stop it. */
interface RunningQuery {
  // assigned after query() — the run is registered before query() starts so an
  // interrupt arriving in that window can still abort it.
  q?: ReturnType<typeof query>;
  controller: AbortController;
}

/**
 * Thrown when a run ends in an SDK error result. Its own enumerable properties
 * ride the built-in error port under `msg.error` (nrg spreads a thrown error's
 * fields), so a downstream flow can route and react on the structured detail —
 * subtype, the SDK's `errors`/`stopReason`, cost, correlation — instead of just
 * a message string.
 */
class AgentRunError extends Error {
  readonly subtype: string;
  readonly correlationId?: string;
  readonly sessionId?: string;
  readonly totalCostUsd?: number;
  readonly numTurns?: number;
  readonly errors?: string[];
  readonly stopReason?: string | null;
  constructor(
    subtype: string,
    info: {
      correlationId?: string;
      sessionId?: string;
      totalCostUsd?: number;
      numTurns?: number;
      errors?: string[];
      stopReason?: string | null;
    },
  ) {
    super(`claude-agent: ${subtype}`);
    this.name = "AgentRunError";
    this.subtype = subtype;
    this.correlationId = info.correlationId;
    this.sessionId = info.sessionId;
    this.totalCostUsd = info.totalCostUsd;
    this.numTurns = info.numTurns;
    this.errors = info.errors;
    this.stopReason = info.stopReason;
  }
}

/** Collect the text from a BetaMessage's content blocks. */
function extractText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => (block as { type?: string })?.type === "text")
      .map((block) => (block as { text?: string }).text ?? "")
      .join("");
  }
  return "";
}

export default class ClaudeAgent extends IONode<Config, any, Input, any> {
  static override readonly type = "claude-agent";
  static override readonly category = "claude";
  static override readonly color: `#${string}` = "#D97757";
  static override readonly configSchema: Schema = ConfigsSchema;
  static override readonly inputSchema: Schema = InputSchema;
  static override readonly outputsSchema = OutputsSchema as unknown as Schema;

  /** Interactive requests awaiting answers, keyed by requestId (globally unique). */
  private readonly pending = new Map<string, PendingRequest>();
  /**
   * In-flight queries grouped by correlation key (`correlationId ?? "default"`).
   * A correlation can hold several concurrent runs, so interrupt aborts every
   * run for that key rather than only the most recently started one.
   */
  private readonly running = new Map<string, Set<RunningQuery>>();

  /** Resolve a pending interactive request from a routed-back answer. */
  private answer(response: ClaudeResponse, fromCorrelationId?: string): void {
    const requestId = response?.requestId;
    const entry = requestId ? this.pending.get(requestId) : undefined;
    if (!entry) return;
    // Only the client that owns the run may answer its requests. A run that
    // omitted correlationId can only be answered by an answer that likewise
    // omits it (both undefined) — an unrelated client must not resolve it.
    if (entry.correlationId !== fromCorrelationId) {
      return;
    }
    this.pending.delete(requestId);

    if (entry.kind === "dialog") {
      // onUserDialog answer. The per-kind result shape is opaque (lives in the
      // CLI), so pass the collected answers/result through.
      if (response.behavior === "deny") {
        entry.resolve({ behavior: "cancelled" });
        return;
      }
      entry.resolve({
        behavior: "completed",
        result: response.result ?? response.answers ?? {},
      });
      return;
    }

    if (response.behavior === "deny") {
      entry.resolve({
        behavior: "deny",
        message: response.message ?? "Denied",
      });
      return;
    }

    if (entry.toolName === "AskUserQuestion") {
      // Legacy/fallback path: feed answers via updatedInput. Used only when the
      // onUserDialog channel is not active (no dialog kinds declared). Whether
      // the CLI honors this is unverified — declare supportedDialogKinds for the
      // documented channel instead.
      entry.resolve({
        behavior: "allow",
        updatedInput: {
          questions: (entry.input as { questions?: unknown }).questions,
          answers: response.answers ?? {},
        },
      });
      return;
    }

    entry.resolve({
      behavior: "allow",
      updatedInput: response.updatedInput ?? entry.input,
    });
  }

  override async input(msg: Input): Promise<void> {
    const m = msg as Input & {
      claudeControl?: string;
      claudeResponse?: ClaudeResponse;
      sessionId?: string;
      correlationId?: string;
    };

    // Correlation id rides every emission so a downstream router can return
    // each message to the originating client (captured locally => concurrency-safe).
    const correlationId = m.correlationId;
    // A keyless run gets its OWN key — a literal "default" bucket would merge
    // every keyless run, so one interrupt aborts them all and one client's answer
    // could resolve another's prompt. Multi-user integrations MUST set
    // correlationId; keyless runs are isolated but not interruptible.
    const key = correlationId ?? randomUUID();

    // Control: abort this correlation's in-flight run. Aborting the controller
    // tears down the subprocess (q.interrupt() is unsupported for the single-turn
    // string-prompt queries this node issues).
    if (m.claudeControl === "interrupt") {
      // Abort every in-flight run for this correlation. Only reflect
      // 'interrupted' when something was actually aborted, so a stray interrupt
      // doesn't clobber a concurrent run on a different key.
      const runs = this.running.get(key);
      if (runs?.size) {
        for (const run of runs) run.controller.abort();
        this.status({ fill: "grey", shape: "ring", text: "interrupted" });
      }
      return;
    }

    // Answer to an interactive request — resolve and stop (not a new prompt).
    if (m.claudeResponse?.requestId) {
      this.answer(m.claudeResponse, correlationId);
      return;
    }

    const configNode = this.config.config as
      | ClaudeAgentConfiguration
      | undefined;
    if (!configNode) {
      this.status({ fill: "red", shape: "dot", text: "no configuration" });
      throw new Error("claude-agent: no configuration node selected");
    }

    // Register the run BEFORE the async prompt.resolve + query() so an interrupt
    // arriving in that window aborts it instead of finding an empty bucket.
    // `dropRun` removes it on any exit path (guard throw, abort, or the finally).
    const runRequestIds = new Set<string>();
    const controller = new AbortController();
    const runEntry: RunningQuery = { controller };
    let runs = this.running.get(key);
    if (!runs) {
      runs = new Set<RunningQuery>();
      this.running.set(key, runs);
    }
    runs.add(runEntry);
    const dropRun = () => {
      const set = this.running.get(key);
      if (set) {
        set.delete(runEntry);
        if (set.size === 0) this.running.delete(key);
      }
    };

    let resolved: unknown;
    try {
      resolved = await this.config.prompt.resolve(msg);
    } catch (err) {
      dropRun();
      throw err;
    }
    const prompt =
      (typeof resolved === "string" && resolved) ||
      (typeof m.payload === "string" ? m.payload : "");
    if (!prompt) {
      dropRun();
      this.status({ fill: "red", shape: "dot", text: "empty prompt" });
      throw new Error("claude-agent: prompt is empty");
    }
    const options: Options = {
      ...configNode.buildOptions(),
      abortController: controller,
    };
    if (this.config.permissionMode !== "inherit") {
      options.permissionMode = this.config.permissionMode;
    }
    // bypassPermissions only takes effect when paired with this explicit flag.
    if (options.permissionMode === "bypassPermissions") {
      options.allowDangerouslySkipPermissions = true;
    }

    // The onUserDialog channel only makes sense when there's a UI to answer it.
    const dialogActive =
      this.config.interactive &&
      (options.supportedDialogKinds?.length ?? 0) > 0;
    if (!dialogActive) delete options.supportedDialogKinds;

    // canUseTool surfaces tool-approval and (legacy) AskUserQuestion prompts.
    const canUseTool: CanUseTool = (toolName, toolInput, opts) =>
      new Promise<PermissionResult>((resolve) => {
        // When the dialog channel handles questions, just permit the tool so it
        // runs and emits its dialog — don't surface it twice.
        if (toolName === "AskUserQuestion" && dialogActive) {
          resolve({ behavior: "allow", updatedInput: toolInput });
          return;
        }
        const requestId = randomUUID();
        runRequestIds.add(requestId);
        this.pending.set(requestId, {
          kind: "permission",
          resolve,
          toolName,
          input: toolInput,
          correlationId,
        });
        opts.signal?.addEventListener("abort", () => {
          if (this.pending.delete(requestId)) {
            resolve({ behavior: "deny", message: "Aborted" });
          }
        });
        const kind = toolName === "AskUserQuestion" ? "question" : "permission";
        this.status({
          fill: "yellow",
          shape: "ring",
          text: `awaiting ${kind}`,
        });
        this.sendToPort(ASK_PORT, {
          correlationId,
          payload: {
            requestId,
            kind,
            toolName,
            // the SDK's own tool-use id, so a UI/audit log can correlate this
            // request with the tool call (matches the onUserDialog path)
            toolUseId: opts.toolUseID,
            input: toolInput,
            questions: (toolInput as { questions?: unknown }).questions,
            suggestions: opts.suggestions,
          },
        });
      });

    // onUserDialog: the documented channel for CLI-rendered dialogs (e.g.
    // AskUserQuestion). Surfaces the request on the ask port and returns the
    // user's choice. Only fires for kinds declared in supportedDialogKinds.
    const onUserDialog: OnUserDialog = (request, opts) =>
      new Promise<UserDialogResult>((resolve) => {
        const requestId = randomUUID();
        runRequestIds.add(requestId);
        this.pending.set(requestId, { kind: "dialog", resolve, correlationId });
        opts.signal?.addEventListener("abort", () => {
          if (this.pending.delete(requestId))
            resolve({ behavior: "cancelled" });
        });
        // Log the kind so a new one can be discovered and added to config.
        this.warn(`claude-agent: user dialog '${request.dialogKind}'`);
        this.status({
          fill: "yellow",
          shape: "ring",
          text: "awaiting question",
        });
        this.sendToPort(ASK_PORT, {
          correlationId,
          payload: {
            requestId,
            kind: "question",
            dialogKind: request.dialogKind,
            toolUseId: request.toolUseID,
            input: request.payload,
            questions: (request.payload as { questions?: unknown }).questions,
          },
        });
      });

    if (this.config.interactive) {
      options.canUseTool = canUseTool;
      // Fully auto-approving/denying modes never consult canUseTool, so the ask
      // port can't fire and a UI awaiting approval would hang. (acceptEdits is
      // excluded: it auto-accepts edits but still prompts for other tools.)
      if (
        options.permissionMode === "bypassPermissions" ||
        options.permissionMode === "dontAsk"
      ) {
        this.warn(
          `claude-agent: interactive is on but permission mode '${options.permissionMode}' auto-approves or auto-denies tools — the ask port will not fire. Use 'default' or 'plan' for interactive approvals.`,
        );
      }
      // Without a correlationId the ask/answer + interrupt routing can't be
      // isolated per client — fine for one user, unsafe for multi-tenant.
      if (!correlationId) {
        this.warn(
          "claude-agent: interactive run without a correlationId — answers and interrupts can't be isolated per client. Set msg.correlationId for multi-user routing.",
        );
      }
    }
    if (dialogActive) options.onUserDialog = onUserDialog;

    const stream = this.config.responseMode === "stream";
    // Only request partial messages when streaming actually consumes them.
    if (stream && this.config.includePartial) {
      options.includePartialMessages = true;
    }
    if (m.sessionId) options.resume = m.sessionId;

    this.status({ fill: "blue", shape: "dot", text: "running" });

    // An interrupt may have aborted us during the awaits above.
    if (controller.signal.aborted) {
      dropRun();
      this.status({ fill: "grey", shape: "ring", text: "interrupted" });
      return;
    }

    const q = query({ prompt, options });
    runEntry.q = q;
    let sessionId: string | undefined = m.sessionId;
    let sawResult = false;

    try {
      for await (const message of q) {
        switch (message.type) {
          case "system":
            sessionId = message.session_id ?? sessionId;
            break;
          case "assistant": {
            sessionId = message.session_id ?? sessionId;
            if (message.error) {
              // Fatal auth/billing/access errors won't recover and may not be
              // followed by a result, so forward them on the error port now
              // (otherwise the stream can end silently and the UI shows nothing).
              if (FATAL_ASSISTANT_ERRORS.has(message.error)) {
                this.status({ fill: "red", shape: "dot", text: message.error });
                throw new AgentRunError(message.error, {
                  correlationId,
                  sessionId,
                });
              }
              // Transient errors: the SDK retries and the terminal result still
              // arrives below; log for debugging.
              this.warn(`claude-agent: assistant error: ${message.error}`);
            }
            // In stream mode emit each turn's full text — unless partials are
            // on, in which case the deltas already carry it (avoid duplication).
            if (stream && !this.config.includePartial) {
              const text = extractText(message.message);
              if (text) {
                this.sendToPort(RESPONSE_PORT, {
                  payload: text,
                  kind: "assistant",
                  sessionId,
                  correlationId,
                });
              }
            }
            break;
          }
          case "stream_event": {
            // Keep the closure sessionId authoritative, like the other
            // branches, in case an id first surfaces on a stream event.
            sessionId = message.session_id ?? sessionId;
            if (stream && this.config.includePartial) {
              const event = message.event as {
                type?: string;
                delta?: { text?: string };
              };
              const delta =
                event?.type === "content_block_delta"
                  ? (event.delta?.text ?? "")
                  : "";
              if (delta) {
                this.sendToPort(RESPONSE_PORT, {
                  payload: delta,
                  kind: "partial",
                  sessionId,
                  correlationId,
                });
              }
            }
            break;
          }
          case "result": {
            sessionId = message.session_id ?? sessionId;
            sawResult = true;
            if (message.subtype === "success") {
              this.sendToPort(RESPONSE_PORT, {
                payload: message.result,
                kind: "result",
                sessionId,
                correlationId,
                usage: message.usage,
                total_cost_usd: message.total_cost_usd,
                num_turns: message.num_turns,
                structured_output: message.structured_output,
              });
              const cost = message.total_cost_usd;
              this.status({
                fill: "green",
                shape: "dot",
                text:
                  typeof cost === "number"
                    ? `done · $${cost.toFixed(4)}`
                    : "done",
              });
            } else {
              this.status({ fill: "red", shape: "dot", text: message.subtype });
              throw new AgentRunError(message.subtype, {
                correlationId,
                sessionId,
                totalCostUsd: message.total_cost_usd,
                numTurns: message.num_turns,
                errors: message.errors,
                stopReason: message.stop_reason,
              });
            }
            break;
          }
        }
      }

      // The stream ended with no terminal result and we weren't interrupted —
      // settle on the error port so a waiting UI never hangs.
      if (!sawResult && !controller.signal.aborted) {
        this.status({ fill: "red", shape: "dot", text: "no result" });
        throw new AgentRunError("ended_without_result", {
          correlationId,
          sessionId,
        });
      }
    } catch (err) {
      // An abort is an interrupt, not a failure — don't route it to the error port.
      if (controller.signal.aborted) {
        this.status({ fill: "grey", shape: "ring", text: "interrupted" });
        return;
      }
      throw err;
    } finally {
      // Settle any asks this run raised but never got answered, so neither the
      // pending Map nor the callback promises leak.
      for (const requestId of runRequestIds) {
        const entry = this.pending.get(requestId);
        if (entry) {
          this.pending.delete(requestId);
          if (entry.kind === "dialog") {
            entry.resolve({ behavior: "cancelled" });
          } else {
            entry.resolve({ behavior: "deny", message: "Run ended" });
          }
        }
      }
      // Drop this run from its correlation bucket (idempotent with the dropRun
      // used on the guard/abort exit paths).
      dropRun();
    }
  }

  override async closed(): Promise<void> {
    for (const runs of this.running.values()) {
      for (const { controller } of runs) {
        try {
          controller.abort();
        } catch {
          // best effort on teardown
        }
      }
    }
    this.running.clear();
    for (const entry of this.pending.values()) {
      try {
        if (entry.kind === "dialog") {
          entry.resolve({ behavior: "cancelled" });
        } else {
          entry.resolve({ behavior: "deny", message: "Node closed" });
        }
      } catch {
        // best effort on teardown
      }
    }
    this.pending.clear();
  }
}
