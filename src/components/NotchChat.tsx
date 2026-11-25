import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ArrowUp, Check, Copy, History, SquarePen, Square, Trash2, X } from "lucide-react";
import { useT } from "../i18n";
import {
  addUserMessage,
  appendDelta,
  finishMessage,
  historyForApi,
  loadChats,
  mergeChats,
  newChat,
  saveChats,
  type Chat,
} from "../chat/chatStore";
import { renderMarkdown } from "../chat/markdown";

type Provider = Chat["provider"];
const PROVIDERS: Provider[] = ["gemini", "anthropic", "openai"];
const PROVIDER_NAME: Record<Provider, string> = { gemini: "Gemini", anthropic: "Claude", openai: "ChatGPT" };
const KNOWN_ERRORS = ["key", "rate", "model", "server", "nokey", "empty", "net", "blocked", "noreply", "quota"];

// Read at send time so a provider switch in Settings applies to the next message.
const readProvider = (): Provider => {
  const v = localStorage.getItem("nectar-chat-provider") as Provider | null;
  return v && PROVIDERS.includes(v) ? v : "gemini";
};
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

function errorText(t: ReturnType<typeof useT>, code: string): string {
  if (KNOWN_ERRORS.includes(code)) return t(`chat.err.${code}`);
  const file = /^file:(\w+):(.*)$/.exec(code);
  if (file) {
    const k = { count: "fileCount", type: "fileType", size: "fileSize", read: "fileRead" }[file[1]];
    return k ? t(`chat.err.${k}`, { name: file[2] }) : t("chat.err.file", { name: file[2] });
  }
  const detail = code.replace(/^other:/, "");
  return detail ? `${t("chat.err.other")} ${detail}` : t("chat.err.other").replace(/\s*:\s*$/, "");
}

type Props = { open: boolean; pendingFiles: string[]; onFilesConsumed: () => void; onClose: () => void };

export function NotchChat({ open, pendingFiles, onFilesConsumed, onClose }: Props) {
  const t = useT();
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState<Record<Provider, boolean> | null>(null);
  const [provider, setProvider] = useState<Provider>(readProvider);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const active = useRef<{ send: string; chat: string } | null>(null);
  const removed = useRef(new Set<string>());
  // Merge with what other notch windows stored, so their chats are not overwritten; local deletes stay deleted.
  const persist = (list: Chat[]) =>
    saveChats(mergeChats(loadChats().filter((c) => !removed.current.has(c.id)), list));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const historyOpenRef = useRef(historyOpen);
  historyOpenRef.current = historyOpen;

  const update = (id: string, fn: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const finish = (state: "done" | "cut" | "error", error?: string) => {
    const a = active.current;
    if (!a) return;
    active.current = null;
    setBusy(false);
    update(a.chat, (c) => finishMessage(c, state, error));
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Stream events stay subscribed while the panel is closed, so a reply keeps arriving in the background.
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    const mine = (id: string) => active.current?.send === id;
    const subs = [
      win.listen<{ id: string; text: string }>("chat-delta", (e) => {
        const a = active.current;
        if (a && mine(e.payload.id)) update(a.chat, (c) => appendDelta(c, e.payload.text));
      }),
      win.listen<{ id: string }>("chat-done", (e) => { if (mine(e.payload.id)) finishRef.current("done"); }),
      win.listen<{ id: string }>("chat-cut", (e) => { if (mine(e.payload.id)) finishRef.current("cut"); }),
      win.listen<{ id: string; code: string }>("chat-error", (e) => { if (mine(e.payload.id)) finishRef.current("error", e.payload.code); }),
    ];
    return () => { subs.forEach((s) => s.then((f) => f())); };
  }, []);

  // Saving on every delta would rewrite the whole history many times a second.
  useEffect(() => { if (!busy) persist(chats); }, [chats, busy]);

  useEffect(() => {
    if (!open) return;
    if (!active.current) setChats(loadChats()); // pick up chats made in another monitor's notch
    setProvider(readProvider());
    invoke<Record<Provider, boolean>>("chat_key_status").then(setKeys).catch(() => setKeys(null));
    invoke("set_window_keyboard_focus", { enabled: true }).catch(() => {}).finally(() => inputRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (historyOpenRef.current) setHistoryOpen(false);
      else onCloseRef.current();
    };
    // Clicks outside the notch land in another app (the window is click-through there), which blurs us.
    const onBlur = () => onCloseRef.current();
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      setHistoryOpen(false);
      invoke("set_window_keyboard_focus", { enabled: false }).catch(() => {});
    };
  }, [open]);

  useEffect(() => {
    if (!pendingFiles.length) return;
    setFiles((f) => [...f, ...pendingFiles.filter((p) => !f.includes(p))]);
    onFilesConsumed();
  }, [pendingFiles, onFilesConsumed]);

  const chat = chats.find((c) => c.id === currentId);
  const messages = chat?.messages ?? [];

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const send = () => {
    const text = input.trim();
    if (busy || (!text && !files.length)) return;
    const p = readProvider();
    setProvider(p);
    const next = addUserMessage(chat ?? newChat(p), text, files.map(baseName));
    const all = [next, ...chats.filter((c) => c.id !== next.id)];
    setChats(all);
    persist(all);
    setCurrentId(next.id);
    const sent = files;
    setInput("");
    setFiles([]);
    const send = crypto.randomUUID(); // per message, never the chat id: cancel is keyed on it
    active.current = { send, chat: next.id };
    setBusy(true);
    invoke("chat_send", { id: send, provider: p, history: historyForApi(next), files: sent }).catch((e) => {
      const code = String(e);
      if (code === "nokey") invoke<Record<Provider, boolean>>("chat_key_status").then(setKeys).catch(() => {});
      if (active.current?.send === send) finishRef.current("error", code);
    });
  };

  const stop = () => {
    if (active.current) invoke("chat_cancel", { id: active.current.send }).catch(() => {});
  };

  const openSettings = async () => {
    await invoke("open_settings_window").catch(() => {});
    await emit("settings-navigate", "ai");
  };

  const copy = (i: number, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1200);
    }).catch(() => {});
  };

  const remove = (id: string) => {
    removed.current.add(id);
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (id === currentId) setCurrentId(null);
  };

  if (!open) return null;
  const noKey = keys !== null && !keys[provider];
  const sorted = [...chats].sort((a, b) => b.updated - a.updated);

  return (
    <div className="chat-panel" onClick={(e) => e.stopPropagation()}>
      <div className="chat-head">
        <span className="chat-provider">{PROVIDER_NAME[provider]}</span>
        <button type="button" className="chat-icon-btn" aria-label={t("chat.newChat")} title={t("chat.newChat")} onClick={() => { setCurrentId(null); setHistoryOpen(false); inputRef.current?.focus(); }}>
          <SquarePen size={14} strokeWidth={2} />
        </button>
        <button type="button" className={`chat-icon-btn${historyOpen ? " active" : ""}`} aria-label={t("chat.history")} title={t("chat.history")} aria-expanded={historyOpen} onClick={() => setHistoryOpen((h) => !h)}>
          <History size={14} strokeWidth={2} />
        </button>
        <button type="button" className="chat-icon-btn" aria-label={t("chat.close")} title={t("chat.close")} onClick={onClose}>
          <X size={14} strokeWidth={2} />
        </button>
        {historyOpen && (
          <div className="chat-history" role="menu">
            {sorted.length === 0 ? (
              <div className="chat-history-empty">{t("chat.noHistory")}</div>
            ) : (
              <>
                {sorted.map((c) => (
                  <div key={c.id} className={`chat-history-item${c.id === currentId ? " current" : ""}`}>
                    <button type="button" className="chat-history-title" onClick={() => { setCurrentId(c.id); setHistoryOpen(false); }}>
                      {c.title || t("chat.untitled")}
                    </button>
                    <button type="button" className="chat-icon-btn" aria-label={t("chat.delete")} title={t("chat.delete")} onClick={() => remove(c.id)}>
                      <Trash2 size={12} strokeWidth={2} />
                    </button>
                  </div>
                ))}
                <button type="button" className="chat-history-clear" onClick={() => { chats.forEach((c) => removed.current.add(c.id)); setChats([]); setCurrentId(null); setHistoryOpen(false); }}>
                  {t("chat.deleteAll")}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="chat-body" ref={bodyRef}>
        {noKey ? (
          <div className="chat-nokey">
            <span>{t("chat.noKey", { provider: PROVIDER_NAME[provider] })}</span>
            <button type="button" className="chat-settings-btn" onClick={openSettings}>{t("chat.openSettings")}</button>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-hint">{t("chat.hint")}</div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}${m.state === "error" ? " error" : ""}`}>
              {m.role === "user" ? (
                <>
                  {m.text && <div className="chat-user-text">{m.text}</div>}
                  {m.files?.length ? <div className="chat-msg-files">{m.files.join(", ")}</div> : null}
                </>
              ) : (
                <>
                  {m.text ? <div className="chat-md">{renderMarkdown(m.text, t("chat.copy"))}</div> : m.state === "streaming" && <span className="chat-typing">…</span>}
                  {m.state === "cut" && <div className="chat-note">{t("chat.cut")}</div>}
                  {m.state === "error" && m.error && <div className="chat-note">{errorText(t, m.error)}</div>}
                  {m.text && m.state !== "streaming" && (
                    <button type="button" className="chat-copy" aria-label={t("chat.copy")} title={t("chat.copy")} onClick={() => copy(i, m.text)}>
                      {copied === i ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={2} />}
                    </button>
                  )}
                </>
              )}
            </div>
          ))
        )}
        {busy && messages[messages.length - 1]?.role === "user" && (
          <div className="chat-msg assistant"><span className="chat-typing">…</span></div>
        )}
      </div>

      <div className="chat-foot">
        {files.length > 0 && (
          <div className="chat-files">
            {files.map((f) => (
              <span key={f} className="chat-file" title={f}>
                {baseName(f)}
                <button type="button" aria-label={t("chat.removeFile")} onClick={() => setFiles((fs) => fs.filter((x) => x !== f))}>×</button>
              </span>
            ))}
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={2}
            value={input}
            placeholder={t("chat.placeholder")}
            aria-label={t("chat.placeholder")}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          {busy ? (
            <button type="button" className="chat-send stop" aria-label={t("chat.stop")} title={t("chat.stop")} onClick={stop}>
              <Square size={12} strokeWidth={2.5} fill="currentColor" />
            </button>
          ) : (
            <button type="button" className="chat-send" aria-label={t("chat.send")} title={t("chat.send")} disabled={noKey || (!input.trim() && !files.length)} onClick={send}>
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
