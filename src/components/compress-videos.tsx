import {
  Alert02Icon,
  ArrowShrink02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Film01Icon,
  InformationCircleIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useCallback, useEffect, useRef, useState } from "react";

import { DropZone } from "@/components/shared/drop-zone";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildOutputPath,
  cancelCompression,
  CODEC_LABELS,
  compressVideo,
  deriveEncoder,
  detectGpuEncoders,
  encoderLabel,
  FORMAT_LABELS,
  getFileSize,
  gpuAvailableForCodec,
  isSupportedVideo,
  listenDone,
  listenProgress,
  OUTPUT_FORMATS,
  QUALITY_MODE_LABELS,
  QUALITY_MODES,
  QUALITY_TIPS,
  VIDEO_CODECS,
  VIDEO_EXTENSIONS,
  type OutputFormat,
  type QualityMode,
  type VideoCodec,
  type VideoItem,
  type VideoStatus,
} from "@/lib/compress";
import { basename, formatSize } from "@/lib/files";
import { cn } from "@/lib/utils";

let counter = 0;
const nextId = () => `video-${++counter}`;

const STATUS_BADGE: Record<VideoStatus, string> = {
  pending: "bg-secondary text-muted-foreground",
  compressing: "bg-primary/15 text-primary",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-destructive/15 text-destructive",
  cancelled: "bg-secondary text-muted-foreground/60",
};

const STATUS_LABEL: Record<VideoStatus, string> = {
  pending: "Pending",
  compressing: "Compressing",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

const isResettable = (s: VideoStatus) =>
  s === "done" || s === "error" || s === "cancelled";

const toPending = (i: VideoItem): VideoItem => ({
  ...i,
  status: "pending",
  progress: 0,
  outputSize: undefined,
  error: undefined,
});

export function CompressVideos() {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [qualityMode, setQualityMode] = useState<QualityMode>("crf");
  const [crf, setCrf] = useState(24);
  const [bitrate, setBitrate] = useState(2000);
  const [targetSizeMb, setTargetSizeMb] = useState(10);
  const [videoCodec, setVideoCodec] = useState<VideoCodec>("h264");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp4");
  const [useGpu, setUseGpu] = useState(false);
  const [suffix, setSuffix] = useState("-compressed");
  const [renameBase, setRenameBase] = useState("");
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [gpuEncoders, setGpuEncoders] = useState<string[]>([]);

  const itemsRef = useRef<VideoItem[]>(items);
  // Mirror the latest items so async handlers read fresh state without deps.
  useEffect(() => {
    itemsRef.current = items;
  });

  useEffect(() => {
    detectGpuEncoders()
      .then(setGpuEncoders)
      .catch(() => {});
  }, []);

  const addFiles = useCallback(async (paths: string[]) => {
    const known = new Set(itemsRef.current.map((i) => i.inputPath));
    const newItems: VideoItem[] = [];
    for (const path of paths) {
      if (known.has(path)) continue;
      known.add(path);
      let inputSize = 0;
      try {
        inputSize = await getFileSize(path);
      } catch {
        // non-critical
      }
      newItems.push({
        id: nextId(),
        inputPath: path,
        fileName: basename(path),
        inputSize,
        status: "pending",
        progress: 0,
      });
    }
    if (newItems.length) setItems((prev) => [...prev, ...newItems]);
  }, []);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setOutputDir(selected);
  }

  async function cancelItem(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "cancelled" } : i)),
    );
    try {
      await cancelCompression(id);
    } catch {
      // process may have already finished
    }
  }

  async function removeItem(id: string) {
    const item = itemsRef.current.find((i) => i.id === id);
    if (item?.status === "compressing") {
      try {
        await cancelCompression(id);
      } catch {
        // ignore
      }
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function clearAll() {
    const compressing = itemsRef.current.filter(
      (i) => i.status === "compressing",
    );
    await Promise.allSettled(compressing.map((i) => cancelCompression(i.id)));
    setItems([]);
  }

  function resetItem(id: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id && isResettable(i.status) ? toPending(i) : i)),
    );
  }

  function resetAll() {
    setItems((prev) => prev.map((i) => (isResettable(i.status) ? toPending(i) : i)));
  }

  function processItem(item: VideoItem, outputPath: string): Promise<void> {
    return new Promise((resolve) => {
      let unlistenProgress: (() => void) | undefined;
      let unlistenDone: (() => void) | undefined;
      const cleanup = () => {
        unlistenProgress?.();
        unlistenDone?.();
      };

      Promise.all([
        listenProgress(item.id, (percent) => {
          setItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, progress: percent } : i)),
          );
        }),
        listenDone(item.id, (payload) => {
          setItems((prev) =>
            prev.map((i) => {
              if (i.id !== item.id || i.status === "cancelled") return i;
              return {
                ...i,
                status: payload.success ? "done" : "error",
                progress: payload.success ? 100 : i.progress,
                outputSize: payload.output_size ?? undefined,
                error: payload.error ?? undefined,
              };
            }),
          );
          cleanup();
          resolve();
        }),
      ]).then(([up, ud]) => {
        unlistenProgress = up;
        unlistenDone = ud;
      });

      const current = itemsRef.current.find((i) => i.id === item.id);
      if (current?.status === "cancelled") {
        cleanup();
        resolve();
        return;
      }

      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, status: "compressing" } : i)),
      );

      const encoder = deriveEncoder(videoCodec, useGpu, gpuEncoders);

      compressVideo({
        id: item.id,
        inputPath: item.inputPath,
        outputPath,
        crf,
        bitrate: qualityMode === "bitrate" ? bitrate : null,
        encoder,
        targetSizeMb: qualityMode === "target-size" ? targetSizeMb : null,
      }).catch((e: unknown) => {
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, status: "error", error: String(e) }
              : i,
          ),
        );
        cleanup();
        resolve();
      });
    });
  }

  async function compressAll() {
    if (running) return;
    setRunning(true);

    const pending = itemsRef.current.filter((i) => i.status === "pending");
    let renameIdx = 0;
    for (const item of pending) {
      renameIdx++;
      const outputPath = buildOutputPath(
        item.inputPath,
        suffix,
        outputDir,
        outputFormat,
        renameBase || undefined,
        renameBase ? renameIdx : undefined,
      );
      await processItem(item, outputPath);
    }

    const doneCount = itemsRef.current.filter((i) => i.status === "done").length;
    if (doneCount > 0) {
      try {
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (granted) {
          sendNotification({
            title: "BroUtils",
            body: `${doneCount} video${doneCount > 1 ? "s" : ""} compressed.`,
          });
        }
      } catch {
        // notifications are not critical
      }
    }

    setRunning(false);
  }

  const hasFiles = items.length > 0;
  const hasPending = items.some((i) => i.status === "pending");
  const gpuOn = useGpu && gpuAvailableForCodec(videoCodec, gpuEncoders);
  const effectiveEncoder = deriveEncoder(videoCodec, useGpu, gpuEncoders);

  const valueControl =
    qualityMode === "crf" ? (
      <div className="flex items-center gap-3">
        <Slider
          min={0}
          max={51}
          value={[crf]}
          onValueChange={([v]) => setCrf(v)}
          className="w-40"
        />
        <span className="w-6 text-center font-mono text-sm tabular-nums">
          {crf}
        </span>
      </div>
    ) : qualityMode === "bitrate" ? (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={100}
          step={100}
          value={bitrate}
          onChange={(e) => setBitrate(Math.max(100, Number(e.target.value) || 0))}
          className="w-28"
        />
        <span className="text-sm text-muted-foreground">kbps</span>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          step={1}
          value={targetSizeMb}
          onChange={(e) =>
            setTargetSizeMb(Math.max(1, Number(e.target.value) || 0))
          }
          className="w-28"
        />
        <span className="text-sm text-muted-foreground">MB</span>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Compress Videos</h2>
          <p className="text-sm text-muted-foreground">
            Drop videos, pick a quality target, and they&apos;re re-encoded with
            FFmpeg into the same folder (or a chosen output folder).
          </p>
        </div>

        <DropZone
          onFiles={addFiles}
          icon={Film01Icon}
          title="Drag & drop videos here"
          buttonLabel="Select Videos"
          disabled={running}
          accept={isSupportedVideo}
          dialogFilters={[
            { name: "Video", extensions: [...VIDEO_EXTENSIONS] },
          ]}
          hint={
            hasFiles
              ? `${items.length} video${items.length === 1 ? "" : "s"} queued`
              : VIDEO_EXTENSIONS.join(" · ")
          }
        />

        {/* Controls */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="quality-mode">Quality</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground">
                      <HugeiconsIcon
                        icon={InformationCircleIcon}
                        className="size-3.5"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    {QUALITY_TIPS[qualityMode]}
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select
                value={qualityMode}
                onValueChange={(v) => setQualityMode(v as QualityMode)}
                disabled={running}
              >
                <SelectTrigger id="quality-mode" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {QUALITY_MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{QUALITY_MODE_LABELS[qualityMode]}</Label>
              <div className="flex h-9 items-center">{valueControl}</div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="codec">Codec</Label>
              <Select
                value={videoCodec}
                onValueChange={(v) => setVideoCodec(v as VideoCodec)}
                disabled={running}
              >
                <SelectTrigger id="codec" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIDEO_CODECS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CODEC_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="format">Format</Label>
              <Select
                value={outputFormat}
                onValueChange={(v) => setOutputFormat(v as OutputFormat)}
                disabled={running}
              >
                <SelectTrigger id="format" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FORMAT_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {gpuAvailableForCodec(videoCodec, gpuEncoders) && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="use-gpu">Encoder</Label>
                <div className="flex h-9 items-center gap-2">
                  <Switch
                    id="use-gpu"
                    checked={gpuOn}
                    onCheckedChange={setUseGpu}
                    disabled={running}
                  />
                  <span className="text-sm text-muted-foreground">
                    {gpuOn ? encoderLabel(effectiveEncoder) : "CPU"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <Label>Output folder</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={pickFolder}
                  disabled={running}
                  className="max-w-56 justify-start truncate font-normal"
                >
                  {outputDir ?? "Same as source"}
                </Button>
                {outputDir && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setOutputDir(null)}
                    disabled={running}
                    aria-label="Reset output folder"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} />
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="rename-base">Rename (optional)</Label>
              <Input
                id="rename-base"
                placeholder="e.g. clip → clip-1.mp4"
                value={renameBase}
                onChange={(e) => setRenameBase(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={running}
              />
            </div>

            <div
              className={cn(
                "flex flex-col gap-2 transition-opacity",
                renameBase.trim() && "pointer-events-none opacity-40",
              )}
            >
              <Label htmlFor="suffix">Suffix</Label>
              <Input
                id="suffix"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                disabled={running || renameBase.trim().length > 0}
                className="w-40"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={resetAll}
              disabled={running || !items.some((i) => isResettable(i.status))}
            >
              <HugeiconsIcon icon={RefreshIcon} />
              Reset all
            </Button>
            <Button
              variant="ghost"
              onClick={clearAll}
              disabled={!hasFiles}
            >
              Clear
            </Button>
            <Button onClick={compressAll} disabled={running || !hasPending}>
              <HugeiconsIcon icon={ArrowShrink02Icon} />
              {running ? "Compressing…" : "Compress all"}
            </Button>
          </div>
        </div>

        {/* Queue */}
        {hasFiles && (
          <div className="flex flex-col divide-y overflow-hidden rounded-lg border">
            {items.map((item) => {
              const reduction =
                item.outputSize && item.inputSize
                  ? ((item.inputSize - item.outputSize) / item.inputSize) * 100
                  : null;
              return (
                <div key={item.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {item.fileName}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatSize(item.inputSize)}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs",
                        STATUS_BADGE[item.status],
                      )}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>
                    {item.status === "compressing" ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => cancelItem(item.id)}
                        aria-label="Cancel"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} />
                      </Button>
                    ) : (
                      <>
                        {isResettable(item.status) && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => resetItem(item.id)}
                            disabled={running}
                            aria-label="Reset"
                          >
                            <HugeiconsIcon icon={RefreshIcon} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => removeItem(item.id)}
                          aria-label="Remove"
                        >
                          <HugeiconsIcon icon={Cancel01Icon} />
                        </Button>
                      </>
                    )}
                  </div>

                  {item.status === "compressing" && (
                    <div className="h-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}

                  {item.status === "done" && item.outputSize != null && (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                      <HugeiconsIcon
                        icon={CheckmarkCircle02Icon}
                        className="size-3.5"
                      />
                      {formatSize(item.outputSize)}
                      {reduction != null &&
                        reduction > 0 &&
                        ` · ${reduction.toFixed(1)}% smaller`}
                    </p>
                  )}

                  {item.status === "error" && item.error && (
                    <p className="flex items-center gap-1.5 truncate text-xs text-destructive">
                      <HugeiconsIcon icon={Alert02Icon} className="size-3.5" />
                      {item.error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
