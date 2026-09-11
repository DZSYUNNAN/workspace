use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use wait_timeout::ChildExt;
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub ok: bool,
    pub pdf_base64: Option<String>,
    pub log: String,
}
fn safe_file(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 200
        && !name.starts_with('/')
        && !name.contains(['\\', ':'])
        && name.split('/').all(|p| {
            !p.is_empty()
                && p != "."
                && p != ".."
                && p.chars()
                    .all(|c| c.is_alphanumeric() || "_.- ()".contains(c))
        })
        && project_file(name)
}
pub fn project_file(name: &str) -> bool {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    [
        "tex", "bib", "sty", "cls", "bst", "bbx", "cbx", "def", "fd", "clo", "png", "jpg", "jpeg",
        "pdf", "eps", "mps",
    ]
    .contains(&ext.as_str())
}
fn executable_path(name: &str) -> PathBuf {
    let filename = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let mut paths: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    #[cfg(windows)]
    {
        for root in ["C:/texlive", "D:/texlive", "E:/texlive"] {
            if let Ok(entries) = fs::read_dir(root) {
                let mut years: Vec<_> = entries.flatten().map(|e| e.path()).collect();
                years.sort();
                years.reverse();
                paths.extend(years.into_iter().map(|p| p.join("bin/windows")));
            }
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            paths.push(PathBuf::from(local).join("Programs/MiKTeX/miktex/bin/x64"));
        }
        if let Some(programs) = std::env::var_os("ProgramFiles") {
            paths.push(PathBuf::from(programs).join("MiKTeX/miktex/bin/x64"));
        }
    }
    paths
        .into_iter()
        .map(|p| p.join(&filename))
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from(name))
}
fn run(dir: &Path, executable: &str, args: &[&str]) -> Result<String, String> {
    let log_path = dir.join("process.log");
    let stdout = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;
    let executable_path = executable_path(executable);
    let mut command = Command::new(&executable_path);
    if let Some(parent) = executable_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        let mut paths = vec![parent.to_path_buf()];
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        command.env(
            "PATH",
            std::env::join_paths(paths).map_err(|e| e.to_string())?,
        );
    }
    command
        .current_dir(dir)
        .args(args)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr)
        .env("openin_any", "p")
        .env("openout_any", "p");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| {
        format!("启动 {executable} 失败：{e}。请安装 TeX Live 或 MiKTeX，并将工具添加到 PATH。")
    })?;
    let status = match child
        .wait_timeout(Duration::from_secs(60))
        .map_err(|e| e.to_string())?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("编译超时（60 秒），已停止进程。".into());
        }
    };
    let log = fs::read_to_string(log_path).unwrap_or_default();
    let tail = log
        .lines()
        .rev()
        .take(80)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    if status.success() {
        Ok(tail)
    } else {
        Err(tail)
    }
}
fn compile(
    source: String,
    engine: String,
    entry: String,
    files: BTreeMap<String, String>,
) -> Result<CompileResult, String> {
    compile_project(
        source,
        engine,
        entry,
        files
            .into_iter()
            .map(|(name, text)| (name, text.into_bytes()))
            .collect(),
    )
}
pub fn compile_project(
    source: String,
    engine: String,
    entry: String,
    files: BTreeMap<String, Vec<u8>>,
) -> Result<CompileResult, String> {
    if !["xelatex", "lualatex", "pdflatex"].contains(&engine.as_str()) {
        return Err("不支持的编译引擎".into());
    }
    if !safe_file(&entry) || !entry.to_lowercase().ends_with(".tex") || files.len() > 500 {
        return Err("无效的工程入口或文件数量".into());
    }
    if source.len() + files.values().map(|s| s.len()).sum::<usize>() > 100 * 1024 * 1024 {
        return Err("工程内容超过 100 MB，请将主文件与依赖放入独立工程目录".into());
    }
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    for (name, content) in files {
        if !safe_file(&name) {
            return Err(format!("无效的工程路径：{name}"));
        }
        let path = temp.path().join(name);
        fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())?;
    }
    let entry_path = temp.path().join(&entry);
    fs::create_dir_all(entry_path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&entry_path, source).map_err(|e| e.to_string())?;
    // Command performs platform argument quoting; do not embed literal quotes.
    let entry_arg = format!("./{entry}");
    let job = format!("mpw-{}", uuid::Uuid::new_v4());
    let job_arg = format!("-jobname={job}");
    let args = [
        "-no-shell-escape",
        "-interaction=nonstopmode",
        "-halt-on-error",
        job_arg.as_str(),
        entry_arg.as_str(),
    ];
    run(temp.path(), &engine, &args)?;
    let aux = fs::read_to_string(temp.path().join(format!("{job}.aux"))).unwrap_or_default();
    if temp.path().join(format!("{job}.bcf")).exists() {
        run(temp.path(), "biber", &[&job])?;
    } else if aux.contains("\\bibdata") {
        run(temp.path(), "bibtex", &[&job])?;
    }
    run(temp.path(), &engine, &args)?;
    let log = run(temp.path(), &engine, &args)?;
    let bytes = fs::read(temp.path().join(format!("{job}.pdf"))).map_err(|e| e.to_string())?;
    Ok(CompileResult {
        ok: true,
        pdf_base64: Some(STANDARD.encode(bytes)),
        log,
    })
}
#[tauri::command]
pub async fn compile_latex(
    source: String,
    engine: String,
    entry: Option<String>,
    files: Option<BTreeMap<String, String>>,
) -> CompileResult {
    match tauri::async_runtime::spawn_blocking(move || {
        compile(
            source,
            engine,
            entry.unwrap_or("main.tex".into()),
            files.unwrap_or_default(),
        )
    })
    .await
    {
        Ok(Ok(result)) => result,
        result => CompileResult {
            ok: false,
            pdf_base64: None,
            log: match result {
                Ok(Err(e)) => e,
                Err(e) => e.to_string(),
                _ => unreachable!(),
            },
        },
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_outside_project() {
        for path in [
            "../bad.tex",
            "/bad.tex",
            "C:/bad.tex",
            "sections/../../bad.tex",
            "-bad.exe",
        ] {
            assert!(!safe_file(path));
        }
        assert!(safe_file("sections/intro.tex"));
    }
    #[test]
    fn rejects_arbitrary_programs_before_spawning() {
        assert!(compile(
            "".into(),
            "powershell".into(),
            "main.tex".into(),
            BTreeMap::new()
        )
        .is_err());
    }
    #[test]
    #[ignore = "requires installed XeLaTeX and BibTeX"]
    fn compiles_chinese_multifile_project_with_bibliography() {
        let source = "\\documentclass{ctexart}\n\\begin{document}\n\\input{sections/intro}\n\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}";
        let mut files = BTreeMap::new();
        files.insert(
            "sections/intro.tex".into(),
            "中文编译验收。引用\\cite{fixture2026}。".into(),
        );
        files.insert("references.bib".into(), "@article{fixture2026,title={Test fixture},author={Tester, Ada},journal={Test journal},year={2026}}".into());
        let result = compile(source.into(), "xelatex".into(), "main.tex".into(), files).unwrap();
        assert!(result.ok);
        let bytes = STANDARD.decode(result.pdf_base64.unwrap()).unwrap();
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(bytes.len() > 1000);
        assert!(!result.log.contains("undefined references"));
        if let Ok(path) = std::env::var("MODUDESK_TEST_OUTPUT") {
            fs::write(path, bytes).unwrap();
        }
    }
}
