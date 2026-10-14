import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import postcss from "postcss";

const files = ["app/globals.css", "app/simplified.css", "app/playbooks/Playbooks.module.css", "app/activity/Activity.module.css", "app/mailboxes/Mailboxes.module.css", "app/import/ImportClient.module.css", "app/ui/YcExplorer.module.css"];
let redundant = 0;
const candidates = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const root = postcss.parse(source);
  const writes = new Map();
  const removable = [];
  root.walkRules((rule) => {
    const scope = [];
    let parent = rule.parent;
    while (parent?.type !== "root") { scope.unshift(`${parent.name} ${parent.params}`); parent = parent.parent; }
    const selectors = rule.selectors.map((selector) => selector.trim());
    rule.walkDecls((declaration) => {
      if (declaration.parent !== rule) return;
      const keys = selectors.map((selector) => JSON.stringify([scope, selector, declaration.prop]));
      for (const key of keys) {
        const previous = writes.get(key);
        if (previous && (!previous.declaration.important || declaration.important)) previous.overridden.add(key);
      }
      const item = { declaration, keys, overridden: new Set() };
      keys.forEach((key) => writes.set(key, item));
      removable.push(item);
    });
  });
  const items = removable.filter((item) => item.keys.every((key) => item.overridden.has(key)) && !item.declaration.important);
  redundant += items.length;
  console.log(`${file}: ${items.length} earlier exact-selector declarations superseded in the same conditional scope`);
  console.log(items.slice(0, 15).map((item) => `  ${item.declaration.source.start.line}: ${item.declaration.parent.selector} / ${item.declaration.prop}`).join("\n"));
  if (process.argv.includes("--candidates")) {
    items.forEach((item) => item.declaration.remove());
    root.walkRules((rule) => { if (!rule.nodes.length) rule.remove(); });
    root.walkComments((comment) => { if (!/license|copyright|spdx/i.test(comment.text)) comment.remove(); });
    const hash = createHash("sha256").update(source).digest("hex");
    const target = resolve("../operations/ui-qa/mobile-20261007/cleanup-candidates", file);
    const cleaned = root.toString().replace(/\n\s*\n\s*\n/g, "\n\n").trim() + "\n";
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `/* Source baseline ${hash}. Generated candidate; not active CSS. */\n${cleaned}`);
    candidates.push({ file, target, hash, removedDeclarations: items.length, beforeLines: source.split("\n").length, afterLines: cleaned.split("\n").length });
  }
}
assert.ok(redundant >= 0);
console.log(`Total ${redundant}. This is read-only inspection, not permission to remove unmatched or shorthand declarations.`);
if (candidates.length) {
  writeFileSync(resolve("../operations/ui-qa/mobile-20261007/cleanup-candidates/manifest.json"), JSON.stringify(candidates, null, 2));
  console.log(JSON.stringify(candidates.map(({ file, beforeLines, afterLines }) => ({ file, beforeLines, afterLines })), null, 2));
}
