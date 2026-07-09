export interface UploadFile {
  path: string;
  contentBase64: string;
}

export interface FolderStatus {
  exists: boolean;
  fileCount: number;
  bytes: number;
  uploadedAt: string | null;
}

export type UploadMode = "overwrite" | "merge";

const url = (nodeId: string) =>
  `claude-agent/${encodeURIComponent(nodeId)}/claude-folder`;

// Node-RED stores the admin token under "auth-tokens" and attaches it as a
// Bearer header on its own requests (editor red.js). Replicate that here so
// fetch works whether or not adminAuth is enabled.
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const tokens = RED.settings.get("auth-tokens") as
    | { access_token?: string }
    | undefined;
  if (tokens?.access_token) {
    headers.Authorization = `Bearer ${tokens.access_token}`;
  }
  return headers;
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the status text
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Client wrapper for the per-node uploaded-`.claude` admin endpoints. */
export class ClaudeAgentApi {
  async getStatus(nodeId: string): Promise<FolderStatus> {
    return readJson<FolderStatus>(
      await fetch(url(nodeId), { headers: authHeaders() }),
    );
  }

  async upload(
    nodeId: string,
    files: UploadFile[],
    mode: UploadMode,
  ): Promise<FolderStatus> {
    return readJson<FolderStatus>(
      await fetch(url(nodeId), {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ files, mode }),
      }),
    );
  }

  async clear(nodeId: string): Promise<void> {
    const res = await fetch(url(nodeId), {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  }
}

export const claudeAgentApi = new ClaudeAgentApi();
