import {
  Alert02Icon,
  ArrowDataTransferHorizontalIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Image02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  basename,
  convertImages,
  isSupportedImage,
  LOSSY_FORMATS,
  previewName,
  TARGET_FORMATS,
  type ConvertResult,
  type TargetFormat,
} from "@/lib/convert";
import { cn } from "@/lib/utils";

type ConvertFile = {
  path: string;
  name: string;
  /** Per-file target format; overrides nothing else — each row is independent. */
  format: TargetFormat;
};

type Status =
  | { state: "idle" }
  | { state: "converting" }
  | { state: "done"; ok: number; failed: number };

const DEFAULT_FORMAT: TargetFormat = "jpg";

export function ConvertImages() {
  const [files, setFiles] = useState<ConvertFile[]>([]);
  const [bulkFormat, setBulkFormat] = useState<TargetFormat>(DEFAULT_FORMAT);
  const [baseName, setBaseName] = useState("");
  const [quality, setQuality] = useState(85);
  const [deleteOriginals, setDeleteOriginals] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isConverting = status.state === "converting";

  // Mirrors `bulkFormat` so the native drop listener (subscribed once) can read
  // the latest selected default without re-subscribing.
  const bulkFormatRef = useRef(bulkFormat);
  useEffect(() => {
    bulkFormatRef.current = bulkFormat;
  }, [bulkFormat]);

  // Same trick for the conversion status: the drop listener captures the first
  // render's closure, so it reads liveness through a ref.
  const isConvertingRef = useRef(isConverting);
  useEffect(() => {
    isConvertingRef.current = isConverting;
  }, [isConverting]);

  function addPaths(paths: string[]) {
    // Freeze the queue while a conversion is in flight.
    if (isConvertingRef.current) return;
    setStatus({ state: "idle" });
    setErrors({});
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.path));
      const next = [...prev];
      for (const path of paths) {
        const name = basename(path);
        // Quietly skip non-images and duplicates.
        if (seen.has(path) || !isSupportedImage(name)) continue;
        seen.add(path);
        next.push({ path, name, format: bulkFormatRef.current });
      }
      return next;
    });
  }

  // Listen for native file drops from the Tauri webview (gives real paths).
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setIsDragging(true);
      } else if (payload.type === "leave") {
        setIsDragging(false);
      } else if (payload.type === "drop") {
        setIsDragging(false);
        addPaths(payload.paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  async function handleSelectFiles() {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Images",
          extensions: [
            "jpg",
            "jpeg",
            "png",
            "webp",
            "avif",
            "gif",
            "bmp",
            "tiff",
            "tif",
            "ico",
            "heic",
            "heif",
          ],
        },
      ],
    });
    if (!selected) return;
    addPaths(Array.isArray(selected) ? selected : [selected]);
  }

  function setFileFormat(path: string, format: TargetFormat) {
    if (isConverting) return;
    setFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, format } : f)),
    );
    // The output name changes, so any prior per-row error no longer applies.
    setErrors({});
    setStatus({ state: "idle" });
  }

  /** Apply the bulk format to every file at once. */
  function applyBulkFormat(format: TargetFormat) {
    if (isConverting) return;
    setBulkFormat(format);
    setFiles((prev) => prev.map((f) => ({ ...f, format })));
    setErrors({});
    setStatus({ state: "idle" });
  }

  function removeFile(path: string) {
    if (isConverting) return;
    setFiles((prev) => prev.filter((f) => f.path !== path));
    setStatus({ state: "idle" });
  }

  function handleBaseNameChange(value: string) {
    setBaseName(value);
    // Output names change with the base, so stale row errors no longer match.
    setErrors({});
    setStatus({ state: "idle" });
  }

  function clearAll() {
    setFiles([]);
    setStatus({ state: "idle" });
    setErrors({});
  }

  const showQuality = useMemo(
    () => files.some((f) => LOSSY_FORMATS.has(f.format)),
    [files],
  );

  const canConvert = files.length > 0 && status.state !== "converting";

  const preview = useMemo(
    () =>
      files.map((file, i) => ({
        ...file,
        newName: previewName(file.name, file.format, baseName, i + 1),
      })),
    [files, baseName],
  );

  async function handleConvert() {
    if (!canConvert) return;
    setStatus({ state: "converting" });
    setErrors({});

    try {
      const results: ConvertResult[] = await convertImages(
        files.map((f) => ({ path: f.path, format: f.format })),
        baseName,
        quality,
        deleteOriginals,
      );

      const nextErrors: Record<string, string> = {};
      let ok = 0;
      let failed = 0;
      for (const r of results) {
        if (r.ok) {
          ok++;
        } else {
          failed++;
          nextErrors[r.old_path] = r.error ?? "conversion failed";
        }
      }

      setErrors(nextErrors);
      setStatus({ state: "done", ok, failed });
    } catch (e) {
      // The IPC call itself failed (nothing was converted) — surface it instead
      // of leaving the UI stuck on "Converting…".
      const message = e instanceof Error ? e.message : String(e);
      setErrors(Object.fromEntries(files.map((f) => [f.path, message])));
      setStatus({ state: "done", ok: 0, failed: files.length });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Convert Images</h2>
        <p className="text-sm text-muted-foreground">
          Drop images, pick a target format (per file or all at once), and
          they&apos;re re-encoded into the same folder. HEIC input is supported.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30",
        )}
      >
        <HugeiconsIcon
          icon={Image02Icon}
          className={cn(
            "size-8",
            isDragging ? "text-primary" : "text-muted-foreground",
          )}
        />
        <p className="text-sm font-medium">
          {isDragging ? "Drop to add images" : "Drag & drop images here"}
        </p>
        <p className="text-xs text-muted-foreground">
          {files.length > 0
            ? `${files.length} image${files.length === 1 ? "" : "s"} ready`
            : "jpg · png · webp · avif · gif · bmp · tiff · ico · heic"}
        </p>
        <Button
          className="mt-1"
          size="sm"
          onClick={handleSelectFiles}
          disabled={isConverting}
        >
          <HugeiconsIcon icon={Image02Icon} />
          Select Images
        </Button>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-format">Convert all to</Label>
            <Select
              value={bulkFormat}
              onValueChange={(v) => applyBulkFormat(v as TargetFormat)}
              disabled={isConverting}
            >
              <SelectTrigger id="bulk-format" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="rename-base">Rename (optional)</Label>
            <Input
              id="rename-base"
              placeholder="e.g. holiday → holiday-1.jpg"
              value={baseName}
              onChange={(e) => handleBaseNameChange(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={isConverting}
            />
          </div>
        </div>

        {showQuality && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="quality">Quality (lossy formats)</Label>
              <span className="text-sm tabular-nums text-muted-foreground">
                {quality}
              </span>
            </div>
            <Slider
              id="quality"
              min={1}
              max={100}
              step={1}
              value={[quality]}
              onValueChange={([v]) => setQuality(v)}
              disabled={isConverting}
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="delete-originals"
              checked={deleteOriginals}
              onCheckedChange={setDeleteOriginals}
              disabled={isConverting}
            />
            <Label htmlFor="delete-originals" className="text-sm font-normal">
              Delete originals after converting
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={clearAll}
              disabled={files.length === 0 || status.state === "converting"}
            >
              Clear
            </Button>
            <Button onClick={handleConvert} disabled={!canConvert}>
              <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} />
              {status.state === "converting" ? "Converting…" : "Convert"}
            </Button>
          </div>
        </div>
      </div>

      {/* Status banner */}
      {status.state === "done" && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            status.failed === 0
              ? "border-border bg-muted/40 text-foreground"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          <HugeiconsIcon
            icon={status.failed === 0 ? CheckmarkCircle02Icon : Alert02Icon}
            className="size-4"
          />
          <span>
            Converted {status.ok} image{status.ok === 1 ? "" : "s"}
            {status.failed > 0 && `, ${status.failed} failed`}.
          </span>
        </div>
      )}

      {/* Preview table */}
      {files.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>Current name</TableHead>
                <TableHead className="w-32">Format</TableHead>
                <TableHead>New name</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((file, i) => {
                const error = errors[file.path];
                return (
                  <TableRow key={file.path}>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {file.name}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={file.format}
                        onValueChange={(v) =>
                          setFileFormat(file.path, v as TargetFormat)
                        }
                        disabled={isConverting}
                      >
                        <SelectTrigger size="sm" className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_FORMATS.map((f) => (
                            <SelectItem key={f} value={f}>
                              {f.toUpperCase()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {error ? (
                        <span className="text-destructive">{error}</span>
                      ) : (
                        file.newName
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => removeFile(file.path)}
                        disabled={isConverting}
                        aria-label={`Remove ${file.name}`}
                      >
                        <HugeiconsIcon icon={Cancel01Icon} />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
