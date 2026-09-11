use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};

pub struct WorkspaceStore {
    root: PathBuf,
    active: Mutex<PathBuf>,
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = tempfile::NamedTempFile::new_in(path.parent().ok_or("missing parent")?)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn valid_ref(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 180
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("Invalid attachment reference".into());
    }
    Ok(value)
}
impl WorkspaceStore {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let pointer = root.join("active.txt");
        let id = if pointer.exists() {
            fs::read_to_string(&pointer).map_err(|e| e.to_string())?
        } else {
            uuid::Uuid::new_v4().to_string()
        };
        valid_ref(&id)?;
        let active = root.join(&id);
        fs::create_dir_all(active.join("blobs")).map_err(|e| e.to_string())?;
        if !pointer.exists() {
            atomic_write(&pointer, id.as_bytes())?;
        }
        Ok(Self {
            root,
            active: Mutex::new(active),
        })
    }
    fn restore(&self, database: &[u8], blobs: BTreeMap<String, String>) -> Result<(), String> {
        let mut active = self.active.lock().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let next = self.root.join(&id);
        fs::create_dir_all(next.join("blobs")).map_err(|e| e.to_string())?;
        for (name, encoded) in blobs {
            let bytes = STANDARD.decode(encoded).map_err(|e| e.to_string())?;
            atomic_write(&next.join("blobs").join(valid_ref(&name)?), &bytes)?;
        }
        atomic_write(&next.join("workspace.sqlite"), database)?;
        // Publish only after every file is durable. Old generation is retained.
        atomic_write(&self.root.join("active.txt"), id.as_bytes())?;
        *active = next;
        Ok(())
    }
}
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let root = app.path().app_data_dir()?.join("workspaces");
    app.manage(WorkspaceStore::open(root).map_err(std::io::Error::other)?);
    Ok(())
}
#[tauri::command]
pub fn workspace_read(store: State<WorkspaceStore>) -> Result<Option<String>, String> {
    let active = store.active.lock().map_err(|e| e.to_string())?;
    match fs::read(active.join("workspace.sqlite")) {
        Ok(bytes) => Ok(Some(STANDARD.encode(bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
pub fn workspace_write(store: State<WorkspaceStore>, database: String) -> Result<(), String> {
    let active = store.active.lock().map_err(|e| e.to_string())?;
    atomic_write(
        &active.join("workspace.sqlite"),
        &STANDARD.decode(database).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
pub fn workspace_restore(
    store: State<WorkspaceStore>,
    database: String,
    blobs: BTreeMap<String, String>,
) -> Result<(), String> {
    let bytes = STANDARD.decode(database).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"SQLite format 3\0") {
        return Err("Invalid SQLite file".into());
    }
    store.restore(&bytes, blobs)
}
#[tauri::command]
pub fn workspace_path(store: State<WorkspaceStore>) -> String {
    store.root.to_string_lossy().to_string()
}
#[tauri::command]
pub fn blob_put(store: State<WorkspaceStore>, name: String, data: String) -> Result<(), String> {
    let active = store.active.lock().map_err(|e| e.to_string())?;
    atomic_write(
        &active.join("blobs").join(valid_ref(&name)?),
        &STANDARD.decode(data).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
pub fn blob_get(store: State<WorkspaceStore>, name: String) -> Result<Option<String>, String> {
    let active = store.active.lock().map_err(|e| e.to_string())?;
    match fs::read(active.join("blobs").join(valid_ref(&name)?)) {
        Ok(bytes) => Ok(Some(STANDARD.encode(bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
pub fn blob_list(store: State<WorkspaceStore>) -> Result<Vec<String>, String> {
    let active = store.active.lock().map_err(|e| e.to_string())?;
    fs::read_dir(active.join("blobs"))
        .map_err(|e| e.to_string())?
        .map(|e| {
            e.map(|v| v.file_name().to_string_lossy().to_string())
                .map_err(|e| e.to_string())
        })
        .collect()
}
#[tauri::command]
pub fn secret_get(name: String) -> Result<Option<String>, String> {
    match keyring::Entry::new("edu.mpw.modudesk", &name)
        .map_err(|e| e.to_string())?
        .get_password()
    {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    keyring::Entry::new("edu.mpw.modudesk", &name)
        .map_err(|e| e.to_string())?
        .set_password(&value)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    match keyring::Entry::new("edu.mpw.modudesk", &name)
        .map_err(|e| e.to_string())?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    #[ignore = "writes and removes a temporary Windows credential"]
    fn windows_credential_roundtrip() {
        let name = format!("modudesk-selftest-{}", uuid::Uuid::new_v4());
        let entry = keyring::Entry::new("edu.mpw.modudesk", &name).unwrap();
        entry.set_password("temporary-selftest-value").unwrap();
        let read = entry.get_password();
        entry.delete_credential().unwrap();
        assert_eq!(read.unwrap(), "temporary-selftest-value");
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
    #[test]
    fn restore_publishes_complete_generation_and_retains_previous() {
        let temp = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::open(temp.path().to_path_buf()).unwrap();
        let old = store.active.lock().unwrap().clone();
        atomic_write(&old.join("workspace.sqlite"), b"old").unwrap();
        let mut blobs = BTreeMap::new();
        blobs.insert("b_test".into(), STANDARD.encode(b"pdf"));
        store.restore(b"new", blobs).unwrap();
        let reopened = WorkspaceStore::open(temp.path().to_path_buf()).unwrap();
        let active = reopened.active.lock().unwrap();
        assert_eq!(fs::read(active.join("workspace.sqlite")).unwrap(), b"new");
        assert_eq!(fs::read(active.join("blobs/b_test")).unwrap(), b"pdf");
        assert_eq!(fs::read(old.join("workspace.sqlite")).unwrap(), b"old");
    }
    #[test]
    fn failed_restore_does_not_change_active_generation() {
        let temp = tempfile::tempdir().unwrap();
        let store = WorkspaceStore::open(temp.path().to_path_buf()).unwrap();
        let previous = fs::read(temp.path().join("active.txt")).unwrap();
        let mut blobs = BTreeMap::new();
        blobs.insert("../escape".into(), STANDARD.encode(b"bad"));
        assert!(store.restore(b"new", blobs).is_err());
        assert_eq!(fs::read(temp.path().join("active.txt")).unwrap(), previous);
    }
}
