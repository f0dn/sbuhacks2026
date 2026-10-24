// takes the filtered DOM (from tests/filter-dom.ts) and runs only the grouping
// pass (src/vdom/group.ts), so grouping can be tuned without re-running the
// filter's Jev calls.
//
// usage: pnpm tsx tests/group-dom.ts [input.json] [--max-calls N]

import { TypeSafeClient } from "@typesafe-ai/sdk";
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { formatGroups, group } from "../src/vdom/group.js";
import { countNodes, type FilteredNode } from "../src/vdom/types.js";

const args = process.argv.slice(2);
const maxCallsIdx = args.indexOf("--max-calls");
const MAX_CALLS = maxCallsIdx >= 0 ? Number(args[maxCallsIdx + 1]) : 500;
const INPUT =
  args.find((a, i) => !a.startsWith("--") && i !== maxCallsIdx + 1) ??
  "tests/example-filtered-dom.json";
const OUTPUT = "tests/example-grouped-dom.json";

const client = new TypeSafeClient({ defaultModel: "jev-latest" });

const start = Date.now();
const filtered: FilteredNode = JSON.parse(readFileSync(INPUT, "utf8"));
const { tree, groups, calls, stats } = await group(filtered, client, {
  maxCalls: MAX_CALLS,
});

console.log(formatGroups(tree, groups).join("\n"));
writeFileSync(OUTPUT, JSON.stringify(tree, null, 2));

console.log("\nsummary", {
  nodes: countNodes(tree),
  ...stats,
  jevCalls: calls,
  groups: groups.length,
  annotatedParents: groups.filter((g) => !g.group!.synthetic).length,
  synthetic: groups.filter((g) => g.group!.synthetic).length,
  titled: groups.filter((g) => g.group!.labelledBy !== undefined).length,
  seconds: (Date.now() - start) / 1000,
  output: OUTPUT,
});
