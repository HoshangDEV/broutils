mod compress;

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use image::{DynamicImage, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct RenameResult {
    old_path: String,
    new_path: String,
    new_name: String,
    ok: bool,
    error: Option<String>,
}

/// Renames the given files in place (same folder) to `{base_name}-{index}.{ext}`.
/// Index starts at 1 and follows the order of the incoming `paths` array.
/// The original extension is preserved; files without an extension stay extension-less.
#[tauri::command]
fn rename_files(paths: Vec<String>, base_name: String) -> Vec<RenameResult> {
    let base = base_name.trim();

    paths
        .iter()
        .enumerate()
        .map(|(i, old_path)| {
            let index = i + 1;
            let src = Path::new(old_path);

            let ext = src.extension().and_then(|e| e.to_str());
            let new_name = match ext {
                Some(ext) => format!("{base}-{index}.{ext}"),
                None => format!("{base}-{index}"),
            };

            let parent = src.parent().unwrap_or_else(|| Path::new(""));
            let dst = parent.join(&new_name);

            // No-op when the target name already matches the source.
            if dst == src {
                return RenameResult {
                    old_path: old_path.clone(),
                    new_path: dst.to_string_lossy().into_owned(),
                    new_name,
                    ok: true,
                    error: None,
                };
            }

            if dst.exists() {
                return RenameResult {
                    old_path: old_path.clone(),
                    new_path: dst.to_string_lossy().into_owned(),
                    new_name,
                    ok: false,
                    error: Some("a file with that name already exists".into()),
                };
            }

            match std::fs::rename(src, &dst) {
                Ok(()) => RenameResult {
                    old_path: old_path.clone(),
                    new_path: dst.to_string_lossy().into_owned(),
                    new_name,
                    ok: true,
                    error: None,
                },
                Err(e) => RenameResult {
                    old_path: old_path.clone(),
                    new_path: dst.to_string_lossy().into_owned(),
                    new_name,
                    ok: false,
                    error: Some(e.to_string()),
                },
            }
        })
        .collect()
}

/// One file to convert, with its own chosen target format. Letting each item
/// carry its own `format` is what makes per-file overrides possible — a bulk
/// "convert all to X" just sends the same format on every item.
#[derive(Deserialize)]
struct ConvertItem {
    path: String,
    /// Target format extension, e.g. "jpg", "png", "webp", "avif".
    format: String,
}

#[derive(Serialize)]
struct ConvertResult {
    old_path: String,
    new_path: String,
    new_name: String,
    ok: bool,
    error: Option<String>,
}

/// Converts each image to its chosen target format, written into the same
/// folder as the source.
///
/// - `base_name`: when non-empty, outputs are named `{base}-{index}.{ext}`
///   (index is 1-based, following the incoming order). When empty, the original
///   file stem is kept and only the extension changes.
/// - `quality`: 1–100, used by the lossy encoders (JPEG / WebP / AVIF) and
///   ignored by the lossless ones.
/// - `delete_originals`: when true, the source file is removed after a
///   successful conversion (skipped if the output would be the same file).
#[tauri::command]
fn convert_images(
    items: Vec<ConvertItem>,
    base_name: String,
    quality: u8,
    delete_originals: bool,
) -> Vec<ConvertResult> {
    let base = base_name.trim();

    items
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let index = i + 1;
            let src = Path::new(&item.path);
            let ext = output_extension(&item.format);

            let stem = if base.is_empty() {
                src.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("image")
                    .to_string()
            } else {
                format!("{base}-{index}")
            };
            let new_name = format!("{stem}.{ext}");

            let parent = src.parent().unwrap_or_else(|| Path::new(""));
            let dst = parent.join(&new_name);
            let new_path = dst.to_string_lossy().into_owned();

            // Refuse to clobber a different, pre-existing file.
            if dst.exists() && dst != src {
                return ConvertResult {
                    old_path: item.path.clone(),
                    new_path,
                    new_name,
                    ok: false,
                    error: Some("a file with that name already exists".into()),
                };
            }

            match convert_one(src, &dst, &item.format, quality) {
                Ok(()) => {
                    if delete_originals && src != dst {
                        let _ = std::fs::remove_file(src);
                    }
                    ConvertResult {
                        old_path: item.path.clone(),
                        new_path,
                        new_name,
                        ok: true,
                        error: None,
                    }
                }
                Err(e) => ConvertResult {
                    old_path: item.path.clone(),
                    new_path,
                    new_name,
                    ok: false,
                    error: Some(e),
                },
            }
        })
        .collect()
}

/// Maps a requested format to the file extension we write.
fn output_extension(format: &str) -> &'static str {
    match format.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "jpg",
        "png" => "png",
        "webp" => "webp",
        "gif" => "gif",
        "bmp" => "bmp",
        "tiff" | "tif" => "tiff",
        "ico" => "ico",
        "avif" => "avif",
        _ => "png",
    }
}

/// Loads an image, routing HEIC/HEIF through libheif and everything else
/// through the `image` crate's auto-detecting reader.
fn load_image(src: &Path) -> Result<DynamicImage, String> {
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());

    match ext.as_deref() {
        #[cfg(not(target_os = "windows"))]
        Some("heic") | Some("heif") => decode_heic(src),
        #[cfg(target_os = "windows")]
        Some("heic") | Some("heif") => {
            Err("HEIC/HEIF input is not supported on Windows".to_string())
        }
        _ => ImageReader::open(src)
            .map_err(|e| e.to_string())?
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .decode()
            .map_err(|e| e.to_string()),
    }
}

/// Decodes a HEIC/HEIF file to an RGB8 image using system libheif.
#[cfg(not(target_os = "windows"))]
fn decode_heic(src: &Path) -> Result<DynamicImage, String> {
    use libheif_rs::{ColorSpace, HeifContext, LibHeif, RgbChroma};

    let path = src.to_str().ok_or("path is not valid UTF-8")?;
    let lib_heif = LibHeif::new();
    let ctx = HeifContext::read_from_file(path).map_err(|e| e.to_string())?;
    let handle = ctx.primary_image_handle().map_err(|e| e.to_string())?;
    let decoded = lib_heif
        .decode(&handle, ColorSpace::Rgb(RgbChroma::Rgb), None)
        .map_err(|e| e.to_string())?;

    let planes = decoded.planes();
    let plane = planes
        .interleaved
        .ok_or("HEIC image has no interleaved RGB plane")?;

    let width = plane.width as usize;
    let height = plane.height as usize;
    let stride = plane.stride;
    let row_bytes = width * 3;

    // libheif rows are padded to `stride`; repack into a tight RGB buffer.
    let mut buf = Vec::with_capacity(width * height * 3);
    for y in 0..height {
        let start = y * stride;
        buf.extend_from_slice(&plane.data[start..start + row_bytes]);
    }

    image::RgbImage::from_raw(width as u32, height as u32, buf)
        .map(DynamicImage::ImageRgb8)
        .ok_or_else(|| "failed to build image from HEIC pixels".into())
}

/// Converts the image at `src` into `dst` in the requested format.
///
/// Encoding goes to a temporary sibling file that is renamed over `dst` only on
/// success. This keeps an in-place conversion (`src == dst`) from truncating the
/// source before it is read, and never leaves a half-written output behind if
/// encoding fails.
fn convert_one(src: &Path, dst: &Path, format: &str, quality: u8) -> Result<(), String> {
    let img = load_image(src)?;
    let fmt = format.to_ascii_lowercase();
    let tmp = temp_path(dst);

    match encode_image(img, &tmp, &fmt, quality) {
        Ok(()) => std::fs::rename(&tmp, dst).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            e.to_string()
        }),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// A temporary sibling path next to `dst`, used to stage the encoded output.
fn temp_path(dst: &Path) -> PathBuf {
    let mut name = dst
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(format!(".{}.tmp", std::process::id()));
    dst.with_file_name(name)
}

/// Encodes `img` to `out` in the requested format, flushing before returning so
/// buffered-write failures surface instead of being swallowed on drop.
fn encode_image(img: DynamicImage, out: &Path, fmt: &str, quality: u8) -> Result<(), String> {
    // WebP needs the libwebp-backed encoder for a lossy quality knob.
    if fmt == "webp" {
        let rgba = img.to_rgba8();
        let encoder = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height());
        let mem = encoder.encode(quality as f32);
        return std::fs::write(out, &*mem).map_err(|e| e.to_string());
    }

    let file = File::create(out).map_err(|e| e.to_string())?;
    let mut writer = BufWriter::new(file);

    match fmt {
        "jpg" | "jpeg" => {
            // JPEG has no alpha channel; flatten to RGB first.
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, quality);
            DynamicImage::ImageRgb8(img.to_rgb8())
                .write_with_encoder(encoder)
                .map_err(|e| e.to_string())?;
        }
        "avif" => {
            // speed 1–10 (higher = faster, lower quality/efficiency); 6 is a
            // reasonable interactive default.
            let encoder =
                image::codecs::avif::AvifEncoder::new_with_speed_quality(&mut writer, 6, quality);
            img.write_with_encoder(encoder).map_err(|e| e.to_string())?;
        }
        "png" => img
            .write_to(&mut writer, ImageFormat::Png)
            .map_err(|e| e.to_string())?,
        "gif" => img
            .write_to(&mut writer, ImageFormat::Gif)
            .map_err(|e| e.to_string())?,
        "bmp" => img
            .write_to(&mut writer, ImageFormat::Bmp)
            .map_err(|e| e.to_string())?,
        "tiff" | "tif" => img
            .write_to(&mut writer, ImageFormat::Tiff)
            .map_err(|e| e.to_string())?,
        "ico" => img
            .write_to(&mut writer, ImageFormat::Ico)
            .map_err(|e| e.to_string())?,
        other => return Err(format!("unsupported target format: {other}")),
    }

    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(compress::CompressState::default())
        .invoke_handler(tauri::generate_handler![
            rename_files,
            convert_images,
            compress::compress_video,
            compress::cancel_compression,
            compress::get_file_size,
            compress::detect_gpu_encoders,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
