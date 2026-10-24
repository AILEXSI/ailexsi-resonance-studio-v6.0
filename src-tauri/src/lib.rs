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
            ai_keychain_delete,
            lyrics_whisper_align
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

/// Run a local whisper.cpp binary the user configured. No download and no network.
#[tauri::command]
fn lyrics_whisper_align(executable: String, model: String, audio_path: String) -> Result<String, String> {
    let executable = executable.trim().to_string();
    let model = model.trim().to_string();
    let audio = audio_path.trim().to_string();
    if executable.is_empty() || model.is_empty() {
        return Err("whisper.cpp is not configured. Nothing was sent.".into());
    }
    if audio.is_empty() {
        return Err("No local audio file is available for alignment. Nothing was sent.".into());
    }
    if executable.contains('\n') || executable.contains('\r') || model.contains('\n') || audio.contains('\n') {
        return Err("whisper.cpp paths are invalid. Nothing was sent.".into());
    }
    if !std::path::Path::new(&executable).is_file() {
        return Err("whisper.cpp executable was not found. Nothing was sent.".into());
    }
    if !std::path::Path::new(&model).is_file() {
        return Err("whisper.cpp model file was not found. Nothing was sent.".into());
    }
    if !std::path::Path::new(&audio).is_file() {
        return Err("Audio file was not found. Nothing was sent.".into());
    }
    let dir = std::env::temp_dir().join(format!("ailexsi-whisper-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|_| {
        "Could not prepare a temporary folder for whisper.cpp. Nothing was sent.".to_string()
    })?;
    let stem = dir.join("align");
    let output = std::process::Command::new(&executable)
        .arg("-m")
        .arg(&model)
        .arg("-f")
        .arg(&audio)
        .arg("-oj")
        .arg("-of")
        .arg(&stem)
        .output()
        .map_err(|_| "whisper.cpp could not start. Nothing was sent.".to_string())?;
    let json = read_whisper_json(&dir, &output.stdout);
    let _ = std::fs::remove_dir_all(&dir);
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let short: String = err.chars().take(400).collect();
        return Err(format!("whisper.cpp failed. {short} Nothing was changed."));
    }
    json.filter(|text| !text.trim().is_empty())
        .ok_or_else(|| "whisper.cpp returned no JSON. Nothing was changed.".to_string())
}

fn read_whisper_json(dir: &std::path::Path, stdout: &[u8]) -> Option<String> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
                if let Ok(text) = std::fs::read_to_string(path) {
                    if text.len() <= 2_000_000 {
                        return Some(text);
                    }
                }
            }
        }
    }
    let text = String::from_utf8_lossy(stdout).trim().to_string();
    if text.starts_with('{') && text.len() <= 2_000_000 {
        return Some(text);
    }
    None
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
