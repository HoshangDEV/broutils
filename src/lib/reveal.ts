import { revealItemInDir } from "@tauri-apps/plugin-opener";

/**
 * Opens the containing folder of each path in the system file manager, with the
 * files themselves selected. Paths in the same folder open a single window.
 * Errors (file moved or deleted since processing) are swallowed — this is a
 * convenience action, never a failure the user needs to act on.
 */
export async function revealFiles(paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;
  try {
    await revealItemInDir(unique);
  } catch {
    // nothing actionable — the folder just doesn't open
  }
}
