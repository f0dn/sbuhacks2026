// runs every pass end to end on a parsed DOM:
//   prefilter -> collapse -> filter (Jev) -> group (Jev)
// and writes each stage's output, so render-dom.ts can show any of them.
//
// usage: pnpm tsx tests/pipeline.ts [input.json] [--max-calls N]
// --max-calls is the Jev budget for each Jev pass

import { TypeSafeClient } from "@typesafe-ai/sdk";
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { collapse } from "../src/vdom/collapse.js";
import { filter } from "../src/vdom/filter.js";
import { formatGroups, group } from "../src/vdom/group.js";
import { prefilter } from "../src/vdom/prefilter.js";
import { countNodes, findTag, type ParsedNode } from "../src/vdom/types.js";

const args = process.argv.slice(2);
const maxCallsIdx = args.indexOf("--max-calls");
const MAX_CALLS = maxCallsIdx >= 0 ? Number(args[maxCallsIdx + 1]) : 500;
const INPUT =
  args.find((a, i) => !a.startsWith("--") && i !== maxCallsIdx + 1) ??
  "tests/example-real-dom.json";
const FILTERED_OUTPUT = "tests/example-filtered-dom.json";
const GROUPED_OUTPUT = "tests/example-grouped-dom.json";
const CONCURRENCY = 16;

const client = new TypeSafeClient({ defaultModel: "jev-latest" });

/** time one stage and record its node count */
const stages: { stage: string; nodes: number; jevCalls: number; ms: number }[] =
  [];
const timed = async <T>(
  stage: string,
  run: () => T | Promise<T>,
  count: (result: T) => { nodes: number; jevCalls?: number },
) => {
  const t = Date.now();
  const result = await run();
  const { nodes, jevCalls = 0 } = count(result);
  stages.push({ stage, nodes, jevCalls, ms: Date.now() - t });
  return result;
};

const start = Date.now();
const real: ParsedNode = JSON.parse(readFileSync(INPUT, "utf8"));
stages.push({ stage: "parsed", nodes: countNodes(real), jevCalls: 0, ms: 0 });

const body = findTag(real, "BODY") ?? real;
const prefiltered = await timed(
  "prefilter",
  () => prefilter(body),
  (t) => ({ nodes: t ? countNodes(t) : 0 }),
);
if (!prefiltered) throw new Error("nothing left after prefilter");

const collapsed = await timed(
  "collapse",
  () => collapse(prefiltered),
  (t) => ({ nodes: countNodes(t) }),
);

const { filtered } = await timed(
  "filter (Jev)",
  () => filter(collapsed, client, { maxCalls: MAX_CALLS, concurrency: CONCURRENCY }),
  (r) => ({ nodes: r.filtered ? countNodes(r.filtered) : 0, jevCalls: r.calls }),
);
if (!filtered) throw new Error("Jev pruned the whole page");
writeFileSync(FILTERED_OUTPUT, JSON.stringify(filtered, null, 2));

const { tree, groups } = await timed(
  "group (Jev)",
  () => group(filtered, client, { maxCalls: MAX_CALLS, concurrency: CONCURRENCY }),
  (r) => ({ nodes: countNodes(r.tree), jevCalls: r.calls }),
);
writeFileSync(GROUPED_OUTPUT, JSON.stringify(tree, null, 2));

console.log("groups:");
console.log(formatGroups(tree, groups).join("\n"));

console.log("\nstages:");
console.table(stages);
console.log("summary", {
  groups: groups.length,
  synthetic: groups.filter((g) => g.group!.synthetic).length,
  titled: groups.filter((g) => g.group!.labelledBy !== undefined).length,
  jevCalls: stages.reduce((n, s) => n + s.jevCalls, 0),
  seconds: (Date.now() - start) / 1000,
  outputs: [FILTERED_OUTPUT, GROUPED_OUTPUT],
});
