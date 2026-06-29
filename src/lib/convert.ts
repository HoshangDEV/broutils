import { invoke } from "@tauri-apps/api/core";

import { basename, extensionOf } from "@/lib/files";

export { basename };

/** Output formats the Rust side can encode to. */
export const TARGET_FORMATS = [
  "jpg",
  "png",
  "webp",
  "avif",
  "gif",
  "bmp",
  "tiff",
  "ico",
] as const;

export type TargetFormat = (typeof TARGET_FORMATS)[number];

/** Extensions we can decode as input, including HEIC via libheif. */
export const INPUT_EXTENSIONS = [
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
];

/** Formats whose quality slider actually does something. */
export const LOSSY_FORMATS = new Set<TargetFormat>(["jpg", "webp", "avif"]);

export type ConvertItem = {
  path: string;
  format: TargetFormat;
};

export type ConvertResult = {
  old_path: string;
  new_path: string;
  new_name: string;
  ok: boolean;
  error: string | null;
};

/** True when the file looks like an image we can decode. */
export function isSupportedImage(name: string): boolean {
  const ext = extensionOf(name)?.toLowerCase();
  return ext !== undefined && ext !== null && INPUT_EXTENSIONS.includes(ext);
}

/** Filename stem (everything before the final extension). */
function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * Preview the output name for a file at a given 1-based index.
 * Mirrors the Rust `convert_images` naming so the table matches the result.
 */
export function previewName(
  originalName: string,
  format: TargetFormat,
  base: string,
  index: number,
): string {
  const trimmed = base.trim();
  const stem = trimmed ? `${trimmed}-${index}` : stemOf(originalName);
  return `${stem}.${format}`;
}

export function convertImages(
  items: ConvertItem[],
  baseName: string,
  quality: number,
  deleteOriginals: boolean,
): Promise<ConvertResult[]> {
  return invoke<ConvertResult[]>("convert_images", {
    items,
    baseName,
    quality,
    deleteOriginals,
  });
}
