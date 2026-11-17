// Folder stacks: pure helpers, checked by scripts/selfcheck-stacks.ts.
export type StackSort = "date" | "name";
export type Stack = { path: string; sort: StackSort };
export type StackEntry = { name: string; path: string; isDir: boolean; modified: number; size: number };

export const STACKS_KEY = "nectar-dock-stacks";
export const STACK_LIMIT = 30;

const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();

export function parseStacks(raw: string | null | undefined): Stack[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: Stack[] = [];
    for (const s of parsed) {
      if (!s || typeof s.path !== "string" || !s.path.trim() || seen.has(norm(s.path))) continue;
      seen.add(norm(s.path));
      out.push({ path: s.path, sort: s.sort === "name" ? "name" : "date" });
    }
    return out;
  } catch {
    return [];
  }
}

export const addStack = (list: Stack[], path: string): Stack[] =>
  list.some((s) => norm(s.path) === norm(path)) ? list : [...list, { path, sort: "date" }];

export const stackName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
