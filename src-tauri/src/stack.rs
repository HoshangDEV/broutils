use std::path::Path;

use base64::Engine;
use image::metadata::Orientation;
use image::{imageops, DynamicImage, ImageDecoder, ImageReader, RgbaImage};
use serde::Serialize;

use crate::{encode_image, load_image, temp_path};

/// Longest edge budget for the in-app thumbnail. Wide enough to look sharp in
/// the preview column on a 2x display; tall enough for long screenshots.
const PREVIEW_MAX_WIDTH: u32 = 640;
const PREVIEW_MAX_HEIGHT: u32 = 16_383;

/// WebP stores each dimension in 14 bits.
const WEBP_MAX_DIMENSION: u32 = 16_383;
/// JPEG stores each dimension in 16 bits.
const JPEG_MAX_DIMENSION: u32 = 65_535;
/// Refuse canvases past ~2 GB of RGBA so a huge stack fails cleanly instead of
/// aborting the app on allocation.
const MAX_PIXELS: u64 = 500_000_000;

#[derive(Serialize)]
pub struct ImagePreview {
    /// Upright dimensions of the original image (after EXIF rotation).
    width: u32,
    height: u32,
    /// Downscaled WebP thumbnail as a `data:` URL, ready for an `<img>`.
    data_url: String,
}

#[derive(Serialize)]
pub struct StackResult {
    path: String,
    width: u32,
    height: u32,
}

/// Decodes an image and returns its real dimensions plus a small thumbnail.
/// Decoding goes through Rust (not the webview) so HEIC previews work too.
#[tauri::command]
pub async fn image_preview(path: String) -> Result<ImagePreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let img = load_upright(Path::new(&path))?;
        let (width, height) = (img.width(), img.height());

        let thumb = img
            .thumbnail(PREVIEW_MAX_WIDTH, PREVIEW_MAX_HEIGHT)
            .to_rgba8();
        let webp = webp::Encoder::from_rgba(thumb.as_raw(), thumb.width(), thumb.height())
            .encode(80.0);
        let data_url = format!(
            "data:image/webp;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&*webp)
        );

        Ok(ImagePreview {
            width,
            height,
            data_url,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stacks the images top-to-bottom, in the given order, into one image at
/// `output_path`.
///
/// Every image is first scaled (aspect ratio kept) to a shared width:
/// - `match_width = "widest"`: smaller images are enlarged to the widest one.
/// - `match_width = "narrowest"`: larger images are shrunk to the narrowest one.
///
/// `output_path` comes from a native save dialog, so an existing file there is
/// overwritten — the dialog already asked the user.
#[tauri::command]
pub async fn stack_images(
    paths: Vec<String>,
    output_path: String,
    format: String,
    quality: u8,
    match_width: String,
) -> Result<StackResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        stack_blocking(&paths, &output_path, &format, quality, &match_width)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn stack_blocking(
    paths: &[String],
    output_path: &str,
    format: &str,
    quality: u8,
    match_width: &str,
) -> Result<StackResult, String> {
    if paths.len() < 2 {
        return Err("add at least two images to stack".into());
    }

    let images = paths
        .iter()
        .map(|p| {
            load_upright(Path::new(p)).map_err(|e| format!("{}: {e}", file_name(p)))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let widths = images.iter().map(|img| img.width());
    let width = match match_width {
        "narrowest" => widths.min(),
        _ => widths.max(),
    }
    .ok_or("no images to stack")?;

    let heights: Vec<u32> = images
        .iter()
        .map(|img| scaled_height(img, width))
        .collect::<Result<_, _>>()?;
    let total: u64 = heights.iter().map(|&h| u64::from(h)).sum();
    let height = u32::try_from(total).map_err(|_| "the stacked image is too tall".to_string())?;

    check_output_size(format, width, height)?;

    let mut canvas = RgbaImage::new(width, height);
    let mut y: i64 = 0;
    for (img, h) in images.into_iter().zip(heights) {
        let layer = if img.width() == width && img.height() == h {
            img.into_rgba8()
        } else {
            img.resize_exact(width, h, imageops::FilterType::Lanczos3)
                .into_rgba8()
        };
        imageops::replace(&mut canvas, &layer, 0, y);
        y += i64::from(h);
    }

    let fmt = format.to_ascii_lowercase();
    let dst = Path::new(output_path);
    let tmp = temp_path(dst);
    let written = encode_image(DynamicImage::ImageRgba8(canvas), &tmp, &fmt, quality)
        .and_then(|()| std::fs::rename(&tmp, dst).map_err(|e| e.to_string()));
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }

    Ok(StackResult {
        path: output_path.to_string(),
        width,
        height,
    })
}

/// Height after scaling `img` to `width`, rounded to the nearest pixel.
/// Mirrors `scaledHeight` in `src/lib/stack.ts` so the UI's size readout matches.
fn scaled_height(img: &DynamicImage, width: u32) -> Result<u32, String> {
    let (w, h) = (u64::from(img.width()), u64::from(img.height()));
    let scaled = ((h * u64::from(width) + w / 2) / w).max(1);
    u32::try_from(scaled).map_err(|_| "an image is too tall after scaling".to_string())
}

/// Rejects outputs the chosen encoder can't represent (or that would exhaust
/// memory) with a message the user can act on.
fn check_output_size(format: &str, width: u32, height: u32) -> Result<(), String> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_PIXELS {
        return Err(format!(
            "the stacked image would be {width} × {height} px ({} MP) — too large. Try matching the narrowest width.",
            pixels / 1_000_000
        ));
    }

    let limit = match format.to_ascii_lowercase().as_str() {
        "webp" => Some(("WebP", WEBP_MAX_DIMENSION)),
        "jpg" | "jpeg" => Some(("JPG", JPEG_MAX_DIMENSION)),
        _ => None,
    };
    if let Some((name, max)) = limit {
        if width > max || height > max {
            return Err(format!(
                "{name} can't exceed {max} px per side (this stack is {width} × {height} px). Use PNG instead."
            ));
        }
    }
    Ok(())
}

/// Loads an image with its EXIF orientation applied, so phone photos stack the
/// way they look in a photo viewer rather than sideways.
fn load_upright(src: &Path) -> Result<DynamicImage, String> {
    let is_heif = src
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("heic") || e.eq_ignore_ascii_case("heif"));
    // libheif already applies the container's rotation/mirroring when decoding.
    if is_heif {
        return load_image(src);
    }

    let mut decoder = ImageReader::open(src)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_decoder()
        .map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(orientation);
    Ok(img)
}

fn file_name(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
}
