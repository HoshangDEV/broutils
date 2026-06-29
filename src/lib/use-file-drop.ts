import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Subscribes once to the Tauri webview's native drag-drop events (which give
 * real filesystem paths) and reports the current drag-over state.
 *
 * `onDrop` is read through a ref so the listener — subscribed a single time —
 * always invokes the latest closure without needing to re-subscribe.
 */
export function useFileDrop(onDrop: (paths: string[]) => void): boolean {
  const [isDragging, setIsDragging] = useState(false);
  const onDropRef = useRef(onDrop);
  // Keep the ref pointed at the latest closure without re-subscribing below.
  useEffect(() => {
    onDropRef.current = onDrop;
  });

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setIsDragging(true);
      } else if (payload.type === "leave") {
        setIsDragging(false);
      } else if (payload.type === "drop") {
        setIsDragging(false);
        onDropRef.current(payload.paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return isDragging;
}
