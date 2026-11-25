import type { ReactNode } from "react";

// Safe mini-markdown: builds React elements only (no innerHTML), links are plain text.
// shortcut: no nested lists, tables or blockquotes; upgrade if chat answers need them.

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{m[3]}</em>);
    else out.push(`${m[4]} (${m[5]})`);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// plain function (not a component) so the tree holds a real <pre> element
function codeBlock(code: string, key: number, copyLabel: string): ReactNode {
  return (
    <pre key={key}>
      <button type="button" onClick={() => void navigator.clipboard?.writeText(code)}>
        {copyLabel}
      </button>
      <code>{code}</code>
    </pre>
  );
}

export function renderMarkdown(text: string, copyLabel = "Copy"): ReactNode {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const n = () => out.length;
  const flushPara = () => {
    if (para.length) out.push(<p key={n()}>{inline(para.join(" "), `p${n()}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${n()}-${i}`)}</li>);
    out.push(list.ordered ? <ol key={n()}>{items}</ol> : <ul key={n()}>{items}</ul>);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      flushList();
      const code: string[] = [];
      // an unclosed fence (streaming) runs to the end of the text
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(codeBlock(code.join("\n"), n(), copyLabel));
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*(?:([-*])|(\d+\.))\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const Tag = (["h1", "h2", "h3"] as const)[h[1].length - 1];
      out.push(<Tag key={n()}>{inline(h[2], `h${n()}`)}</Tag>);
    } else if (li) {
      flushPara();
      const ordered = li[2] !== undefined;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(li[3]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <>{out}</>;
}
