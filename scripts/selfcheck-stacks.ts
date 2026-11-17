// Self-check for the folder stack helpers: bun scripts/selfcheck-stacks.ts
import { parseStacks, addStack, stackName } from "../src/stacks.ts";

const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error("FAIL", m, a, b);
    process.exit(1);
  }
};

const B = String.fromCharCode(92);
const w = (...parts: string[]) => parts.join(B);
eq(parseStacks(null), [], "missing value");
eq(parseStacks("not json"), [], "bad json");
eq(parseStacks("{}"), [], "not an array");
eq(parseStacks(JSON.stringify([{ path: w("C:", "a"), sort: "name" }, { path: w("c:", "A") + B }, { path: "" }, { x: 1 }, null])),
  [{ path: w("C:", "a"), sort: "name" }], "dedupe, defaults, junk dropped");
eq(addStack([{ path: w("C:", "a"), sort: "date" }], w("c:", "a") + B).length, 1, "same folder not added twice");
eq(addStack([], w("C:", "Downloads")), [{ path: w("C:", "Downloads"), sort: "date" }], "add");
eq(stackName(w("C:", "Users", "me", "Downloads") + B), "Downloads", "trailing slash name");
eq(stackName("D:" + B), "D:", "drive root");
console.log("ok");
