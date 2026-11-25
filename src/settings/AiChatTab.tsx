import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bot, ExternalLink, Keyboard, Lock, Trash2 } from "lucide-react";
import { SettingRow } from "./SettingRow";
import { ShortcutRecorder } from "./ShortcutRecorder";
import { useT } from "../i18n";

type Provider = "gemini" | "anthropic" | "openai";
const PROVIDERS: Provider[] = ["gemini", "anthropic", "openai"];
const NAME: Record<Provider, string> = { gemini: "Gemini", anthropic: "Claude", openai: "ChatGPT" };
const KEY_PAGE: Record<Provider, string> = {
  gemini: "https://aistudio.google.com/apikey",
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
};
const DEFAULT_HOTKEY = "Ctrl+Alt+Space";

function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  invoke("save_setting", { key, value }).catch(() => { });
}

export function AiChatTab() {
  const t = useT();
  const [provider, setProvider] = useState<Provider>(() => {
    const v = localStorage.getItem("nectar-chat-provider") as Provider | null;
    return v && PROVIDERS.includes(v) ? v : "gemini";
  });
  const [saved, setSaved] = useState<Record<Provider, boolean>>({ gemini: false, anthropic: false, openai: false });
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [hotkey, setHotkey] = useState(() => localStorage.getItem("nectar-chat-hotkey") ?? DEFAULT_HOTKEY);
  const [hotkeyOk, setHotkeyOk] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const input = useRef<HTMLInputElement>(null); // uncontrolled: the key never lives in React state

  const refresh = useCallback(() => {
    invoke<Record<Provider, boolean>>("chat_key_status").then(setSaved).catch(() => { });
    invoke<boolean>("chat_hotkey_ok").then(setHotkeyOk).catch(() => { });
  }, []);
  useEffect(refresh, [refresh]);

  const pick = (p: Provider) => {
    setProvider(p);
    setResult("");
    if (input.current) input.current.value = "";
    save("nectar-chat-provider", p);
  };

  const setKey = async (key: string) => {
    setBusy(true);
    setResult("");
    try {
      await invoke("chat_set_key", { provider, key });
    } catch (e) {
      setResult(String(e));
    }
    if (input.current) input.current.value = "";
    setBusy(false);
    refresh();
  };

  const test = async () => {
    setBusy(true);
    setResult(t("chat.set.testing"));
    try {
      await invoke("chat_test_key", { provider });
      setResult(t("chat.set.testOk"));
    } catch (e) {
      const code = String(e);
      const known = ["key", "rate", "model", "server", "nokey", "net", "blocked", "noreply", "quota"];
      const detail = code.replace(/^other:/, "");
      setResult(known.includes(code) ? t(`chat.err.${code}`) : detail ? `${t("chat.err.other")} ${detail}` : t("chat.err.other").replace(/\s*:\s*$/, ""));
    }
    setBusy(false);
  };

  const commitHotkey = (next: string) => {
    setHotkey(next);
    save("nectar-chat-hotkey", next);
    // Rust re-registers the hotkey on save; give it a moment before asking.
    setTimeout(() => invoke<boolean>("chat_hotkey_ok").then(setHotkeyOk).catch(() => { }), 300);
  };

  const clearHistory = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    try { localStorage.removeItem("nectar-chat-history"); } catch { /* storage unavailable */ }
    setConfirmClear(false);
  };

  const hasKey = saved[provider];
  const submit = () => {
    const v = input.current?.value.trim();
    if (v) void setKey(v);
  };

  return (
    <>
      <div className="setting-group">
        <SettingRow icon={Bot} label={t("chat.set.provider")} desc={t("chat.set.provider.desc")} stacked>
          <div className="unit-toggle-minimal wide caldav-providers">
            {PROVIDERS.map((p) => (
              <span key={p} className={provider === p ? "active" : ""} onClick={() => pick(p)}>
                {NAME[p]}{p === "gemini" ? ` (${t("chat.set.free")})` : ""}
              </span>
            ))}
          </div>
        </SettingRow>

        <SettingRow icon={Lock} label={`${NAME[provider]} ${t("chat.set.key")}`} desc={provider === "gemini" ? undefined : t("chat.set.paid")} stacked>
          <div className="caldav-form">
            <input
              ref={input}
              key={provider}
              type="password"
              placeholder={hasKey ? t("chat.set.keySaved") : t("chat.set.keyPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <div className="caldav-form-footer">
              <span className="caldav-hint">{result}</span>
              <button className="caldav-btn primary" disabled={busy} onClick={submit}>
                {t("chat.set.save")}
              </button>
              <button className="caldav-btn" disabled={busy || !hasKey} onClick={() => void test()}>
                {t("chat.set.test")}
              </button>
              <button className="caldav-btn danger" disabled={busy || !hasKey} onClick={() => void setKey("")}>
                {t("chat.set.remove")}
              </button>
            </div>
          </div>
        </SettingRow>

        <SettingRow icon={ExternalLink} label={t("chat.set.guide")} stacked>
          <ol className="caldav-hint" style={{ margin: 0, paddingLeft: 18 }}>
            {[1, 2, 3].map((n) => (
              <li key={n}>{t(`chat.guide.${provider}.${n}`)}</li>
            ))}
          </ol>
          <button className="caldav-btn" onClick={() => void openUrl(KEY_PAGE[provider]).catch(() => { })}>
            <ExternalLink size={11} /> {t("chat.set.openPage")}
          </button>
        </SettingRow>

        <SettingRow icon={Keyboard} label={t("chat.set.hotkey")} desc={t("chat.set.hotkey.desc")}>
          <ShortcutRecorder value={hotkey} onCommit={commitHotkey} />
        </SettingRow>
        {!hotkeyOk && hotkey && <div className="caldav-error">{t("chat.set.hotkeyBusy")}</div>}

        <SettingRow
          icon={Trash2}
          label={t("chat.set.clear")}
          desc={confirmClear ? t("chat.set.clear.confirm") : t("chat.set.clear.desc")}
          action
          danger
          onClick={clearHistory}
          divider={false}
        />
      </div>
      <p className="caldav-hint" style={{ padding: "8px 4px" }}>{t("chat.set.privacy")}</p>
    </>
  );
}
