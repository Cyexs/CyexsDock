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
console.log("selfcheck-chat OK");
