//! Resolve literal LaTeX references without walking unrelated directories.
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

const MAX_BYTES: usize = 100 * 1024 * 1024;
const MAX_FILES: usize = 500;

// A small TeX scanner: balanced arguments, optional arguments and comments matter
// here; regular expressions would miss nested graphicspath groups, for example.
fn uncomment(text: &str) -> String {
    let mut result = String::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            result.push(c);
            if let Some(next) = chars.next() {
                result.push(next);
            }
        } else if c == '%' {
            for next in chars.by_ref() {
                if next == '\n' {
                    result.push('\n');
                    break;
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}
fn whitespace(text: &str, at: &mut usize) {
    while *at < text.len() && text.as_bytes()[*at].is_ascii_whitespace() {
        *at += 1;
    }
}
fn group(text: &str, at: &mut usize, open: u8, close: u8) -> Option<String> {
    whitespace(text, at);
    if text.as_bytes().get(*at) != Some(&open) {
        return None;
    }
    *at += 1;
    let start = *at;
    let mut depth = 1;
    while *at < text.len() {
        let c = text.as_bytes()[*at];
        if c == b'\\' {
            *at = (*at + 2).min(text.len());
            continue;
        }
        if c == open {
            depth += 1;
        }
        if c == close {
            depth -= 1;
            if depth == 0 {
                let value = text[start..*at].to_string();
                *at += 1;
                return Some(value);
            }
        }
        *at += 1;
    }
    None
}
fn commands(text: &str) -> Vec<(String, String, Option<String>)> {
    let text = uncomment(text);
    let mut at = 0;
    let mut result = Vec::new();
    while at < text.len() {
        if text.as_bytes()[at] != b'\\' {
            at += 1;
            continue;
        }
        at += 1;
        let start = at;
        while at < text.len() && text.as_bytes()[at].is_ascii_alphabetic() {
            at += 1;
        }
        if at == start {
            at = (at + 1).min(text.len());
            continue;
        }
        let name = &text[start..at];
        // Leave unknown command bodies in the scan stream (e.g. AtBeginDocument
        // and template definitions can contain literal file references).
        if ![
            "verb",
            "begin",
            "input",
            "include",
            "subfile",
            "InputIfFileExists",
            "IfFileExists",
            "lstinputlisting",
            "verbatiminput",
            "documentclass",
            "LoadClass",
            "LoadClassWithOptions",
            "usepackage",
            "RequirePackage",
            "RequirePackageWithOptions",
            "bibliography",
            "addbibresource",
            "bibliographystyle",
            "RequireBibliographyStyle",
            "RequireCitationStyle",
            "includegraphics",
            "includepdf",
            "graphicspath",
            "import",
            "subimport",
            "inputfrom",
            "subinputfrom",
            "includefrom",
            "subincludefrom",
        ]
        .contains(&name)
        {
            continue;
        }
        if text.as_bytes().get(at) == Some(&b'*') {
            at += 1;
        }
        if name == "verb" {
            if let Some(&delimiter) = text.as_bytes().get(at) {
                at += 1;
                while at < text.len() && text.as_bytes()[at] != delimiter {
                    at += 1;
                }
                at = (at + 1).min(text.len());
            }
            continue;
        }
        let mut options = Vec::new();
        while let Some(option) = group(&text, &mut at, b'[', b']') {
            options.push(option);
        }
        let mut first = group(&text, &mut at, b'{', b'}');
        if first.is_none() && name == "input" {
            let start = at;
            while at < text.len()
                && !text.as_bytes()[at].is_ascii_whitespace()
                && !b"\\{}".contains(&text.as_bytes()[at])
            {
                at += 1;
            }
            first = Some(text[start..at].into());
        }
        if let Some(first) = first {
            if ["usepackage", "RequirePackage"].contains(&name)
                && first.split(',').any(|p| p.trim() == "biblatex")
            {
                for option in options {
                    for setting in option.split(',') {
                        if let Some((key, value)) = setting.split_once('=') {
                            let key = key.trim();
                            let value = value.trim().trim_matches(['{', '}']);
                            if ["style", "bibstyle"].contains(&key) {
                                result.push((
                                    "RequireBibliographyStyle".into(),
                                    value.into(),
                                    None,
                                ));
                            }
                            if ["style", "citestyle"].contains(&key) {
                                result.push(("RequireCitationStyle".into(), value.into(), None));
                            }
                        }
                    }
                }
            }
            if name == "begin"
                && ["verbatim", "Verbatim", "lstlisting", "minted"].contains(&first.as_str())
            {
                let end = format!("\\end{{{first}}}");
                if let Some(offset) = text[at..].find(&end) {
                    at += offset + end.len();
                }
                continue;
            }
            let second = if [
                "import",
                "subimport",
                "inputfrom",
                "subinputfrom",
                "includefrom",
                "subincludefrom",
            ]
            .contains(&name)
            {
                group(&text, &mut at, b'{', b'}')
            } else {
                None
            };
            result.push((name.into(), first, second));
        }
    }
    result
}

fn relative(base: &str, name: &str) -> Result<String, String> {
    let name = name.trim().trim_matches('"');
    if name.contains([':', '\\']) || Path::new(name).is_absolute() {
        return Err(format!("工程依赖超出了主文件目录：{name}"));
    }
    let joined = Path::new(base).join(name);
    let mut parts = Vec::new();
    for part in joined.components() {
        match part {
            Component::Normal(value) => parts.push(value.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir if !parts.is_empty() => {
                parts.pop();
            }
            _ => return Err(format!("工程依赖超出了主文件目录：{name}")),
        }
    }
    Ok(parts.join("/"))
}
struct Collector<'a> {
    root: &'a Path,
    entry: String,
    files: BTreeMap<String, Vec<u8>>,
    sources: BTreeMap<String, String>, // filename -> import base
    graphics: Vec<String>,
    size: usize,
}
impl Collector<'_> {
    fn add(
        &mut self,
        name: &str,
        extensions: &[&str],
        base: &str,
        image: bool,
    ) -> Result<(), String> {
        // TeX macros require expansion by the engine. Do not guess their values.
        if name.trim().is_empty() || name.contains(['\\', '#', '{', '}']) {
            return Ok(());
        }
        let mut bases = vec![base.to_string()];
        if image {
            bases.extend(self.graphics.clone());
        }
        if !base.is_empty() {
            bases.push(String::new());
        }
        for base in bases {
            let stem = relative(&base, name)?;
            let mut candidates = Vec::new();
            if Path::new(&stem).extension().is_some() {
                candidates.push(stem.clone());
            }
            candidates.extend(extensions.iter().map(|ext| format!("{stem}.{ext}")));
            for key in candidates {
                if key == self.entry || self.files.contains_key(&key) {
                    return Ok(());
                }
                let path = self.root.join(&key);
                if !path.is_file() {
                    continue;
                } // Distribution packages remain resolved by TeX.
                if !path
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    .starts_with(self.root)
                {
                    return Err(format!("工程依赖超出了主文件目录：{key}"));
                }
                // Reject symlinks in any component, including directory junctions that escape.
                let mut ancestor = PathBuf::from(self.root);
                for part in Path::new(&key).components() {
                    ancestor.push(part.as_os_str());
                    if fs::symlink_metadata(&ancestor)
                        .map_err(|e| e.to_string())?
                        .file_type()
                        .is_symlink()
                    {
                        return Err(format!("工程依赖不能使用符号链接：{key}"));
                    }
                }
                if !crate::tex::project_file(&key) {
                    return Ok(());
                }
                let remaining = MAX_BYTES.saturating_sub(self.size);
                let len = fs::metadata(&path).map_err(|e| e.to_string())?.len();
                if self.files.len() >= MAX_FILES || len > remaining as u64 {
                    return Err(format!(
                        "实际引用的依赖超过 100 MB / 500 个文件；触发文件：{key}"
                    ));
                }
                let mut bytes = Vec::new();
                fs::File::open(path)
                    .map_err(|e| e.to_string())?
                    .take((remaining + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() > remaining {
                    return Err(format!("实际引用的依赖超过 100 MB：{key}"));
                }
                self.size += bytes.len();
                let ext = key.rsplit('.').next().unwrap_or("").to_lowercase();
                if ["tex", "sty", "cls", "bbx", "cbx", "def", "fd", "clo"].contains(&ext.as_str()) {
                    self.sources.insert(key.clone(), base);
                }
                self.files.insert(key, bytes);
                return Ok(());
            }
        }
        Ok(())
    }
    fn scan(&mut self, text: &str, base: &str) -> Result<(), String> {
        for (command, value, second) in commands(text) {
            let (extensions, multiple, image): (&[&str], bool, bool) = match command.as_str() {
                "input" | "include" | "subfile" | "InputIfFileExists" | "IfFileExists"
                | "lstinputlisting" | "verbatiminput" => (&["tex"], false, false),
                "documentclass" | "LoadClass" | "LoadClassWithOptions" => (&["cls"], false, false),
                "usepackage" | "RequirePackage" | "RequirePackageWithOptions" => {
                    (&["sty"], true, false)
                }
                "bibliography" => (&["bib"], true, false),
                "addbibresource" => (&["bib"], false, false),
                "bibliographystyle" => (&["bst"], false, false),
                "RequireBibliographyStyle" => (&["bbx"], false, false),
                "RequireCitationStyle" => (&["cbx"], false, false),
                "includegraphics" => (&["pdf", "png", "jpg", "jpeg", "mps", "eps"], false, true),
                "includepdf" => (&["pdf"], false, true),
                "graphicspath" => {
                    let mut at = 0;
                    while let Some(path) = group(&value, &mut at, b'{', b'}') {
                        if path.contains('\\') {
                            continue;
                        }
                        let path = relative(base, &path)?;
                        if !self.graphics.contains(&path) {
                            self.graphics.push(path);
                        }
                    }
                    continue;
                }
                "import" | "subimport" | "inputfrom" | "subinputfrom" | "includefrom"
                | "subincludefrom" => {
                    if let Some(file) = second {
                        if !value.contains('\\') {
                            let prefix = relative(
                                if command.starts_with("sub") { base } else { "" },
                                &value,
                            )?;
                            self.add(&file, &["tex"], &prefix, false)?;
                        }
                    }
                    continue;
                }
                _ => continue,
            };
            if multiple {
                for name in value.split(',') {
                    self.add(name, extensions, base, image)?;
                }
            } else {
                self.add(&value, extensions, base, image)?;
            }
        }
        Ok(())
    }
}
pub fn collect(
    root: &Path,
    entry: &Path,
    source: &str,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut collector = Collector {
        root,
        entry: entry
            .file_name()
            .ok_or("工程入口无效")?
            .to_string_lossy()
            .into(),
        files: BTreeMap::new(),
        sources: BTreeMap::new(),
        graphics: Vec::new(),
        size: source.len(),
    };
    loop {
        let before = (collector.files.len(), collector.graphics.len());
        collector.scan(source, "")?;
        for (name, base) in collector.sources.clone() {
            let text = String::from_utf8_lossy(&collector.files[&name]).into_owned();
            collector.scan(&text, &base)?;
        }
        if before == (collector.files.len(), collector.graphics.len()) {
            break;
        }
    }
    Ok(collector.files)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_unrelated_directory_does_not_count_toward_dependencies() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("unrelated")).unwrap();
        fs::File::create(root.join("large.pdf"))
            .unwrap()
            .set_len(101 * 1024 * 1024)
            .unwrap();
        for i in 0..510 {
            fs::write(root.join(format!("unrelated/{i}.tex")), "unused").unwrap();
        }
        fs::write(root.join("chapter.tex"), "正文").unwrap();
        let files = collect(&root, &root.join("main.tex"), "\\input{chapter}").unwrap();
        assert_eq!(files.keys().collect::<Vec<_>>(), vec!["chapter.tex"]);
        assert!(collect(
            &root,
            &root.join("main.tex"),
            "\\includegraphics{large.pdf}"
        )
        .unwrap_err()
        .contains("large.pdf"));
    }
    #[test]
    fn resolves_nested_inputs_graphics_imports_and_templates_without_cycles() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for folder in ["chapters", "figures", "imported"] {
            fs::create_dir(root.join(folder)).unwrap();
        }
        for (name, content) in [
            ("main.tex", "old source"),
            ("chapters/one.tex", "\\input{main}\\input chapters/two"),
            ("chapters/two.tex", "\\includegraphics[width={2cm}]{图 1}"),
            ("figures/图 1.png", "image"),
            ("local.cls", "\\RequirePackage{one,two}"),
            ("one.sty", "\\input{settings.def}"),
            ("two.sty", ""),
            ("settings.def", ""),
            ("refs.bib", ""),
            ("style.bst", ""),
            ("imported/chapter.tex", "\\input{child}"),
            ("imported/child.tex", ""),
        ] {
            fs::write(root.join(name), content).unwrap();
        }
        let source = "\\documentclass{local}\n%\\input{large}\n\\input{chapters/one}\n\\graphicspath{{figures/}}\n\\bibliography{refs}\n\\bibliographystyle{style}\n\\import{imported/}{chapter.tex}";
        let files = collect(&root, &root.join("main.tex"), source).unwrap();
        assert_eq!(files.len(), 11);
        assert!(!files.contains_key("main.tex"));
        for key in [
            "figures/图 1.png",
            "settings.def",
            "imported/child.tex",
            "refs.bib",
        ] {
            assert!(files.contains_key(key), "{key}");
        }
    }
    #[test]
    fn comments_and_verbatim_are_not_dependencies_and_paths_stay_inside_root() {
        let parsed = commands("%\\input{ignored}\n\\verb|\\input{ignored}|\n\\begin{verbatim}\\input{ignored}\\end{verbatim}\n\\input{real}");
        assert_eq!(parsed, vec![("input".into(), "real".into(), None)]);
        assert_eq!(
            relative("chapters", "../figures/a.png").unwrap(),
            "figures/a.png"
        );
        for path in ["../outside.tex", "C:/outside.tex", "/outside.tex"] {
            assert!(relative("", path).is_err());
        }
    }
    #[test]
    fn actual_dependency_count_is_still_bounded() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let mut source = String::new();
        for i in 0..501 {
            fs::write(root.join(format!("{i}.tex")), "").unwrap();
            source.push_str(&format!("\\input{{{i}}}"));
        }
        let error = collect(&root, &root.join("main.tex"), &source).unwrap_err();
        assert!(error.contains("实际引用") && error.contains("500.tex"));
    }
}
