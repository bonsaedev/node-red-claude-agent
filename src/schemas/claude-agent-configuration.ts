import { defineSchema, SchemaType } from "@bonsae/nrg/server";

/**
 * Configuration for a Claude agent: auth/provider plus the options that shape
 * every run (model, system prompt, working directory, permission mode, tool
 * allow/deny lists, setting sources, limits). One config node is shared by many
 * `claude-agent` nodes.
 */
export const ConfigsSchema = defineSchema(
  {
    name: SchemaType.String({ default: "", "x-nrg-form": { icon: "tag" } }),
    provider: SchemaType.Union(
      [
        SchemaType.Literal("anthropic"),
        SchemaType.Literal("bedrock"),
        SchemaType.Literal("vertex"),
        SchemaType.Literal("foundry"),
      ],
      {
        default: "anthropic",
        description:
          "Auth provider: anthropic (API key), or a cloud provider (Bedrock / Vertex / Azure Foundry — cloud credentials must be present in the environment)",
        "x-nrg-form": { icon: "cloud" },
      },
    ),
    model: SchemaType.String({
      default: "",
      description:
        "Model alias or full id (e.g. claude-opus-4-8). Empty uses the SDK/CLI default.",
      "x-nrg-form": { icon: "microchip" },
    }),
    fallbackModel: SchemaType.String({
      default: "",
      description: "Model to fall back to if the primary is unavailable",
      "x-nrg-form": { icon: "microchip" },
    }),
    systemPromptPreset: SchemaType.Union(
      [
        SchemaType.Literal("claude_code"),
        SchemaType.Literal("custom"),
        SchemaType.Literal("minimal"),
      ],
      {
        default: "claude_code",
        description:
          "claude_code = the full Claude Code agent prompt (behaves like the terminal); custom = your own prompt; minimal = no preset",
        "x-nrg-form": { icon: "file-text-o" },
      },
    ),
    appendSystemPrompt: SchemaType.String({
      default: "",
      description:
        "Text appended to the claude_code preset (extra house rules, persona, constraints)",
      "x-nrg-form": { icon: "plus" },
    }),
    customSystemPrompt: SchemaType.String({
      default: "",
      description: "Full system prompt used when the preset is 'custom'",
      "x-nrg-form": { icon: "pencil" },
    }),
    cwd: SchemaType.String({
      default: "",
      description:
        "Working directory the agent operates in (host file operations are relative to it). Empty uses the Node-RED process directory.",
      "x-nrg-form": { icon: "folder-o" },
    }),
    permissionMode: SchemaType.Union(
      [
        SchemaType.Literal("default"),
        SchemaType.Literal("acceptEdits"),
        SchemaType.Literal("bypassPermissions"),
        SchemaType.Literal("plan"),
        SchemaType.Literal("dontAsk"),
      ],
      {
        // Default to the SAFE mode — a freshly-dragged config node must not grant
        // unattended shell/file access. bypassPermissions stays selectable but
        // opt-in (set it deliberately, in a sandbox).
        default: "default",
        description:
          "How freely the agent uses tools. 'default' prompts for dangerous operations (safe). bypassPermissions = full terminal-like autonomy — opt in, and only in a sandbox. For interactive approvals use 'default' and enable 'interactive' on the agent node.",
        "x-nrg-form": { icon: "shield" },
      },
    ),
    allowedTools: SchemaType.String({
      default: "",
      description:
        "Comma/newline-separated tools to auto-approve (e.g. Read, Glob, Grep, mcp__server__*). Empty = none pre-approved.",
      "x-nrg-form": { icon: "check" },
    }),
    disallowedTools: SchemaType.String({
      default: "",
      description:
        "Comma/newline-separated tools to deny (e.g. Bash(rm *)). Denials win in every mode.",
      "x-nrg-form": { icon: "ban" },
    }),
    settingSources: SchemaType.String({
      default: "user,project,local",
      description:
        "Filesystem settings to load (any of user, project, local) — loads CLAUDE.md and .claude/ config like the terminal. Empty loads none.",
      "x-nrg-form": { icon: "cogs" },
    }),
    maxTurns: SchemaType.Number({
      default: 0,
      minimum: 0,
      description: "Max agentic turns (tool round-trips). 0 = unlimited.",
      "x-nrg-form": { icon: "refresh" },
    }),
    maxBudgetUsd: SchemaType.Number({
      default: 0,
      minimum: 0,
      description:
        "Stop when the estimated cost reaches this many USD. 0 = no cap.",
      "x-nrg-form": { icon: "dollar" },
    }),
    additionalDirectories: SchemaType.String({
      default: "",
      description:
        "Extra directories (comma/newline-separated) the agent may access beyond the working directory",
      "x-nrg-form": { icon: "folder-open-o" },
    }),
    supportedDialogKinds: SchemaType.String({
      default: "",
      description:
        "Comma/newline-separated CLI dialog kinds your UI handles (e.g. AskUserQuestion). When set, the agent routes those via the proper onUserDialog channel instead of canUseTool. The CLI fails closed: a kind not listed here is never emitted. Leave empty to keep the canUseTool path.",
      "x-nrg-form": { icon: "comments-o" },
    }),
  },
  { $id: "claude-agent-configuration:config" },
);

export const CredentialsSchema = defineSchema(
  {
    apiKey: SchemaType.String({
      default: "",
      format: "password",
      description:
        "ANTHROPIC_API_KEY (for the anthropic provider). Cloud providers read their own credentials from the environment.",
    }),
  },
  { $id: "claude-agent-configuration:credentials" },
);
