# @bonsae/node-red-claude

Claude Agent nodes for [Node-RED](https://nodered.org), built with
[`@bonsae/nrg`](https://github.com/bonsaedev/nrg). They wrap the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) so a flow
can run an autonomous agent — the same agent loop and built-in tools that power
Claude Code in the terminal (read/write files, run commands, search the web) —
and stream the result back.

## Nodes

### `claude-agent-configuration` (config node)

Holds auth and the options that shape every run. One config node is shared by
many agent nodes.

| Field | Notes |
| --- | --- |
| **provider** | `anthropic` (API key) or a cloud provider (`bedrock` / `vertex` / `foundry`; their credentials come from the environment) |
| **API key** | credential — injected as `ANTHROPIC_API_KEY` for the agent process |
| **model / fallbackModel** | empty = SDK default |
| **system prompt** | `claude_code` (the full terminal agent prompt), `custom`, or `minimal`; plus an append box |
| **cwd** | working directory the agent operates in — host file ops are relative to it |
| **permission mode** | `bypassPermissions` (full terminal-like autonomy), `acceptEdits`, `default`, `plan`, `dontAsk` |
| **allowed / disallowed tools** | comma/newline lists (e.g. `Read, Glob, Grep`, `Bash(rm *)`) |
| **setting sources** | `user,project,local` — loads `CLAUDE.md` and `.claude/` like the terminal |
| **maxTurns / maxBudgetUsd / additional directories** | optional limits and extra accessible paths |

### `claude-agent` (action node)

Runs `query()` for an incoming prompt.

- **prompt** — defaults to `msg.payload`; can be pinned to a string or another `msg` property.
- **response mode** — `single` (one final result) or `stream` (each assistant message as it arrives, then the result).
- **interactive** — when on, tool-approval requests and clarifying questions are emitted on the **ask** port for a UI to answer; route the answer back into the node (see protocol below). Pair with permission mode `default` or `plan`.
- **permission mode** — `inherit` (use the config's) or override per node.

**Ports:** `0` response · `1` ask (interactive requests) · plus optional built-in error / complete / status ports.

## Message protocol

Emitted values are wrapped under **`msg.output`** (nrg convention), and the
incoming message's top-level keys are carried through.

**Output, port 0 (response)** — `msg.output = { payload, kind, sessionId, correlationId }`
where `kind` is `assistant` (streamed text), `partial` (token deltas when
`includePartial` is on), or `result` (final; also carries `usage`,
`total_cost_usd`, `num_turns`).

**Output, port 1 (ask)** — `msg.output = { correlationId, payload: { requestId, kind, toolName, input, questions?, suggestions? } }`.
`kind` is `permission` or `question`.

**`correlationId`** is whatever you set on the input `msg.correlationId`; the node
echoes it on every emission (captured per run, so it's safe under concurrent
requests). A downstream router uses it to send each message back to the right
client/connection — see the multi-user chat example.

**Input** — a prompt (`msg.payload` or the configured source). Optional fields:
`msg.sessionId` continues a conversation (resume), `msg.correlationId` is echoed
back for routing. To answer an interactive request, send a message with:

```js
msg.claudeResponse = {
  requestId,                            // from the ask
  behavior: "allow" | "deny",           // permission requests
  updatedInput,                         // optional: edited tool input
  message,                              // optional: reason on deny
  answers: { "<question>": "<label>" }, // AskUserQuestion
};
```

Send `msg.claudeControl = "interrupt"` to abort the in-flight run.

### Clarifying questions (AskUserQuestion)

When Claude asks a clarifying question, it can surface two ways:

- **`canUseTool` (default)** — the question rides the ask port (`kind: "question"`)
  and you answer with `claudeResponse.answers`. Simple, but whether the CLI
  honors answers fed back this way is **unverified** against a live run.
- **`onUserDialog` (the documented channel)** — the CLI's proper dialog channel.
  To use it, set **dialog kinds** on the config node to the kind the CLI emits
  for `AskUserQuestion` (an opaque string baked into the CLI binary). The agent
  then routes questions through `onUserDialog` and you answer the same way
  (`claudeResponse.answers`, returned to the CLI as the dialog result).

> Discovering the kind: the CLI **fails closed** — it only emits a dialog kind
> you've declared, so you can't see an undeclared one fire. Run interactively
> with a guess (the agent logs each `user dialog '<kind>'` it receives, e.g. via
> a `PreToolUse`/debug trace of the AskUserQuestion `tool_use`), then put the
> real kind in the config field. Until then the default `canUseTool` path is used.

## Install & build

```bash
pnpm install
pnpm build      # bundles the nodes into dist/ (declares @bonsae/nrg-runtime + the SDK)
pnpm dev        # boots a Node-RED editor with the nodes loaded
```

Set the API key on the configuration node in the editor before running.

## Example: interpret a downloaded CSV (autonomous)

Import `src/examples/csv-interpret.flow.json`. It downloads a CSV to the agent's
working directory (`/tmp/claude-agent`), then asks the agent to read and
interpret the file from disk using its file tools — no glue code, the agent does
the inspection itself. The config node uses `bypassPermissions`, so it runs
unattended.

```
[inject url] -> [http request] -> [file: write data.csv] -> [claude-agent] -> [debug]
```

## Example: multi-user interactive chat (Vue + WebSocket)

Import `src/examples/chat.flow.json` (a WebSocket listener at
`ws://localhost:1880/claude` wired to an interactive agent), deploy, then open
`examples/chat-demo/index.html` in a browser (any static server, or the file
directly). Open it in **two browsers/profiles** to see two independent users.

```
[ws in] -> [auth + route in] --0--> [claude-agent (stream, interactive)] --0--> [route response] -> [ws out]
                  └--1 (login replies)--> [ws out]                          --1--> [route ask]      -> [ws out]
                                                                            --2--> [route error]    -> [ws out]
```

**Sign in** with a demo user (`alice / alice123` or `bob / bob123`), then chat.
The agent surfaces tool-approval and clarifying-question prompts; the chat shows
Allow/Deny or multiple-choice and routes your answer back.

How the multi-user separation works (all server-side, nothing trusted from the
browser):

- **Users** live in Node-RED flow context — `{ alice: "alice123", bob: "bob123" }`
  (simple passwords, in memory). Edit the `auth + route in` function to change them.
- **Connection** — `auth + route in` reads `msg._session` (the socket) on login and
  maps `socket -> user`. Each emitted message carries that socket as
  `correlationId`; the `route *` functions rebuild `msg._session` from it so a
  reply goes back **only to that user's connection** (no broadcast).
- **Conversation memory** — the server stores `user -> Claude sessionId` in flow
  context and resumes it on the next prompt, so each user has a separate thread.
  The browser never sends the session id.

So the three identities stay separate: **socket = transport, user = identity
(password), Claude `sessionId` = conversation memory.** This is a demo-grade
in-memory store with a plaintext password over `ws://` — put it behind TLS and a
real user store / token before exposing it.

> **Safety:** `bypassPermissions` gives the agent full, unattended access to the
> host (files, shell). Run it in a container/sandbox, or use `default` +
> `interactive` (approve each tool) or `dontAsk` + an `allowedTools` allowlist
> when you need guardrails.
