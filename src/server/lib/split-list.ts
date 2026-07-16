/** Split a comma/newline-separated field into a trimmed, non-empty list. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
