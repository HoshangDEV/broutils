import { ClipboardPasteIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { PASTE_SHORTCUT, readClipboardFiles } from "@/lib/clipboard";
import { basename } from "@/lib/files";
import { useFileDrop } from "@/lib/use-file-drop";
import { usePasteShortcut } from "@/lib/use-paste-shortcut";
import { cn } from "@/lib/utils";

type DialogFilter = { name: string; extensions: string[] };

interface DropZoneProps {
  /** Receives real filesystem paths from a drop or the native file dialog. */
  onFiles: (paths: string[]) => void;
  icon: IconSvgElement;
  /** Idle headline; while dragging it is always "Drop to add files". */
  title?: string;
  /** Secondary line — typically a queued-file count or a format hint. */
  hint: ReactNode;
  buttonLabel: string;
  /** Native open-dialog filters; omit to allow any file. */
  dialogFilters?: DialogFilter[];
  /** Keep only dropped paths whose filename matches (dialog uses `dialogFilters`). */
  accept?: (name: string) => boolean;
  /** Also take files or image data from the clipboard (Paste button + shortcut). */
  pasteable?: boolean;
  disabled?: boolean;
}

/** How long a paste notice replaces the hint. */
const NOTICE_MS = 3000;

/**
 * The shared drag-and-drop / file-picker surface used by every tool. Owns the
 * native drop listener and drag state; tools just react to `onFiles`.
 */
export function DropZone({
  onFiles,
  icon,
  title = "Drag & drop files here",
  hint,
  buttonLabel,
  dialogFilters,
  accept,
  pasteable = false,
  disabled = false,
}: DropZoneProps) {
  /** Replaces the hint briefly when a paste finds nothing usable. */
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  /** Emits the accepted paths and returns how many there were. */
  function emit(paths: string[]): number {
    const filtered = accept ? paths.filter((p) => accept(basename(p))) : paths;
    if (filtered.length) onFiles(filtered);
    return filtered.length;
  }

  const isDragging = useFileDrop((paths) => {
    if (!disabled) emit(paths);
  });

  async function handleSelect() {
    const selected = await open({ multiple: true, filters: dialogFilters });
    if (!selected) return;
    emit(Array.isArray(selected) ? selected : [selected]);
  }

  async function handlePaste() {
    if (disabled) return;
    try {
      const added = emit(await readClipboardFiles());
      setNotice(added ? null : "Nothing to paste — copy an image or image files first");
    } catch (e) {
      setNotice(`Couldn't read the clipboard: ${e}`);
    }
  }

  usePasteShortcut(handlePaste, pasteable);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
        isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/30",
      )}
    >
      <HugeiconsIcon
        icon={icon}
        className={cn("size-8", isDragging ? "text-primary" : "text-muted-foreground")}
      />
      <p className="text-sm font-medium">
        {isDragging ? "Drop to add files" : title}
      </p>
      <p className={cn("text-xs", notice ? "text-destructive" : "text-muted-foreground")}>
        {notice ?? hint}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Button size="sm" onClick={handleSelect} disabled={disabled}>
          <HugeiconsIcon icon={icon} />
          {buttonLabel}
        </Button>
        {pasteable && (
          <Button size="sm" variant="outline" onClick={handlePaste} disabled={disabled}>
            <HugeiconsIcon icon={ClipboardPasteIcon} />
            Paste
            <kbd className="font-sans text-muted-foreground">{PASTE_SHORTCUT}</kbd>
          </Button>
        )}
      </div>
    </div>
  );
}
