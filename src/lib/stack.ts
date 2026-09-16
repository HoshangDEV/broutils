import { invoke } from "@tauri-apps/api/core";

import { INPUT_EXTENSIONS, isSupportedImage } from "@/lib/convert";
import { basename, extensionOf } from "@/lib/files";

export { basename, INPUT_EXTENSIONS, isSupportedImage };

/** Formats the stacked result can be saved as. */
export const STACK_FORMATS = ["png", "jpg", "webp"] as const;
export type StackFormat = (typeof STACK_FORMATS)[number];

export const LOSSY_STACK_FORMATS = new Set<StackFormat>(["jpg", "webp"]);

/** Which image's width every other image is scaled to. */
export type MatchWidth = "widest" | "narrowest";

export const MATCH_WIDTH_LABELS: Record<MatchWidth, string> = {
  widest: "Widest image",
  narrowest: "Narrowest image",
};

/** Per-side pixel limits of the encoders; mirrors `check_output_size` in Rust. */
const FORMAT_MAX_DIMENSION: Partial<Record<StackFormat, number>> = {
  webp: 16_383,
  jpg: 65_535,
};

export type ImagePreview = {
  width: number;
  height: number;
  data_url: string;
};

export type StackResult = {
  path: string;
  width: number;
  height: number;
};

// Previews decode full-size images in Rust; cap how many run at once so a big
// drop doesn't hold dozens of decoded photos in memory together.
const PREVIEW_CONCURRENCY = 3;
let activePreviews = 0;
const previewQueue: Array<() => void> = [];

export async function imagePreview(path: string): Promise<ImagePreview> {
  if (activePreviews >= PREVIEW_CONCURRENCY) {
    await new Promise<void>((resolve) => previewQueue.push(resolve));
  }
  activePreviews++;
  try {
    return await invoke<ImagePreview>("image_preview", { path });
  } finally {
    activePreviews--;
    previewQueue.shift()?.();
  }
}

export function stackImages(
  paths: string[],
  outputPath: string,
  format: StackFormat,
  quality: number,
  matchWidth: MatchWidth,
): Promise<StackResult> {
  return invoke<StackResult>("stack_images", {
    paths,
    outputPath,
    format,
    quality,
    matchWidth,
  });
}

/** Height after scaling to `width`; mirrors `scaled_height` in Rust. */
export function scaledHeight(size: { width: number; height: number }, width: number): number {
  return Math.max(1, Math.round((size.height * width) / size.width));
}

/** Final stacked size, or `null` until every image's dimensions are known. */
export function stackSize(
  sizes: Array<{ width: number; height: number } | undefined>,
  matchWidth: MatchWidth,
): { width: number; height: number } | null {
  if (sizes.length === 0 || sizes.some((s) => !s)) return null;
  const known = sizes as Array<{ width: number; height: number }>;
  const widths = known.map((s) => s.width);
  const width = matchWidth === "narrowest" ? Math.min(...widths) : Math.max(...widths);
  const height = known.reduce((sum, s) => sum + scaledHeight(s, width), 0);
  return { width, height };
}

/** A user-facing reason the stack can't be saved in `format`, if any. */
export function formatLimitError(
  format: StackFormat,
  size: { width: number; height: number },
): string | null {
  const max = FORMAT_MAX_DIMENSION[format];
  if (!max || (size.width <= max && size.height <= max)) return null;
  return `${format.toUpperCase()} can't exceed ${max.toLocaleString()} px per side. Use PNG instead.`;
}

/**
 * Makes the save-dialog path agree with a format. A recognised extension the
 * user typed wins (and picks the format); otherwise the selected one is added.
 */
export function resolveOutput(
  path: string,
  format: StackFormat,
): { path: string; format: StackFormat } {
  const ext = extensionOf(basename(path))?.toLowerCase();
  if (ext === "jpeg") return { path, format: "jpg" };
  if (ext && (STACK_FORMATS as readonly string[]).includes(ext)) {
    return { path, format: ext as StackFormat };
  }
  return { path: `${path}.${format}`, format };
}
