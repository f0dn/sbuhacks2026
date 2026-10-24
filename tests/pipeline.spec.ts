// runs every pass end to end on a parsed DOM, the same way the service worker
// does (src/vdom/pipeline.ts):
//   prefilter -> collapse -> filter (Jev) -> group (Jev)
// then builds the navigator outline (src/vdom/nav.ts) and prints it. writes
// each stage's output, so render-dom.ts can show any of them.
//
// usage: pnpm tsx tests/pipeline.spec.ts [input.json] [--max-calls N]
// --max-calls is the Jev budget for each Jev pass

import { TypeSafeClient } from "@typesafe-ai/sdk";
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { formatGroups } from "../src/vdom/group.js";
import { runPipeline } from "../src/vdom/pipeline.js";
import { buildNav, speakable, type NavItem } from "../src/vdom/nav.js";
import type { ParsedNode } from "../src/vdom/types.js";

const args = process.argv.slice(2);
const maxCallsIdx = args.indexOf("--max-calls");
const MAX_CALLS = maxCallsIdx >= 0 ? Number(args[maxCallsIdx + 1]) : 500;
const INPUT =
  args.find((a, i) => !a.startsWith("--") && i !== maxCallsIdx + 1) ??
  "tests/example-real-dom.json";
const FILTERED_OUTPUT = "tests/example-filtered-dom.json";
const GROUPED_OUTPUT = "tests/example-grouped-dom.json";
const NAV_OUTPUT = "tests/example-nav.json";

const client = new TypeSafeClient({ defaultModel: "jev-latest" });

const start = Date.now();
const real: ParsedNode = JSON.parse(readFileSync(INPUT, "utf8"));
const { filtered, grouping, stages } = await runPipeline(real, client, {
  maxCalls: MAX_CALLS,
});

writeFileSync(FILTERED_OUTPUT, JSON.stringify(filtered, null, 2));
writeFileSync(GROUPED_OUTPUT, JSON.stringify(grouping.tree, null, 2));

console.log("groups:");
console.log(formatGroups(grouping.tree, grouping.groups).join("\n"));

const nav = buildNav(grouping.tree, "example page");
writeFileSync(NAV_OUTPUT, JSON.stringify(nav, null, 2));

const outline = (it: NavItem, depth = 0): string[] => [
  `${"  ".repeat(depth)}${speakable(it).slice(0, 100)}`,
  ...it.children.flatMap((c) => outline(c, depth + 1)),
];
const lines = outline(nav);
console.log(`\nnavigator outline (${lines.length} items, first 80):`);
console.log(lines.slice(0, 80).join("\n"));

console.log("\nstages:");
console.table(stages);
console.log("summary", {
  groups: grouping.groups.length,
  navItems: lines.length,
  jevCalls: stages.reduce((n, s) => n + s.jevCalls, 0),
  seconds: (Date.now() - start) / 1000,
  outputs: [FILTERED_OUTPUT, GROUPED_OUTPUT, NAV_OUTPUT],
});
