import { invoke } from "@tauri-apps/api/core";

export type DroppedFile = {
  path: string;
  name: string;
};

export type RenameResult = {
  old_path: string;
  new_path: string;
  new_name: string;
  ok: boolean;
  error: string | null;
};

/** Last path segment, handling both `/` and `\` separators. */
export function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/** Splits a filename into its extension (without the dot) and the rest. */
function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  // No extension for dotfiles like ".env" or names with no dot.
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1);
}

/**
 * Preview the new name for a file at a given 1-based index.
 * Mirrors the Rust `rename_files` logic so the table matches the result.
 */
export function previewName(originalName: string, base: string, index: number): string {
  const trimmed = base.trim();
  const ext = extensionOf(originalName);
  return ext ? `${trimmed}-${index}.${ext}` : `${trimmed}-${index}`;
}

export function renameFiles(paths: string[], baseName: string): Promise<RenameResult[]> {
  return invoke<RenameResult[]>("rename_files", { paths, baseName });
}
