import type { RED } from "@bonsae/nrg/server";
import {
  writeFolder,
  status,
  clear,
  type UploadFile,
  type UploadMode,
} from "../lib/claude-folder-store";

/**
 * Admin HTTP endpoints for the per-config-node uploaded `.claude` folder, keyed
 * by node id: GET status, POST upload, DELETE clear. Writes/deletes require the
 * `flows.write` permission (status needs `flows.read`) when admin auth is on.
 */
function initClaudeFolderRoutes(RED: RED): void {
  const base = "/claude-agent/:nodeId/claude-folder";
  const write = RED.auth?.needsPermission
    ? [RED.auth.needsPermission("flows.write")]
    : [];
  const read = RED.auth?.needsPermission
    ? [RED.auth.needsPermission("flows.read")]
    : [];

  RED.httpAdmin.get(base, ...read, (req, res) => {
    try {
      res.json(status(RED, req.params.nodeId));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  RED.httpAdmin.post(base, ...write, (req, res) => {
    try {
      const { files, mode } = req.body as {
        files: UploadFile[];
        mode?: UploadMode;
      };
      const result = writeFolder(
        RED,
        req.params.nodeId,
        files,
        mode === "merge" ? "merge" : "overwrite",
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  RED.httpAdmin.delete(base, ...write, (req, res) => {
    try {
      clear(RED, req.params.nodeId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });
}

export { initClaudeFolderRoutes };
