// asks Jev, top-down, which parts of the page are worth classifying in more
// detail. a node is only pruned (with its subtree) when Jev is confident it's
// boring; otherwise we keep it and look at its children.

import { choice, noul, score, type TypeSafeClient } from "@typesafe-ai/sdk";
import {
  ancestorOutline,
  clip,
  describe,
  filterTree,
  formatTree,
  mapTree,
  parentsOf,
  walkTreeAsync,
  type CollapsedNode,
  type FilteredNode,
  type FilterVerdict,
} from "./types.js";

export type FilterOptions = { maxCalls?: number; concurrency?: number };

const stateFor = (
  n: FilteredNode,
  parents: Map<FilteredNode, FilteredNode | null>,
) => {
  const subtree = clip(
    formatTree(n, describe, { maxDepth: 2 }).join("\n"),
    2500,
  );
  return `Page outline (ancestors of the element):\n${ancestorOutline(n, parents)}\n\nElement of interest:\n${subtree}`;
};

const judge = async (
  client: TypeSafeClient,
  state: string,
): Promise<FilterVerdict> => {
  const { answers } = await client.systemOne({
    state,
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

/**
 * `judged` is the whole tree with every node's status (pruned subtrees
 * included, for printing); `filtered` drops the pruned subtrees and keeps kept
 * and unvisited nodes (unvisited = undecided, so leave them).
 */
export const filter = async (
  root: CollapsedNode,
  client: TypeSafeClient,
  { maxCalls = 500, concurrency = 16 }: FilterOptions = {},
) => {
  const judged: FilteredNode = mapTree(root, (n) => ({
    merged: n.merged,
    status: "unvisited" as const,
  }));
  const parents = parentsOf(judged);

  const calls = await walkTreeAsync(
    judged,
    async (n) => {
      n.jev = await judge(client, stateFor(n, parents));
      n.status = confidentlyBoring(n.jev) ? "pruned" : "kept";
      return n.status === "kept";
    },
    { concurrency, limit: maxCalls },
  );

  const filtered = filterTree(judged, (n) => n.status !== "pruned");
  return { judged, filtered, calls };
};
