import { useEffect, useRef } from "react";

import { IS_MAC } from "@/lib/clipboard";

/** True when the key event is going into a text field, which keeps its own paste. */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable]") !== null)
  );
}

/**
 * Calls `onPaste` when ⌘V (Ctrl+V off macOS) is pressed outside a text field.
 * Listens for the key itself rather than the DOM `paste` event, which webviews
 * don't reliably fire when nothing editable has focus.
 *
 * `onPaste` is read through a ref so the listener always invokes the latest
 * closure without re-subscribing.
 */
export function usePasteShortcut(onPaste: () => void, enabled = true): void {
  const onPasteRef = useRef(onPaste);
  useEffect(() => {
    onPasteRef.current = onPaste;
  });

  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(e: KeyboardEvent) {
      const modifier = IS_MAC ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      // Non-Latin layouts report another character; fall back to the physical key.
      const isV = key === "v" || (!/^[a-z]$/.test(key) && e.code === "KeyV");
      if (!modifier || e.shiftKey || e.altKey || !isV) return;
      if (e.repeat || isEditableTarget(e.target)) return;
      e.preventDefault();
      onPasteRef.current();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
