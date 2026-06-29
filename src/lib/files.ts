/** Shared filesystem/path helpers used across every tool. */

/** Last path segment, handling both `/` and `\` separators. */
export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * The file extension (without the dot), case preserved, or `null` for dotfiles
 * (`.env`) and names with no extension. Callers lowercase when they need to
 * compare; preserving case lets rename/convert keep the original spelling.
 */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1);
}

/** Human-readable byte size. Returns "—" for 0 / unknown. */
export function formatSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
