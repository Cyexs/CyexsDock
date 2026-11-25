// Chat history kept in localStorage. Not part of settings sync/export on purpose.
export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  files?: string[]; // names only, never contents
  state?: "streaming" | "done" | "cut" | "error";
  error?: string;
};
export type Chat = {
  id: string;
  provider: "gemini" | "anthropic" | "openai";
  title: string;
  updated: number;
  messages: ChatMessage[];
};

const KEY = "nectar-chat-history";
const MAX_CHATS = 30;

export function loadChats(): Chat[] {
  let v: unknown;
  try {
    v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  // storage is untrusted: keep only well-formed chats, repair soft fields
  return v
    .filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages))
    .map((c) => ({
      ...c,
      provider: ["gemini", "anthropic", "openai"].includes(c.provider) ? c.provider : "gemini",
      title: typeof c.title === "string" ? c.title : "",
      updated: typeof c.updated === "number" ? c.updated : 0,
      messages: c.messages.filter(
        (m: any) => m && typeof m.text === "string" && (m.role === "user" || m.role === "assistant"),
      ),
    }));
}

export function saveChats(chats: Chat[]): void {
  const kept = [...chats].sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS);
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // quota or blocked storage: history is best-effort
  }
}

export function newChat(provider: Chat["provider"]): Chat {
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, provider, title: "", updated: Date.now(), messages: [] };
}

export function titleOf(text: string): string {
  return (text.split("\n")[0] ?? "").slice(0, 40);
}

export function addUserMessage(chat: Chat, text: string, fileNames: string[]): Chat {
  const msg: ChatMessage = { role: "user", text, ...(fileNames.length ? { files: fileNames } : {}) };
  return { ...chat, title: chat.title || titleOf(text), updated: Date.now(), messages: [...chat.messages, msg] };
}

export function appendDelta(chat: Chat, text: string): Chat {
  const msgs = chat.messages.slice();
  const last = msgs[msgs.length - 1];
  if (last && last.role === "assistant") msgs[msgs.length - 1] = { ...last, text: last.text + text, state: "streaming" };
  else msgs.push({ role: "assistant", text, state: "streaming" });
  return { ...chat, updated: Date.now(), messages: msgs };
}

export function finishMessage(chat: Chat, state: "done" | "cut" | "error", error?: string): Chat {
  const msgs = chat.messages.slice();
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== "assistant") {
    if (state !== "error") return chat;
    msgs.push({ role: "assistant", text: "", state, error });
  } else {
    msgs[msgs.length - 1] = { ...last, state, ...(error ? { error } : {}) };
  }
  return { ...chat, updated: Date.now(), messages: msgs };
}

export function historyForApi(chat: Chat): { role: string; text: string }[] {
  return chat.messages
    .filter((m) => m.state !== "error")
    .map((m) => ({
      role: m.role,
      text: m.role === "user" && m.files?.length ? `${m.text}\n[Dosya: ${m.files.join(", ")}]` : m.text,
    }));
}
