<script setup lang="ts">
import { computed } from "vue";
import type { Selection } from "../../lib/folder-files";
import type { UploadMode } from "../../api/claude-agent";
import { humanBytes } from "../../lib/format";

const props = defineProps<{
  selection: Selection;
  mode: UploadMode;
  busy: boolean;
  t: (key: string) => string;
}>();
const emit = defineEmits<{
  "update:mode": [mode: UploadMode];
  upload: [];
  clear: [];
}>();

const totalBytes = computed(() =>
  props.selection.files.reduce((sum, f) => sum + f.size, 0),
);
</script>

<template>
  <div class="cc-selection">
    <div class="cc-selection__summary">
      <i class="fa fa-folder-o"></i>
      <strong>{{ selection.files.length }}</strong> files kept ({{
        humanBytes(totalBytes)
      }})
      <span v-if="selection.dropped" class="cc-selection__dropped">
        · {{ selection.dropped }} ignored (outside .claude)
      </span>
    </div>

    <div class="cc-selection__row">
      <div class="cc-segmented" role="radiogroup">
        <label :class="{ 'is-active': mode === 'overwrite' }">
          <input
            type="radio"
            value="overwrite"
            :checked="mode === 'overwrite'"
            @change="emit('update:mode', 'overwrite')"
          />
          {{ t("upload.replace") }}
        </label>
        <label :class="{ 'is-active': mode === 'merge' }">
          <input
            type="radio"
            value="merge"
            :checked="mode === 'merge'"
            @change="emit('update:mode', 'merge')"
          />
          {{ t("upload.merge") }}
        </label>
      </div>

      <div class="cc-selection__buttons">
        <button
          type="button"
          class="red-ui-button"
          :disabled="busy"
          @click="emit('clear')"
        >
          {{ t("upload.cancel") }}
        </button>
        <button
          type="button"
          class="red-ui-button primary"
          :disabled="busy"
          @click="emit('upload')"
        >
          <i class="fa fa-upload"></i>
          {{ busy ? t("upload.uploading") : t("upload.upload") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cc-selection {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--red-ui-secondary-border-color, #ddd);
  border-radius: 6px;
  background: var(--red-ui-secondary-background, #fafafa);
}
.cc-selection__summary {
  font-size: 12px;
  color: var(--red-ui-primary-text-color, #333);
}
.cc-selection__dropped {
  color: var(--red-ui-secondary-text-color, #888);
}
.cc-selection__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.cc-segmented {
  display: inline-flex;
  border: 1px solid var(--red-ui-secondary-border-color, #ccc);
  border-radius: 4px;
  overflow: hidden;
}
.cc-segmented label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.cc-segmented label.is-active {
  background: var(--red-ui-workspace-button-background-active, #efefef);
}
.cc-segmented label + label {
  border-left: 1px solid var(--red-ui-secondary-border-color, #ccc);
}
.cc-segmented input {
  display: none;
}
.cc-selection__buttons {
  display: flex;
  gap: 6px;
}
</style>
