//! Paste support for the image tools. Files copied in Finder/Explorer come back
//! as their real paths. Raw image data (a screenshot copied to the clipboard,
//! "Copy Image" in a browser) is first saved into a scratch folder, since every
//! tool works on file paths.

use std::path::{Path, PathBuf};

use crate::unique_path;

/// Where pasted image data is saved. Outputs made from these files go to the
/// Downloads folder instead of here (see `output_dir`).
pub fn paste_dir() -> PathBuf {
    std::env::temp_dir().join("broutils-pasted")
}

/// The folder a tool writes its output for `src` into: normally the source's
/// own folder, but Downloads for pasted images, which live in a temp folder
/// the user never sees.
pub fn output_dir(src: &Path) -> PathBuf {
    let parent = src.parent().unwrap_or_else(|| Path::new(""));
    if parent == paste_dir() {
        if let Some(downloads) = dirs::download_dir() {
            return downloads;
        }
    }
    parent.to_path_buf()
}

/// Reads the clipboard as file paths: copied files as-is, or copied image data
/// saved as `{file_stem}.{ext}` in `paste_dir`. Returns an empty list when the
/// clipboard holds neither.
#[tauri::command]
pub async fn read_clipboard_files(file_stem: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || read_blocking(&file_stem))
        .await
        .map_err(|e| e.to_string())?
}

fn read_blocking(file_stem: &str) -> Result<Vec<String>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;

    // Check files first: a file copied in Finder also puts its icon on the
    // clipboard as image data.
    if let Ok(files) = clipboard.get().file_list() {
        if !files.is_empty() {
            return Ok(files
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect());
        }
    }

    let Some((bytes, ext)) = clipboard_image(&mut clipboard)? else {
        return Ok(Vec::new());
    };

    let dir = paste_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = match file_stem.trim() {
        "" => "pasted",
        s => s,
    };
    let path = unique_path(&dir, stem, ext);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(vec![path.to_string_lossy().into_owned()])
}

/// The clipboard image as encoded file bytes plus their extension.
///
/// macOS apps put PNG and/or TIFF on the pasteboard; those bytes are saved
/// untouched, so nothing is lost and there is no re-encode wait.
#[cfg(target_os = "macos")]
fn clipboard_image(
    _clipboard: &mut arboard::Clipboard,
) -> Result<Option<(Vec<u8>, &'static str)>, String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeTIFF};

    let pasteboard = NSPasteboard::generalPasteboard();
    // SAFETY: AppKit's pasteboard type constants are immutable statics.
    let types = unsafe { [(NSPasteboardTypePNG, "png"), (NSPasteboardTypeTIFF, "tiff")] };
    Ok(types.into_iter().find_map(|(data_type, ext)| {
        pasteboard
            .dataForType(data_type)
            .map(|data| (data.to_vec(), ext))
    }))
}

/// The clipboard image as encoded file bytes plus their extension.
///
/// arboard hands back raw RGBA pixels here, so they're encoded to PNG.
#[cfg(not(target_os = "macos"))]
fn clipboard_image(
    clipboard: &mut arboard::Clipboard,
) -> Result<Option<(Vec<u8>, &'static str)>, String> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::{ExtendedColorType, ImageEncoder};

    let img = match clipboard.get().image() {
        Ok(img) => img,
        Err(arboard::Error::ContentNotAvailable) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };

    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::Adaptive)
        .write_image(
            &img.bytes,
            img.width as u32,
            img.height as u32,
            ExtendedColorType::Rgba8,
        )
        .map_err(|e| e.to_string())?;
    Ok(Some((png, "png")))
}

