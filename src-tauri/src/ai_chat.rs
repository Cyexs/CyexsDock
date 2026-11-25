//! AI chat: pure provider request building, SSE parsing and error mapping.
#![allow(dead_code)] // consumed by later tasks (HTTP commands, UI)

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
        .map(|(i, t)| {
            let mut content = vec![text_block(p, &t.role, &t.text)];
            if Some(i) == last_user {
                content.extend(parts.iter().map(|x| part_block(p, x)));
            }
            let role = match (p, t.role.as_str()) {
                (Provider::Gemini, "assistant") => "model",
                (_, r) => r,
            };
            let key = if p == Provider::Gemini { "parts" } else { "content" };
            json!({"role": role, key: content})
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
            json!({"model": model, "stream": true, "instructions": SYSTEM_PROMPT, "input": messages}),
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

/// Replaces `key` with `***`; keys under 8 chars are not searched.
pub fn redact_key(text: &str, key: &str) -> String {
    if key.len() < 8 {
        return text.to_string();
    }
    text.replace(key, "***")
}

/// Maps an HTTP failure to a code the frontend translates.
pub fn friendly_error(status: u16, body: &str) -> String {
    let msg = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(String::from))
        .unwrap_or_default();
    match status {
        401 | 403 => "key".into(),
        400 if msg.contains("API key") => "key".into(),
        429 => "rate".into(),
        404 => "model".into(),
        500..=599 => "server".into(),
        _ => format!("other:{}", msg.chars().take(200).collect::<String>()),
    }
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
    }
}
