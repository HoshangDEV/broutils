import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import {
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  DragDropVerticalIcon,
  ImageNotFound01Icon,
  Layers01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, type ReactNode } from "react";

import { DropZone } from "@/components/shared/drop-zone";
import { RevealButton } from "@/components/shared/reveal-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  basename,
  formatLimitError,
  imagePreview,
  INPUT_EXTENSIONS,
  isSupportedImage,
  LOSSY_STACK_FORMATS,
  MATCH_WIDTH_LABELS,
  scaledHeight,
  STACK_FORMATS,
  stackFileStem,
  stackImages,
  stackSize,
  type ImagePreview,
  type MatchWidth,
  type StackFormat,
  type StackResult,
} from "@/lib/stack";
import { cn } from "@/lib/utils";

type StackFile = {
  /** The file path doubles as the sortable id — duplicates are skipped. */
  path: string;
  name: string;
};

type PreviewState =
  | ({ state: "ready" } & ImagePreview)
  | { state: "error"; message: string };

type Status =
  | { state: "idle" }
  | { state: "stacking" }
  | { state: "done"; result: StackResult }
  | { state: "error"; message: string };

const MATCH_WIDTHS: MatchWidth[] = ["widest", "narrowest"];

function formatDimensions(width: number, height: number): string {
  return `${width.toLocaleString()} × ${height.toLocaleString()}`;
}

export function StackImages() {
  const [files, setFiles] = useState<StackFile[]>([]);
  /** Path → decoded dimensions + thumbnail; a missing key means still loading. */
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  const [matchWidth, setMatchWidth] = useState<MatchWidth>("widest");
  const [format, setFormat] = useState<StackFormat>("png");
  const [quality, setQuality] = useState(90);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  /** Row under the pointer or being dragged — highlighted in the preview. */
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);

  const isStacking = status.state === "stacking";

  /** Any edit makes a previous result or error stale. */
  function invalidate() {
    setStatus((s) => (s.state === "stacking" ? s : { state: "idle" }));
  }

  function loadPreview(path: string) {
    imagePreview(path)
      .then((p) =>
        setPreviews((prev) => ({ ...prev, [path]: { state: "ready", ...p } })),
      )
      .catch((e) =>
        setPreviews((prev) => ({
          ...prev,
          [path]: { state: "error", message: String(e) },
        })),
      );
  }

  function addPaths(paths: string[]) {
    if (isStacking) return;
    const seen = new Set(files.map((f) => f.path));
    const added: StackFile[] = [];
    for (const path of paths) {
      const name = basename(path);
      // Quietly skip non-images and duplicates.
      if (seen.has(path) || !isSupportedImage(name)) continue;
      seen.add(path);
      added.push({ path, name });
    }
    if (added.length === 0) return;

    setFiles((prev) => [...prev, ...added]);
    for (const { path } of added) {
      if (previews[path]?.state !== "ready") loadPreview(path);
    }
    invalidate();
  }

  function removeFile(path: string) {
    if (isStacking) return;
    setFiles((prev) => prev.filter((f) => f.path !== path));
    setHoveredPath((h) => (h === path ? null : h));
    invalidate();
  }

  function moveFile(from: number, to: number) {
    if (from === to) return;
    setFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    invalidate();
  }

  function clearAll() {
    setFiles([]);
    setPreviews({});
    setHoveredPath(null);
    setStatus({ state: "idle" });
  }

  const readyPreviews = files.map((f) => {
    const p = previews[f.path];
    return p?.state === "ready" ? p : undefined;
  });

  const output = stackSize(readyPreviews, matchWidth);

  const limitError = output ? formatLimitError(format, output) : null;
  const loadingCount = files.filter((f) => !previews[f.path]).length;
  const hasPreviewErrors = files.some((f) => previews[f.path]?.state === "error");

  const canStack =
    files.length >= 2 &&
    output !== null &&
    !limitError &&
    !hasPreviewErrors &&
    !isStacking;

  const highlighted = draggingPath ?? hoveredPath;

  async function handleStack() {
    if (!canStack) return;

    setStatus({ state: "stacking" });
    try {
      const result = await stackImages(
        files.map((f) => f.path),
        stackFileStem(),
        format,
        quality,
        matchWidth,
      );
      setStatus({ state: "done", result });
    } catch (e) {
      setStatus({ state: "error", message: String(e) });
    }
  }

  let hint: string;
  if (files.length === 0) {
    hint = "jpg · png · webp · avif · gif · bmp · tiff · heic";
  } else if (files.length === 1) {
    hint = "1 image — add at least one more";
  } else {
    hint = `${files.length} images ready`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Stack Images</h2>
        <p className="text-sm text-muted-foreground">
          Drop or paste two or more images and they&apos;re joined top to
          bottom into one. Every image is scaled to the same width first,
          keeping its proportions. The result is saved next to the first image
          (Downloads if it was pasted) as{" "}
          <span className="font-mono text-xs">stacked-&#123;date&#125;</span>.
        </p>
      </div>

      <DropZone
        onFiles={addPaths}
        icon={Layers01Icon}
        title="Drag & drop images here"
        buttonLabel="Select Images"
        disabled={isStacking}
        accept={isSupportedImage}
        pasteable
        dialogFilters={[{ name: "Images", extensions: INPUT_EXTENSIONS }]}
        hint={hint}
      />

      {/* Controls */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="match-width">Match width to</Label>
            <Select
              value={matchWidth}
              onValueChange={(v) => {
                setMatchWidth(v as MatchWidth);
                invalidate();
              }}
              disabled={isStacking}
            >
              <SelectTrigger id="match-width" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MATCH_WIDTHS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {MATCH_WIDTH_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="stack-format">Save as</Label>
            <Select
              value={format}
              onValueChange={(v) => {
                setFormat(v as StackFormat);
                invalidate();
              }}
              disabled={isStacking}
            >
              <SelectTrigger id="stack-format" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STACK_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {LOSSY_STACK_FORMATS.has(format) && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="stack-quality">Quality</Label>
              <span className="text-sm tabular-nums text-muted-foreground">
                {quality}
              </span>
            </div>
            <Slider
              id="stack-quality"
              min={1}
              max={100}
              step={1}
              value={[quality]}
              onValueChange={([v]) => setQuality(v)}
              disabled={isStacking}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <p
            className={cn(
              "text-sm tabular-nums",
              limitError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {limitError ??
              (output && files.length >= 2
                ? `Output ${formatDimensions(output.width, output.height)} px`
                : loadingCount > 0
                  ? "Reading images…"
                  : null)}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={clearAll}
              disabled={files.length === 0 || isStacking}
            >
              Clear
            </Button>
            <Button onClick={handleStack} disabled={!canStack}>
              <HugeiconsIcon icon={Layers01Icon} />
              {isStacking ? "Stacking…" : "Stack & Save"}
            </Button>
          </div>
        </div>
      </div>

      {/* Status banner */}
      {status.state === "done" && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4 shrink-0" />
          <span className="min-w-0 truncate">
            Saved <span className="font-mono text-xs">{basename(status.result.path)}</span>{" "}
            <span className="text-muted-foreground tabular-nums">
              · {formatDimensions(status.result.width, status.result.height)} px
            </span>
          </span>
          <div className="ml-auto">
            <RevealButton paths={[status.result.path]} label="Show in folder" />
          </div>
        </div>
      )}
      {status.state === "error" && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <HugeiconsIcon icon={Alert02Icon} className="size-4 shrink-0" />
          <span>{status.message}</span>
        </div>
      )}

      {files.length > 0 && (
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_15rem]">
          {/* Order list */}
          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h3 className="text-sm font-medium">Order</h3>
              <span className="text-xs text-muted-foreground">
                Top to bottom · drag to reorder
              </span>
            </div>
            <DragDropProvider
              modifiers={[RestrictToVerticalAxis]}
              onDragStart={(event) => {
                const id = event.operation.source?.id;
                setDraggingPath(id == null ? null : String(id));
              }}
              onDragEnd={(event) => {
                setDraggingPath(null);
                if (event.canceled) return;
                const { source } = event.operation;
                if (isSortable(source)) {
                  moveFile(source.initialIndex, source.index);
                }
              }}
            >
              <ol className="flex flex-col gap-2">
                {files.map((file, index) => (
                  <StackRow
                    key={file.path}
                    file={file}
                    index={index}
                    preview={previews[file.path]}
                    targetWidth={output?.width}
                    disabled={isStacking}
                    onRemove={() => removeFile(file.path)}
                    onHover={(hovering) =>
                      setHoveredPath((h) =>
                        hovering ? file.path : h === file.path ? null : h,
                      )
                    }
                  />
                ))}
              </ol>
            </DragDropProvider>
          </section>

          {/* Live preview of the stacked result */}
          <section className="flex flex-col gap-2 md:sticky md:top-4">
            <div className="flex items-baseline justify-between px-1">
              <h3 className="text-sm font-medium">Preview</h3>
            </div>
            <div className="max-h-[36rem] overflow-y-auto rounded-xl border bg-muted/30 p-2">
              <div className="overflow-hidden rounded-md">
                {files.map((file, index) => {
                  const preview = previews[file.path];
                  const dimmed = highlighted !== null && highlighted !== file.path;
                  return (
                    <div
                      key={file.path}
                      className={cn(
                        "relative transition-opacity",
                        dimmed && "opacity-35",
                      )}
                    >
                      {preview?.state === "ready" ? (
                        <img
                          src={preview.data_url}
                          alt={file.name}
                          className="block w-full"
                          draggable={false}
                        />
                      ) : preview?.state === "error" ? (
                        <div className="flex h-20 items-center justify-center bg-destructive/10 text-destructive">
                          <HugeiconsIcon icon={ImageNotFound01Icon} className="size-5" />
                        </div>
                      ) : (
                        <div className="h-20 animate-pulse bg-muted" />
                      )}
                      <span className="absolute left-1.5 top-1.5 rounded bg-background/80 px-1.5 text-[10px] font-medium tabular-nums backdrop-blur-sm">
                        {index + 1}
                      </span>
                      {highlighted === file.path && (
                        <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-primary" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

interface StackRowProps {
  file: StackFile;
  index: number;
  preview: PreviewState | undefined;
  /** Shared output width, once every image's size is known. */
  targetWidth: number | undefined;
  disabled: boolean;
  onRemove: () => void;
  onHover: (hovering: boolean) => void;
}

function StackRow({
  file,
  index,
  preview,
  targetWidth,
  disabled,
  onRemove,
  onHover,
}: StackRowProps) {
  const { ref, handleRef, isDragging } = useSortable({
    id: file.path,
    index,
    disabled,
  });

  let details: ReactNode;
  if (!preview) {
    details = "Reading…";
  } else if (preview.state === "error") {
    details = <span className="text-destructive">{preview.message}</span>;
  } else {
    const { width, height } = preview;
    const resized = targetWidth !== undefined && targetWidth !== width;
    details = (
      <>
        {formatDimensions(width, height)}
        {resized && (
          <>
            {" → "}
            <span className="text-foreground">
              {formatDimensions(targetWidth, scaledHeight(preview, targetWidth))}
            </span>
          </>
        )}
      </>
    );
  }

  return (
    <li
      ref={ref}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-2 pr-3 transition-shadow",
        isDragging && "border-primary/60 shadow-lg shadow-black/30",
      )}
    >
      <button
        ref={handleRef}
        type="button"
        disabled={disabled}
        aria-label={`Reorder ${file.name}`}
        className="flex h-10 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-default disabled:opacity-50"
      >
        <HugeiconsIcon icon={DragDropVerticalIcon} className="size-4" />
      </button>

      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium tabular-nums">
        {index + 1}
      </span>

      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {preview?.state === "ready" ? (
          <img
            src={preview.data_url}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
        ) : preview?.state === "error" ? (
          <HugeiconsIcon
            icon={ImageNotFound01Icon}
            className="size-4 text-destructive"
          />
        ) : (
          <div className="size-full animate-pulse bg-muted-foreground/10" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs">{file.name}</p>
        <p className="truncate text-xs text-muted-foreground tabular-nums">
          {details}
        </p>
      </div>

      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
      >
        <HugeiconsIcon icon={Cancel01Icon} />
      </Button>
    </li>
  );
}
