#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            allow_media_paths,
            ai_keychain_status,
            ai_keychain_exists,
            ai_keychain_set,
            ai_keychain_delete,
            ai_chat,
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

/// True when a non-empty key is stored. The password never leaves this process.
#[tauri::command]
fn ai_keychain_exists() -> Result<bool, String> {
    match stored_api_key() {
        Ok(value) => Ok(value.is_some()),
        Err(err) => Err(err),
    }
}

fn stored_api_key() -> Result<Option<String>, String> {
    let entry = ai_key_entry()?;
    match entry.get_password() {
        Ok(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(err) if is_missing(&err) => Ok(None),
        Err(_) => Err("OS keychain could not be read. Nothing was sent.".into()),
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

const AI_CHAT_BODY_LIMIT: u64 = 8 * 1024 * 1024;
const AI_CHAT_REQUEST_LIMIT: usize = 1_000_000;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiChatRequest {
    base_url: String,
    model: String,
    messages: serde_json::Value,
    tools: serde_json::Value,
    /// Typed into the session field. Used for this request only and not stored.
    session_key: Option<String>,
}

#[derive(serde::Serialize)]
struct AiChatResponse {
    status: u16,
    body: String,
}

struct ChatPlan {
    url: String,
    authorization: Option<String>,
}

fn local_provider_host(host: &str) -> bool {
    // `url::Url::host_str` keeps the IPv6 brackets.
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

/// Build the chat URL and the bearer value. A stored key is never attached to loopback.
fn plan_ai_chat(
    base_url: &str,
    model: &str,
    session_key: Option<&str>,
    stored_key: Option<&str>,
) -> Result<ChatPlan, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("Model name required. Nothing was sent.".into());
    }
    let url = chat_endpoint(base_url)?;
    let host = url.host_str().unwrap_or("");
    let local = local_provider_host(host);
    if local && url.scheme() != "http" && url.scheme() != "https" {
        return Err("Local providers need http or https. Nothing was sent.".into());
    }
    if !local && url.scheme() != "https" {
        return Err("Cloud providers need https. Nothing was sent.".into());
    }
    let session = session_key.map(str::trim).filter(|value| !value.is_empty());
    if let Some(secret) = session {
        reject_header_secret(secret)?;
        return Ok(ChatPlan {
            url: url.to_string(),
            authorization: Some(format!("Bearer {secret}")),
        });
    }
    if local {
        return Ok(ChatPlan {
            url: url.to_string(),
            authorization: None,
        });
    }
    let stored = stored_key.map(str::trim).filter(|value| !value.is_empty());
    let Some(secret) = stored else {
        return Err("Cloud providers need a key supplied at runtime. Nothing was sent.".into());
    };
    reject_header_secret(secret)?;
    Ok(ChatPlan {
        url: url.to_string(),
        authorization: Some(format!("Bearer {secret}")),
    })
}

fn reject_header_secret(secret: &str) -> Result<(), String> {
    if secret.len() > 4096 || secret.chars().any(|ch| ch.is_control() || ch == ' ') {
        return Err("The API key is invalid. Nothing was sent.".into());
    }
    Ok(())
}

fn chat_endpoint(base_url: &str) -> Result<url::Url, String> {
    let mut url = url::Url::parse(base_url.trim())
        .map_err(|_| "Invalid base URL. Nothing was sent.".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Invalid base URL. Nothing was sent.".into());
    }
    if url.host_str().is_none() {
        return Err("Invalid base URL. Nothing was sent.".into());
    }
    let path = url.path().trim_end_matches('/');
    url.set_path(&format!("{path}/chat/completions"));
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

/// Reads the key in-process, sets Authorization, and returns only the provider body.
#[tauri::command]
fn ai_chat(request: AiChatRequest) -> Result<AiChatResponse, String> {
    let session = request.session_key.as_deref();
    let needs_store = session
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
        && chat_endpoint(&request.base_url)
            .ok()
            .and_then(|url| url.host_str().map(|host| !local_provider_host(host)))
            .unwrap_or(false);
    let stored = if needs_store { stored_api_key()? } else { None };
    let plan = plan_ai_chat(
        &request.base_url,
        &request.model,
        session,
        stored.as_deref(),
    )?;
    let payload = serde_json::json!({
        "model": request.model.trim(),
        "stream": true,
        "messages": request.messages,
        "tools": request.tools,
    });
    let body = serde_json::to_vec(&payload)
        .map_err(|_| "Provider request failed. Nothing was changed.".to_string())?;
    if body.len() > AI_CHAT_REQUEST_LIMIT {
        return Err("Provider request failed. Nothing was changed.".into());
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Provider request failed. Nothing was changed.".to_string())?;
    let mut call = client
        .post(&plan.url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "text/event-stream");
    if let Some(authorization) = plan.authorization {
        let header = reqwest::header::HeaderValue::from_str(&authorization)
            .map_err(|_| "The API key is invalid. Nothing was sent.".to_string())?;
        call = call.header(reqwest::header::AUTHORIZATION, header);
    }
    let response = call
        .body(body)
        .send()
        .map_err(|_| "Provider request failed. Nothing was changed.".to_string())?;
    let status = response.status().as_u16();
    let mut limited = std::io::Read::take(response, AI_CHAT_BODY_LIMIT + 1);
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut limited, &mut bytes)
        .map_err(|_| "Provider response was not text. Nothing was changed.".to_string())?;
    if bytes.len() as u64 > AI_CHAT_BODY_LIMIT {
        return Err("Provider response is too large. Nothing was changed.".into());
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| "Provider response was not text. Nothing was changed.".to_string())?;
    Ok(AiChatResponse { status, body: text })
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

#[cfg(test)]
mod ai_chat_tests {
    use super::{plan_ai_chat, ChatPlan};

    fn auth(plan: &ChatPlan) -> Option<&str> {
        plan.authorization.as_deref()
    }

    #[test]
    fn ollama_on_loopback_sends_no_key_even_when_one_is_stored() {
        for base in [
            "http://127.0.0.1:11434/v1",
            "http://localhost:11434/v1/",
            "http://[::1]:11434/v1",
            "http://127.0.0.1:9999/v1",
        ] {
            let plan = plan_ai_chat(base, "qwen2.5:7b", None, Some("stored-cloud-key"))
                .unwrap_or_else(|err| panic!("{base}: {err}"));
            assert!(plan.url.ends_with("/v1/chat/completions"), "{}", plan.url);
            assert!(auth(&plan).is_none(), "{base}");
            assert!(!plan.url.contains("stored-cloud-key"));
        }
    }

    #[test]
    fn session_key_is_a_header_value_and_is_not_part_of_the_url() {
        let plan = plan_ai_chat(
            "https://example.com/v1?token=nope",
            "m",
            Some("session-key"),
            Some("stored-cloud-key"),
        )
        .unwrap();
        assert_eq!(plan.url, "https://example.com/v1/chat/completions");
        assert_eq!(auth(&plan), Some("Bearer session-key"));
    }

    #[test]
    fn cloud_without_a_session_key_uses_the_stored_key() {
        let plan = plan_ai_chat(
            "https://example.com/v1",
            "m",
            Some("  "),
            Some("stored-cloud-key"),
        )
        .unwrap();
        assert_eq!(auth(&plan), Some("Bearer stored-cloud-key"));
    }

    #[test]
    fn cloud_without_any_key_is_refused() {
        let err = match plan_ai_chat("https://example.com/v1", "m", None, None) {
            Err(message) => message,
            Ok(_) => panic!("cloud chat without a key was allowed"),
        };
        assert!(err.contains("Nothing was sent"));
        assert!(!err.contains("stored"));
    }

    #[test]
    fn cleartext_cloud_and_bad_keys_are_refused() {
        assert!(plan_ai_chat("http://example.com/v1", "m", Some("k"), None).is_err());
        assert!(plan_ai_chat("https://user:secret@example.com/v1", "m", None, Some("k")).is_err());
        assert!(plan_ai_chat("https://example.com/v1", "m", Some("bad key"), None).is_err());
        assert!(plan_ai_chat("https://example.com/v1", "  ", None, Some("k")).is_err());
        assert!(plan_ai_chat("not a url", "m", None, None).is_err());
    }
}
