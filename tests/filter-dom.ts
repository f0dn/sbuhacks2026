// feeds a real parsed DOM (from src/vdom/parse.ts) to Jev, top-down, to decide
// which parts of the page are worth classifying in more detail.
//
// usage: pnpm tsx tests/filter-dom.ts [input.json] [--max-calls N]

import { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import {
  clip,
  countNodes,
  describe,
  filterTree,
  findTag,
  formatTree,
  mapTree,
  parentsOf,
  someNode,
  walkTree,
  walkTreeAsync,
  type FilteredNode,
  type ParsedNode,
  type FilterVerdict,
} from "../src/vdom/types.js";
import { collapse } from "../src/vdom/collapse.js";

const args = process.argv.slice(2);
const maxCallsIdx = args.indexOf("--max-calls");
const MAX_CALLS = maxCallsIdx >= 0 ? Number(args[maxCallsIdx + 1]) : 500;
const INPUT =
  args.find((a, i) => !a.startsWith("--") && i !== maxCallsIdx + 1) ??
  "tests/example-real-dom.json";
const OUTPUT = "tests/example-filtered-dom.json";
const CONCURRENCY = 500;

// ---------------------------------------------------------------------------
// 1 + 2. load and prefilter without Jev
// ---------------------------------------------------------------------------

const DROP_TAGS = new Set([
  "HEAD",
  "SCRIPT",
  "STYLE",
  "META",
  "LINK",
  "NOSCRIPT",
  "BR",
  "TEMPLATE",
]);
const KEEP_WITHOUT_TEXT = new Set(["IMG", "INPUT", "BUTTON", "svg"]);

const prefilter = (root: ParsedNode) =>
  filterTree(
    root,
    (el, parent) =>
      !DROP_TAGS.has(el.tag) &&
      // keep the svg itself, but not its paths/circles/masks
      parent?.tag !== "svg" &&
      (KEEP_WITHOUT_TEXT.has(el.tag) || someNode(el, (n) => n.text !== "")),
  );

// ---------------------------------------------------------------------------
// 3. Jev state for one node
// ---------------------------------------------------------------------------

let parents = new Map<FilteredNode, FilteredNode | null>();

const stateFor = (n: FilteredNode) => {
  const ancestors: string[] = [];
  for (let p = parents.get(n); p; p = parents.get(p))
    ancestors.unshift(describe(p));
  const ancestry = ancestors.map((a, i) => `${"  ".repeat(i)}${a}`).join("\n");
  const subtree = clip(
    formatTree(n, describe, { maxDepth: 2 }).join("\n"),
    2500,
  );
  return `Page outline (ancestors of the element):\n${ancestry || "(none)"}\n\nElement of interest:\n${subtree}`;
};

// ---------------------------------------------------------------------------
// 3. top-down Jev pass with pruning
// ---------------------------------------------------------------------------

const client = new TypeSafeClient({ defaultModel: "jev-latest" });
let calls = 0;

const judge = async (n: FilteredNode): Promise<FilterVerdict> => {
  const { answers } = await client.systemOne({
    state: stateFor(n),
    questions: {
      region: choice("Which part of the page is the element of interest?", {
        navigation: "Site navigation, menus, or lists of links to other pages.",
        main_content: "The main article or primary content of the page.",
        header: "Page header or branding, such as a logo or site title.",
        footer: "Page footer, such as copyright or legal links.",
        sidebar: "A sidebar or table of contents next to the main content.",
        form: "A search box or form for user input.",
        code_sample: "A block of example source code.",
        decorative: "Decorative or layout-only, with no content of its own.",
      }),
      has_content: noul(
        "The element of interest contains content a reader of this page would want to hear",
      ),
      is_decorative: noul(
        "The element of interest is purely decorative, layout-only, or duplicates nearby content",
      ),
      importance: score(
        "How important is the element of interest to the main content of the page?",
        ["Not important at all", "Somewhat important", "Very important"],
      ),
    },
  });

  return {
    region: answers.region.choice,
    regionConfidence: answers.region.confidence,
    hasContent: answers.has_content.noul,
    isDecorative: answers.is_decorative.noul,
    importance: answers.importance.score,
    interesting:
      answers.has_content.noul > 0.5 && answers.is_decorative.noul < 0.5,
  };
};

/** only prune when Jev is confident; otherwise leave the node and look deeper */
const confidentlyBoring = (v: FilterVerdict) =>
  v.isDecorative > 0.8 ||
  v.hasContent < 0.2 ||
  // e.g. the empty "#" anchor links next to headings
  (v.hasContent < 0.35 && v.importance < 0.6);

/** judge a node, and only look at its children if it's worth keeping */
const visit = async (n: FilteredNode) => {
  n.jev = await judge(n);
  n.status = confidentlyBoring(n.jev) ? "pruned" : "kept";
  return n.status === "kept";
};

// ---------------------------------------------------------------------------
// 4. output
// ---------------------------------------------------------------------------

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

const start = Date.now();
const real: ParsedNode = JSON.parse(readFileSync(INPUT, "utf8"));
const body = findTag(real, "BODY") ?? real;
const prefiltered = prefilter(body);
if (!prefiltered) throw new Error("nothing left after prefilter");
const collapsed = collapse(prefiltered);
const root: FilteredNode = mapTree(collapsed, (n) => ({
  merged: n.merged,
  status: "unvisited" as const,
}));
parents = parentsOf(root);

console.log(
  `nodes in: ${countNodes(real)}, after prefilter: ${countNodes(prefiltered)}, after collapse: ${countNodes(root)}`,
);

calls = await walkTreeAsync(root, visit, {
  concurrency: CONCURRENCY,
  limit: MAX_CALLS,
});

console.log(
  formatTree(root, line, { expand: (n) => n.status === "kept" }).join("\n"),
);
// drop pruned subtrees, keep kept + unvisited nodes (unvisited = undecided, so leave them)
const filtered = filterTree(root, (n) => n.status !== "pruned");
writeFileSync(OUTPUT, JSON.stringify(filtered, null, 2));

console.log("\nsummary", {
  jevCalls: calls,
  maxCalls: MAX_CALLS,
  ...countStatus(root),
  seconds: (Date.now() - start) / 1000,
  output: OUTPUT,
});
