import { onMounted, ref, type Ref } from "vue";
import {
  claudeAgentApi,
  type FolderStatus,
  type UploadMode,
} from "../api/claude-agent";
import type { Selection } from "../lib/folder-files";

/**
 * State + actions for a node's uploaded `.claude` folder: the on-disk status,
 * the pending (picked-but-not-yet-uploaded) selection, and upload/remove. The
 * config-node fields that mirror the status into the flow stay in the form —
 * this composable reports every committed change through `onChange`.
 */
export function useClaudeFolder(
  nodeId: Ref<string | undefined>,
  onChange: (status: FolderStatus) => void,
) {
  const status = ref<FolderStatus | null>(null);
  const selection = ref<Selection | null>(null);
  const mode = ref<UploadMode>("overwrite");
  const busy = ref(false);

  onMounted(async () => {
    if (!nodeId.value) return;
    try {
      status.value = await claudeAgentApi.getStatus(nodeId.value);
    } catch {
      // no status route yet (fresh node) — leave it null
    }
  });

  function select(next: Selection): void {
    selection.value = next.files.length > 0 ? next : null;
  }

  function clearSelection(): void {
    selection.value = null;
  }

  async function upload(): Promise<void> {
    const id = nodeId.value;
    const sel = selection.value;
    if (!id || !sel) return;
    busy.value = true;
    try {
      const next = await claudeAgentApi.upload(
        id,
        sel.files.map((f) => ({
          path: f.path,
          contentBase64: f.contentBase64,
        })),
        mode.value,
      );
      status.value = next;
      selection.value = null;
      onChange(next);
      RED.notify(`Uploaded .claude (${next.fileCount} files)`, {
        type: "success",
      });
    } catch (err) {
      RED.notify(`Upload failed: ${(err as Error).message}`, { type: "error" });
    } finally {
      busy.value = false;
    }
  }

  async function remove(): Promise<void> {
    const id = nodeId.value;
    if (!id) return;
    busy.value = true;
    try {
      await claudeAgentApi.clear(id);
      const cleared: FolderStatus = {
        exists: false,
        fileCount: 0,
        bytes: 0,
        uploadedAt: null,
      };
      status.value = cleared;
      selection.value = null;
      onChange(cleared);
      RED.notify("Removed the uploaded .claude folder", { type: "success" });
    } catch (err) {
      RED.notify(`Remove failed: ${(err as Error).message}`, { type: "error" });
    } finally {
      busy.value = false;
    }
  }

  return {
    status,
    selection,
    mode,
    busy,
    select,
    clearSelection,
    upload,
    remove,
  };
}
