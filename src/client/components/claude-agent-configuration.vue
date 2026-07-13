<script setup lang="ts">
import { computed } from "vue";
import { useFormNode } from "@bonsae/nrg/client";
import type {
  ConfigsSchema,
  CredentialsSchema,
} from "../../shared/schemas/claude-agent-configuration";
import type { FolderStatus } from "../api/claude-agent";
import { ANTHROPIC_MODELS } from "../../shared/models";
import ClaudeFolderUpload from "./upload/claude-folder-upload.vue";

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
const effortLevels = computed(() => [
  { value: "", label: t("options.effort.default") },
  { value: "low", label: t("options.effort.low") },
  { value: "medium", label: t("options.effort.medium") },
  { value: "high", label: t("options.effort.high") },
  { value: "xhigh", label: t("options.effort.xhigh") },
  { value: "max", label: t("options.effort.max") },
]);
const cloudProviderLabel = () =>
  providers.value.find((p) => p.value === node.provider)?.label ??
  node.provider;

// Build the select options from the shared curated list (see ../../shared/models),
// keeping a not-yet-listed saved value selectable so upgrading/downgrading the
// list never silently drops a configured model. Cloud providers use
// deployment/region-specific ids and keep a free-text field instead.
function modelOptions(current: string | undefined, emptyLabel: string) {
  const opts = [{ value: "", label: emptyLabel }];
  const known = new Set(ANTHROPIC_MODELS.map((m) => m.id));
  if (current && !known.has(current)) {
    opts.push({ value: current, label: `${current} (custom)` });
  }
  return [
    ...opts,
    ...ANTHROPIC_MODELS.map((m) => ({ value: m.id, label: m.label })),
  ];
}

// Mirror the uploaded-folder status into the node config so the flow can tell an
// upload exists (contents stay on disk; only this metadata travels with the
// flow). ClaudeFolderUpload owns the pick/upload/remove UI and reports here.
function applyStatus(status: FolderStatus): void {
  node.claudeFolderUploaded = status.exists;
  node.claudeFolderFileCount = status.fileCount;
  node.claudeFolderBytes = status.bytes;
  node.claudeFolderUploadedAt = status.uploadedAt ?? "";
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
  <div class="cc-section">{{ t("sections.signIn") }}</div>

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
  <div class="cc-section">{{ t("sections.model") }}</div>

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

  <!-- Reasoning effort (applies to every provider) -->
  <div class="form-row">
    <NodeRedSelectInput
      v-model:value="node.effort"
      :label="t('configs.effort')"
      icon="bolt"
      :options="effortLevels"
    />
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> How hard the model thinks — higher means
      deeper reasoning and more tokens. Default lets the SDK decide;
      <code>xhigh</code> suits agentic work, <code>max</code> when correctness
      matters most.
    </div>
  </div>

  <!-- ───────── Assistant behaviour ───────── -->
  <div class="cc-section">{{ t("sections.assistant") }}</div>

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
    <NodeRedInputLabel :label="t('configs.appendSystemPrompt')" icon="plus" />
    <textarea
      v-model="node.appendSystemPrompt"
      class="cc-textarea"
      rows="4"
      placeholder="Added on top of the Claude Code prompt — house rules, tone, things it should always do."
    ></textarea>
    <div class="cc-tip">
      <i class="fa fa-info-circle"></i> Claude Code gives the assistant its full
      set of tools — reading and writing files, running commands, browsing the
      web — for any task. This box <em>adds</em> your instructions on top —
      leave it empty to use it as-is.
    </div>
  </div>

  <!-- Custom preset → full prompt box -->
  <div v-else-if="node.systemPromptPreset === 'custom'" class="form-row">
    <NodeRedInputLabel :label="t('configs.customSystemPrompt')" icon="pencil" />
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
  <div class="cc-section">{{ t("sections.workspace") }}</div>

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

  <!-- Upload a .claude folder (stored per node; fed to the run via cwd) -->
  <div class="form-row">
    <ClaudeFolderUpload :node-id="node.id" :t="t" @change="applyStatus" />
  </div>

  <!-- ───────── Tools &amp; permissions ───────── -->
  <div class="cc-section">{{ t("sections.tools") }}</div>

  <div class="form-row">
    <NodeRedSelectInput
      v-model:value="node.permissionMode"
      :label="t('configs.permissionMode')"
      icon="shield"
      :options="permissionModes"
    />
  </div>

  <div class="form-row">
    <NodeRedInputLabel :label="t('configs.allowedTools')" icon="check" />
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
    <NodeRedInputLabel :label="t('configs.disallowedTools')" icon="ban" />
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
  <div class="cc-section">{{ t("sections.limits") }}</div>

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
    <NodeRedInputLabel
      :label="t('configs.additionalDirectories')"
      icon="folder-open-o"
    />
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
  <div class="cc-section">{{ t("sections.advanced") }}</div>

  <div class="form-row">
    <NodeRedInputLabel
      :label="t('configs.supportedDialogKinds')"
      icon="comments-o"
    />
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
