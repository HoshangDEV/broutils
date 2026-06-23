use std::path::Path;

use serde::Serialize;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![rename_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
