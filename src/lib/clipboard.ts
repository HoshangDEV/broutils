import { invoke } from "@tauri-apps/api/core";

import { datedStem } from "@/lib/files";

/**
 * The clipboard as file paths: files copied in Finder/Explorer, or a copied
 * image (screenshot, "Copy Image") that Rust saves as `pasted-{date}.png`.
 * Empty when the clipboard holds neither.
 */
export function readClipboardFiles(): Promise<string[]> {
  return invoke<string[]>("read_clipboard_files", {
    fileStem: datedStem("pasted"),
  });
}

export const IS_MAC = navigator.userAgent.includes("Mac");

/** The paste shortcut as shown to the user. */
export const PASTE_SHORTCUT = IS_MAC ? "⌘V" : "Ctrl+V";
