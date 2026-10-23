#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            allow_media_paths,
            ai_keychain_status,
            ai_keychain_get,
            ai_keychain_set,
            ai_keychain_delete
        ])
        .setup(|app| {
            allow_last_project_file(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

const AI_KEYCHAIN_SERVICE: &str = "com.ailexsi.resonance-studio-v6-0";
const AI_KEYCHAIN_USER: &str = "ai-director-api-key";

fn ai_key_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(AI_KEYCHAIN_SERVICE, AI_KEYCHAIN_USER).map_err(|err| err.to_string())
}

fn is_missing(err: &keyring::Error) -> bool {
    matches!(err, keyring::Error::NoEntry)
}

/// Probe. Does not return the secret. Missing entry still means the store opened.
#[tauri::command]
fn ai_keychain_status() -> Result<(), String> {
    let entry = ai_key_entry()?;
    match entry.get_password() {
        Ok(_) => Ok(()),
        Err(err) if is_missing(&err) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn ai_keychain_get() -> Result<String, String> {
    let entry = ai_key_entry()?;
    match entry.get_password() {
        Ok(value) => Ok(value),
        Err(err) if is_missing(&err) => Ok(String::new()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn ai_keychain_set(secret: String) -> Result<(), String> {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return ai_keychain_delete();
    }
    let entry = ai_key_entry()?;
    entry.set_password(trimmed).map_err(|err| err.to_string())
}

#[tauri::command]
fn ai_keychain_delete() -> Result<(), String> {
    let entry = ai_key_entry()?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(err) if is_missing(&err) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

/// User-picked / remembered paths only. Does not allow C:\ wholesale.
#[tauri::command]
fn allow_media_paths(app: tauri::AppHandle, paths: Vec<String>) {
    use tauri_plugin_fs::FsExt;
    for path in paths {
        if path.is_empty() {
            continue;
        }
        let _ = app.fs_scope().allow_file(&path);
    }
}

/// Grant the remembered project path (string, not a Chrome handle) so autostart
/// can read it, plus each asset sourcePath in that JSON.
fn allow_last_project_file(app: &tauri::App) {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let last = dir.join("last-project.json");
    let Ok(text) = std::fs::read_to_string(&last) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let Some(path) = value.get("path").and_then(|p| p.as_str()) else {
        return;
    };
    if path.is_empty() {
        return;
    }
    let _ = app.fs_scope().allow_file(path);
    allow_source_paths_in_project(app, path);
}

fn allow_source_paths_in_project(app: &tauri::App, project_path: &str) {
    use tauri_plugin_fs::FsExt;
    let Ok(text) = std::fs::read_to_string(project_path) else {
        return;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let Some(assets) = value.get("assets").and_then(|a| a.as_array()) else {
        return;
    };
    for asset in assets {
        if let Some(src) = asset.get("sourcePath").and_then(|p| p.as_str()) {
            if !src.is_empty() {
                let _ = app.fs_scope().allow_file(src);
            }
        }
    }
}
