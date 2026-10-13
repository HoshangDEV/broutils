import {
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Download04Icon,
  InformationCircleIcon,
  Loading03Icon,
  RefreshIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useEffect, useRef, useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  cancelDownload,
  downloadVideo,
  hostOf,
  installYtdlp,
  listenDone,
  listenProgress,
  parseUrls,
  QUALITIES,
  QUALITY_LABELS,
  QUALITY_TIP,
  updateYtdlp,
  ytdlpVersion,
  type DownloadItem,
  type DownloadQuality,
  type DownloadStatus,
} from "@/lib/download";
import { formatSize } from "@/lib/files";
import { cn } from "@/lib/utils";

let counter = 0;
const nextId = () => `download-${++counter}`;

const STATUS_BADGE: Record<DownloadStatus, string> = {
  pending: "bg-secondary text-muted-foreground",
  downloading: "bg-primary/15 text-primary",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-destructive/15 text-destructive",
  cancelled: "bg-secondary text-muted-foreground/60",
};

const STATUS_LABEL: Record<DownloadStatus, string> = {
  pending: "Waiting",
  downloading: "Downloading",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

const isRetryable = (s: DownloadStatus) => s === "error" || s === "cancelled";

/** yt-dlp state: undefined while checking, null when not downloaded yet. */
type ToolVersion = string | null | undefined;

export function DownloadVideos() {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [text, setText] = useState("");
  const [quality, setQuality] = useState<DownloadQuality>("compatible");
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [version, setVersion] = useState<ToolVersion>(undefined);
  const [toolBusy, setToolBusy] = useState<"installing" | "updating" | null>(
    null,
  );
  const [toolError, setToolError] = useState<string | null>(null);

  // Every change goes through `update`, so the ref is always current for the
  // queue loop and event handlers without waiting for a render.
  const itemsRef = useRef<DownloadItem[]>([]);
  const runningRef = useRef(false);
  const update = (fn: (prev: DownloadItem[]) => DownloadItem[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  };
  const patch = (id: string, changes: Partial<DownloadItem>) =>
    update((prev) => prev.map((i) => (i.id === id ? { ...i, ...changes } : i)));

  useEffect(() => {
    ytdlpVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") setOutputDir(selected);
  }

  function processItem(item: DownloadItem): Promise<void> {
    return new Promise((resolve) => {
      let unlisten: (() => void)[] = [];
      const finish = () => {
        unlisten.forEach((u) => u());
        resolve();
      };

      Promise.all([
        listenProgress(item.id, (p) => {
          const changes: Partial<DownloadItem> = {};
          if (p.percent != null) changes.progress = p.percent;
          if (p.title) changes.title = p.title;
          if (p.thumbnail) changes.thumbnail = p.thumbnail;
          patch(item.id, changes);
        }),
        listenDone(item.id, (done) => {
          // Skips a cancelled (or since retried/removed) item.
          const current = itemsRef.current.find((i) => i.id === item.id);
          if (current?.status === "downloading") {
            patch(item.id, {
              status: done.success ? "done" : "error",
              progress: done.success ? 100 : current.progress,
              path: done.path ?? undefined,
              size: done.size ?? undefined,
              error: done.error ?? undefined,
            });
          }
          finish();
        }),
      ]).then((fns) => {
        unlisten = fns;
        // Cancelled or removed while the listeners were being set up.
        const current = itemsRef.current.find((i) => i.id === item.id);
        if (current?.status !== "pending") return finish();

        patch(item.id, { status: "downloading", progress: 0 });
        downloadVideo({ id: item.id, url: item.url, quality, outputDir }).catch(
          (e: unknown) => {
            patch(item.id, { status: "error", error: String(e) });
            finish();
          },
        );
      });
    });
  }

  /** Works through every waiting link, setting up yt-dlp first if needed. */
  async function runQueue() {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setToolError(null);

    try {
      if (!version) {
        setToolBusy("installing");
        try {
          setVersion(await installYtdlp());
        } catch (e) {
          setToolError(`Couldn't download yt-dlp: ${String(e)}`);
          return;
        } finally {
          setToolBusy(null);
        }
      }

      // Links added or retried mid-run are picked up by the same loop.
      let doneCount = 0;
      let next: DownloadItem | undefined;
      while ((next = itemsRef.current.find((i) => i.status === "pending"))) {
        const id = next.id;
        await processItem(next);
        if (itemsRef.current.find((i) => i.id === id)?.status === "done") doneCount++;
      }

      if (doneCount > 0) {
        try {
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === "granted";
          if (granted) {
            sendNotification({
              title: "BroUtils",
              body: `${doneCount} video${doneCount > 1 ? "s" : ""} downloaded.`,
            });
          }
        } catch {
          // notifications are not critical
        }
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  function addLinks() {
    const known = new Set(
      itemsRef.current.filter((i) => i.status !== "done").map((i) => i.url),
    );
    const urls = parseUrls(text).filter((u) => !known.has(u));
    if (urls.length === 0) return;
    update((prev) => [
      ...prev,
      ...urls.map((url) => ({
        id: nextId(),
        url,
        status: "pending" as const,
        progress: 0,
      })),
    ]);
    setText("");
    runQueue();
  }

  async function cancelItem(id: string) {
    patch(id, { status: "cancelled" });
    try {
      await cancelDownload(id);
    } catch {
      // process may have already finished
    }
  }

  async function removeItem(id: string) {
    if (itemsRef.current.find((i) => i.id === id)?.status === "downloading") {
      await cancelItem(id);
    }
    update((prev) => prev.filter((i) => i.id !== id));
  }

  async function clearAll() {
    const active = itemsRef.current.filter((i) => i.status === "downloading");
    update(() => []);
    await Promise.allSettled(active.map((i) => cancelDownload(i.id)));
  }

  function retryItem(id: string) {
    patch(id, { status: "pending", progress: 0, error: undefined });
    runQueue();
  }

  async function updateTool() {
    setToolBusy("updating");
    setToolError(null);
    try {
      setVersion(await updateYtdlp());
    } catch (e) {
      setToolError(`Update failed: ${String(e)}`);
    } finally {
      setToolBusy(null);
    }
  }

  const linkCount = parseUrls(text).length;
  const donePaths = items
    .filter((i) => i.status === "done" && i.path)
    .map((i) => i.path as string);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Download Videos</h2>
        <p className="text-sm text-muted-foreground">
          Paste links from YouTube, TikTok, Instagram, Facebook, X and
          hundreds of other sites. Videos are saved as MP4 to your Downloads
          folder (or a chosen output folder).
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              addLinks();
            }
          }}
          placeholder={"Paste one or more links, one per line\nhttps://www.youtube.com/watch?v=…"}
          aria-label="Video links"
          autoComplete="off"
          spellCheck={false}
          className="max-h-48 min-h-20 font-mono text-xs md:text-xs"
        />
        <p className="text-xs text-muted-foreground">
          {linkCount > 0
            ? `${linkCount} link${linkCount === 1 ? "" : "s"} found · ⌘/Ctrl+Enter to download`
            : "Playlists download only the linked video."}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="download-quality">Quality</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground">
                    <HugeiconsIcon
                      icon={InformationCircleIcon}
                      className="size-3.5"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{QUALITY_TIP}</TooltipContent>
              </Tooltip>
            </div>
            <Select
              value={quality}
              onValueChange={(v) => setQuality(v as DownloadQuality)}
              disabled={running}
            >
              <SelectTrigger id="download-quality" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUALITIES.map((q) => (
                  <SelectItem key={q} value={q}>
                    {QUALITY_LABELS[q]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
                {outputDir ?? "Downloads"}
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

          <div className="ml-auto flex items-center gap-2">
            {donePaths.length > 0 && (
              <RevealButton paths={donePaths} label="Show in folder" />
            )}
            <Button variant="ghost" onClick={clearAll} disabled={items.length === 0}>
              Clear
            </Button>
            <Button onClick={addLinks} disabled={linkCount === 0 || toolBusy !== null}>
              <HugeiconsIcon icon={Download04Icon} />
              Download
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {toolBusy ? (
            <>
              <HugeiconsIcon icon={Loading03Icon} className="size-3.5 animate-spin" />
              {toolBusy === "installing"
                ? "Setting up yt-dlp (one-time download, ~30 MB)…"
                : "Updating yt-dlp…"}
            </>
          ) : version ? (
            <>
              Powered by yt-dlp {version}
              <span aria-hidden>·</span>
              <button
                onClick={updateTool}
                disabled={running}
                className="cursor-pointer underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
              >
                Check for update
              </button>
            </>
          ) : version === null ? (
            "yt-dlp (~30 MB) is downloaded the first time you use this tool."
          ) : null}
        </div>
        {toolError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <HugeiconsIcon icon={Alert02Icon} className="size-3.5 shrink-0" />
            {toolError}
          </p>
        )}
      </div>

      {items.length > 0 && (
        <div className="flex flex-col divide-y overflow-hidden rounded-lg border">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="relative flex aspect-video w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                <HugeiconsIcon icon={Video01Icon} className="size-4" />
                {item.thumbnail && (
                  <img
                    src={item.thumbnail}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 size-full object-cover"
                    onError={(e) => (e.currentTarget.hidden = true)}
                  />
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm" title={item.url}>
                    {item.title ?? item.url}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs",
                      STATUS_BADGE[item.status],
                    )}
                  >
                    {item.status === "downloading" && item.progress > 0
                      ? `${Math.round(item.progress)}%`
                      : STATUS_LABEL[item.status]}
                  </span>
                </div>

                {item.status === "downloading" ? (
                  <div className="h-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                ) : item.status === "error" && item.error ? (
                  <p
                    className="flex items-center gap-1.5 text-xs text-destructive"
                    title={item.error}
                  >
                    <HugeiconsIcon icon={Alert02Icon} className="size-3.5 shrink-0" />
                    <span className="truncate">{item.error}</span>
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {item.status === "done" && (
                      <HugeiconsIcon
                        icon={CheckmarkCircle02Icon}
                        className="size-3.5 text-emerald-600 dark:text-emerald-400"
                      />
                    )}
                    {hostOf(item.url)}
                    {item.size != null && ` · ${formatSize(item.size)}`}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center">
                {item.status === "downloading" ? (
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
                    {item.status === "done" && item.path && (
                      <RevealButton
                        paths={[item.path]}
                        aria-label={`Show ${item.title ?? "video"} in folder`}
                      />
                    )}
                    {isRetryable(item.status) && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => retryItem(item.id)}
                        aria-label="Retry"
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
