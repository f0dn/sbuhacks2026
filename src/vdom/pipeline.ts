// every pass in order, from a parsed DOM to the grouped tree section mode
// moves through:
//   prefilter -> collapse -> filter (Jev) -> group (Jev)
// used by the service worker and by tests/pipeline.ts.

import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { collapse } from "./collapse.js";
import { filter } from "./filter.js";
import { group } from "./group.js";
import { prefilter } from "./prefilter.js";
import { countNodes, findTag, type ParsedNode } from "./types.js";

export type PipelineOptions = { maxCalls?: number; concurrency?: number };

export type StageStats = {
  stage: string;
  nodes: number;
  jevCalls: number;
  ms: number;
};

export const runPipeline = async (
  real: ParsedNode,
  client: TypeSafeClient,
  { maxCalls = 500, concurrency = 16 }: PipelineOptions = {},
) => {
  const stages: StageStats[] = [
    { stage: "parsed", nodes: countNodes(real), jevCalls: 0, ms: 0 },
  ];
  let t = Date.now();
  const record = (stage: string, nodes: number, jevCalls = 0) => {
    stages.push({ stage, nodes, jevCalls, ms: Date.now() - t });
    t = Date.now();
  };

  const prefiltered = prefilter(findTag(real, "BODY") ?? real);
  if (!prefiltered) throw new Error("nothing left after prefilter");
  record("prefilter", countNodes(prefiltered));

  const collapsed = collapse(prefiltered);
  record("collapse", countNodes(collapsed));

  const { judged, filtered, calls: filterCalls } = await filter(
    collapsed,
    client,
    { maxCalls, concurrency },
  );
  if (!filtered) throw new Error("Jev pruned the whole page");
  record("filter (Jev)", countNodes(filtered), filterCalls);

  const grouping = await group(filtered, client, { maxCalls, concurrency });
  record("group (Jev)", countNodes(grouping.tree), grouping.calls);

  return { judged, filtered, grouping, stages };
};
