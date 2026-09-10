//! ModuDesk 桌面壳(Tauri 2)。
//! 职责:承载 Web 外壳 + 暴露系统能力(本地 TeX 编译、文件系统、钥匙串)。
//! 核心逻辑仍在前端内核 — 这里只是适配层(ARCHITECTURE.md §8)。

use std::fs;
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::Manager;

static JOB_SEQ: AtomicU32 = AtomicU32::new(0);

#[derive(serde::Serialize)]
struct CompileResult {
    ok: bool,
    pdf_base64: Option<String>,
    log: String,
}

/// 本地 LaTeX 编译:在临时目录运行所选引擎,返回 PDF(base64)与日志。
/// 引擎按 XeLaTeX → LuaLaTeX → pdfLaTeX 的用户选择执行;错误日志原样回传,
/// 前端「错误面板」负责导航。
#[tauri::command]
fn compile_latex(source: String, engine: String, job_name: String) -> CompileResult {
    let seq = JOB_SEQ.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("modudesk-tex-{}-{}", job_name, seq));
    if fs::create_dir_all(&dir).is_err() {
        return CompileResult { ok: false, pdf_base64: None, log: "无法创建临时目录".into() };
    }
    let tex_path = dir.join(&job_name).with_extension("tex");
    if fs::write(&tex_path, source).is_err() {
        return CompileResult { ok: false, pdf_base64: None, log: "无法写入 .tex 文件".into() };
    }

    let engine_bin = match engine.as_str() {
        "xelatex" => "xelatex",
        "lualatex" => "lualatex",
        "pdflatex" => "pdflatex",
        other => {
            return CompileResult { ok: false, pdf_base64: None, log: format!("未知引擎:{}", other) }
        }
    };

    let output = Command::new(engine_bin)
        .current_dir(&dir)
        .arg("-interaction=nonstopmode")
        .arg("-halt-on-error")
        .arg(&tex_path)
        .output();

    let log = match &output {
        Ok(o) => String::from_utf8_lossy(&o.stderr).to_string()
            + &String::from_utf8_lossy(&o.stdout),
        Err(e) => format!(
            "启动 {} 失败:{}。请确认已安装 TeX 发行版(TeX Live / MiKTeX)并在 PATH 中。",
            engine_bin, e
        ),
    };

    let pdf_path = dir.join(&job_name).with_extension("pdf");
    match fs::read(&pdf_path) {
        Ok(bytes) => {
            use base64::Engine as _;
            CompileResult {
                ok: true,
                pdf_base64: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
                log: log.lines().rev().take(40).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n"),
            }
        }
        Err(_) => {
            // 失败时把 .log 尾部带回前端错误面板
            let tail = fs::read_to_string(dir.join(&job_name).with_extension("log"))
                .map(|l| l.lines().rev().take(40).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n"))
                .unwrap_or(log);
            CompileResult { ok: false, pdf_base64: None, log: tail }
        }
    }
}

#[tauri::command]
fn reveal_in_explorer(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let resolved = app.path().resolve(path, BaseDir::Temp).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&resolved)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = resolved;
    }
    Ok(())
}

// Tauri PathResolver BaseDir 枚举别名(避免额外 use 污染)
use tauri::path::BaseDirectory as BaseDir;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![compile_latex, reveal_in_explorer])
        .run(tauri::generate_context!())
        .expect("ModuDesk 启动失败");
}
