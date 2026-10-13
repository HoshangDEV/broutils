import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type DownloadQuality = "compatible" | "best" | "1080" | "720";

export type DownloadStatus =
  | "pending"
  | "downloading"
  | "done"
  | "error"
  | "cancelled";

export interface DownloadItem {
  id: string;
  url: string;
  /** Video title, known once yt-dlp has read the page. */
  title?: string;
  thumbnail?: string;
  status: DownloadStatus;
  progress: number;
  /** Saved file, set when the download finishes. */
  path?: string;
  size?: number;
  error?: string;
}

export const QUALITIES: DownloadQuality[] = ["compatible", "best", "1080", "720"];

export const QUALITY_LABELS: Record<DownloadQuality, string> = {
  compatible: "Compatible (H.264)",
  best: "Best quality",
  "1080": "Up to 1080p",
  "720": "Up to 720p",
};

export const QUALITY_TIP =
  "Compatible picks H.264 video that plays everywhere (QuickTime, WhatsApp, phones). Best quality may pick VP9 or AV1, which some players can't open.";

/**
 * Pulls http(s) links out of pasted text — one per line, or separated by
 * spaces/commas — and drops duplicates, keeping the first occurrence.
 */
export function parseUrls(text: string): string[] {
  const links = text.match(/https?:\/\/[^\s,;"'<>]+/gi) ?? [];
  return [...new Set(links)];
}

/** `www.youtube.com/watch?v=…` → `youtube.com`, for a compact row subtitle. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ytdlpVersion(): Promise<string | null> {
  return invoke<string | null>("ytdlp_version");
}

export function installYtdlp(): Promise<string> {
  return invoke<string>("ytdlp_install");
}

export function updateYtdlp(): Promise<string> {
  return invoke<string>("ytdlp_update");
}

export function downloadVideo(args: {
  id: string;
  url: string;
  quality: DownloadQuality;
  outputDir: string | null;
}): Promise<void> {
  return invoke("download_video", { ...args });
}

export function cancelDownload(id: string): Promise<void> {
  return invoke("cancel_download", { id });
}

export interface ProgressPayload {
  percent: number | null;
  title: string | null;
  thumbnail: string | null;
}

export interface DonePayload {
  success: boolean;
  error: string | null;
  path: string | null;
  size: number | null;
}

export function listenProgress(
  id: string,
  cb: (payload: ProgressPayload) => void,
): Promise<UnlistenFn> {
  return listen<ProgressPayload>(`download://progress/${id}`, (e) =>
    cb(e.payload),
  );
}

export function listenDone(
  id: string,
  cb: (payload: DonePayload) => void,
): Promise<UnlistenFn> {
  return listen<DonePayload>(`download://done/${id}`, (e) => cb(e.payload));
}
