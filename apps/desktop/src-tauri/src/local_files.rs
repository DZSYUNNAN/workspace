use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::State;

const LIMIT: usize = 32 * 1024 * 1024;
#[derive(Default, Clone)]
pub struct LocalFiles(Arc<Mutex<HashMap<String, Selected>>>);
struct Selected {
    path: PathBuf,
    backed_up: bool,
    sync: Option<SyncBundle>,
}
struct SyncBundle {
    pdf: Vec<u8>,
    synctex: Vec<u8>,
    job: String,
    entry: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLocation {
    line: usize,
    column: usize,
    source: String,
}
#[derive(Serialize)]
pub struct Opened {
    id: String,
    name: String,
    path: String,
    data: String,
    stamp: String,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn read(path: &PathBuf) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take((LIMIT + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        return Err("可编辑文档上限为 32 MB".into());
    }
    Ok(bytes)
}
impl LocalFiles {
    fn compile(
        &self,
        id: &str,
        source: String,
        engine: String,
        expected: &str,
    ) -> Result<crate::tex::CompileResult, String> {
        let path = {
            let selected = self.0.lock().map_err(|e| e.to_string())?;
            selected
                .get(id)
                .ok_or("文件未获授权，请重新选择")?
                .path
                .clone()
        };
        if !path
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("tex"))
        {
            return Err("请选择 LaTeX 主文件（.tex）".into());
        }
        if hash(&read(&path)?) != expected {
            return Err("本地文件已改变，请重新读取或等待同步完成再编译".into());
        }
        let root = path.parent().ok_or("工程目录无效")?;
        let files = crate::tex_dependencies::collect(root, &path, &source)?;
        let entry = path.file_name().unwrap().to_string_lossy().into_owned();
        let mut result = crate::tex::compile_project(source, engine, entry.clone(), files)?;
        let bundle = if let (Some(pdf), Some(synctex), Some(job)) = (
            result
                .pdf_base64
                .as_ref()
                .and_then(|value| STANDARD.decode(value).ok()),
            result.sync_tex.take(),
            result.job.take(),
        ) {
            Some(SyncBundle {
                pdf,
                synctex,
                job,
                entry,
            })
        } else {
            None
        };
        let mut selected = self.0.lock().map_err(|e| e.to_string())?;
        if let Some(file) = selected.get_mut(id) {
            file.sync = bundle;
        }
        Ok(result)
    }
    fn sync(&self, id: &str, page: u32, x: f64, y: f64) -> Result<SyncLocation, String> {
        if page == 0
            || !x.is_finite()
            || !y.is_finite()
            || x < 0.0
            || y < 0.0
            || x > 20_000.0
            || y > 20_000.0
        {
            return Err("PDF 定位坐标无效".into());
        }
        let (pdf, synctex, job, entry) = {
            let selected = self.0.lock().map_err(|e| e.to_string())?;
            let bundle = selected
                .get(id)
                .ok_or("文件未获授权，请重新选择")?
                .sync
                .as_ref()
                .ok_or("当前 PDF 没有 SyncTeX 数据，请先保存并编译")?;
            (
                bundle.pdf.clone(),
                bundle.synctex.clone(),
                bundle.job.clone(),
                bundle.entry.clone(),
            )
        };
        let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
        fs::write(temp.path().join(format!("{job}.pdf")), pdf).map_err(|e| e.to_string())?;
        fs::write(temp.path().join(format!("{job}.synctex.gz")), synctex)
            .map_err(|e| e.to_string())?;
        let query = format!("{page}:{x:.2}:{y:.2}:{job}.pdf");
        let mut command = Command::new(crate::tex::executable_path("synctex"));
        command
            .current_dir(temp.path())
            .args(["edit", "-o", &query])
            .stdin(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let output = command
            .output()
            .map_err(|e| format!("启动 SyncTeX 失败：{e}。请确认 TeX Live 或 MiKTeX 已安装。"))?;
        if !output.status.success() {
            return Err("SyncTeX 未找到对应源码位置".into());
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let value = |name: &str| {
            text.lines()
                .find_map(|line| line.strip_prefix(&format!("{name}:")))
                .map(str::trim)
        };
        let line = value("Line")
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v > 0)
            .ok_or("SyncTeX 未返回有效行号")?;
        let column = value("Column")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(0);
        let input = value("Input").unwrap_or(&entry);
        let source = PathBuf::from(input)
            .file_name()
            .map(|v| v.to_string_lossy().into_owned())
            .unwrap_or(entry);
        Ok(SyncLocation {
            line,
            column,
            source,
        })
    }
    fn select(&self, path: PathBuf) -> Result<Opened, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !["md", "markdown", "txt", "tex", "bib", "html", "htm", "docx"].contains(&ext.as_str()) {
            return Err("请选择 DOCX、Markdown、TXT、TeX、BibTeX 或 HTML".into());
        }
        read(&path)?;
        let mut selected = self.0.lock().map_err(|e| e.to_string())?;
        let id = selected
            .iter()
            .find(|(_, s)| s.path == path)
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        selected.entry(id.clone()).or_insert(Selected {
            path,
            backed_up: false,
            sync: None,
        });
        drop(selected);
        self.snapshot(&id)
    }
    fn snapshot(&self, id: &str) -> Result<Opened, String> {
        let selected = self.0.lock().map_err(|e| e.to_string())?;
        let file = selected.get(id).ok_or("文件未获授权，请重新选择")?;
        let bytes = read(&file.path)?;
        Ok(Opened {
            id: id.into(),
            name: file.path.file_name().unwrap().to_string_lossy().into(),
            path: file.path.to_string_lossy().into(),
            stamp: hash(&bytes),
            data: STANDARD.encode(bytes),
        })
    }
    fn write(&self, id: &str, bytes: &[u8], expected: &str) -> Result<String, String> {
        if bytes.len() > LIMIT {
            return Err("文件超过 32 MB".into());
        }
        let mut selected = self.0.lock().map_err(|e| e.to_string())?;
        let file = selected.get_mut(id).ok_or("文件未获授权，请重新选择")?;
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true);
        // Refuse concurrent writers, while allowing the final atomic replacement.
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(1 | 4);
        }
        let mut guard = options
            .open(&file.path)
            .map_err(|e| format!("无法写入文件（可能正被 Word 占用）：{e}"))?;
        let mut old = Vec::new();
        (&mut guard)
            .take((LIMIT + 1) as u64)
            .read_to_end(&mut old)
            .map_err(|e| e.to_string())?;
        if hash(&old) != expected {
            return Err(
                "本地文件已被其他程序修改，已暂停同步。请先下载当前编辑副本，再重新读取本地文件。"
                    .into(),
            );
        }
        let parent = file.path.parent().ok_or("文件目录无效")?;
        if !file.backed_up {
            let name = format!(
                "{}.modudesk-{}.bak",
                file.path.file_name().unwrap().to_string_lossy(),
                uuid::Uuid::new_v4()
            );
            let mut backup = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(parent.join(name))
                .map_err(|e| format!("无法创建原文件备份：{e}"))?;
            backup
                .write_all(&old)
                .and_then(|_| backup.sync_all())
                .map_err(|e| e.to_string())?;
            file.backed_up = true;
        }
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temp.write_all(bytes)
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|e| e.to_string())?;
        // Windows cannot replace the destination while our write handle remains open.
        // Release it only after the new contents are durable, then recheck immediately.
        drop(guard);
        if hash(&read(&file.path)?) != expected {
            return Err("本地文件在保存期间发生变化，已暂停同步".into());
        }
        temp.persist(&file.path).map_err(|e| e.to_string())?;
        Ok(hash(bytes))
    }
}
#[tauri::command]
pub async fn local_file_compile(
    state: State<'_, LocalFiles>,
    id: String,
    source: String,
    engine: String,
    expected: String,
) -> Result<crate::tex::CompileResult, String> {
    let files = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || files.compile(&id, source, engine, &expected))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn local_file_synctex(
    state: State<'_, LocalFiles>,
    id: String,
    page: u32,
    x: f64,
    y: f64,
) -> Result<SyncLocation, String> {
    let files = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || files.sync(&id, page, x, y))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn local_file_open(
    state: State<'_, LocalFiles>,
    window: tauri::Window,
) -> Result<Option<Opened>, String> {
    let files = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = rfd::FileDialog::new()
            .set_parent(&window)
            .set_title("选择文档：编辑将同步到原文件")
            .add_filter(
                "可编辑文档",
                &["md", "markdown", "txt", "tex", "bib", "html", "htm", "docx"],
            )
            .pick_file();
        path.map(|p| files.select(p)).transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn local_file_read(state: State<'_, LocalFiles>, id: String) -> Result<Opened, String> {
    let files = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || files.snapshot(&id))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn local_file_write(
    state: State<'_, LocalFiles>,
    id: String,
    data: String,
    expected: String,
) -> Result<String, String> {
    let files = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        files.write(
            &id,
            &STANDARD.decode(data).map_err(|e| e.to_string())?,
            &expected,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_compile_rejects_unselected_or_changed_files() {
        let files = LocalFiles::default();
        assert!(files
            .compile("not-selected", "".into(), "xelatex".into(), "")
            .is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("main.tex");
        fs::write(&path, "old").unwrap();
        let opened = files.select(path.clone()).unwrap();
        fs::write(&path, "changed outside").unwrap();
        assert!(files
            .compile(&opened.id, "old".into(), "xelatex".into(), &opened.stamp)
            .err()
            .unwrap()
            .contains("已改变"));
    }
    #[test]
    fn synctex_requires_a_selected_compiled_pdf_and_valid_coordinates() {
        let files = LocalFiles::default();
        assert!(files.sync("missing", 1, 10.0, 10.0).is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("paper.tex");
        fs::write(&path, "source").unwrap();
        let opened = files.select(path).unwrap();
        assert!(files
            .sync(&opened.id, 0, 10.0, 10.0)
            .unwrap_err()
            .contains("坐标"));
        assert!(files
            .sync(&opened.id, 1, 10.0, 10.0)
            .unwrap_err()
            .contains("请先保存并编译"));
    }
    #[test]
    #[ignore = "requires installed XeLaTeX and BibTeX"]
    fn compiles_selected_local_project_with_image_class_and_bibliography() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sections")).unwrap();
        fs::create_dir(dir.path().join("figures")).unwrap();
        let source = "\\documentclass{local}\n\\usepackage{graphicx}\n\\begin{document}\n\\input{sections/intro}\n\\includegraphics[width=1cm]{figures/image.png}\n\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}";
        let path = dir.path().join("主 稿.tex");
        fs::write(&path, source).unwrap();
        fs::write(
            dir.path().join("local.cls"),
            "\\NeedsTeXFormat{LaTeX2e}\n\\ProvidesClass{local}\n\\LoadClass{ctexart}",
        )
        .unwrap();
        fs::write(
            dir.path().join("sections/intro.tex"),
            "本地工程测试。\\cite{fixture2026}",
        )
        .unwrap();
        fs::write(
            dir.path().join("references.bib"),
            "@article{fixture2026,title={Fixture},author={Tester, Ada},journal={Test},year={2026}}",
        )
        .unwrap();
        fs::write(
            dir.path().join("figures/image.png"),
            include_bytes!("../icons/32x32.png"),
        )
        .unwrap();
        fs::write(dir.path().join("modudesk.pdf"), "stale output").unwrap();
        // Reproduce a main document selected from a large general-purpose folder.
        fs::File::create(dir.path().join("unrelated-large.pdf"))
            .unwrap()
            .set_len(101 * 1024 * 1024)
            .unwrap();
        fs::create_dir(dir.path().join("unrelated-documents")).unwrap();
        for i in 0..510 {
            fs::write(
                dir.path().join(format!("unrelated-documents/{i}.tex")),
                "unused",
            )
            .unwrap();
        }
        let files = LocalFiles::default();
        let opened = files.select(path.clone()).unwrap();
        let result = files
            .compile(&opened.id, source.into(), "xelatex".into(), &opened.stamp)
            .unwrap();
        let pdf = STANDARD.decode(result.pdf_base64.unwrap()).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() > 1000);
        assert!(!result.log.contains("undefined references"));
        let location = files.sync(&opened.id, 1, 100.0, 100.0).unwrap();
        assert!(location.line > 0);
        assert!(location.source.ends_with("tex"));
        assert_eq!(fs::read_to_string(path).unwrap(), source);
        assert!(!dir.path().join("modudesk.aux").exists());
        if let Ok(path) = std::env::var("MODUDESK_TEST_OUTPUT") {
            fs::write(path, pdf).unwrap();
        }
    }
    #[test]
    fn writes_selected_file_and_preserves_original_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("中文.md");
        fs::write(&path, "原稿").unwrap();
        let files = LocalFiles::default();
        let opened = files.select(path.clone()).unwrap();
        let next = files
            .write(&opened.id, "修改".as_bytes(), &opened.stamp)
            .unwrap();
        files.write(&opened.id, "最终".as_bytes(), &next).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "最终");
        let backups: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|f| f.path().extension().is_some_and(|e| e == "bak"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read_to_string(backups[0].path()).unwrap(), "原稿");
    }
    #[test]
    fn conflict_and_unselected_paths_cannot_be_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.txt");
        fs::write(&path, "old").unwrap();
        let files = LocalFiles::default();
        let opened = files.select(path.clone()).unwrap();
        fs::write(&path, "external").unwrap();
        assert!(files
            .write(&opened.id, b"mine", &opened.stamp)
            .unwrap_err()
            .contains("其他程序"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        assert!(files
            .write(path.to_str().unwrap(), b"mine", &hash(b"external"))
            .is_err());
        fs::remove_file(&path).unwrap();
        assert!(files.write(&opened.id, b"mine", &opened.stamp).is_err());
    }
}
