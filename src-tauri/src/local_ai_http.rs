//! Loopback-only HTTP for the generic OpenAI-compatible provider.
//! ADV-5: localhost / 127.0.0.1 / ::1 only. No LAN, no internet.

use std::io::{Read, Write};
use std::net::{IpAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_TIMEOUT_MS: u64 = 180_000;

#[derive(serde::Serialize)]
pub struct LocalAiHttpResponse {
    pub status: u16,
    pub body: String,
}

struct Target {
    host: String,
    port: u16,
    path: String,
}

fn is_loopback_host(host: &str) -> bool {
    let h = host.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    h == "127.0.0.1" || h == "localhost" || h == "::1"
}

fn parse_loopback_http_url(raw: &str) -> Result<Target, String> {
    let raw = raw.trim();
    let rest = raw
        .strip_prefix("http://")
        .ok_or_else(|| "SECURITY_POLICY: only http:// loopback URLs are allowed".to_string())?;
    let (authority, path) = if let Some(idx) = rest.find('/') {
        (&rest[..idx], &rest[idx..])
    } else {
        (rest, "/")
    };
    if authority.is_empty() {
        return Err("SECURITY_POLICY: missing host".into());
    }
    let (host, port) = if authority.starts_with('[') {
        let end = authority
            .find(']')
            .ok_or_else(|| "SECURITY_POLICY: invalid IPv6 host".to_string())?;
        let host = &authority[1..end];
        let port = if authority[end + 1..].starts_with(':') {
            authority[end + 2..]
                .parse::<u16>()
                .map_err(|_| "SECURITY_POLICY: invalid port".to_string())?
        } else {
            80
        };
        (host.to_string(), port)
    } else if let Some((h, p)) = authority.rsplit_once(':') {
        let port = p
            .parse::<u16>()
            .map_err(|_| "SECURITY_POLICY: invalid port".to_string())?;
        (h.to_string(), port)
    } else {
        (authority.to_string(), 80)
    };
    if !is_loopback_host(&host) {
        return Err("SECURITY_POLICY: Local provider allows localhost / 127.0.0.1 / ::1 only".into());
    }
    if path.contains('\r') || path.contains('\n') {
        return Err("SECURITY_POLICY: invalid path".into());
    }
    Ok(Target {
        host,
        port,
        path: path.to_string(),
    })
}

fn classify_io(err: &std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
            format!("TIMEOUT: {err}")
        }
        std::io::ErrorKind::ConnectionRefused => format!("REFUSED: {err}"),
        _ => {
            let msg = err.to_string().to_ascii_lowercase();
            if msg.contains("refused") {
                format!("REFUSED: {err}")
            } else if msg.contains("timed out") {
                format!("TIMEOUT: {err}")
            } else {
                format!("UNKNOWN: {err}")
            }
        }
    }
}

fn read_response(stream: &mut TcpStream) -> Result<(u16, String), String> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if buf.len() > MAX_BODY_BYTES + 16_384 {
                    return Err("INVALID_RESPONSE: body too large".into());
                }
                if let Some(header_end) = find_header_end(&buf) {
                    if let Some(total) = complete_len(&buf, header_end) {
                        if buf.len() >= total {
                            buf.truncate(total);
                            break;
                        }
                    }
                }
            }
            Err(err) => return Err(classify_io(&err)),
        }
    }
    parse_http_response(&buf)
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4)
}

fn header_value(headers: &str, name: &str) -> Option<String> {
    for line in headers.lines() {
        if let Some((k, v)) = line.split_once(':') {
            if k.eq_ignore_ascii_case(name) {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

fn complete_len(buf: &[u8], header_end: usize) -> Option<usize> {
    let headers = std::str::from_utf8(&buf[..header_end]).ok()?;
    if header_value(headers, "Transfer-Encoding")
        .map(|v| v.to_ascii_lowercase().contains("chunked"))
        .unwrap_or(false)
    {
        return chunked_complete_len(buf, header_end);
    }
    if let Some(len) = header_value(headers, "Content-Length")
        .and_then(|v| v.parse::<usize>().ok())
    {
        return Some(header_end + len);
    }
    None
}

fn chunked_complete_len(buf: &[u8], header_end: usize) -> Option<usize> {
    let mut i = header_end;
    loop {
        let rest = buf.get(i..)?;
        let line_end = rest.windows(2).position(|w| w == b"\r\n")?;
        let size_line = std::str::from_utf8(&rest[..line_end]).ok()?.trim();
        let size = usize::from_str_radix(size_line.split(';').next()?, 16).ok()?;
        i += line_end + 2 + size + 2;
        if size == 0 {
            return Some(i);
        }
        if i > buf.len() {
            return None;
        }
    }
}

fn decode_chunked(body: &[u8]) -> Result<String, String> {
    let mut i = 0;
    let mut out = Vec::new();
    loop {
        let rest = body.get(i..).ok_or("INVALID_RESPONSE: truncated chunk")?;
        let line_end = rest
            .windows(2)
            .position(|w| w == b"\r\n")
            .ok_or("INVALID_RESPONSE: bad chunk size")?;
        let size_line = std::str::from_utf8(&rest[..line_end])
            .map_err(|_| "INVALID_RESPONSE: bad chunk size")?
            .trim();
        let size = usize::from_str_radix(size_line.split(';').next().unwrap_or(""), 16)
            .map_err(|_| "INVALID_RESPONSE: bad chunk size")?;
        i += line_end + 2;
        if size == 0 {
            break;
        }
        let chunk = body
            .get(i..i + size)
            .ok_or("INVALID_RESPONSE: truncated chunk")?;
        out.extend_from_slice(chunk);
        i += size + 2;
        if out.len() > MAX_BODY_BYTES {
            return Err("INVALID_RESPONSE: body too large".into());
        }
    }
    String::from_utf8(out).map_err(|_| "INVALID_RESPONSE: body is not UTF-8".to_string())
}

fn parse_http_response(buf: &[u8]) -> Result<(u16, String), String> {
    let header_end = find_header_end(buf).ok_or("INVALID_RESPONSE: incomplete HTTP headers")?;
    let headers = std::str::from_utf8(&buf[..header_end])
        .map_err(|_| "INVALID_RESPONSE: headers are not UTF-8".to_string())?;
    let status_line = headers.lines().next().unwrap_or("");
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| "INVALID_RESPONSE: missing status".to_string())?;
    let raw_body = &buf[header_end..];
    let body = if header_value(headers, "Transfer-Encoding")
        .map(|v| v.to_ascii_lowercase().contains("chunked"))
        .unwrap_or(false)
    {
        decode_chunked(raw_body)?
    } else {
        String::from_utf8_lossy(raw_body).into_owned()
    };
    Ok((status, body))
}

pub fn loopback_http(
    method: &str,
    url: &str,
    body: Option<&str>,
    timeout_ms: u64,
    authorization: Option<&str>,
) -> Result<LocalAiHttpResponse, String> {
    let method = method.to_ascii_uppercase();
    if method != "GET" && method != "POST" {
        return Err("SECURITY_POLICY: only GET and POST are allowed".into());
    }
    let target = parse_loopback_http_url(url)?;
    let timeout = Duration::from_millis(timeout_ms.clamp(1, MAX_TIMEOUT_MS));
    let addr = format!("{}:{}", target.host, target.port);
    let mut addrs = addr
        .to_socket_addrs()
        .map_err(|e| format!("REFUSED: {e}"))?;
    let sock = addrs
        .next()
        .ok_or_else(|| "REFUSED: unresolved loopback address".to_string())?;
    if !sock.ip().is_loopback() && sock.ip() != IpAddr::from([127, 0, 0, 1]) {
        return Err("SECURITY_POLICY: resolved host is not loopback".into());
    }
    let mut stream = TcpStream::connect_timeout(&sock, timeout).map_err(|e| classify_io(&e))?;
    stream.set_read_timeout(Some(timeout)).map_err(|e| classify_io(&e))?;
    stream.set_write_timeout(Some(timeout)).map_err(|e| classify_io(&e))?;

    let payload = body.unwrap_or("");
    let mut req = format!(
        "{method} {path} HTTP/1.1\r\nHost: {host}:{port}\r\nAccept: application/json\r\nConnection: close\r\n",
        path = target.path,
        host = target.host,
        port = target.port,
    );
    if method == "POST" {
        req.push_str("Content-Type: application/json\r\n");
        req.push_str(&format!("Content-Length: {}\r\n", payload.len()));
    } else {
        req.push_str("Content-Length: 0\r\n");
    }
    if let Some(auth) = authorization {
        let trimmed = auth.trim();
        if !trimmed.is_empty() && !trimmed.contains('\r') && !trimmed.contains('\n') {
            req.push_str("Authorization: ");
            req.push_str(trimmed);
            req.push_str("\r\n");
        }
    }
    req.push_str("\r\n");
    stream
        .write_all(req.as_bytes())
        .map_err(|e| classify_io(&e))?;
    if method == "POST" && !payload.is_empty() {
        stream
            .write_all(payload.as_bytes())
            .map_err(|e| classify_io(&e))?;
    }
    stream.flush().map_err(|e| classify_io(&e))?;
    let (status, body) = read_response(&mut stream)?;
    Ok(LocalAiHttpResponse { status, body })
}

#[tauri::command]
pub fn local_ai_http(
    method: String,
    url: String,
    body: Option<String>,
    timeout_ms: u64,
    authorization: Option<String>,
) -> Result<LocalAiHttpResponse, String> {
    loopback_http(
        &method,
        &url,
        body.as_deref(),
        timeout_ms,
        authorization.as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::parse_loopback_http_url;

    #[test]
    fn accepts_loopback_and_rejects_lan() {
        assert!(parse_loopback_http_url("http://127.0.0.1:11434/v1/models").is_ok());
        assert!(parse_loopback_http_url("http://localhost:1234/v1/models").is_ok());
        assert!(parse_loopback_http_url("http://10.0.0.8/v1").is_err());
        assert!(parse_loopback_http_url("https://127.0.0.1/v1").is_err());
    }
}
