/** Human-readable byte size, e.g. 12 KB / 3.4 MB. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Locale date-time string for an ISO timestamp, or "" when null. */
export function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "";
}
