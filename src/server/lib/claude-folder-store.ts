import fs from "node:fs";
import path from "node:path";

/** A single uploaded file: a relative path plus base64 content. */
export interface UploadFile {
  path: string;
  contentBase64: string;
}

export type UploadMode = "overwrite" | "merge";

export interface FolderStatus {
  exists: boolean;
  fileCount: number;
  bytes: number;
  uploadedAt: string | null;
}

/** Minimal RED surface this store needs (avoids importing the full type here). */
interface REDLike {
  settings: { userDir?: string };
}

// Guardrails. The uploaded tree is stored in a per-node dir, so it is isolated,
// but we still cap size/count and reject anything outside the .claude surface.
const MAX_FILE_BYTES = 2 * 1024 * 1024;
// Kept under Node-RED's default admin body limit (apiMaxLength ~5 MB): the JSON
// payload carries base64 (~1.37x). Larger folders need Phase 3 (multipart).
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_FILES = 500;
// A file's first path segment must be one of these (or the file must live under
// `.claude/`). Executable content (hooks/commands/skills) IS allowed by design —
// callers are warned that uploaded code can run during an agent session.
const ALLOWED_TOP_LEVEL = new Set(["CLAUDE.md", ".claude", ".mcp.json"]);

function baseDir(RED: REDLike): string {
  const userDir = RED.settings.userDir || process.cwd();
  return path.join(userDir, "claude-agent");
}

/** The per-config-node managed directory: `<userDir>/claude-agent/<nodeId>`. */
export function managedDir(RED: REDLike, nodeId: string): string {
  const safeId = String(nodeId).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safeId || safeId === "." || safeId === "..") {
    throw new Error("Invalid node id");
  }
  return path.join(baseDir(RED), safeId);
}

/** True when a managed `.claude` or `CLAUDE.md` exists for this node. */
export function hasFolder(RED: REDLike, nodeId: string): boolean {
  const dir = managedDir(RED, nodeId);
  return (
    fs.existsSync(path.join(dir, ".claude")) ||
    fs.existsSync(path.join(dir, "CLAUDE.md"))
  );
}

/** Validate a relative upload path and resolve it inside `dir` (throws on any
 *  traversal / absolute / disallowed-root attempt). */
function resolveInside(dir: string, rel: string): string {
  if (typeof rel !== "string" || !rel) throw new Error("Empty file path");
  const normalized = rel.replace(/\\/g, "/");
  if (
    path.isAbsolute(normalized) ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((seg) => seg === "..")
  ) {
    throw new Error(`Illegal path: ${rel}`);
  }
  const top = normalized.split("/")[0];
  if (!ALLOWED_TOP_LEVEL.has(top)) {
    throw new Error(`Path outside .claude: ${rel}`);
  }
  const resolved = path.resolve(dir, normalized);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
    throw new Error(`Path escapes managed dir: ${rel}`);
  }
  return resolved;
}

/** Validate the whole payload (count, per-file + total size, paths). */
function validate(dir: string, files: UploadFile[]): { total: number } {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("No files provided");
  }
  if (files.length > MAX_FILES) {
    throw new Error(`Too many files (max ${MAX_FILES})`);
  }
  let total = 0;
  for (const f of files) {
    resolveInside(dir, f.path);
    const bytes = Buffer.byteLength(f.contentBase64 || "", "base64");
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`File too large: ${f.path}`);
    }
    total += bytes;
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(`Upload too large (max ${MAX_TOTAL_BYTES} bytes)`);
    }
  }
  return { total };
}

/** Write the uploaded files. `overwrite` replaces the whole managed tree
 *  atomically (temp dir + rename); `merge` writes/updates the given files. */
export function writeFolder(
  RED: REDLike,
  nodeId: string,
  files: UploadFile[],
  mode: UploadMode = "overwrite",
): FolderStatus {
  const dir = managedDir(RED, nodeId);
  const target = mode === "overwrite" ? `${dir}.tmp-${process.pid}` : dir;
  validate(mode === "overwrite" ? dir : dir, files);

  if (mode === "overwrite") fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  for (const f of files) {
    const dest = resolveInside(target, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(f.contentBase64 || "", "base64"));
  }

  if (mode === "overwrite") {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(target, dir);
  }
  return status(RED, nodeId);
}

/** Snapshot the managed folder: file count, total bytes, newest mtime. */
export function status(RED: REDLike, nodeId: string): FolderStatus {
  const dir = managedDir(RED, nodeId);
  if (!fs.existsSync(dir)) {
    return { exists: false, fileCount: 0, bytes: 0, uploadedAt: null };
  }
  let fileCount = 0;
  let bytes = 0;
  let newest = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) {
        const st = fs.statSync(p);
        fileCount++;
        bytes += st.size;
        newest = Math.max(newest, st.mtimeMs);
      }
    }
  };
  walk(dir);
  return {
    exists: fileCount > 0,
    fileCount,
    bytes,
    uploadedAt: newest ? new Date(newest).toISOString() : null,
  };
}

/** Delete the managed folder for this node (used on re-upload/clear/delete). */
export function clear(RED: REDLike, nodeId: string): void {
  fs.rmSync(managedDir(RED, nodeId), { recursive: true, force: true });
}

/** Copy the managed `.claude` + `CLAUDE.md` into `cwd`, backing up any existing
 *  `.claude` there once. Used when the author set an explicit Working folder. */
export function syncInto(RED: REDLike, nodeId: string, cwd: string): void {
  const src = managedDir(RED, nodeId);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(cwd, { recursive: true });

  const existingClaude = path.join(cwd, ".claude");
  if (fs.existsSync(existingClaude)) {
    const backup = path.join(cwd, ".claude.bak");
    if (!fs.existsSync(backup)) fs.renameSync(existingClaude, backup);
    else fs.rmSync(existingClaude, { recursive: true, force: true });
  }
  fs.cpSync(src, cwd, { recursive: true });
}
