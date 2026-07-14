use std::collections::HashMap;
use std::sync::Mutex;

use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
pub struct CompressState {
    pub processes: Mutex<HashMap<String, CommandChild>>,
}

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub percent: f32,
}

#[derive(Serialize, Clone)]
pub struct DonePayload {
    pub success: bool,
    pub error: Option<String>,
    pub output_size: Option<u64>,
}

fn parse_secs(h: &str, m: &str, s: &str, cs: &str) -> f32 {
    let h: f32 = h.parse().unwrap_or(0.0);
    let m: f32 = m.parse().unwrap_or(0.0);
    let s: f32 = s.parse().unwrap_or(0.0);
    let cs: f32 = cs.parse().unwrap_or(0.0) / 100.0;
    h * 3600.0 + m * 60.0 + s + cs
}

const GPU_ENCODERS: &[&str] = &[
    "h264_videotoolbox", "h264_nvenc", "h264_amf",
    "hevc_videotoolbox", "hevc_nvenc", "hevc_amf",
];

/// A compiled-in encoder can still fail at runtime (e.g. nvenc without an
/// NVIDIA GPU), so encode one dummy frame to prove the hardware works.
async fn test_encoder(app: &AppHandle, encoder: &str) -> bool {
    let Ok(cmd) = app.shell().sidecar("ffmpeg") else {
        return false;
    };
    cmd.args([
        "-hide_banner",
        "-f", "lavfi",
        "-i", "color=c=black:s=256x256:r=30:d=0.1",
        "-pix_fmt", "yuv420p",
        "-frames:v", "1",
        "-c:v", encoder,
        "-f", "null",
        "-",
    ])
    .output()
    .await
    .map(|out| out.status.success())
    .unwrap_or(false)
}

#[tauri::command]
pub async fn detect_gpu_encoders(app: AppHandle) -> Vec<String> {
    let Ok(out) = app
        .shell()
        .sidecar("ffmpeg")
        .unwrap()
        .args(["-hide_banner", "-encoders"])
        .output()
        .await
    else {
        return vec![];
    };

    let text = String::from_utf8_lossy(&out.stdout).to_string()
        + &String::from_utf8_lossy(&out.stderr).to_string();

    let mut working = Vec::new();
    for &enc in GPU_ENCODERS.iter().filter(|&&enc| text.contains(enc)) {
        if test_encoder(&app, enc).await {
            working.push(enc.to_string());
        }
    }
    working
}

async fn probe_duration(app: &AppHandle, input_path: &str) -> Result<f32, String> {
    let out = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(["-hide_banner", "-i", input_path])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stderr = String::from_utf8_lossy(&out.stderr);
    let re = Regex::new(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)").unwrap();
    let caps = re
        .captures(&stderr)
        .ok_or_else(|| "Could not determine video duration".to_string())?;
    Ok(parse_secs(&caps[1], &caps[2], &caps[3], &caps[4]))
}

fn build_ffmpeg_args(
    input_path: &str,
    output_path: &str,
    crf: u8,
    bitrate: Option<u32>,
    encoder: &str,
    encode_audio: bool,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-i".into(), input_path.into(), "-c:v".into(), encoder.into()];

    if let Some(kbps) = bitrate {
        args.extend(["-b:v".into(), format!("{}k", kbps)]);
        match encoder {
            "libx264" | "libx265" => args.extend(["-preset".into(), "slow".into()]),
            "libvpx-vp9" => args.extend(["-deadline".into(), "good".into(), "-cpu-used".into(), "1".into()]),
            "libaom-av1" => args.extend(["-cpu-used".into(), "4".into()]),
            _ => {}
        }
    } else {
        match encoder {
            "libx264" | "libx265" => {
                args.extend(["-crf".into(), crf.to_string(), "-preset".into(), "slow".into()]);
            }
            "libvpx-vp9" => {
                args.extend([
                    "-crf".into(), crf.to_string(),
                    "-b:v".into(), "0".into(),
                    "-deadline".into(), "good".into(),
                    "-cpu-used".into(), "1".into(),
                ]);
            }
            "libaom-av1" => {
                args.extend([
                    "-crf".into(), crf.to_string(),
                    "-b:v".into(), "0".into(),
                    "-cpu-used".into(), "4".into(),
                ]);
            }
            "h264_videotoolbox" | "hevc_videotoolbox" => {
                let q = ((51u8.saturating_sub(crf)) as f32 / 51.0 * 100.0).round().max(1.0) as u8;
                args.extend(["-q:v".into(), q.to_string()]);
            }
            "h264_nvenc" | "hevc_nvenc" => {
                args.extend(["-cq".into(), crf.to_string()]);
            }
            "h264_amf" | "hevc_amf" => {
                let q = crf.to_string();
                args.extend([
                    "-rc".into(), "cqp".into(),
                    "-qp_i".into(), q.clone(),
                    "-qp_p".into(), q.clone(),
                    "-qp_b".into(), q,
                ]);
            }
            _ => {
                args.extend(["-crf".into(), crf.to_string()]);
            }
        }
    }

    if encode_audio {
        // WebM requires Opus; everything else gets AAC
        let audio_codec = if output_path.ends_with(".webm") { "libopus" } else { "aac" };
        args.extend(["-c:a".into(), audio_codec.into(), "-b:a".into(), "128k".into()]);
    } else {
        args.extend(["-c:a".into(), "copy".into()]);
    }
    args.extend(["-y".into(), output_path.into()]);
    args
}

#[tauri::command]
pub async fn compress_video(
    app: AppHandle,
    state: State<'_, CompressState>,
    id: String,
    input_path: String,
    output_path: String,
    crf: u8,
    bitrate: Option<u32>,
    encoder: String,
    target_size_mb: Option<f32>,
) -> Result<(), String> {
    const AUDIO_KBPS: u32 = 128;

    let (effective_bitrate, encode_audio) = if let Some(mb) = target_size_mb {
        let duration = probe_duration(&app, &input_path).await?;
        if duration <= 0.0 {
            return Err("Video duration is zero or unknown".into());
        }
        let total_kbps = ((mb as f64 * 1024.0 * 1024.0 * 8.0) / duration as f64 / 1000.0) as u32;
        let video_kbps = total_kbps.saturating_sub(AUDIO_KBPS).max(100);
        (Some(video_kbps), true)
    } else {
        (bitrate, false)
    };

    let args = build_ffmpeg_args(&input_path, &output_path, crf, effective_bitrate, &encoder, encode_audio);

    let sidecar = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(args);

    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;

    state.processes.lock().unwrap().insert(id.clone(), child);

    let app_clone = app.clone();
    let id_clone = id.clone();
    let output_path_clone = output_path.clone();

    tauri::async_runtime::spawn(async move {
        let duration_re =
            Regex::new(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)").expect("invalid regex");
        let time_re = Regex::new(r"time=(\d+):(\d+):(\d+)\.(\d+)").expect("invalid regex");

        let mut total_secs: f32 = 0.0;
        let mut success = true;
        let mut error_msg: Option<String> = None;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(bytes) => {
                    let chunk = String::from_utf8_lossy(&bytes);

                    if total_secs == 0.0 {
                        if let Some(caps) = duration_re.captures(&chunk) {
                            total_secs = parse_secs(&caps[1], &caps[2], &caps[3], &caps[4]);
                        }
                    }

                    if total_secs > 0.0 {
                        let mut last_percent: Option<f32> = None;
                        for caps in time_re.captures_iter(&chunk) {
                            let current = parse_secs(&caps[1], &caps[2], &caps[3], &caps[4]);
                            last_percent = Some((current / total_secs * 100.0).min(99.0));
                        }
                        if let Some(pct) = last_percent {
                            let _ = app_clone.emit(
                                &format!("compress://progress/{id_clone}"),
                                ProgressPayload { percent: pct },
                            );
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if payload.code != Some(0) {
                        success = false;
                        if error_msg.is_none() {
                            error_msg = Some(match (payload.code, payload.signal) {
                                (Some(code), _) => format!("Exited with code {code}"),
                                (None, Some(sig)) => format!("Killed by signal {sig}"),
                                _ => "Process terminated unexpectedly".to_string(),
                            });
                        }
                    }
                }
                CommandEvent::Error(err) => {
                    success = false;
                    error_msg = Some(err);
                }
                _ => {}
            }
        }

        app_clone
            .state::<CompressState>()
            .processes
            .lock()
            .unwrap()
            .remove(&id_clone);

        let output_size = if success {
            std::fs::metadata(&output_path_clone).ok().map(|m| m.len())
        } else {
            None
        };

        let _ = app_clone.emit(
            &format!("compress://done/{id_clone}"),
            DonePayload {
                success,
                error: error_msg,
                output_size,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_compression(state: State<'_, CompressState>, id: String) -> Result<(), String> {
    let mut processes = state.processes.lock().unwrap();
    if let Some(child) = processes.remove(&id) {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}
