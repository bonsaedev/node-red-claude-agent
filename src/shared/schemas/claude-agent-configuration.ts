import { defineSchema, SchemaType } from "@bonsae/nrg/schema";

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
          "Where Claude runs. 'Anthropic' uses an API key or your Claude subscription (see Sign-in method). The cloud options run Claude through your Amazon, Google, or Microsoft account, whose credentials must already be set on this machine.",
        "x-nrg-form": { icon: "cloud" },
      },
    ),
    authMethod: SchemaType.Union(
      [
        SchemaType.Literal("apiKey"),
        SchemaType.Literal("subscriptionToken"),
        SchemaType.Literal("claudeCodeLogin"),
      ],
      {
        default: "apiKey",
        description:
          "How to sign in when the provider is 'Anthropic' (ignored for cloud providers). 'API key' bills per use. The two subscription options use your own Claude Pro/Max plan — one with a token you paste, one with the login already on this computer. Only use a subscription for your own account; Anthropic's terms don't allow running other people's traffic through it.",
        "x-nrg-form": { icon: "id-card-o" },
      },
    ),
    model: SchemaType.String({
      default: "",
      description:
        "Which Claude model to use (for example: claude-opus-4-8). Leave empty for the default.",
      "x-nrg-form": { icon: "microchip" },
    }),
    fallbackModel: SchemaType.String({
      default: "",
      description:
        "A second model to use automatically if the main one is unavailable. Leave empty for none.",
      "x-nrg-form": { icon: "microchip" },
    }),
    effort: SchemaType.Union(
      [
        SchemaType.Literal(""),
        SchemaType.Literal("low"),
        SchemaType.Literal("medium"),
        SchemaType.Literal("high"),
        SchemaType.Literal("xhigh"),
        SchemaType.Literal("max"),
      ],
      {
        // Empty = leave unset so the SDK/model default (high) applies.
        default: "",
        description:
          "How hard the model thinks before acting — higher means deeper reasoning and more tokens. Leave as Default to use the SDK default; 'xhigh' suits most agentic/coding work, 'max' when correctness matters more than cost.",
        "x-nrg-form": { icon: "bolt" },
      },
    ),
    systemPromptPreset: SchemaType.Union(
      [
        SchemaType.Literal("claude_code"),
        SchemaType.Literal("custom"),
        SchemaType.Literal("minimal"),
      ],
      {
        default: "claude_code",
        description:
          "Which built-in behavior the assistant starts from. 'Claude Code' acts like the coding assistant in the terminal; 'Custom' lets you write your own instructions; 'Minimal' starts with none.",
        "x-nrg-form": { icon: "file-text-o" },
      },
    ),
    appendSystemPrompt: SchemaType.String({
      default: "",
      description:
        "Extra instructions added on top of the 'Claude Code' style — house rules, tone, or things it should always do.",
      "x-nrg-form": { icon: "plus" },
    }),
    customSystemPrompt: SchemaType.String({
      default: "",
      description:
        "Your own instructions for the assistant. Used only when the style above is set to 'Custom'.",
      "x-nrg-form": { icon: "pencil" },
    }),
    cwd: SchemaType.String({
      default: "",
      description:
        "The folder the assistant works in — any files it reads or writes are relative to this. Leave empty to use the folder Node-RED runs in.",
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
          "How much the assistant can do on its own. The default asks before anything risky (safest). 'Full autonomy' lets it run and change anything without asking — only use it on a machine you can safely sandbox.",
        "x-nrg-form": { icon: "shield" },
      },
    ),
    allowedTools: SchemaType.String({
      default: "",
      description:
        "Tools the assistant may use without asking. One per line (for example: Read, Glob, Grep). Leave empty to approve none up front.",
      "x-nrg-form": { icon: "check" },
    }),
    disallowedTools: SchemaType.String({
      default: "",
      description:
        "Tools the assistant may never use. One per line (for example: Bash(rm *)). A block here always wins.",
      "x-nrg-form": { icon: "ban" },
    }),
    settingSources: SchemaType.String({
      default: "user,project,local",
      description:
        "Which project settings files to load (any of user, project, local) — reads CLAUDE.md and .claude/ like the terminal does. Leave empty to load none.",
      "x-nrg-form": { icon: "cogs" },
    }),
    maxTurns: SchemaType.Number({
      default: 0,
      minimum: 0,
      description:
        "The most back-and-forth steps the assistant may take before stopping. 0 means no limit.",
      "x-nrg-form": { icon: "refresh" },
    }),
    maxBudgetUsd: SchemaType.Number({
      default: 0,
      minimum: 0,
      description:
        "Stop once the estimated cost reaches this many US dollars. 0 means no limit.",
      "x-nrg-form": { icon: "dollar" },
    }),
    additionalDirectories: SchemaType.String({
      default: "",
      description:
        "Other folders the assistant is allowed to open, besides the working folder. One per line.",
      "x-nrg-form": { icon: "folder-open-o" },
    }),
    supportedDialogKinds: SchemaType.String({
      default: "",
      description:
        "Advanced: the kinds of clarifying question your UI can answer (for example: AskUserQuestion). Leave empty unless you know you need this.",
      "x-nrg-form": { icon: "comments-o" },
    }),
    // Uploaded-.claude metadata. Set by the folder uploader (not edited by
    // hand); the actual files live on disk under <userDir>/claude-agent/<id>.
    // Contents never travel in the flow export — only this lightweight status.
    claudeFolderUploaded: SchemaType.Boolean({ default: false }),
    claudeFolderFileCount: SchemaType.Number({ default: 0, minimum: 0 }),
    claudeFolderBytes: SchemaType.Number({ default: 0, minimum: 0 }),
    claudeFolderUploadedAt: SchemaType.String({ default: "" }),
  },
  { $id: "claude-agent-configuration:config" },
);

export const CredentialsSchema = defineSchema(
  {
    apiKey: SchemaType.String({
      default: "",
      format: "password",
      description:
        "Your Anthropic API key (starts with sk-ant-api…). Used when Sign-in method is 'API key'. Create one at console.anthropic.com.",
    }),
    oauthToken: SchemaType.String({
      default: "",
      format: "password",
      description:
        "Your Claude subscription token (starts with sk-ant-oat…). Used when Sign-in method is 'Claude subscription (paste token)'. Get one by running `claude setup-token` in a terminal; it lasts about a year. Revoke at claude.ai → Settings → Claude Code.",
    }),
  },
  { $id: "claude-agent-configuration:credentials" },
);
