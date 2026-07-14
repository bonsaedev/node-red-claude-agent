<p align="center">
  <img src="https://raw.githubusercontent.com/bonsaedev/node-red-claude-agent/main/src/resources/icons/claude-agent.svg" alt="Claude Code" width="180" />
</p>

<a href="https://bonsaedev.github.io/nrg/"><img src="https://img.shields.io/badge/built%20with-nrg-A80000.svg?labelColor=black&style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Im91dGxpbmVHcmFkaWVudCIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiAjODA4MDgwOyBzdG9wLW9wYWNpdHk6IDEiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6ICM0MDQwNDA7IHN0b3Atb3BhY2l0eTogMSIgLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImhleGFnb25HcmFkaWVudCIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMTAwJSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiAjQTgwMDAwOyBzdG9wLW9wYWNpdHk6IDEiIC8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6ICM0QjAwMDA7IHN0b3Atb3BhY2l0eTogMSIgLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpZ2h0bmluZ0dyYWRpZW50IiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEwMCUiIHkyPSIxMDAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6ICNmZmZmZmY7IHN0b3Atb3BhY2l0eTogMSIgLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjogI2UwZTBlMDsgc3RvcC1vcGFjaXR5OiAxIiAvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CiAgPHBvbHlnb24gcG9pbnRzPSI1MCwyIDk4LDI1IDk4LDc1IDUwLDk4IDMsNzUgMywyNSIgCiAgICAgICAgICAgc3Ryb2tlPSJ1cmwoI291dGxpbmVHcmFkaWVudCkiIHN0cm9rZS13aWR0aD0iNCIgZmlsbD0idXJsKCNoZXhhZ29uR3JhZGllbnQpIiAvPgoKICA8cGF0aCBkPSJNMzMgMGwxOS43OTcyIDM5LjQ1NzQtMjguNTAyMi0xMS4xMTg0TDc0IDk4IDUxLjA2MDggNDkuMzA1NCA3MSA1NloiIAogICAgICAgIGZpbGw9InVybCgjbGlnaHRuaW5nR3JhZGllbnQpIiBzdHJva2U9Im5vbmUiIC8+Cjwvc3ZnPgo=" alt="built with nrg"/></a>
<a href="https://www.npmjs.com/package/@bonsae/node-red-claude-agent"><img alt="NPM Version" src="https://img.shields.io/npm/v/@bonsae/node-red-claude-agent"></a>
<a href="https://github.com/bonsaedev/node-red-claude-agent/actions/workflows/ci.yaml"><img src="https://github.com/bonsaedev/node-red-claude-agent/actions/workflows/ci.yaml/badge.svg?branch=main" alt="build status"/></a>
<a href="https://socket.dev/npm/package/@bonsae/node-red-claude-agent"><img src="https://socket.dev/api/badge/npm/package/@bonsae/node-red-claude-agent?v=1" alt="socket badge"/></a>
<a href="https://codecov.io/gh/bonsaedev/node-red-claude-agent"><img src="https://codecov.io/gh/bonsaedev/node-red-claude-agent/graph/badge.svg" alt="codecov"/></a>

# @bonsae/node-red-claude-agent

Run **Claude as an autonomous agent** inside your Node-RED flows. These nodes wrap the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) — the same agent loop and built-in tools that power Claude Code in the terminal (read/write files, run commands, search the web) — so a flow sends a prompt, the agent does the work, and the result comes back.

## Quick start

> Not on npm yet — build from source for now. _(Once published: in Node-RED, **Manage Palette → Install → `@bonsae/node-red-claude-agent`**.)_

```bash
pnpm install && pnpm build && pnpm dev   # opens a Node-RED editor with the nodes loaded
```

1. Drag a **Claude Agent** node onto a flow and open it.
2. Next to **Configuration**, click ✎ to create a config node, paste your **Anthropic API key** (`sk-ant-…`), and Done. _(Defaults: Anthropic provider, API-key auth.)_
3. Wire an **inject** in and a **debug** out:
   ```
   [inject → msg.payload = "Summarize today's AI news"]  →  [claude-agent]  →  [debug]
   ```
4. **Deploy**, then click inject. Claude runs and the answer arrives on **`msg.output.payload`**.

That's the whole happy path — **prompt in on `msg.payload`, answer out on `msg.output.payload`.** By default the agent runs autonomously (no approvals) and returns one final result.

Want it to work with files or run commands? Give the config node a **Working directory** and a **Permission mode** (see [Safety](#safety)). Want a human in the loop? Turn on [Interactive](#interactive--approvals).

## The nodes

### `claude-agent` (action)

Runs the agent once per incoming message.

- **Prompt** — `msg.payload` by default; or pin a fixed string / point at another message property.
- **Response mode** — `single` (one final result, default) or `stream` (each message as it arrives).
- **Interactive** — off by default (autonomous). On = surface tool approvals / questions to a UI → [Interactive & approvals](#interactive--approvals).
- **Permission mode** — `inherit` the config's, or override here.
- **Ports** — `0` response · `1` ask · plus optional error / complete / status.

### `claude-agent-configuration` (config)

Auth plus the options every run shares — one config is used by many agent nodes. **Every field has an inline description in the editor;** the essentials:

| Field | What it does |
| --- | --- |
| **Provider / Auth method** | `anthropic` + `apiKey` (defaults). Also a subscription token, or the local `claude /login` — see [Authentication](#authentication). |
| **Model / Fallback** | leave empty for the SDK default. |
| **System prompt** | `claude_code` (the full terminal prompt), `custom`, or `minimal`, with an append box. |
| **Working directory** | where the agent's file/command tools operate. |
| **Permission mode** | `default` (asks) · `acceptEdits` · `plan` · `bypassPermissions` (full autonomy) · `dontAsk`. |
| **Allowed / Disallowed tools** | e.g. `Read, Glob, Grep` or `Bash(rm *)`. |
| **Setting sources** | `user,project,local` — loads `CLAUDE.md` / `.claude/` like the terminal. |
| **Limits** | optional `maxTurns`, `maxBudgetUsd`, and extra accessible directories. |

## Messages

**In** — the prompt (`msg.payload`, or your configured source). Optional: `msg.sessionId` to resume a previous conversation, `msg.correlationId` echoed back on every emission so you can route replies.

**Out — port 0 (response)** — `msg.output = { payload, kind, sessionId, correlationId }`:

- `kind: "result"` — the final answer (also carries `usage`, `total_cost_usd`, `num_turns`).
- `kind: "assistant"` — each message as it streams (stream mode); `kind: "partial"` — token deltas if **Include partial** is on.

Incoming top-level message keys are carried through.

## Authentication

The `anthropic` provider offers three ways to sign in (cloud providers — bedrock / vertex / foundry — read their credentials from the environment):

- **API key** (default) — paste a Console key (`sk-ant-api03-…`); billed per use. **Use this for shared or production instances.**
- **Subscription token** — run `claude setup-token`, then paste the token (`sk-ant-oat01-…`) to use your own Claude Pro/Max plan.
- **Local login** — reuse the `claude /login` credentials already on this machine; nothing to paste (Node-RED must run as the user who logged in).

Credentials don't travel with exported flows — re-paste after importing. **Subscriptions are for your own account only** — Anthropic's terms don't allow routing other people's traffic through a subscription, so use an API key if the instance serves others.

<details>
<summary>How subscription auth is protected (env scrubbing)</summary>

Both subscription modes scrub host env vars that could outrank or reroute them: `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` (the CLI prefers these, so a stray host key would silently hijack the run and bill the API org), `ANTHROPIC_BASE_URL` (a subscription token must only ever reach Anthropic's API), and the `CLAUDE_CODE_USE_*` provider flags. `claudeCodeLogin` also scrubs `CLAUDE_CODE_OAUTH_TOKEN`. An `apiKeyHelper` in `~/.claude/settings.json` still outranks the token and can't be scrubbed via env — remove it if you hit auth conflicts. In `apiKey` mode, setting the credential also drops a host `ANTHROPIC_AUTH_TOKEN` so your key wins.

The token is readable by the agent's own shell (a Bash call can print it), so treat flows on this instance as trusted. Revoke subscription tokens at claude.ai → Settings → Claude Code.
</details>

## Interactive & approvals

Turn on **Interactive** (with permission mode `default` or `plan`) to approve tool use and answer clarifying questions from a UI. Requests come out on **port 1 (ask)**:

`msg.output = { correlationId, payload: { requestId, kind, toolName, input, questions?, suggestions? } }` — `kind` is `permission` or `question`.

Route the answer back into the node:

```js
msg.claudeResponse = {
  requestId,                            // from the ask
  behavior: "allow" | "deny",           // tool approval
  updatedInput,                         // optional: edited tool input
  message,                              // optional: reason on deny
  answers: { "<question>": "<label>" }, // clarifying questions
};
```

Send `msg.claudeControl = "interrupt"` to abort an in-flight run.

<details>
<summary>Clarifying questions: <code>canUseTool</code> vs <code>onUserDialog</code></summary>

A clarifying question can arrive two ways:

- **`canUseTool` (default)** — the question rides the ask port (`kind: "question"`) and you answer with `claudeResponse.answers`. Simple, but whether the CLI honors answers fed back this way is **unverified** against a live run.
- **`onUserDialog` (the documented channel)** — set **dialog kinds** on the config node to the kind the CLI emits for `AskUserQuestion` (an opaque string baked into the CLI binary); questions then route through it and you answer the same way.

Discovering the kind: the CLI **fails closed** — it only emits a dialog kind you've declared, so you can't observe an undeclared one. Run interactively with a guess (the agent logs each `user dialog '<kind>'` it receives), then put the real kind in the config field. Until then the `canUseTool` path is used.
</details>

## Examples

Once the nodes are installed, import these from the editor's **Import → Examples → @bonsae/node-red-claude-agent** menu:

- **Interpret a CSV (autonomous)** — downloads a CSV to the agent's working directory, then asks the agent to read and interpret it with its own file tools. Runs unattended (`bypassPermissions`).
  ```
  [inject url] → [http request] → [file: write data.csv] → [claude-agent] → [debug]
  ```
- **Multi-user chat (Vue + WebSocket)** — a WebSocket chat where each browser user gets a separate Claude conversation, with Allow/Deny and multiple-choice prompts routed back to the right person. Open the demo page (`examples/chat-demo/index.html`) in two browsers to see two independent sessions (sign in as `alice / alice123` or `bob / bob123`).

<details>
<summary>How the multi-user chat keeps users separate</summary>

All separation is server-side (nothing trusted from the browser):

- **Users** live in flow context (`{ alice: "alice123", bob: "bob123" }` — edit the `auth + route in` function).
- **Connection** — each emitted message carries the socket as `correlationId`; the `route *` functions rebuild `msg._session` from it so a reply goes back only to that user's connection.
- **Conversation memory** — the server maps `user → Claude sessionId` in flow context and resumes it per prompt, so each user keeps a separate thread.

So: **socket = transport, user = identity, Claude `sessionId` = memory.** It's a demo-grade in-memory store with plaintext passwords over `ws://` — put it behind TLS and a real user store before exposing it.
</details>

## Safety

`bypassPermissions` gives the agent full, unattended access to the host (files, shell). Run it in a container/sandbox, or use `default` + **Interactive** (approve each tool), or `dontAsk` + an allowed-tools allowlist, when you need guardrails.

## Documentation

These nodes wrap the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview); the official docs explain what each configuration option does (the config node also links each section to the relevant page):

- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) — the agent loop, built-in tools, and API-key setup
- [Permissions](https://code.claude.com/docs/en/agent-sdk/permissions) — permission modes and allowed / disallowed tools
- [Approvals & user input](https://code.claude.com/docs/en/agent-sdk/user-input) — the interactive approval / clarifying-question flow
- [System prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts) — the `claude_code` / custom / minimal presets and `CLAUDE.md`
- [Claude Code features in the SDK](https://code.claude.com/docs/en/agent-sdk/claude-code-features) — setting sources (`user,project,local`)
- [Sessions](https://code.claude.com/docs/en/agent-sdk/sessions) — resuming a conversation via `msg.sessionId`
- [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript) — every option (model, working directory, limits, …)
- Cloud providers: [Amazon Bedrock](https://code.claude.com/docs/en/amazon-bedrock) · [Google Vertex AI](https://code.claude.com/docs/en/google-vertex-ai) · [Microsoft Foundry](https://code.claude.com/docs/en/microsoft-foundry)

## License

[Business Source License 1.1](./LICENSE) (BUSL-1.1) — free for personal, non-profit, academic, evaluation, and non-production use. **Commercial or production use by a for-profit organization requires a commercial license** — contact allanoricil@duck.com. Each released version converts to the MIT License four years after its release.
