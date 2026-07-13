<script setup lang="ts">
import { ref } from "vue";
import {
  collectFromDataTransfer,
  collectFromFileList,
  type Selection,
} from "../../lib/folder-files";

const props = defineProps<{
  /** Whether an upload already exists (changes the prompt to "replace"). */
  replacing?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ pick: [selection: Selection] }>();

const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const reading = ref(false);

function openPicker(): void {
  if (!props.disabled) input.value?.click();
}
defineExpose({ openPicker });

async function read(collect: () => Promise<Selection>): Promise<void> {
  reading.value = true;
  try {
    emit("pick", await collect());
  } finally {
    reading.value = false;
  }
}

async function onInput(event: Event): Promise<void> {
  const el = event.target as HTMLInputElement;
  if (el.files) await read(() => collectFromFileList(el.files as FileList));
  el.value = ""; // allow re-picking the same folder
}

async function onDrop(event: DragEvent): Promise<void> {
  dragging.value = false;
  if (props.disabled || !event.dataTransfer) return;
  const { items } = event.dataTransfer;
  await read(() => collectFromDataTransfer(items));
}
</script>

<template>
  <div
    class="cc-dropzone"
    :class="{ 'is-dragging': dragging, 'is-disabled': disabled }"
    role="button"
    tabindex="0"
    @click="openPicker"
    @keydown.enter.prevent="openPicker"
    @keydown.space.prevent="openPicker"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <input
      ref="input"
      class="cc-dropzone__input"
      type="file"
      webkitdirectory
      multiple
      :disabled="disabled"
      @change="onInput"
    />
    <i class="fa fa-cloud-upload cc-dropzone__icon"></i>
    <div class="cc-dropzone__title">
      <template v-if="reading">Reading folder…</template>
      <template v-else-if="replacing">
        Drop a folder to replace, or click to browse
      </template>
      <template v-else>
        Drop your <code>.claude</code> or project folder here, or click to
        browse
      </template>
    </div>
    <div class="cc-dropzone__hint">
      Keeps <code>CLAUDE.md</code>, <code>.claude/</code> and
      <code>.mcp.json</code> only
    </div>
  </div>
</template>

<style scoped>
.cc-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px 12px;
  border: 2px dashed var(--red-ui-secondary-border-color, #ccc);
  border-radius: 6px;
  background: var(--red-ui-secondary-background, #fafafa);
  color: var(--red-ui-secondary-text-color, #888);
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.cc-dropzone:hover:not(.is-disabled),
.cc-dropzone.is-dragging {
  border-color: var(--red-ui-form-input-focus-color, #aaa);
  background: var(--red-ui-form-input-background, #fff);
}
.cc-dropzone.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.cc-dropzone__input {
  /* Node-RED's `.form-row input` rule (higher specificity) shows file inputs,
     so !important is needed to keep the real input hidden behind the dropzone. */
  display: none !important;
}
.cc-dropzone__icon {
  font-size: 22px;
  color: var(--red-ui-secondary-text-color, #999);
}
.cc-dropzone__title {
  font-size: 13px;
  color: var(--red-ui-primary-text-color, #333);
}
.cc-dropzone__hint {
  font-size: 11px;
}
.cc-dropzone code {
  font-size: 11px;
}
</style>
