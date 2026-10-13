//! Download Videos: runs yt-dlp, which is fetched on first use into the app
//! data folder rather than bundled — sites break old yt-dlp versions every few
//! weeks, and only a copy outside the signed app bundle can update itself.
//!
//! The "onedir" zip builds are used instead of the single-file binaries: the
//! single-file build unpacks itself (and gets re-scanned by Gatekeeper) on every
//! launch, ~13s on macOS, while the onedir build starts in ~0.2s.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
pub struct DownloadState {
    pub processes: Mutex<HashMap<String, CommandChild>>,
}

const RELEASES: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

/// (release asset, executable inside it) for this platform.
#[cfg(target_os = "macos")]
const BUILD: (&str, &str) = ("yt-dlp_macos.zip", "yt-dlp_macos");
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const BUILD: (&str, &str) = ("yt-dlp_win_arm64.zip", "yt-dlp.exe");
#[cfg(all(target_os = "windows", not(target_arch = "aarch64")))]
const BUILD: (&str, &str) = ("yt-dlp_win.zip", "yt-dlp.exe");
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const BUILD: (&str, &str) = ("yt-dlp_linux_aarch64.zip", "yt-dlp_linux_aarch64");
#[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
const BUILD: (&str, &str) = ("yt-dlp_linux.zip", "yt-dlp_linux");

fn install_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("yt-dlp"))
}

fn ytdlp_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(install_dir(app)?.join(BUILD.1))
}

/// The bundled FFmpeg sidecar sits next to the app executable (in dev too).
fn ffmpeg_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(
        exe.parent()?
            .join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX)),
    )
}

/// Runs a helper program and turns a non-zero exit into its stderr.
async fn run(app: &AppHandle, program: impl AsRef<Path>, args: &[&str]) -> Result<String, String> {
    let out = app
        .shell()
        .command(program.as_ref())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        Err(stderr.trim().lines().last().unwrap_or("failed").to_string())
    }
}

/// Installed yt-dlp version, or `None` when it hasn't been downloaded yet.
#[tauri::command]
pub async fn ytdlp_version(app: AppHandle) -> Result<Option<String>, String> {
    let exe = ytdlp_path(&app)?;
    if !exe.is_file() {
        return Ok(None);
    }
    run(&app, &exe, &["--version"]).await.map(Some)
}

/// Downloads and unpacks the latest yt-dlp build, replacing any previous copy.
// shortcut: uses the system curl and tar/unzip (shipped with macOS and Windows
// 10+) instead of an HTTP/zip crate; switch if a platform lacks them.
#[tauri::command]
pub async fn ytdlp_install(app: AppHandle) -> Result<String, String> {
    let dir = install_dir(&app)?;
    let parent = dir.parent().ok_or("no app data folder")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let zip = parent.join("yt-dlp.zip");
    let zip_str = zip.to_string_lossy().to_string();
    let url = format!("{RELEASES}/{}", BUILD.0);

    run(&app, "curl", &["-fsSL", "--retry", "2", "-o", &zip_str, &url]).await?;

    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dir_str = dir.to_string_lossy().to_string();
    #[cfg(target_os = "linux")]
    let unpacked = run(&app, "unzip", &["-q", "-o", &zip_str, "-d", &dir_str]).await;
    #[cfg(target_os = "macos")]
    let unpacked = run(&app, "tar", &["-xf", &zip_str, "-C", &dir_str]).await;
    // Windows' own bsdtar: a GNU tar from Git earlier in PATH can't read zip.
    #[cfg(target_os = "windows")]
    let unpacked = run(
        &app,
        Path::new(&std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into()))
            .join(r"System32\tar.exe"),
        &["-xf", &zip_str, "-C", &dir_str],
    )
    .await;
    let _ = std::fs::remove_file(&zip);
    if let Err(e) = unpacked {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e);
    }

    // The first launch is the slow one (macOS scans the new files), so take it
    // here while the UI says "Setting up" rather than on the first download.
    ytdlp_version(app)
        .await?
        .ok_or_else(|| "yt-dlp was not found in the download".to_string())
}

/// Updates yt-dlp in place and returns the version now installed.
#[tauri::command]
pub async fn ytdlp_update(app: AppHandle) -> Result<String, String> {
    run(&app, ytdlp_path(&app)?, &["-U"]).await?;
    ytdlp_version(app)
        .await?
        .ok_or_else(|| "yt-dlp is not installed".to_string())
}

/// Format selector shared by every preset: best video (+ separate audio when
/// the site splits them). `bv*` never matches an audio-only format, so a link
/// with no video fails instead of silently saving an mp3.
const FORMAT: &str = "bv*+ba/bv*";

/// yt-dlp sort order (`-S`) for a quality preset. Sorting only prefers, so each
/// preset still falls back to whatever video exists. `res` is the shorter side,
/// so 720p means 720x1280 for portrait TikToks too (`height` would be 1280).
fn format_sort(quality: &str) -> Option<&'static str> {
    match quality {
        "best" => None,
        "1080" => Some("res:1080"),
        "720" => Some("res:720"),
        // H.264 + AAC plays everywhere (QuickTime, WhatsApp, old phones). The
        // sort matches both `avc1` (YouTube) and `h264` (TikTok) codec names.
        _ => Some("vcodec:h264,res,acodec:m4a"),
    }
}

/// yt-dlp's error when `FORMAT` finds no video, reworded for the UI.
fn friendly_error(msg: &str) -> String {
    if msg.contains("Requested format is not available") {
        "No video found at this link, only audio (some TikTok ads can't be downloaded)".into()
    } else {
        msg.to_string()
    }
}

#[derive(Serialize, Clone, Default)]
pub struct ProgressPayload {
    pub percent: Option<f32>,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct DonePayload {
    pub success: bool,
    pub error: Option<String>,
    pub path: Option<String>,
    pub size: Option<u64>,
}

#[derive(Deserialize)]
struct Progress {
    downloaded_bytes: Option<f64>,
    total_bytes: Option<f64>,
    total_bytes_estimate: Option<f64>,
}

/// Percent from one `--progress-template` JSON line, if it carries sizes.
fn parse_percent(json: &str) -> Option<f32> {
    let p: Progress = serde_json::from_str(json).ok()?;
    let total = p.total_bytes.or(p.total_bytes_estimate)?;
    if total <= 0.0 {
        return None;
    }
    Some((p.downloaded_bytes? / total * 100.0).clamp(0.0, 99.0) as f32)
}

/// PATH for the yt-dlp process. GUI apps on macOS start with a bare PATH, so
/// add the usual install folders where yt-dlp can find deno/node/bun, which it
/// needs for YouTube.
fn child_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    if cfg!(windows) {
        return current;
    }
    let home = std::env::var("HOME").unwrap_or_default();
    format!("/opt/homebrew/bin:/usr/local/bin:{home}/.deno/bin:{home}/.bun/bin:{current}")
}

#[tauri::command]
pub async fn download_video(
    app: AppHandle,
    state: State<'_, DownloadState>,
    id: String,
    url: String,
    quality: String,
    output_dir: Option<String>,
) -> Result<(), String> {
    // Also stops a "URL" like `--exec …` from being read as an option.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Not a web link".into());
    }
    let exe = ytdlp_path(&app)?;
    if !exe.is_file() {
        return Err("yt-dlp is not installed".into());
    }
    let out_dir = match output_dir {
        Some(dir) => PathBuf::from(dir),
        None => dirs::download_dir()
            .or_else(dirs::home_dir)
            .ok_or("no Downloads folder")?,
    };

    let mut args: Vec<String> = vec![
        "--no-playlist".into(),
        "--quiet".into(),
        "--no-warnings".into(),
        "--progress".into(),
        "--newline".into(),
        "--encoding".into(),
        "utf-8".into(),
        // Files otherwise get the upload date as mtime and sort as old.
        "--no-mtime".into(),
        "--js-runtimes".into(),
        "node".into(),
        "--js-runtimes".into(),
        "bun".into(),
        "-f".into(),
        FORMAT.into(),
        "--merge-output-format".into(),
        "mp4".into(),
        "--progress-template".into(),
        "download:[progress]%(progress)j".into(),
        "--print".into(),
        "before_dl:[title]%(title)s".into(),
        "--print".into(),
        "before_dl:[thumb]%(thumbnail)s".into(),
        "--print".into(),
        "after_move:[file]%(filepath)s".into(),
        "-P".into(),
        out_dir.to_string_lossy().into(),
        "-o".into(),
        // .120B caps long/unicode titles in bytes, under filesystem limits.
        "%(title).120B [%(id)s].%(ext)s".into(),
    ];
    if let Some(sort) = format_sort(&quality) {
        args.extend(["-S".into(), sort.into()]);
    }
    if let Some(ffmpeg) = ffmpeg_path() {
        args.extend(["--ffmpeg-location".into(), ffmpeg.to_string_lossy().into()]);
    }
    args.extend(["--".into(), url]);

    let (mut rx, child) = app
        .shell()
        .command(&exe)
        .args(args)
        .env("PATH", child_path())
        .spawn()
        .map_err(|e| e.to_string())?;
    state.processes.lock().unwrap().insert(id.clone(), child);

    tauri::async_runtime::spawn(async move {
        let progress_event = format!("download://progress/{id}");
        let mut path: Option<String> = None;
        let mut error: Option<String> = None;
        let mut success = true;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    let line = text.trim();
                    let mut payload = ProgressPayload::default();
                    if let Some(json) = line.strip_prefix("[progress]") {
                        payload.percent = parse_percent(json);
                    } else if let Some(title) = line.strip_prefix("[title]") {
                        payload.title = Some(title.to_string());
                    } else if let Some(thumb) = line.strip_prefix("[thumb]") {
                        payload.thumbnail = Some(thumb.to_string()).filter(|t| t != "NA");
                    } else if let Some(file) = line.strip_prefix("[file]") {
                        path = Some(file.to_string());
                        continue;
                    } else if let Some(msg) = line.strip_prefix("ERROR: ") {
                        error = Some(friendly_error(msg));
                        continue;
                    } else {
                        continue;
                    }
                    let _ = app.emit(&progress_event, payload);
                }
                CommandEvent::Terminated(status) if status.code != Some(0) => {
                    success = false;
                    error.get_or_insert_with(|| match status.code {
                        Some(code) => format!("yt-dlp exited with code {code}"),
                        None => "yt-dlp was stopped".into(),
                    });
                }
                CommandEvent::Error(e) => {
                    success = false;
                    error = Some(e);
                }
                _ => {}
            }
        }

        app.state::<DownloadState>()
            .processes
            .lock()
            .unwrap()
            .remove(&id);

        let success = success && path.is_some();
        let size = path
            .as_ref()
            .and_then(|p| std::fs::metadata(p).ok())
            .map(|m| m.len());
        let _ = app.emit(
            &format!("download://done/{id}"),
            DonePayload {
                success,
                error: if success {
                    None
                } else {
                    error.or(Some("No file was downloaded".into()))
                },
                path: path.filter(|_| success),
                size,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_download(state: State<'_, DownloadState>, id: String) -> Result<(), String> {
    if let Some(child) = state.processes.lock().unwrap().remove(&id) {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_from_progress_json() {
        let line = r#"{"status": "downloading", "downloaded_bytes": 1024, "total_bytes": 4096, "eta": null}"#;
        assert_eq!(parse_percent(line), Some(25.0));
        let estimate = r#"{"downloaded_bytes": 50, "total_bytes": null, "total_bytes_estimate": 100}"#;
        assert_eq!(parse_percent(estimate), Some(50.0));
        assert_eq!(parse_percent(r#"{"downloaded_bytes": 50}"#), None);
        assert_eq!(parse_percent("not json"), None);
    }
}
