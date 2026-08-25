import { FolderOpenIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import { revealFiles } from "@/lib/reveal";

interface RevealButtonProps {
  /** Output files to reveal; their folders are opened with the files selected. */
  paths: string[];
  /** Button text. Omit for an icon-only button (use `aria-label` instead). */
  label?: string;
  "aria-label"?: string;
  disabled?: boolean;
}

/**
 * "Show in folder" — opens the folder holding the processed files. Shared by
 * every tool so the affordance looks and behaves the same across tabs.
 */
export function RevealButton({
  paths,
  label,
  "aria-label": ariaLabel,
  disabled = false,
}: RevealButtonProps) {
  const iconOnly = !label;
  return (
    <Button
      variant="ghost"
      size={iconOnly ? "icon-xs" : "default"}
      onClick={() => revealFiles(paths)}
      disabled={disabled || paths.length === 0}
      aria-label={ariaLabel ?? label}
      title={iconOnly ? (ariaLabel ?? "Show in folder") : undefined}
    >
      <HugeiconsIcon icon={FolderOpenIcon} />
      {label}
    </Button>
  );
}
