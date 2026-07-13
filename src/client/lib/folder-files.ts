import type { UploadFile } from "../api/claude-agent";

/** A picked file plus its byte size (for the selection summary). */
export type PendingFile = UploadFile & { size: number };

export interface Selection {
  /** Files kept after filtering to the .claude allow-list. */
  files: PendingFile[];
  /** How many picked files were ignored (outside the allow-list). */
  dropped: number;
}

/** Only CLAUDE.md, .mcp.json, and everything under .claude/ is kept. */
export function isKept(rel: string): boolean {
  return (
    rel === "CLAUDE.md" || rel === ".mcp.json" || rel.startsWith(".claude/")
  );
}

/**
 * Maps a picked/dropped folder to relative paths. Dropping the `.claude` folder
 * itself keeps its files under `.claude/…`; any other (project) folder is the
 * root, so its top segment is stripped.
 */
function relFor(topSegment: string, rest: string): string {
  return topSegment === ".claude" ? `.claude/${rest}` : rest;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function toSelection(
  entries: { rel: string; file: File }[],
): Promise<Selection> {
  const files: PendingFile[] = [];
  let dropped = 0;
  for (const { rel, file } of entries) {
    if (!isKept(rel)) {
      dropped++;
      continue;
    }
    files.push({
      path: rel,
      contentBase64: await fileToBase64(file),
      size: file.size,
    });
  }
  return { files, dropped };
}

/** Build a Selection from an `<input webkitdirectory>` change (webkitRelativePath). */
export async function collectFromFileList(
  list: FileList | File[],
): Promise<Selection> {
  const entries = Array.from(list).map((file) => {
    const raw =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    const segments = raw.split("/");
    const rest = segments.slice(1).join("/") || file.name;
    return { rel: relFor(segments[0], rest), file };
  });
  return toSelection(entries);
}

/**
 * Build a Selection from a drop's DataTransferItemList, recursing dropped
 * folders via the File System Entries API (a plain drop only exposes loose
 * files). The entries are read out synchronously first: the item list is only
 * valid for the duration of the drop event, but the entries it yields persist.
 */
export async function collectFromDataTransfer(
  items: DataTransferItemList,
): Promise<Selection> {
  const roots: FileSystemEntry[] = [];
  for (const item of Array.from(items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }

  const collected: { rel: string; file: File }[] = [];
  for (const root of roots) {
    if (root.isFile) {
      collected.push({
        rel: root.name,
        file: await entryFile(root as FileSystemFileEntry),
      });
    } else if (root.isDirectory) {
      const base = root.name === ".claude" ? ".claude/" : "";
      await walkDir(root as FileSystemDirectoryEntry, base, collected);
    }
  }
  return toSelection(collected);
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) =>
    reader.readEntries((entries) => resolve(entries), reject),
  );
}

async function walkDir(
  dir: FileSystemDirectoryEntry,
  prefix: string,
  out: { rel: string; file: File }[],
): Promise<void> {
  const reader = dir.createReader();
  // readEntries yields at most ~100 per call — loop until it drains.
  for (;;) {
    const batch = await readEntries(reader);
    if (batch.length === 0) break;
    for (const entry of batch) {
      if (entry.isFile) {
        out.push({
          rel: prefix + entry.name,
          file: await entryFile(entry as FileSystemFileEntry),
        });
      } else if (entry.isDirectory) {
        await walkDir(
          entry as FileSystemDirectoryEntry,
          `${prefix + entry.name}/`,
          out,
        );
      }
    }
  }
}
