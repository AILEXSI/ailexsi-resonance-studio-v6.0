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
            whisper_status,
            whisper_pick_executable,
            whisper_pick_model,
            lyrics_whisper_align
        ])
        .setup(|app| {
            forbid_whisper_store(app);
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

enum SavedKey {
    Missing,
    /// A password from before the host was stored. Never sent.
    Legacy,
    Bound { origin: String, secret: String },
}

fn stored_api_key() -> Result<Option<String>, String> {
    match read_saved_key()? {
        SavedKey::Bound { secret, .. } => Ok(Some(secret)),
        SavedKey::Legacy => Ok(Some(String::new())),
        SavedKey::Missing => Ok(None),
    }
}

fn read_saved_key() -> Result<SavedKey, String> {
    let entry = ai_key_entry()?;
    match entry.get_password() {
        Ok(value) => Ok(parse_saved_key(&value)),
        Err(err) if is_missing(&err) => Ok(SavedKey::Missing),
        Err(_) => Err("OS keychain could not be read. Nothing was sent.".into()),
    }
}

fn parse_saved_key(value: &str) -> SavedKey {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return SavedKey::Missing;
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return SavedKey::Legacy;
    };
    let origin = parsed.get("origin").and_then(|item| item.as_str()).unwrap_or("").trim();
    let secret = parsed.get("secret").and_then(|item| item.as_str()).unwrap_or("").trim();
    if origin.is_empty() || secret.is_empty() {
        return SavedKey::Legacy;
    }
    SavedKey::Bound {
        origin: origin.to_string(),
        secret: secret.to_string(),
    }
}

#[tauri::command]
fn ai_keychain_set(secret: String, base_url: String) -> Result<(), String> {
    let trimmed = secret.trim();
    if trimmed.is_empty() {
        return ai_keychain_delete();
    }
    reject_header_secret(trimmed)?;
    let origin = provider_origin(&base_url)?;
    let payload = serde_json::json!({ "origin": origin, "secret": trimmed });
    let entry = ai_key_entry()?;
    entry
        .set_password(&payload.to_string())
        .map_err(|_| "OS keychain could not be written. Nothing was saved.".to_string())
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
    /// The host shown in the panel for this send. The session key is refused if it differs.
    shown_base_url: Option<String>,
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

/// scheme + host + port. Default ports are written out so :443 matches a bare https URL.
fn provider_origin(base_url: &str) -> Result<String, String> {
    let url = url::Url::parse(base_url.trim()).map_err(|_| "Invalid base URL. Nothing was sent.".to_string())?;
    if !url.username().is_empty() || url.password().is_some() || url.host_str().is_none() {
        return Err("Invalid base URL. Nothing was sent.".into());
    }
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("Invalid base URL. Nothing was sent.".into());
    }
    let host = url.host_str().unwrap_or("");
    let port = url.port_or_known_default().unwrap_or(if scheme == "https" { 443 } else { 80 });
    Ok(format!("{scheme}://{host}:{port}"))
}

const SESSION_HOST_ERROR: &str = "The session key is only sent to the host shown in this request. Nothing was sent.";
const LEGACY_KEY_ERROR: &str = "The saved key has no provider host. Save it again for this host. Nothing was sent.";

/// Build the chat URL and the bearer value.
/// A stored key is sent only to the origin saved with it, and never to loopback.
/// A session key is sent only when the request origin is the origin shown for this send.
fn plan_ai_chat(
    base_url: &str,
    shown_base_url: &str,
    model: &str,
    session_key: Option<&str>,
    saved: &SavedKey,
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
    let request_origin = provider_origin(base_url)?;
    let session = session_key.map(str::trim).filter(|value| !value.is_empty());
    if let Some(secret) = session {
        let shown_origin = provider_origin(shown_base_url)?;
        if shown_origin != request_origin {
            return Err(SESSION_HOST_ERROR.into());
        }
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
    match saved {
        SavedKey::Missing => Err("Cloud providers need a key supplied at runtime. Nothing was sent.".into()),
        SavedKey::Legacy => Err(LEGACY_KEY_ERROR.into()),
        SavedKey::Bound { origin, secret } => {
            if origin != &request_origin {
                return Err(format!(
                    "The saved key is for {origin}. This request is {request_origin}. Nothing was sent."
                ));
            }
            reject_header_secret(secret)?;
            Ok(ChatPlan {
                url: url.to_string(),
                authorization: Some(format!("Bearer {secret}")),
            })
        }
    }
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
    let session_present = session.map(str::trim).filter(|value| !value.is_empty()).is_some();
    let local = chat_endpoint(&request.base_url)
        .ok()
        .and_then(|url| url.host_str().map(|host| local_provider_host(host)))
        .unwrap_or(false);
    let saved = if session_present || local {
        SavedKey::Missing
    } else {
        read_saved_key()?
    };
    let shown = request.shown_base_url.as_deref().unwrap_or("");
    let plan = plan_ai_chat(&request.base_url, shown, &request.model, session, &saved)?;
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

const WHISPER_SEAL_DIR: &str = "resonance-sealed";
const WHISPER_SEAL_FILE: &str = "whisper-cpp.json";
const WHISPER_SEAL_USER: &str = "whisper-path-seal";
const SEAL_BROKEN: &str = "The whisper.cpp choice was changed outside the file dialog. Choose the executable and model again. Nothing was started.";
const SEAL_UNAVAILABLE: &str = "App settings are not available. Nothing was started.";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WhisperStatus {
    executable_name: String,
    model_name: String,
    configured: bool,
    message: String,
}

#[derive(Default, Clone)]
struct WhisperSettings {
    executable: String,
    model: String,
}

struct WhisperMemory {
    executable: String,
    model: String,
}

static WHISPER_MEMORY: std::sync::Mutex<Option<WhisperMemory>> = std::sync::Mutex::new(None);

enum WhisperLoad {
    Empty,
    Ready(WhisperSettings),
    Broken,
}

/// Collapse `.` and `..` after treating both separators as `/`.
fn slash_clean(path: &str) -> String {
    let unified = path.trim().replace('\\', "/");
    let absolute = unified.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in unified.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    let mut out = String::new();
    if absolute {
        out.push('/');
    }
    out.push_str(&parts.join("/"));
    out
}

fn path_eq(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn path_has_prefix(path: &str, prefix: &str) -> bool {
    if path.len() < prefix.len() {
        return false;
    }
    let head = &path[..prefix.len()];
    if cfg!(windows) {
        head.eq_ignore_ascii_case(prefix)
    } else {
        head == prefix
    }
}

/// True for the sealed directory, anything inside it, and the old unsigned file.
fn path_is_whisper_store(candidate: &str, app_data: &str) -> bool {
    let cand = slash_clean(candidate);
    let root = slash_clean(app_data);
    if cand.is_empty() || root.is_empty() {
        return false;
    }
    let root_prefix = format!("{root}/");
    let legacy = format!("{root_prefix}whisper-cpp.json");
    let sealed = format!("{root_prefix}{WHISPER_SEAL_DIR}");
    let sealed_prefix = format!("{sealed}/");
    path_eq(&cand, &legacy) || path_eq(&cand, &sealed) || path_has_prefix(&cand, &sealed_prefix)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    let text = text.trim();
    if text.len() % 2 != 0 || text.is_empty() {
        return None;
    }
    let mut out = Vec::with_capacity(text.len() / 2);
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let hi = hex_nibble(bytes[index])?;
        let lo = hex_nibble(bytes[index + 1])?;
        out.push((hi << 4) | lo);
        index += 2;
    }
    Some(out)
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn mac_matches(key: &[u8], executable: &str, model: &str, mac_hex: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let Some(actual) = decode_hex(mac_hex) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(key) else {
        return false;
    };
    mac.update(&(executable.len() as u64).to_le_bytes());
    mac.update(executable.as_bytes());
    mac.update(&(model.len() as u64).to_le_bytes());
    mac.update(model.as_bytes());
    mac.verify_slice(&actual).is_ok()
}

fn whisper_mac_hex(key: &[u8], executable: &str, model: &str) -> Result<String, String> {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| SEAL_UNAVAILABLE.to_string())?;
    mac.update(&(executable.len() as u64).to_le_bytes());
    mac.update(executable.as_bytes());
    mac.update(&(model.len() as u64).to_le_bytes());
    mac.update(model.as_bytes());
    Ok(hex_encode(&mac.finalize().into_bytes()))
}

/// A stored choice is accepted only when the HMAC matches and, once this process
/// has seen a choice, the file still matches that memory.
fn check_whisper_seal(
    executable: &str,
    model: &str,
    mac: &str,
    key: &[u8],
    memory: Option<(&str, &str)>,
) -> WhisperLoad {
    let executable = executable.trim();
    let model = model.trim();
    let mac = mac.trim();
    if executable.is_empty() && model.is_empty() && mac.is_empty() {
        return if memory.is_some() {
            WhisperLoad::Broken
        } else {
            WhisperLoad::Empty
        };
    }
    if !mac_matches(key, executable, model, mac) {
        return WhisperLoad::Broken;
    }
    if let Some((seen_exe, seen_model)) = memory {
        if seen_exe != executable || seen_model != model {
            return WhisperLoad::Broken;
        }
    }
    WhisperLoad::Ready(WhisperSettings {
        executable: executable.to_string(),
        model: model.to_string(),
    })
}

fn parse_whisper_file(text: &str) -> Result<(String, String, String), ()> {
    if text.trim().is_empty() {
        return Ok((String::new(), String::new(), String::new()));
    }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| ())?;
    let executable = value.get("executable").and_then(|item| item.as_str()).unwrap_or("").to_string();
    let model = value.get("model").and_then(|item| item.as_str()).unwrap_or("").to_string();
    let mac = value.get("mac").and_then(|item| item.as_str()).unwrap_or("").to_string();
    Ok((executable, model, mac))
}

fn whisper_seal_key() -> Result<Vec<u8>, String> {
    let entry = keyring::Entry::new(AI_KEYCHAIN_SERVICE, WHISPER_SEAL_USER).map_err(|_| SEAL_UNAVAILABLE.to_string())?;
    match entry.get_password() {
        Ok(value) => {
            let bytes = decode_hex(&value).ok_or_else(|| SEAL_UNAVAILABLE.to_string())?;
            if bytes.len() != 32 {
                return Err(SEAL_UNAVAILABLE.to_string());
            }
            Ok(bytes)
        }
        Err(err) if is_missing(&err) => {
            let mut key = [0u8; 32];
            getrandom::getrandom(&mut key).map_err(|_| SEAL_UNAVAILABLE.to_string())?;
            entry
                .set_password(&hex_encode(&key))
                .map_err(|_| SEAL_UNAVAILABLE.to_string())?;
            Ok(key.to_vec())
        }
        Err(_) => Err(SEAL_UNAVAILABLE.to_string()),
    }
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map_err(|_| SEAL_UNAVAILABLE.to_string())
}

fn whisper_seal_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let root = app_data_dir(app)?;
    let dir = root.join(WHISPER_SEAL_DIR);
    std::fs::create_dir_all(&dir).map_err(|_| "App settings are not available. Nothing was saved.".to_string())?;
    let _ = std::fs::remove_file(root.join(WHISPER_SEAL_FILE));
    Ok(dir.join(WHISPER_SEAL_FILE))
}

fn memory_paths() -> Result<Option<(String, String)>, String> {
    let guard = WHISPER_MEMORY.lock().map_err(|_| SEAL_BROKEN.to_string())?;
    Ok(guard.as_ref().map(|item| (item.executable.clone(), item.model.clone())))
}

fn set_memory(next: Option<WhisperSettings>) -> Result<(), String> {
    let mut guard = WHISPER_MEMORY.lock().map_err(|_| SEAL_BROKEN.to_string())?;
    *guard = next.map(|item| WhisperMemory {
        executable: item.executable,
        model: item.model,
    });
    Ok(())
}

fn load_whisper(app: &tauri::AppHandle) -> Result<WhisperLoad, String> {
    let path = whisper_seal_path(app)?;
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let (executable, model, mac) = match parse_whisper_file(&text) {
        Ok(parsed) => parsed,
        Err(()) => {
            set_memory(None)?;
            return Ok(WhisperLoad::Broken);
        }
    };
    let key = whisper_seal_key()?;
    let seen = memory_paths()?;
    let load = check_whisper_seal(
        &executable,
        &model,
        &mac,
        &key,
        seen.as_ref().map(|(exe, model)| (exe.as_str(), model.as_str())),
    );
    match &load {
        WhisperLoad::Ready(settings) => set_memory(Some(settings.clone()))?,
        WhisperLoad::Broken | WhisperLoad::Empty => set_memory(None)?,
    }
    Ok(load)
}

fn store_whisper(app: &tauri::AppHandle, settings: &WhisperSettings) -> Result<(), String> {
    let root = app_data_dir(app)?;
    let root_text = root.to_string_lossy();
    if path_is_whisper_store(&settings.executable, &root_text) || path_is_whisper_store(&settings.model, &root_text) {
        return Err("Choose a file outside the app settings folder. Nothing was saved.".into());
    }
    let key = whisper_seal_key()?;
    let mac = whisper_mac_hex(&key, settings.executable.trim(), settings.model.trim())?;
    let payload = serde_json::json!({
        "executable": settings.executable.trim(),
        "model": settings.model.trim(),
        "mac": mac,
    });
    let path = whisper_seal_path(app)?;
    std::fs::write(&path, payload.to_string()).map_err(|_| "App settings could not be saved. Nothing was saved.".to_string())?;
    set_memory(Some(WhisperSettings {
        executable: settings.executable.trim().to_string(),
        model: settings.model.trim().to_string(),
    }))
    .map_err(|_| "App settings could not be saved. Nothing was saved.".to_string())
}

fn forbid_whisper_store(app: &tauri::App) {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;
    let Ok(root) = app.path().app_data_dir() else {
        return;
    };
    let _ = std::fs::remove_file(root.join(WHISPER_SEAL_FILE));
    let sealed = root.join(WHISPER_SEAL_DIR);
    let _ = app.fs_scope().forbid_directory(&sealed, true);
    let _ = app.fs_scope().forbid_file(sealed.join(WHISPER_SEAL_FILE));
    let _ = app.fs_scope().forbid_file(root.join(WHISPER_SEAL_FILE));
}

/// File name only. The directory never goes back to the webview.
fn whisper_label(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.rsplit(['/', '\\']).next().unwrap_or("").to_string()
}

fn whisper_status_of(executable: &str, model: &str) -> WhisperStatus {
    let executable_ok = !executable.trim().is_empty() && std::path::Path::new(executable.trim()).is_file();
    let model_ok = !model.trim().is_empty() && std::path::Path::new(model.trim()).is_file();
    WhisperStatus {
        executable_name: whisper_label(executable),
        model_name: whisper_label(model),
        configured: executable_ok && model_ok,
        message: String::new(),
    }
}

fn status_of_load(load: WhisperLoad) -> WhisperStatus {
    match load {
        WhisperLoad::Ready(settings) => whisper_status_of(&settings.executable, &settings.model),
        WhisperLoad::Empty => WhisperStatus {
            executable_name: String::new(),
            model_name: String::new(),
            configured: false,
            message: String::new(),
        },
        WhisperLoad::Broken => WhisperStatus {
            executable_name: String::new(),
            model_name: String::new(),
            configured: false,
            message: SEAL_BROKEN.to_string(),
        },
    }
}

fn pick_whisper_file(app: &tauri::AppHandle, which: &str, title: &str) -> Result<WhisperStatus, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title(title)
        .blocking_pick_file()
        .ok_or_else(|| "No file was chosen. Nothing was saved.".to_string())?;
    let path = picked
        .into_path()
        .map_err(|_| "The chosen file has no local path. Nothing was saved.".to_string())?;
    if !path.is_file() {
        return Err("The chosen file was not found. Nothing was saved.".into());
    }
    let mut settings = match load_whisper(app)? {
        WhisperLoad::Ready(settings) => settings,
        WhisperLoad::Empty | WhisperLoad::Broken => WhisperSettings::default(),
    };
    let text = path.to_string_lossy().into_owned();
    if which == "executable" {
        settings.executable = text;
    } else {
        settings.model = text;
    }
    store_whisper(app, &settings)?;
    Ok(whisper_status_of(&settings.executable, &settings.model))
}

/// Names only. Paths stay in the sealed app file.
#[tauri::command]
fn whisper_status(app: tauri::AppHandle) -> Result<WhisperStatus, String> {
    Ok(status_of_load(load_whisper(&app)?))
}

#[tauri::command]
fn whisper_pick_executable(app: tauri::AppHandle) -> Result<WhisperStatus, String> {
    pick_whisper_file(&app, "executable", "whisper.cpp executable")
}

#[tauri::command]
fn whisper_pick_model(app: tauri::AppHandle) -> Result<WhisperStatus, String> {
    pick_whisper_file(&app, "model", "whisper.cpp model")
}

/// Run the whisper.cpp binary chosen in the native dialog. The webview does not supply those paths.
#[tauri::command]
fn lyrics_whisper_align(app: tauri::AppHandle, audio_path: String) -> Result<String, String> {
    let settings = match load_whisper(&app)? {
        WhisperLoad::Ready(settings) => settings,
        WhisperLoad::Empty => return Err("whisper.cpp is not configured. Nothing was sent.".into()),
        WhisperLoad::Broken => return Err(SEAL_BROKEN.into()),
    };
    let executable = settings.executable.trim().to_string();
    let model = settings.model.trim().to_string();
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
    use tauri::Manager;
    let app_data = app.path().app_data_dir().ok().map(|dir| dir.to_string_lossy().into_owned());
    for path in paths {
        if path.is_empty() {
            continue;
        }
        if let Some(root) = &app_data {
            if path_is_whisper_store(&path, root) {
                continue;
            }
        }
        grant_fs_file(&app, &path);
    }
}

fn grant_fs_file(app: &tauri::AppHandle, path: &str) {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;
    if path.is_empty() {
        return;
    }
    if let Ok(root) = app.path().app_data_dir() {
        if path_is_whisper_store(path, &root.to_string_lossy()) {
            return;
        }
    }
    let _ = app.fs_scope().allow_file(path);
}

fn grant_app_file(app: &tauri::App, path: &str) {
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;
    if path.is_empty() {
        return;
    }
    if let Ok(root) = app.path().app_data_dir() {
        if path_is_whisper_store(path, &root.to_string_lossy()) {
            return;
        }
    }
    let _ = app.fs_scope().allow_file(path);
}

/// Grant the remembered project path (string, not a Chrome handle) so autostart
/// can read it, plus each asset sourcePath in that JSON.
fn allow_last_project_file(app: &tauri::App) {
    use tauri::Manager;
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
    grant_app_file(app, path);
    allow_source_paths_in_project(app, path);
}

fn allow_source_paths_in_project(app: &tauri::App, project_path: &str) {
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
            grant_app_file(app, src);
        }
    }
}

#[cfg(test)]
mod ai_chat_tests {
    use super::{parse_saved_key, plan_ai_chat, provider_origin, whisper_label, ChatPlan, SavedKey};

    fn auth(plan: &ChatPlan) -> Option<&str> {
        plan.authorization.as_deref()
    }

    fn bound(origin: &str, secret: &str) -> SavedKey {
        SavedKey::Bound {
            origin: origin.to_string(),
            secret: secret.to_string(),
        }
    }

    fn plan<'a>(
        base: &str,
        shown: &str,
        session: Option<&'a str>,
        saved: &'a SavedKey,
    ) -> Result<ChatPlan, String> {
        plan_ai_chat(base, shown, "m", session, saved)
    }

    fn refused(base: &str, shown: &str, session: Option<&str>, saved: &SavedKey) -> String {
        match plan(base, shown, session, saved) {
            Err(message) => message,
            Ok(_) => panic!("request was allowed for {base}"),
        }
    }

    #[test]
    fn ollama_on_loopback_sends_no_key_even_when_one_is_stored_for_another_host() {
        let saved = bound("https://example.com:443", "stored-cloud-key");
        for base in [
            "http://127.0.0.1:11434/v1",
            "http://localhost:11434/v1/",
            "http://[::1]:11434/v1",
            "http://127.0.0.1:9999/v1",
        ] {
            let ready = plan(base, base, None, &saved).unwrap_or_else(|err| panic!("{base}: {err}"));
            assert!(ready.url.ends_with("/chat/completions"), "{}", ready.url);
            assert!(auth(&ready).is_none(), "{base}");
            assert!(!ready.url.contains("stored-cloud-key"));
        }
    }

    #[test]
    fn stored_key_is_sent_only_to_the_saved_origin() {
        let saved = bound("https://example.com:443", "stored-cloud-key");
        let same = plan("https://example.com/v1", "https://example.com/v1", None, &saved).unwrap();
        assert_eq!(auth(&same), Some("Bearer stored-cloud-key"));
        let parsed = parse_saved_key(r#"{"origin":"https://example.com:443","secret":"stored-cloud-key"}"#);
        let from_json = plan("https://example.com/v1", "https://example.com/v1", None, &parsed).unwrap();
        assert_eq!(auth(&from_json), Some("Bearer stored-cloud-key"));
        assert_eq!(
            provider_origin("https://example.com/v1").unwrap(),
            provider_origin("https://example.com:443/v1").unwrap()
        );
        let err = refused("https://evil.example/v1", "https://evil.example/v1", None, &saved);
        assert!(err.contains("https://example.com:443"));
        assert!(err.contains("https://evil.example:443"));
        assert!(err.contains("Nothing was sent"));
        assert!(!err.contains("stored-cloud-key"));
        let port = refused("https://example.com:8443/v1", "https://example.com:8443/v1", None, &saved);
        assert!(port.contains("Nothing was sent"));
        assert!(!port.contains("stored-cloud-key"));
        let legacy = parse_saved_key("plain-stored-cloud-key");
        let legacy_err = refused("https://example.com/v1", "https://example.com/v1", None, &legacy);
        assert!(legacy_err.contains("no provider host"));
        assert!(!legacy_err.contains("plain-stored-cloud-key"));
    }

    #[test]
    fn session_key_is_only_for_the_host_shown_in_the_request() {
        let saved = bound("https://example.com:443", "stored-cloud-key");
        let plan_ok = plan(
            "https://example.com/v1?token=nope",
            "https://example.com/v1",
            Some("session-key"),
            &saved,
        )
        .unwrap();
        assert_eq!(plan_ok.url, "https://example.com/v1/chat/completions");
        assert_eq!(auth(&plan_ok), Some("Bearer session-key"));
        let err = refused(
            "https://evil.example/v1",
            "https://example.com/v1",
            Some("session-key"),
            &saved,
        );
        assert!(err.contains("host shown"));
        assert!(err.contains("Nothing was sent"));
        assert!(!err.contains("session-key"));
        assert!(!err.contains("stored-cloud-key"));
        let missing_shown = refused("https://example.com/v1", "", Some("session-key"), &saved);
        assert!(missing_shown.contains("Nothing was sent"));
        assert!(!missing_shown.contains("session-key"));
        assert!(!missing_shown.contains("stored-cloud-key"));
    }

    #[test]
    fn cloud_without_any_key_is_refused() {
        let err = match plan("https://example.com/v1", "https://example.com/v1", None, &SavedKey::Missing) {
            Err(message) => message,
            Ok(_) => panic!("cloud chat without a key was allowed"),
        };
        assert!(err.contains("Nothing was sent"));
        assert!(!err.contains("stored"));
    }

    #[test]
    fn cleartext_cloud_and_bad_keys_are_refused() {
        let missing = SavedKey::Missing;
        assert!(plan("http://example.com/v1", "http://example.com/v1", Some("k"), &missing).is_err());
        assert!(plan("https://user:secret@example.com/v1", "https://example.com/v1", None, &missing).is_err());
        assert!(plan("https://example.com/v1", "https://example.com/v1", Some("bad key"), &missing).is_err());
        assert!(plan("not a url", "not a url", None, &missing).is_err());
    }

    #[test]
    fn whisper_status_uses_the_file_name_only() {
        assert_eq!(whisper_label("/tmp/secret/main"), "main");
        assert_eq!(whisper_label("C:\\Users\\secret\\ggml.bin"), "ggml.bin");
        assert_eq!(whisper_label("  "), "");
        assert!(!whisper_label("/tmp/secret/main").contains("secret"));
    }
}

#[cfg(test)]
mod whisper_seal_tests {
    use super::{
        check_whisper_seal, path_is_whisper_store, whisper_mac_hex, WhisperLoad, SEAL_BROKEN,
    };

    const KEY: &[u8] = b"0123456789abcdef0123456789abcdef";

    fn ready(load: WhisperLoad) -> (String, String) {
        match load {
            WhisperLoad::Ready(settings) => (settings.executable, settings.model),
            WhisperLoad::Empty => panic!("seal was empty"),
            WhisperLoad::Broken => panic!("seal was broken"),
        }
    }

    #[test]
    fn a_matching_seal_is_accepted_and_a_changed_path_is_not() {
        let mac = whisper_mac_hex(KEY, "/opt/whisper/main", "/opt/models/ggml.bin").unwrap();
        let ok = check_whisper_seal("/opt/whisper/main", "/opt/models/ggml.bin", &mac, KEY, None);
        assert_eq!(ready(ok), ("/opt/whisper/main".to_string(), "/opt/models/ggml.bin".to_string()));
        let changed = check_whisper_seal("/opt/evil/main", "/opt/models/ggml.bin", &mac, KEY, None);
        assert!(matches!(changed, WhisperLoad::Broken));
        assert!(SEAL_BROKEN.contains("file dialog"));
        assert!(SEAL_BROKEN.contains("Nothing was started"));
        assert!(!SEAL_BROKEN.contains("/opt/evil/main"));
        assert!(!SEAL_BROKEN.contains("0123456789"));
    }

    #[test]
    fn a_rewritten_mac_or_missing_mac_is_refused() {
        let mac = whisper_mac_hex(KEY, "/opt/whisper/main", "/opt/models/ggml.bin").unwrap();
        let rewritten = format!("{mac}00");
        assert!(matches!(
            check_whisper_seal("/opt/whisper/main", "/opt/models/ggml.bin", &rewritten, KEY, None),
            WhisperLoad::Broken
        ));
        assert!(matches!(
            check_whisper_seal("/opt/whisper/main", "/opt/models/ggml.bin", "", KEY, None),
            WhisperLoad::Broken
        ));
        let other = whisper_mac_hex(b"abcdefghijklmnopqrstuvwxyz012345", "/opt/whisper/main", "/opt/models/ggml.bin").unwrap();
        assert!(matches!(
            check_whisper_seal("/opt/whisper/main", "/opt/models/ggml.bin", &other, KEY, None),
            WhisperLoad::Broken
        ));
    }

    #[test]
    fn memory_must_match_the_sealed_file() {
        let mac = whisper_mac_hex(KEY, "/opt/whisper/main", "/opt/models/ggml.bin").unwrap();
        let drifted = check_whisper_seal(
            "/opt/whisper/main",
            "/opt/models/ggml.bin",
            &mac,
            KEY,
            Some(("/opt/whisper/main", "/opt/models/other.bin")),
        );
        assert!(matches!(drifted, WhisperLoad::Broken));
        let same = check_whisper_seal(
            "/opt/whisper/main",
            "/opt/models/ggml.bin",
            &mac,
            KEY,
            Some(("/opt/whisper/main", "/opt/models/ggml.bin")),
        );
        assert!(matches!(same, WhisperLoad::Ready(_)));
        let deleted = check_whisper_seal("", "", "", KEY, Some(("/opt/whisper/main", "/opt/models/ggml.bin")));
        assert!(matches!(deleted, WhisperLoad::Broken));
    }

    #[test]
    fn media_grants_skip_the_sealed_store_and_the_old_file() {
        let root = "/home/user/.local/share/studio";
        assert!(path_is_whisper_store(
            "/home/user/.local/share/studio/resonance-sealed/whisper-cpp.json",
            root
        ));
        assert!(path_is_whisper_store(
            "/home/user/.local/share/studio/resonance-sealed/../resonance-sealed/whisper-cpp.json",
            root
        ));
        assert!(path_is_whisper_store(r"C:\Users\a\AppData\studio\resonance-sealed\whisper-cpp.json", r"C:\Users\a\AppData\studio"));
        assert!(path_is_whisper_store("/home/user/.local/share/studio/whisper-cpp.json", root));
        assert!(!path_is_whisper_store("/home/user/.local/share/studio/last-project.json", root));
        assert!(!path_is_whisper_store("/home/user/Music/song.wav", root));
        assert!(!path_is_whisper_store("/home/user/.local/share/studio-extra/whisper-cpp.json", root));
    }
}
