// Self-check for chat history + markdown: bun scripts/selfcheck-chat.ts
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { loadChats, saveChats, newChat, addUserMessage, appendDelta, finishMessage, historyForApi, titleOf } =
  await import("../src/chat/chatStore.ts");
const { renderMarkdown } = await import("../src/chat/markdown.tsx");

const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error("FAIL", m, a, b);
    process.exit(1);
  }
};

// 31 chats -> 30 kept, oldest gone
const many = Array.from({ length: 31 }, (_, i) => ({ ...newChat("gemini"), id: `c${i}`, updated: i + 1 }));
saveChats(many);
const loaded = loadChats();
eq(loaded.length, 30, "keeps 30");
eq(loaded.some((c) => c.id === "c0"), false, "oldest dropped");

// foreign data: only the valid chat survives, save does not throw
const good = { id: "g", provider: "openai", title: "t", updated: 5, messages: [{ role: "user", text: "x" }] };
mem.set("nectar-chat-history", JSON.stringify([null, 1, {}, { id: "a", messages: "x" }, good]));
eq(loadChats(), [good], "foreign elements dropped");
saveChats(loadChats());
mem.set("nectar-chat-history", "{not json");
eq(loadChats(), [], "invalid json");

// historyForApi
let c = newChat("openai");
c = addUserMessage(c, "oku", ["a.pdf"]);
c = appendDelta(c, "bozuk");
c = finishMessage(c, "error", "boom");
c = addUserMessage(c, "selam", []);
eq(historyForApi(c), [
  { role: "user", text: "oku\n[Dosya: a.pdf]" },
  { role: "user", text: "selam" },
], "history drops error, appends file names");

// streaming deltas then cut
let d = newChat("anthropic");
d = addUserMessage(d, "hi", []);
d = appendDelta(d, "mer");
d = appendDelta(d, "haba");
d = finishMessage(d, "cut");
const last = d.messages[d.messages.length - 1];
eq([last.role, last.text, last.state], ["assistant", "merhaba", "cut"], "delta + cut");

// Stop before the first token: empty assistant message marked cut
let e = addUserMessage(newChat("gemini"), "hi", []);
e = finishMessage(e, "cut");
eq(e.messages.map((m) => [m.role, m.text, m.state]), [["user", "hi", undefined], ["assistant", "", "cut"]], "cut before first token");
eq(finishMessage(addUserMessage(newChat("gemini"), "hi", []), "done").messages.length, 1, "done without reply adds nothing");

// malformed files field: repaired, historyForApi must not throw
mem.set("nectar-chat-history", JSON.stringify([{ id: "f", provider: "gemini", title: "", updated: 1, messages: [
  { role: "user", text: "a", files: "x.pdf" }, { role: "user", text: "b", files: [1] }, { role: "user", text: "c", files: ["ok.txt"] }] }]));
const fl = loadChats();
eq(fl[0].messages.map((m) => m.files), [undefined, undefined, ["ok.txt"]], "bad files dropped");
historyForApi(fl[0]);

eq(titleOf("çok uzun bir başlık ".repeat(5)).length, 40, "title 40");
eq(titleOf("ilk\nikinci"), "ilk", "title first line");

// markdown walker
const walk = (n: any, f: (e: any) => void) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, f));
  if (n && typeof n === "object" && "type" in n) {
    f(n);
    walk(n.props?.children, f);
  }
};
const types = (t: string) => {
  const out: string[] = [];
  walk(renderMarkdown(t), (e) => out.push(String(e.type)));
  return out;
};
eq(types("<img src=x onerror=alert(1)>").includes("img"), false, "no img element");
eq(types("```js\nlet a = 1;").filter((t) => t === "pre").length, 1, "unclosed fence is one pre");
eq(types("# H\n- a\n- b\n**x** *y* `z` [t](http://u)").includes("a"), false, "no anchors");
eq(types("1. a\n2. b").includes("ol"), true, "ordered list");
// merge across notch windows: union by id, newer updated wins
const { mergeChats } = await import("../src/chat/chatStore.ts");
const ca = { ...newChat("gemini"), id: "a", updated: 1 };
const cb = { ...newChat("gemini"), id: "b", updated: 1 };
const merged = mergeChats([ca, { ...cb, title: "new", updated: 9 }], [cb, { ...ca, title: "mine", updated: 2 }]);
eq(merged.map((c) => [c.id, c.title]).sort(), [["a", "mine"], ["b", "new"]], "merge keeps both, newer wins");

// one-time CC migration: custom buttons gain the chat button, defaults and existing ones untouched
const { withChatButton } = await import("../src/panelOrder.ts");
eq(withChatButton({ buttons: ["dnd"] }), { buttons: ["ai-chat", "dnd"] }, "chat button added to saved layout");
eq(withChatButton({}), null, "default layout untouched");
eq(withChatButton({ buttons: ["dnd", "ai-chat"] }), null, "already present untouched");
console.log("selfcheck-chat OK");
