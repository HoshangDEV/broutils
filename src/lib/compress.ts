import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { basename, extensionOf } from "@/lib/files";

export type QualityMode = "crf" | "bitrate" | "target-size";
export type VideoCodec = "h264" | "h265" | "vp9" | "av1";
export type OutputFormat = "mp4" | "mkv" | "mov" | "webm";

export type VideoStatus =
  | "pending"
  | "compressing"
  | "done"
  | "error"
  | "cancelled";

export interface VideoItem {
  id: string;
  inputPath: string;
  fileName: string;
  inputSize: number;
  status: VideoStatus;
  progress: number;
  outputSize?: number;
  error?: string;
}

export const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "avi", "webm"] as const;

export function isSupportedVideo(name: string): boolean {
  const ext = extensionOf(name)?.toLowerCase();
  return !!ext && (VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

export const QUALITY_MODES: QualityMode[] = ["crf", "bitrate", "target-size"];
export const VIDEO_CODECS: VideoCodec[] = ["h264", "h265", "vp9", "av1"];
export const OUTPUT_FORMATS: OutputFormat[] = ["mp4", "mkv", "mov", "webm"];

export const QUALITY_MODE_LABELS: Record<QualityMode, string> = {
  crf: "CRF",
  bitrate: "Bitrate",
  "target-size": "Target size",
};

export const CODEC_LABELS: Record<VideoCodec, string> = {
  h264: "H.264",
  h265: "H.265",
  vp9: "VP9",
  av1: "AV1",
};

export const FORMAT_LABELS: Record<OutputFormat, string> = {
  mp4: "MP4",
  mkv: "MKV",
  mov: "MOV",
  webm: "WebM",
};

export const QUALITY_TIPS: Record<QualityMode, string> = {
  crf: "CRF controls quality vs. file size. Lower = better quality & larger file. 18–28 is the sweet spot for most videos.",
  bitrate:
    "Target bitrate in kbps. Higher = better quality & larger file. 1000–4000 kbps covers most use cases; 8000+ for near-lossless.",
  "target-size":
    "Compress to approximately a target file size. Audio is re-encoded at 128 kbps; the rest of the budget goes to video. Result may vary ±10%.",
};

const CPU_ENCODER: Record<VideoCodec, string> = {
  h264: "libx264",
  h265: "libx265",
  vp9: "libvpx-vp9",
  av1: "libaom-av1",
};

const GPU_ENCODER_MAP: Record<VideoCodec, string[]> = {
  h264: ["h264_videotoolbox", "h264_nvenc", "h264_amf"],
  h265: ["hevc_videotoolbox", "hevc_nvenc", "hevc_amf"],
  vp9: [],
  av1: [],
};

const ENCODER_LABELS: Record<string, string> = {
  h264_videotoolbox: "VideoToolbox H.264",
  h264_nvenc: "NVIDIA H.264",
  h264_amf: "AMD H.264",
  hevc_videotoolbox: "VideoToolbox H.265",
  hevc_nvenc: "NVIDIA H.265",
  hevc_amf: "AMD H.265",
};

/** Picks the GPU encoder for a codec when requested and available, else CPU. */
export function deriveEncoder(
  codec: VideoCodec,
  useGpu: boolean,
  availableGpuEncoders: string[],
): string {
  if (useGpu) {
    const found = GPU_ENCODER_MAP[codec].find((c) =>
      availableGpuEncoders.includes(c),
    );
    if (found) return found;
  }
  return CPU_ENCODER[codec];
}

export function gpuAvailableForCodec(
  codec: VideoCodec,
  availableGpuEncoders: string[],
): boolean {
  return GPU_ENCODER_MAP[codec].some((c) => availableGpuEncoders.includes(c));
}

export function encoderLabel(encoder: string): string {
  return ENCODER_LABELS[encoder] ?? encoder;
}

/**
 * Builds the destination path for an output file. When `renameBase` is set the
 * file becomes `{base}-{index}.{format}`; otherwise the original stem is kept
 * with `suffix` appended. `outputDir` overrides the source folder when set.
 */
export function buildOutputPath(
  inputPath: string,
  suffix: string,
  outputDir: string | null,
  outputFormat: OutputFormat,
  renameBase?: string,
  renameIndex?: number,
): string {
  const parts = inputPath.split("/");
  const filename = parts[parts.length - 1];
  const dot = filename.lastIndexOf(".");
  const name = dot >= 0 ? filename.slice(0, dot) : filename;
  const outFilename =
    renameBase && renameIndex !== undefined
      ? `${renameBase}-${renameIndex}.${outputFormat}`
      : `${name}${suffix}.${outputFormat}`;
  const dir = outputDir ?? parts.slice(0, -1).join("/");
  return `${dir}/${outFilename}`;
}

export interface DonePayload {
  success: boolean;
  error: string | null;
  output_size: number | null;
}

export function detectGpuEncoders(): Promise<string[]> {
  return invoke<string[]>("detect_gpu_encoders");
}

export function getFileSize(path: string): Promise<number> {
  return invoke<number>("get_file_size", { path });
}

export function cancelCompression(id: string): Promise<void> {
  return invoke("cancel_compression", { id });
}

export interface CompressArgs {
  id: string;
  inputPath: string;
  outputPath: string;
  crf: number;
  bitrate: number | null;
  encoder: string;
  targetSizeMb: number | null;
}

export function compressVideo(args: CompressArgs): Promise<void> {
  // Spread into a fresh literal so it satisfies invoke's Record arg type.
  return invoke("compress_video", { ...args });
}

export function listenProgress(
  id: string,
  cb: (percent: number) => void,
): Promise<UnlistenFn> {
  return listen<{ percent: number }>(`compress://progress/${id}`, (e) =>
    cb(e.payload.percent),
  );
}

export function listenDone(
  id: string,
  cb: (payload: DonePayload) => void,
): Promise<UnlistenFn> {
  return listen<DonePayload>(`compress://done/${id}`, (e) => cb(e.payload));
}

export { basename };
