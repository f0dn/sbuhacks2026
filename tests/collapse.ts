// checks src/vdom/collapse.ts on small hand-made trees. no Jev.
//
// usage: pnpm tsx tests/collapse.ts

import assert from "node:assert/strict";
import { collapse } from "../src/vdom/collapse.js";
import type { ParsedNode } from "../src/vdom/types.js";

let nextId = 0;
const el = (
  tag: string,
  children: ParsedNode[] = [],
  { aria = {}, text = "" }: { aria?: Record<string, string>; text?: string } = {},
): ParsedNode => ({ id: nextId++, tag, aria, text, children });

// div[role=main] > div > div "hi" > (p, p)  ->  one div with everything
{
  const inner = el("DIV", [el("P"), el("P")], { text: "hi" });
  const middle = el("DIV", [inner], { aria: { "aria-label": "Intro" } });
  const outer = el("DIV", [middle], { aria: { role: "main" } });
  const out = collapse(outer);

  assert.equal(out.id, outer.id);
  assert.deepEqual(out.aria, { role: "main", "aria-label": "Intro" });
  assert.equal(out.text, "hi");
  assert.deepEqual(
    out.children.map((c) => c.tag),
    ["P", "P"],
  );
  assert.deepEqual(
    out.merged.map((m) => m.id),
    [middle.id, inner.id],
  );
  assert.deepEqual(out.merged[0]?.aria, { "aria-label": "Intro" });
}

// a div with two children is not folded into its parent
{
  const out = collapse(el("DIV", [el("DIV", [el("DIV"), el("DIV")])]));
  assert.equal(out.merged.length, 1);
  assert.equal(out.children.length, 2);
  assert.ok(out.children.every((c) => c.merged.length === 0));
}

// conflicting aria values block the fold
{
  const out = collapse(
    el("DIV", [el("DIV", [], { aria: { role: "region" } })], {
      aria: { role: "main" },
    }),
  );
  assert.equal(out.merged.length, 0);
  assert.equal(out.children[0]?.aria.role, "region");
}

// both have text: folding would lose their order
{
  const out = collapse(el("DIV", [el("DIV", [], { text: "b" })], { text: "a" }));
  assert.equal(out.merged.length, 0);
}

// non-wrapper tags are left alone, but chains below them still fold
{
  const out = collapse(el("SECTION", [el("DIV", [el("DIV", [el("P")])])]));
  assert.equal(out.merged.length, 0);
  assert.equal(out.children[0]?.merged.length, 1);
  assert.equal(out.children[0]?.children[0]?.tag, "P");
}

console.log("collapse: all checks passed");
