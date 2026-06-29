import { invoke } from "@tauri-apps/api/core";

import { basename, extensionOf } from "@/lib/files";

export { basename };

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
