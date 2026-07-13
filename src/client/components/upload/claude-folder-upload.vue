<script setup lang="ts">
import { ref, toRef } from "vue";
import UploadDropzone from "./upload-dropzone.vue";
import UploadSelection from "./upload-selection.vue";
import UploadedStatus from "./uploaded-status.vue";
import { useClaudeFolder } from "../../composables/use-claude-folder";
import type { FolderStatus } from "../../api/claude-agent";

const props = defineProps<{
  nodeId: string | undefined;
  t: (key: string) => string;
}>();
const emit = defineEmits<{ change: [status: FolderStatus] }>();

const dropzone = ref<InstanceType<typeof UploadDropzone> | null>(null);

const {
  status,
  selection,
  mode,
  busy,
  select,
  clearSelection,
  upload,
  remove,
} = useClaudeFolder(toRef(props, "nodeId"), (next) => emit("change", next));
</script>

<template>
  <NodeRedInputLabel :label="t('upload.label')" icon="upload" />

  <p v-if="!nodeId" class="cc-tip">
    <i class="fa fa-info-circle"></i> Deploy the node once to enable upload.
  </p>

  <template v-else>
    <UploadDropzone
      ref="dropzone"
      :disabled="busy"
      :replacing="!!status?.exists && !selection"
      @pick="select"
    />

    <UploadSelection
      v-if="selection"
      :selection="selection"
      :mode="mode"
      :busy="busy"
      :t="t"
      @update:mode="mode = $event"
      @upload="upload"
      @clear="clearSelection"
    />
    <UploadedStatus
      v-else-if="status?.exists"
      :status="status"
      :busy="busy"
      :t="t"
      @replace="dropzone?.openPicker()"
      @remove="remove"
    />

    <p class="cc-tip">
      <i class="fa fa-info-circle"></i>
      <strong>Only upload content you trust</strong> — uploaded scripts (hooks,
      commands, skills) can run during a session. Used automatically when the
      node runs: copied into the Working folder if one is set, otherwise a
      private per-node folder holding just this upload.
    </p>
  </template>
</template>

<style scoped>
.cc-tip {
  margin-top: 4px;
  font-size: 12px;
  color: var(--red-ui-secondary-text-color, #888);
  line-height: 1.4;
}
</style>
