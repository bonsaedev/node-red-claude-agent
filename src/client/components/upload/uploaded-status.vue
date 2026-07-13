<script setup lang="ts">
import type { FolderStatus } from "../../api/claude-agent";
import { formatDate, humanBytes } from "../../lib/format";

defineProps<{
  status: FolderStatus;
  busy: boolean;
  t: (key: string) => string;
}>();
const emit = defineEmits<{ replace: []; remove: [] }>();
</script>

<template>
  <div class="cc-uploaded">
    <div class="cc-uploaded__info">
      <i class="fa fa-check-circle cc-uploaded__ok"></i>
      Uploaded <strong>{{ status.fileCount }}</strong> files ({{
        humanBytes(status.bytes)
      }})
      <span v-if="status.uploadedAt" class="cc-uploaded__date">
        · {{ formatDate(status.uploadedAt) }}
      </span>
    </div>
    <div class="cc-uploaded__buttons">
      <button
        type="button"
        class="red-ui-button"
        :disabled="busy"
        @click="emit('replace')"
      >
        <i class="fa fa-refresh"></i> {{ t("upload.replace") }}
      </button>
      <button
        type="button"
        class="red-ui-button"
        :disabled="busy"
        @click="emit('remove')"
      >
        <i class="fa fa-trash"></i> {{ t("upload.remove") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.cc-uploaded {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--red-ui-secondary-border-color, #ddd);
  border-radius: 6px;
  background: var(--red-ui-secondary-background, #fafafa);
  flex-wrap: wrap;
}
.cc-uploaded__info {
  font-size: 12px;
  color: var(--red-ui-primary-text-color, #333);
}
.cc-uploaded__ok {
  color: #22c55e;
}
.cc-uploaded__date {
  color: var(--red-ui-secondary-text-color, #888);
}
.cc-uploaded__buttons {
  display: flex;
  gap: 6px;
}
</style>
