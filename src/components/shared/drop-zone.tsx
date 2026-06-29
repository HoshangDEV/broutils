import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { open } from "@tauri-apps/plugin-dialog";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { basename } from "@/lib/files";
import { useFileDrop } from "@/lib/use-file-drop";
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
  disabled?: boolean;
}

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
  disabled = false,
}: DropZoneProps) {
  function emit(paths: string[]) {
    const filtered = accept ? paths.filter((p) => accept(basename(p))) : paths;
    if (filtered.length) onFiles(filtered);
  }

  const isDragging = useFileDrop((paths) => {
    if (!disabled) emit(paths);
  });

  async function handleSelect() {
    const selected = await open({ multiple: true, filters: dialogFilters });
    if (!selected) return;
    emit(Array.isArray(selected) ? selected : [selected]);
  }

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
      <p className="text-xs text-muted-foreground">{hint}</p>
      <Button className="mt-1" size="sm" onClick={handleSelect} disabled={disabled}>
        <HugeiconsIcon icon={icon} />
        {buttonLabel}
      </Button>
    </div>
  );
}
