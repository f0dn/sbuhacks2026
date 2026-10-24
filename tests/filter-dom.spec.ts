// feeds a real parsed DOM (from src/vdom/parse.ts) through prefilter, collapse
// and the Jev filter pass, and prints every node's verdict.
//
// usage: pnpm tsx tests/filter-dom.spec.ts [input.json] [--max-calls N]

import { TypeSafeClient } from "@typesafe-ai/sdk";
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { collapse } from "../src/vdom/collapse.js";
import { filter } from "../src/vdom/filter.js";
import { prefilter } from "../src/vdom/prefilter.js";
import {
  countNodes,
  describe,
  findTag,
  formatTree,
  walkTree,
  type FilteredNode,
  type ParsedNode,
} from "../src/vdom/types.js";

const args = process.argv.slice(2);
const maxCallsIdx = args.indexOf("--max-calls");
const MAX_CALLS = maxCallsIdx >= 0 ? Number(args[maxCallsIdx + 1]) : 500;
const INPUT =
  args.find((a, i) => !a.startsWith("--") && i !== maxCallsIdx + 1) ??
  "tests/example-real-dom.json";
const OUTPUT = "tests/example-filtered-dom.json";
const CONCURRENCY = 500;

const fmt = (x: number) => x.toFixed(2);

const line = (n: FilteredNode) => {
  const v = n.jev;
  const stats = v
    ? ` ${v.region}(${fmt(v.regionConfidence)}) content=${fmt(v.hasContent)} deco=${fmt(v.isDecorative)} imp=${fmt(v.importance)}`
    : "";
  const merged = n.merged.length ? ` (+${n.merged.length} wrappers)` : "";
  return `${n.status.toUpperCase()} ${describe(n)}${merged}${stats}`;
};

const countStatus = (root: FilteredNode) => {
  const acc: Record<string, number> = {};
  walkTree(root, (n) => {
    acc[n.status] = (acc[n.status] ?? 0) + 1;
  });
  return acc;
};

const client = new TypeSafeClient({ defaultModel: "jev-latest" });

const start = Date.now();
const real: ParsedNode = JSON.parse(readFileSync(INPUT, "utf8"));
const body = findTag(real, "BODY") ?? real;
const prefiltered = prefilter(body);
if (!prefiltered) throw new Error("nothing left after prefilter");
const collapsed = collapse(prefiltered);

console.log(
  `nodes in: ${countNodes(real)}, after prefilter: ${countNodes(prefiltered)}, after collapse: ${countNodes(collapsed)}`,
);

const { judged, filtered, calls } = await filter(collapsed, client, {
  maxCalls: MAX_CALLS,
  concurrency: CONCURRENCY,
});

console.log(
  formatTree(judged, line, { expand: (n) => n.status === "kept" }).join("\n"),
);
writeFileSync(OUTPUT, JSON.stringify(filtered, null, 2));

console.log("\nsummary", {
  jevCalls: calls,
  maxCalls: MAX_CALLS,
  ...countStatus(judged),
  seconds: (Date.now() - start) / 1000,
  output: OUTPUT,
});
