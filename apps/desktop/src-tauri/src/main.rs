#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod storage;
mod tex;
use tauri::Manager;
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .setup(storage::setup)
        .invoke_handler(tauri::generate_handler![
            tex::compile_latex,
            storage::workspace_read,
            storage::workspace_write,
            storage::workspace_restore,
            storage::workspace_path,
            storage::blob_get,
            storage::blob_put,
            storage::blob_list,
            storage::secret_get,
            storage::secret_set,
            storage::secret_delete
        ])
        .run(tauri::generate_context!())
        .expect("ModuDesk 启动失败");
}
