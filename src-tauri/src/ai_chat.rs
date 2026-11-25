//! AI chat: pure provider request building, SSE parsing and error mapping.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::future::Future;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Window};

pub const SYSTEM_PROMPT: &str = "You are a helpful assistant inside CyexsDock, a Windows desktop app. Answer in the language the user writes in. Be concise; use Markdown for lists and code.";

#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Gemini,
    Anthropic,
    Openai,
}

impl Provider {
    pub fn id(self) -> &'static str {
        match self {
            Provider::Gemini => "gemini",
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
        }
    }
    pub fn model(self) -> &'static str {
        match self {
            Provider::Gemini => "gemini-3.8-flash",
            Provider::Anthropic => "claude-haiku-5-5",
            Provider::Openai => "gpt-6-luna",
        }
    }
}

#[derive(Deserialize)]
pub struct ChatTurn {
    pub role: String, // "user" | "assistant"
    pub text: String,
}

pub enum PartKind {
    Text(String),
    Base64(String), // images and PDFs
}

pub struct Part {
    pub mime: String,
    pub name: String,
    pub kind: PartKind,
}

/// One attachment as a provider-specific content block.
fn part_block(p: Provider, part: &Part) -> Value {
    let is_img = part.mime.starts_with("image/");
    match (&part.kind, p) {
        (PartKind::Text(t), Provider::Gemini) => json!({"text": format!("[{}]\n{}", part.name, t)}),
        (PartKind::Text(t), Provider::Anthropic) => json!({"type":"text","text": format!("[{}]\n{}", part.name, t)}),
        (PartKind::Text(t), Provider::Openai) => json!({"type":"input_text","text": format!("[{}]\n{}", part.name, t)}),
        (PartKind::Base64(d), Provider::Gemini) => json!({"inline_data":{"mime_type": part.mime, "data": d}}),
        (PartKind::Base64(d), Provider::Anthropic) => {
            let ty = if is_img { "image" } else { "document" };
            json!({"type": ty, "source": {"type":"base64","media_type": part.mime, "data": d}})
        }
        (PartKind::Base64(d), Provider::Openai) => {
            let uri = format!("data:{};base64,{}", part.mime, d);
            if is_img {
                json!({"type":"input_image","image_url": uri})
            } else {
                json!({"type":"input_file","filename": part.name, "file_data": uri})
            }
        }
    }
}

fn text_block(p: Provider, role: &str, text: &str) -> Value {
    match p {
        Provider::Gemini => json!({"text": text}),
        Provider::Anthropic => json!({"type":"text","text": text}),
        Provider::Openai => {
            let ty = if role == "assistant" { "output_text" } else { "input_text" };
            json!({"type": ty, "text": text})
        }
    }
}

/// Builds (url, headers, body); `parts` attach to the last user turn.
pub fn build_request(
    p: Provider,
    key: &str,
    history: &[ChatTurn],
    parts: &[Part],
) -> (String, Vec<(&'static str, String)>, Value) {
    let last_user = history.iter().rposition(|t| t.role == "user");
    let messages: Vec<Value> = history
        .iter()
        .enumerate()
        .filter_map(|(i, t)| {
            // Providers reject empty text blocks, so blank text is omitted.
            let mut content = Vec::new();
            if !t.text.trim().is_empty() {
                content.push(text_block(p, &t.role, &t.text));
            }
            if Some(i) == last_user {
                content.extend(parts.iter().map(|x| part_block(p, x)));
            }
            if content.is_empty() {
                return None; // blank turn with no attachments is not sent
            }
            let role = match (p, t.role.as_str()) {
                (Provider::Gemini, "assistant") => "model",
                (_, r) => r,
            };
            let key = if p == Provider::Gemini { "parts" } else { "content" };
            Some(json!({"role": role, key: content}))
        })
        .collect();
    let model = p.model();
    match p {
        Provider::Gemini => (
            format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse"),
            vec![("x-goog-api-key", key.to_string()), ("content-type", "application/json".into())],
            json!({"systemInstruction":{"parts":[{"text": SYSTEM_PROMPT}]}, "contents": messages}),
        ),
        Provider::Anthropic => (
            "https://api.anthropic.com/v1/messages".into(),
            vec![
                ("x-api-key", key.to_string()),
                ("anthropic-version", "2023-06-01".into()),
                ("content-type", "application/json".into()),
            ],
            json!({"model": model, "max_tokens": 4096, "stream": true, "system": SYSTEM_PROMPT, "messages": messages}),
        ),
        Provider::Openai => (
            "https://api.openai.com/v1/responses".into(),
            vec![("Authorization", format!("Bearer {key}")), ("content-type", "application/json".into())],
            json!({"model": model, "stream": true, "store": false, "instructions": SYSTEM_PROMPT, "input": messages}),
        ),
    }
}

/// Text delta carried by one SSE `data:` line, if any.
pub fn parse_sse_line(p: Provider, line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line.strip_prefix("data:")?.trim()).ok()?;
    match p {
        Provider::Gemini => {
            let s: String = v["candidates"][0]["content"]["parts"]
                .as_array()?
                .iter()
                .filter_map(|x| x["text"].as_str())
                .collect();
            (!s.is_empty()).then_some(s)
        }
        Provider::Anthropic => (v["type"] == "content_block_delta")
            .then(|| v["delta"]["text"].as_str().map(String::from))
            .flatten(),
        Provider::Openai => (v["type"] == "response.output_text.delta")
            .then(|| v["delta"].as_str().map(String::from))
            .flatten(),
    }
}

/// Provider error carried by one SSE `data:` line, as a code the frontend translates.
pub fn parse_sse_error(p: Provider, line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line.strip_prefix("data:")?.trim()).ok()?;
    let code = |c: &str| match c {
        "insufficient_quota" => "quota",
        "rate_limit_exceeded" | "rate_limit_error" | "RESOURCE_EXHAUSTED" => "rate",
        "invalid_api_key" | "authentication_error" | "permission_error" => "key",
        _ => "server",
    };
    match p {
        Provider::Anthropic => (v["type"] == "error").then(|| code(v["error"]["type"].as_str().unwrap_or("")).into()),
        Provider::Openai => matches!(v["type"].as_str(), Some("error" | "response.failed")).then(|| {
            let e = if v["type"] == "error" { &v } else { &v["response"]["error"] };
            let c = e["code"].as_str().or_else(|| e["error"]["code"].as_str()).unwrap_or("");
            code(c).into()
        }),
        Provider::Gemini => {
            if v.get("error").is_some() {
                let status = v["error"]["code"].as_u64().unwrap_or(500) as u16;
                return Some(friendly_error(status, &v.to_string()));
            }
            let blocked = ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"];
            let cand = &v["candidates"][0];
            let no_text = cand["content"]["parts"]
                .as_array()
                .map_or(true, |a| a.iter().all(|x| x["text"].as_str().unwrap_or("").is_empty()));
            let hit = !v["promptFeedback"]["blockReason"].is_null()
                || (no_text && cand["finishReason"].as_str().is_some_and(|r| blocked.contains(&r)));
            hit.then(|| "blocked".into())
        }
    }
}

/// Replaces `key` with `***`; keys under 8 chars are not searched.
pub fn redact_key(text: &str, key: &str) -> String {
    if key.len() < 8 {
        return text.to_string();
    }
    text.replace(key, "***")
}

/// Maps an HTTP failure to a code the frontend translates.
pub fn friendly_error(status: u16, body: &str) -> String {
    // Gemini sometimes wraps the error object in an array.
    let v = serde_json::from_str::<Value>(body).unwrap_or_default();
    let v = if v.is_array() { v[0].clone() } else { v };
    let msg = v["error"]["message"].as_str().unwrap_or_default().to_string();
    match status {
        401 | 403 => "key".into(),
        400 if msg.contains("API key") => "key".into(),
        429 if v["error"]["code"] == "insufficient_quota" || v["error"]["type"] == "insufficient_quota" => "quota".into(),
        429 => "rate".into(),
        404 => "model".into(),
        500..=599 => "server".into(),
        _ => format!("other:{}", msg.chars().take(200).collect::<String>()),
    }
}

// ---- keys, files, streaming commands ----

const KEY_SERVICE: &str = "Cyexs AI";
const MAX_FILES: usize = 5;
const MAX_BIN: u64 = 10 * 1024 * 1024;
const MAX_TEXT: usize = 200 * 1024;
const ALL: [Provider; 3] = [Provider::Gemini, Provider::Anthropic, Provider::Openai];

fn entry(p: Provider) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEY_SERVICE, p.id()).map_err(|e| e.to_string())
}

fn load_key(p: Provider) -> Option<String> {
    entry(p).ok()?.get_password().ok().filter(|k| !k.is_empty())
}

fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .build()
            .expect("http client")
    })
}

/// Connection-level failures read as "no internet"; anything else keeps the (key-free) reason.
fn net_error(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() || e.is_request() {
        "net".into()
    } else {
        format!("other:{}", e.without_url())
    }
}

fn cancelled() -> &'static Mutex<HashSet<String>> {
    static S: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    S.get_or_init(Default::default)
}

/// Mime and is_text by extension; Err("type" | "size").
pub fn classify_file(path: &Path, len: u64) -> Result<(String, bool), String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "pdf" => "application/pdf",
        "txt" | "md" | "csv" | "json" | "log" | "xml" | "html" | "css" | "js" | "ts" | "tsx" | "py" | "rs"
        | "java" | "c" | "cpp" | "cs" | "go" | "sh" | "ps1" | "yaml" | "yml" | "toml" | "ini" => {
            return Ok(("text/plain".into(), true));
        }
        _ => return Err("type".into()),
    };
    if len > MAX_BIN {
        return Err("size".into());
    }
    Ok((mime.into(), false))
}

fn read_part(path: &str) -> Result<Part, String> {
    let p = Path::new(path);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
    let fail = |r: &str| format!("file:{r}:{name}");
    let len = std::fs::metadata(p).map_err(|_| fail("read"))?.len();
    let (mime, is_text) = classify_file(p, len).map_err(|r| fail(&r))?;
    let f = std::fs::File::open(p).map_err(|_| fail("read"))?;
    let kind = if is_text {
        let mut buf = Vec::new();
        f.take(MAX_TEXT as u64 + 1).read_to_end(&mut buf).map_err(|_| fail("read"))?;
        let cut = buf.len() > MAX_TEXT;
        buf.truncate(MAX_TEXT);
        let mut t = String::from_utf8_lossy(&buf).into_owned();
        if cut {
            t.push_str("\n[... truncated]");
        }
        PartKind::Text(t)
    } else {
        let mut buf = Vec::new();
        f.take(MAX_BIN + 1).read_to_end(&mut buf).map_err(|_| fail("read"))?;
        if buf.len() as u64 > MAX_BIN {
            return Err(fail("size")); // file grew after the metadata check
        }
        PartKind::Base64(base64::engine::general_purpose::STANDARD.encode(buf))
    };
    Ok(Part { mime, name, kind })
}

/// Appends `chunk` and returns the complete non-empty lines; the partial tail stays in `buf`.
fn feed(buf: &mut String, chunk: &str) -> Vec<String> {
    buf.push_str(chunk);
    let mut out = Vec::new();
    while let Some(i) = buf.find('\n') {
        let line: String = buf.drain(..=i).collect();
        let line = line.trim_end_matches(['\n', '\r']);
        if !line.is_empty() {
            out.push(line.to_string());
        }
    }
    out
}

#[tauri::command]
pub async fn chat_key_status() -> HashMap<String, bool> {
    ALL.iter().map(|p| (p.id().to_string(), load_key(*p).is_some())).collect()
}

#[tauri::command]
pub async fn chat_set_key(provider: Provider, key: String) -> Result<(), String> {
    let e = entry(provider)?;
    let key = key.trim();
    if key.is_empty() {
        return match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        };
    }
    e.set_password(key).map_err(|err| redact_key(&err.to_string(), key))
}

#[tauri::command]
pub async fn chat_test_key(provider: Provider) -> Result<(), String> {
    let key = load_key(provider).ok_or("nokey")?;
    let url = match provider {
        Provider::Gemini => "https://generativelanguage.googleapis.com/v1beta/models",
        Provider::Anthropic => "https://api.anthropic.com/v1/models",
        Provider::Openai => "https://api.openai.com/v1/models",
    };
    let (_, headers, _) = build_request(provider, &key, &[], &[]);
    let mut req = client().get(url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| redact_key(&net_error(e), &key))?;
    let status = resp.status().as_u16();
    crate::diagnostics::log(&format!("chat: {} status {}", provider.id(), status));
    if (200..300).contains(&status) {
        return Ok(());
    }
    let body = resp.text().await.unwrap_or_default();
    Err(redact_key(&friendly_error(status, &body), &key))
}

#[tauri::command]
pub fn chat_cancel(id: String) {
    cancelled().lock().unwrap().insert(id);
}

const SLICE: Duration = Duration::from_millis(250);
const IDLE_LIMIT: Duration = Duration::from_secs(120);

enum Stop {
    Cut,
    Idle,
}

/// Why a wait should end: user cancel wins over idle timeout.
fn stop_reason(cancel: bool, idle: Duration) -> Option<Stop> {
    if cancel {
        Some(Stop::Cut)
    } else if idle >= IDLE_LIMIT {
        Some(Stop::Idle)
    } else {
        None
    }
}

fn is_cancelled(id: &str) -> bool {
    cancelled().lock().unwrap().contains(id)
}

/// Awaits `fut` in short slices so cancel and idle timeout are noticed even when no bytes arrive.
async fn guarded<T>(id: &str, fut: impl Future<Output = T>) -> Result<T, Stop> {
    let mut fut = std::pin::pin!(fut);
    let start = Instant::now();
    loop {
        match tokio::time::timeout(SLICE, fut.as_mut()).await {
            Ok(v) => {
                // Honor Stop even when the future is ready every time (fast stream).
                return if is_cancelled(id) { Err(Stop::Cut) } else { Ok(v) };
            }
            Err(_) => {
                if let Some(s) = stop_reason(is_cancelled(id), start.elapsed()) {
                    return Err(s);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn chat_send(
    window: Window,
    id: String,
    provider: Provider,
    history: Vec<ChatTurn>,
    files: Vec<String>,
) -> Result<(), String> {
    let r = send_inner(&window, &id, provider, history, files).await;
    cancelled().lock().unwrap().remove(&id); // every exit path, so ids never pile up
    r
}

async fn send_inner(
    window: &Window,
    id: &str,
    provider: Provider,
    history: Vec<ChatTurn>,
    files: Vec<String>,
) -> Result<(), String> {
    let key = load_key(provider).ok_or("nokey")?;
    if files.len() > MAX_FILES {
        return Err("file:count:".into());
    }
    let parts = files.iter().map(|f| read_part(f)).collect::<Result<Vec<_>, _>>()?;
    if parts.is_empty() && history.iter().all(|t| t.text.trim().is_empty()) {
        return Err("empty".into());
    }
    let result = stream(window, id, provider, &key, &history, &parts).await;
    let label = window.label();
    match result {
        Ok(true) => window.emit_to(label, "chat-cut", json!({"id": id})),
        Ok(false) => window.emit_to(label, "chat-done", json!({"id": id})),
        Err(code) => window.emit_to(label, "chat-error", json!({"id": id, "code": redact_key(&code, &key)})),
    }
    .ok();
    Ok(())
}

/// Emits the delta of one SSE line; a provider error inside the stream ends it with that code.
fn on_line(window: &Window, id: &str, p: Provider, line: &str, got_text: &mut bool) -> Result<(), String> {
    if let Some(e) = parse_sse_error(p, line) {
        return Err(e);
    }
    if let Some(t) = parse_sse_line(p, line) {
        *got_text = true;
        window.emit_to(window.label(), "chat-delta", json!({"id": id, "text": t})).ok();
    }
    Ok(())
}

/// Streams one reply; Ok(true) = cancelled, Err = error code.
async fn stream(
    window: &Window,
    id: &str,
    p: Provider,
    key: &str,
    history: &[ChatTurn],
    parts: &[Part],
) -> Result<bool, String> {
    if is_cancelled(id) {
        return Ok(true); // Stop pressed before the request went out
    }
    let (url, headers, body) = build_request(p, key, history, parts);
    let mut req = client().post(url).body(body.to_string());
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let mut resp = match guarded(id, req.send()).await {
        Ok(r) => r.map_err(net_error)?,
        Err(Stop::Cut) => return Ok(true),
        Err(Stop::Idle) => return Err("server".into()),
    };
    let status = resp.status().as_u16();
    crate::diagnostics::log(&format!("chat: {} status {}", p.id(), status));
    if !(200..300).contains(&status) {
        let body = match guarded(id, resp.text()).await {
            Ok(b) => b.unwrap_or_default(),
            Err(Stop::Cut) => return Ok(true),
            Err(Stop::Idle) => String::new(), // status alone still maps to a code
        };
        return Err(friendly_error(status, &body));
    }
    let (mut line_buf, mut carry, mut got_text) = (String::new(), Vec::<u8>::new(), false);
    loop {
        let chunk = match guarded(id, resp.chunk()).await {
            Ok(r) => r.map_err(net_error)?,
            Err(Stop::Cut) => return Ok(true),
            Err(Stop::Idle) => return Err("server".into()),
        };
        let Some(chunk) = chunk else { break };
        carry.extend_from_slice(&chunk);
        // A multi-byte char may straddle chunks: decode the valid prefix, keep the rest.
        let valid = match std::str::from_utf8(&carry) {
            Ok(s) => s.len(),
            Err(e) => e.valid_up_to(),
        };
        let text = String::from_utf8_lossy(&carry[..valid]).into_owned();
        carry.drain(..valid);
        for line in feed(&mut line_buf, &text) {
            on_line(window, id, p, &line, &mut got_text)?;
        }
    }
    on_line(window, id, p, line_buf.trim(), &mut got_text)?;
    if !got_text {
        return Err("noreply".into());
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turns() -> Vec<ChatTurn> {
        vec![
            ChatTurn { role: "user".into(), text: "hi".into() },
            ChatTurn { role: "assistant".into(), text: "hello".into() },
            ChatTurn { role: "user".into(), text: "what is this".into() },
        ]
    }
    fn png() -> Part {
        Part { mime: "image/png".into(), name: "a.png".into(), kind: PartKind::Base64("QUJD".into()) }
    }
    fn pdf() -> Part {
        Part { mime: "application/pdf".into(), name: "a.pdf".into(), kind: PartKind::Base64("QUJD".into()) }
    }

    #[test]
    fn gemini_body_maps_roles_and_inline_data() {
        let (url, headers, body) = build_request(Provider::Gemini, "SECRETKEY123", &turns(), &[png()]);
        assert!(url.ends_with(":streamGenerateContent?alt=sse"));
        assert_eq!(body["contents"][1]["role"], "model");
        assert_eq!(body["contents"][2]["parts"][1]["inline_data"]["mime_type"], "image/png");
        assert!(!url.contains("SECRETKEY123"));
        for (k, v) in &headers {
            assert_eq!(v.contains("SECRETKEY123"), *k == "x-goog-api-key");
        }
        assert!(headers.iter().any(|(k, _)| *k == "x-goog-api-key"));
    }

    #[test]
    fn anthropic_body_has_pdf_document_and_system() {
        let (_, _, body) = build_request(Provider::Anthropic, "k", &turns()[..1], &[pdf()]);
        assert_eq!(body["messages"][0]["content"][1]["type"], "document");
        assert_eq!(body["system"], SYSTEM_PROMPT);
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn openai_body_uses_output_text_for_assistant() {
        let (_, _, body) = build_request(Provider::Openai, "k", &turns(), &[pdf()]);
        assert_eq!(body["input"][1]["content"][0]["type"], "output_text");
        assert_eq!(body["input"][2]["content"][1]["type"], "input_file");
        assert_eq!(body["store"], false);
    }

    #[test]
    fn text_part_is_inlined_as_text() {
        let p = Part { mime: "text/markdown".into(), name: "notes.md".into(), kind: PartKind::Text("body".into()) };
        let (_, _, body) = build_request(Provider::Anthropic, "k", &turns()[..1], &[p]);
        let t = body["messages"][0]["content"][1]["text"].as_str().unwrap();
        assert!(t.starts_with("[notes.md]\n"));
    }

    #[test]
    fn parse_sse_line_per_provider() {
        let g = r#"data: {"candidates":[{"content":{"parts":[{"text":"Mer"}]}}]}"#;
        let a = r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Mer"}}"#;
        let o = r#"data: {"type":"response.output_text.delta","delta":"Mer"}"#;
        assert_eq!(parse_sse_line(Provider::Gemini, g).as_deref(), Some("Mer"));
        assert_eq!(parse_sse_line(Provider::Anthropic, a).as_deref(), Some("Mer"));
        assert_eq!(parse_sse_line(Provider::Openai, o).as_deref(), Some("Mer"));
        for p in [Provider::Gemini, Provider::Anthropic, Provider::Openai] {
            for l in ["event: ping", "data: [DONE]", ""] {
                assert_eq!(parse_sse_line(p, l), None);
            }
        }
    }

    #[test]
    fn redact_key_hides_key() {
        assert_eq!(redact_key("bad key AIzaSy123456789 here", "AIzaSy123456789"), "bad key *** here");
        assert_eq!(redact_key("abc abc", "abc"), "abc abc");
    }

    #[test]
    fn friendly_error_codes() {
        assert_eq!(friendly_error(401, ""), "key");
        assert_eq!(friendly_error(400, r#"{"error":{"message":"API key not valid"}}"#), "key");
        assert_eq!(friendly_error(429, ""), "rate");
        assert_eq!(friendly_error(404, ""), "model");
        assert_eq!(friendly_error(503, ""), "server");
        assert_eq!(friendly_error(400, r#"{"error":{"message":"Bad thing"}}"#), "other:Bad thing");
        // Gemini array-wrapped body
        assert_eq!(friendly_error(400, r#"[{"error":{"code":400,"message":"API key not valid. Please pass a valid API key."}}]"#), "key");
        // OpenAI out of credit is not a rate limit
        assert_eq!(friendly_error(429, r#"{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}"#), "quota");
        assert_eq!(friendly_error(429, r#"{"error":{"code":"rate_limit_exceeded"}}"#), "rate");
    }

    #[test]
    fn parse_sse_error_per_provider() {
        let a = r#"data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#;
        let a2 = r#"data: {"type":"error","error":{"type":"rate_limit_error","message":"x"}}"#;
        assert_eq!(parse_sse_error(Provider::Anthropic, a).as_deref(), Some("server"));
        assert_eq!(parse_sse_error(Provider::Anthropic, a2).as_deref(), Some("rate"));
        let o = r#"data: {"type":"response.failed","response":{"error":{"code":"server_error","message":"x"}}}"#;
        let o2 = r#"data: {"type":"error","code":"insufficient_quota","message":"x"}"#;
        assert_eq!(parse_sse_error(Provider::Openai, o).as_deref(), Some("server"));
        assert_eq!(parse_sse_error(Provider::Openai, o2).as_deref(), Some("quota"));
        let g = r#"data: {"error":{"code":503,"message":"The model is overloaded","status":"UNAVAILABLE"}}"#;
        let g2 = r#"data: {"promptFeedback":{"blockReason":"SAFETY"}}"#;
        let g3 = r#"data: {"candidates":[{"finishReason":"SAFETY"}]}"#;
        assert_eq!(parse_sse_error(Provider::Gemini, g).as_deref(), Some("server"));
        assert_eq!(parse_sse_error(Provider::Gemini, g2).as_deref(), Some("blocked"));
        assert_eq!(parse_sse_error(Provider::Gemini, g3).as_deref(), Some("blocked"));
        // normal deltas (also a final Gemini chunk that carries text) are not errors
        let gd = r#"data: {"candidates":[{"content":{"parts":[{"text":"Mer"}]},"finishReason":"SAFETY"}]}"#;
        assert_eq!(parse_sse_error(Provider::Gemini, gd), None);
        assert_eq!(parse_sse_error(Provider::Gemini, r#"data: {"candidates":[{"content":{"parts":[{"text":"Mer"}]}}]}"#), None);
        assert_eq!(parse_sse_error(Provider::Anthropic, r#"data: {"type":"content_block_delta","delta":{"text":"Mer"}}"#), None);
        assert_eq!(parse_sse_error(Provider::Openai, r#"data: {"type":"response.output_text.delta","delta":"Mer"}"#), None);
        for p in [Provider::Gemini, Provider::Anthropic, Provider::Openai] {
            assert_eq!(parse_sse_error(p, "event: ping"), None);
        }
    }

    #[test]
    fn attachment_only_turn_has_no_empty_text_block() {
        let h = vec![ChatTurn { role: "user".into(), text: "  ".into() }];
        for (p, arr, key) in [
            (Provider::Gemini, "contents", "parts"),
            (Provider::Anthropic, "messages", "content"),
            (Provider::Openai, "input", "content"),
        ] {
            let (_, _, body) = build_request(p, "k", &h, &[png()]);
            let blocks = body[arr][0][key].as_array().unwrap();
            assert_eq!(blocks.len(), 1, "{p:?}");
            assert!(blocks[0].get("text").is_none(), "{p:?}");
        }
    }

    #[test]
    fn blank_turns_without_parts_are_dropped() {
        let h = vec![
            ChatTurn { role: "user".into(), text: "".into() },
            ChatTurn { role: "assistant".into(), text: "ok".into() },
            ChatTurn { role: "user".into(), text: "next".into() },
        ];
        for (p, arr, key) in [
            (Provider::Gemini, "contents", "parts"),
            (Provider::Anthropic, "messages", "content"),
            (Provider::Openai, "input", "content"),
        ] {
            let (_, _, body) = build_request(p, "k", &h, &[]);
            let turns = body[arr].as_array().unwrap();
            assert_eq!(turns.len(), 2, "{p:?}");
            for t in turns {
                let blocks = t[key].as_array().unwrap();
                assert!(!blocks.is_empty(), "{p:?}");
                assert!(blocks.iter().all(|b| b["text"] != ""), "{p:?}");
            }
        }
    }

    #[test]
    fn classify_file_by_extension_and_size() {
        use std::path::Path;
        let mb = 1024 * 1024;
        assert_eq!(classify_file(Path::new("a.PNG"), 1024), Ok(("image/png".to_string(), false)));
        assert_eq!(classify_file(Path::new("b.pdf"), 11 * mb), Err("size".to_string()));
        assert_eq!(classify_file(Path::new("c.exe"), 10), Err("type".to_string()));
        assert_eq!(classify_file(Path::new("d.md"), mb), Ok(("text/plain".to_string(), true)));
    }

    #[test]
    fn stop_reason_cancel_and_idle() {
        let s = Duration::from_secs;
        assert!(stop_reason(false, s(119)).is_none());
        assert!(matches!(stop_reason(false, s(120)), Some(Stop::Idle)));
        assert!(matches!(stop_reason(true, s(0)), Some(Stop::Cut)));
        assert!(matches!(stop_reason(true, s(500)), Some(Stop::Cut)));
    }

    #[test]
    fn guarded_returns_value_and_cuts_on_cancel() {
        use tauri::async_runtime::block_on;
        assert!(matches!(block_on(guarded("t-ok", async { 7 })), Ok(7)));
        cancelled().lock().unwrap().insert("t-cut".into());
        let r = block_on(guarded("t-cut", std::future::pending::<()>()));
        assert!(matches!(r, Err(Stop::Cut)));
        // Ready future + already-cancelled id must still cut (fast streams).
        let r = block_on(guarded("t-cut", async { 1 }));
        assert!(matches!(r, Err(Stop::Cut)));
        cancelled().lock().unwrap().remove("t-cut");
    }

    #[test]
    fn sse_lines_split_across_chunks() {
        let mut buf = String::new();
        assert!(feed(&mut buf, "data: {\"a\"").is_empty());
        assert_eq!(feed(&mut buf, ":1}

"), vec!["data: {\"a\":1}".to_string()]);
        assert!(buf.is_empty());
    }
}
