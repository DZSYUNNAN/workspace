use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::State;

const LIMIT: usize = 32 * 1024 * 1024;
#[derive(Default, Clone)]
pub struct LocalFiles(Arc<Mutex<HashMap<String, Selected>>>);
struct Selected {
    path: PathBuf,
    backed_up: bool,
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
        let mut files = BTreeMap::new();
        let mut size = source.len();
        let mut visited = 0;
        collect_project(root, root, &mut files, &mut size, &mut visited, 0)?;
        crate::tex::compile_project(
            source,
            engine,
            path.file_name().unwrap().to_string_lossy().into(),
            files,
        )
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
fn collect_project(
    root: &Path,
    dir: &Path,
    files: &mut BTreeMap<String, Vec<u8>>,
    size: &mut usize,
    visited: &mut usize,
    depth: usize,
) -> Result<(), String> {
    if depth > 12 {
        return Err("工程子目录层数过多，请使用独立的 LaTeX 工程目录".into());
    }
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        *visited += 1;
        if *visited > 10000 {
            return Err("工程目录文件过多，请将 TeX 与依赖放在独立目录".into());
        }
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.')
            || ["node_modules", "target", "build", "dist"].contains(&name.as_str())
        {
            continue;
        }
        let kind = item.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        let path = item.path();
        if !path
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(root)
        {
            return Err("工程依赖超出了主文件目录".into());
        }
        if kind.is_dir() {
            collect_project(root, &path, files, size, visited, depth + 1)?;
        } else if kind.is_file() && crate::tex::project_file(&name) {
            // Limit before allocation; source files remain read-only throughout compilation.
            let len = item.metadata().map_err(|e| e.to_string())?.len();
            if len > (100 * 1024 * 1024usize).saturating_sub(*size) as u64 || files.len() >= 500 {
                return Err("工程超过 100 MB / 500 个依赖文件，请使用独立工程目录".into());
            }
            let mut bytes = Vec::new();
            fs::File::open(&path)
                .map_err(|e| e.to_string())?
                .take((100 * 1024 * 1024usize - *size + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            *size += bytes.len();
            if *size > 100 * 1024 * 1024 {
                return Err("工程超过 100 MB".into());
            }
            files.insert(
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
                bytes,
            );
        }
    }
    Ok(())
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
        let files = LocalFiles::default();
        let opened = files.select(path.clone()).unwrap();
        let result = files
            .compile(&opened.id, source.into(), "xelatex".into(), &opened.stamp)
            .unwrap();
        let pdf = STANDARD.decode(result.pdf_base64.unwrap()).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(pdf.len() > 1000);
        assert!(!result.log.contains("undefined references"));
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
