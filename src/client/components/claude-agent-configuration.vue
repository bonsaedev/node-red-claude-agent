<script setup lang="ts">
import { computed } from "vue";
import { useFormNode } from "@bonsae/nrg/client";
import type {
  ConfigsSchema,
  CredentialsSchema,
} from "../../shared/schemas/claude-agent-configuration";

const { node } = useFormNode<typeof ConfigsSchema, typeof CredentialsSchema>();

// Ensure the credentials object exists so v-model bindings are reactive.
if (!node.credentials) node.credentials = {};

// Translate against this node's locale catalog (configs.* / options.* /
// credentials.* live in src/resources/locales/labels/claude-agent-configuration).
const t = (key: string): string => node._(`claude-agent-configuration.${key}`);

const providers = computed(() => [
  { value: "anthropic", label: t("options.provider.anthropic") },
  { value: "bedrock", label: t("options.provider.bedrock") },
  { value: "vertex", label: t("options.provider.vertex") },
  { value: "foundry", label: t("options.provider.foundry") },
]);
const authMethods = computed(() => [
  { value: "apiKey", label: t("options.authMethod.apiKey") },
  {
    value: "subscriptionToken",
    label: t("options.authMethod.subscriptionToken"),
  },
  {
    value: "claudeCodeLogin",
    label: t("options.authMethod.claudeCodeLogin"),
  },
]);
const promptPresets = computed(() => [
  { value: "claude_code", label: t("options.systemPromptPreset.claude_code") },
  { value: "custom", label: t("options.systemPromptPreset.custom") },
  { value: "minimal", label: t("options.systemPromptPreset.minimal") },
]);
const permissionModes = computed(() => [
  { value: "default", label: t("options.permissionMode.default") },
  { value: "acceptEdits", label: t("options.permissionMode.acceptEdits") },
  {
    value: "bypassPermissions",
    label: t("options.permissionMode.bypassPermissions"),
  },
  { value: "plan", label: t("options.permissionMode.plan") },
  { value: "dontAsk", label: t("options.permissionMode.dontAsk") },
]);

const cloudProviderLabel = () =>
  providers.value.find((p) => p.value === node.provider)?.label ??
  node.provider;

// Curated Anthropic model list (maintained in code — drop entries in a future
// node release as models are retired). Model ids/names are universal, so they
// are not localized. Cloud providers use deployment/region-specific ids and
// keep a free-text field instead.
const ANTHROPIC_MODELS = [
  { value: "claude-opus-4-8", label: "Opus 4.8 — most capable" },
  { value: "claude-opus-4-7", label: "Opus 4.7" },
  { value: "claude-opus-4-6", label: "Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 — balanced" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 — fast" },
  { value: "claude-fable-5", label: "Fable 5" },
];

// Build the select options, keeping a not-yet-listed saved value selectable so
// upgrading/downgrading the list never silently drops a configured model.
function modelOptions(current: string | undefined, emptyLabel: string) {
  const opts = [{ value: "", label: emptyLabel }];
  const known = new Set(ANTHROPIC_MODELS.map((m) => m.value));
  if (current && !known.has(current)) {
    opts.push({ value: current, label: `${current} (custom)` });
  }
  return [...opts, ...ANTHROPIC_MODELS];
}
</script>

<template>
  <div class="form-row">
    <NodeRedInput
      v-model:value="node.name"
      :label="t('configs.name')"
      icon="tag"
    />
  </div>

  <!-- ───────── Sign-in ───────── -->
  <div class="cc-section">Sign-in</div>

  <div class="form-row">
    <NodeRedSelectInput
      v-model:value="node.provider"
      :label="t('configs.provider')"
      icon="cloud"
      :options="providers"
    />
  </div>

  <!-- Anthropic: choose how to authenticate -->
  <template v-if="node.provider === 'anthropic'">
    <div class="form-row">
      <NodeRedSelectInput
        v-model:value="node.authMethod"
        :label="t('configs.authMethod')"
        icon="id-card-o"
        :options="authMethods"
      />
    </div>

    <div v-if="node.authMethod === 'apiKey'" class="form-row">
      <NodeRedInput
        v-model:value="node.credentials.apiKey"
        type="password"
        :label="t('credentials.apiKey')"
        icon="key"
      />
      <div class="cc-tip">
        <i class="fa fa-info-circle"></i> Starts with <code>sk-ant-api…</code>.
        Create one at console.anthropic.com — billed per use.
      </div>
    </div>

    <div v-else-if="node.authMethod === 'subscriptionToken'" class="form-row">
      <NodeRedInput
        v-model:value="node.credentials.oauthToken"
        type="password"
        :label="t('credentials.oauthToken')"
        icon="key"
      />
      <div class="cc-tip">
        <i class="fa fa-info-circle"></i> Starts with <code>sk-ant-oat…</code>.
        Run <code>claude setup-token</code> in a terminal to create one. Only
        use your own subscription.
      </div>
    </div>

    <div v-else class="cc-tip cc-tip-block">
      <i class="fa fa-info-circle"></i> Uses the Claude login already on this
      computer — run <code>claude</code> and sign in once. No token to paste.
    </div>
  </template>

  <!-- Cloud providers: use the machine's existing credentials -->
  <div v-else class="cc-tip cc-tip-block">
    <i class="fa fa-info-circle"></i> Runs Claude through your
    {{ cloudProviderLabel() }} account. Its credentials must already be
    configured on this machine (no key needed here).
  </div>

  <!-- ───────── Model ───────── -->
  <div class="cc-section">Model</div>

  <!-- Anthropic: curated model dropdowns (empty = SDK default) -->
  <template v-if="node.provider === 'anthropic'">
    <div class="form-row">
      <NodeRedSelectInput
        v-model:value="node.model"
        :label="t('configs.model')"
        icon="microchip"
        :options="modelOptions(node.model, 'Default (SDK chooses)')"
      />
    </div>
    <div class="form-row">
      <NodeRedSelectInput
        v-model:value="node.fallbackModel"
        :label="t('configs.fallbackModel')"
        icon="microchip"
        :options="modelOptions(node.fallbackModel, 'None')"
      />
      <div class="cc-tip">
        <i class="fa fa-info-circle"></i> Used automatically if the main model
        is unavailable.
      </div>
    </div>
  </template>

  <!-- Cloud providers: platform-specific model IDs → free text -->
  <template v-else>
    <div class="form-row">
      <NodeRedInput
        v-model:value="node.model"
        :label="t('configs.model')"
        icon="microchip"
        placeholder="platform model ID (empty = default)"
      />
      <div class="cc-tip">
        <i class="fa fa-info-circle"></i> On {{ cloudProviderLabel() }} use that
        platform's model ID (deployment/region-specific). Empty = default.
      </div>
    </div>
    <div class="form-row">
      <NodeRedInput
        v-model:value="node.fallbackModel"
        :label="t('configs.fallbackModel')"
        icon="microchip"
        placeholder="platform model ID (optional)"
      />
    </div>
  </template>

  <!-- ───────── Assistant behaviour ───────── -->
  <div class="cc-section">Assistant behaviour</div>

  <div class="form-row">
    <NodeRedSelectInput
      v-model:value="node.systemPromptPreset"
      :label="t('configs.systemPromptPreset')"
      icon="file-text-o"
      :options="promptPresets"
    />
  </div>

  <!-- Claude Code preset → append box -->
  <div v-if="node.systemPromptPreset === 'claude_code'" class="form-row">
    <label class="cc-label"
      ><i class="fa fa-plus"></i> {{ t("configs.appendSystemPrompt") }}</label
    >
    <textarea
      v-model="node.appendSystemPrompt"
      class="cc-textarea"
      rows="4"
      placeholder="Added on top of the Claude Code prompt — house rules, tone, things it should always do."
    ></textarea>
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> Claude Code gives the assistant the full
      terminal-agent behaviour. This box <em>adds</em> your instructions on top
      — leave it empty to use Claude Code as-is.
    </div>
  </div>

  <!-- Custom preset → full prompt box -->
  <div v-else-if="node.systemPromptPreset === 'custom'" class="form-row">
    <label class="cc-label"
      ><i class="fa fa-pencil"></i> {{ t("configs.customSystemPrompt") }}</label
    >
    <textarea
      v-model="node.customSystemPrompt"
      class="cc-textarea"
      rows="6"
      placeholder="Write the assistant's full instructions here…"
    ></textarea>
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> Your instructions become the assistant's
      entire system prompt (no preset behaviour is added).
    </div>
  </div>

  <!-- Minimal preset → nothing to fill -->
  <div v-else class="cc-tip cc-tip-block">
    <i class="fa fa-info-circle"></i> No preset — the assistant starts with no
    system prompt.
  </div>

  <!-- ───────── Working folder & project settings ───────── -->
  <div class="cc-section">Working folder &amp; project settings</div>

  <div class="form-row">
    <NodeRedInput
      v-model:value="node.cwd"
      :label="t('configs.cwd')"
      icon="folder-o"
      placeholder="defaults to the folder Node-RED runs in"
    />
  </div>

  <div class="form-row">
    <NodeRedInput
      v-model:value="node.settingSources"
      :label="t('configs.settingSources')"
      icon="cogs"
      placeholder="user,project,local"
    />
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> Which settings to read from the working
      folder — any of <code>user</code>, <code>project</code>,
      <code>local</code> — loads <code>CLAUDE.md</code> and
      <code>.claude/</code> like the terminal does. Leave empty to load none.
    </div>
  </div>

  <!-- ───────── Tools &amp; permissions ───────── -->
  <div class="cc-section">Tools &amp; permissions</div>

  <div class="form-row">
    <NodeRedSelectInput
      v-model:value="node.permissionMode"
      :label="t('configs.permissionMode')"
      icon="shield"
      :options="permissionModes"
    />
  </div>

  <div class="form-row">
    <label class="cc-label"
      ><i class="fa fa-check"></i> {{ t("configs.allowedTools") }}</label
    >
    <textarea
      v-model="node.allowedTools"
      class="cc-textarea"
      rows="3"
      placeholder="One per line, e.g. Read, Glob, Grep"
    ></textarea>
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> Tools the assistant may use without
      asking. One per line.
    </div>
  </div>

  <div class="form-row">
    <label class="cc-label"
      ><i class="fa fa-ban"></i> {{ t("configs.disallowedTools") }}</label
    >
    <textarea
      v-model="node.disallowedTools"
      class="cc-textarea"
      rows="3"
      placeholder="One per line, e.g. Bash(rm *)"
    ></textarea>
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> Tools the assistant may never use — a
      block always wins. One per line.
    </div>
  </div>

  <!-- ───────── Limits ───────── -->
  <div class="cc-section">Limits</div>

  <div class="form-row">
    <NodeRedInput
      v-model:value="node.maxTurns"
      type="number"
      :label="t('configs.maxTurns')"
      icon="refresh"
    />
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> 0 means no limit.
    </div>
  </div>

  <div class="form-row">
    <NodeRedInput
      v-model:value="node.maxBudgetUsd"
      type="number"
      :label="t('configs.maxBudgetUsd')"
      icon="dollar"
    />
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> 0 means no limit.
    </div>
  </div>

  <div class="form-row">
    <label class="cc-label"
      ><i class="fa fa-folder-open-o"></i>
      {{ t("configs.additionalDirectories") }}</label
    >
    <textarea
      v-model="node.additionalDirectories"
      class="cc-textarea"
      rows="2"
      placeholder="One folder per line"
    ></textarea>
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> Other folders the assistant may open,
      besides the working folder.
    </div>
  </div>

  <!-- ───────── Advanced ───────── -->
  <div class="cc-section">Advanced</div>

  <div class="form-row">
    <label class="cc-label"
      ><i class="fa fa-comments-o"></i>
      {{ t("configs.supportedDialogKinds") }}</label
    >
    <textarea
      v-model="node.supportedDialogKinds"
      class="cc-textarea"
      rows="2"
      placeholder="One per line, e.g. AskUserQuestion"
    ></textarea>
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> The kinds of clarifying question your UI
      can answer. Leave empty unless you know you need this.
    </div>
  </div>
</template>

<style scoped>
.cc-section {
  font-weight: 600;
  font-size: 0.95em;
  margin: 16px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--red-ui-secondary-border-color, #ddd);
  color: var(--red-ui-header-text-color, #333);
}
.cc-label {
  display: block;
  margin-bottom: 4px;
  font-weight: 500;
}
.cc-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font-family: var(--red-ui-monospace-font, monospace);
  font-size: 13px;
  padding: 6px 8px;
}
.cc-tip {
  margin-top: 4px;
  font-size: 12px;
  color: var(--red-ui-secondary-text-color, #888);
  line-height: 1.4;
}
.cc-tip-block {
  margin: 4px 0 8px;
}
.cc-tip code {
  font-size: 11px;
}
</style>
