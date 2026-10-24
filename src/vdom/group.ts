// asks Jev which neighbouring siblings belong to the same unit (a card, a
// section, a label and its field), then groups them and records which member
// titles each group.
//
// a parent whose children all form one unit is annotated in place; a run that
// covers only some children is wrapped in a synthetic GROUP node (negative id,
// no live element).

import { choice, noul, type TypeSafeClient } from "@typesafe-ai/sdk";
import {
  ancestorOutline,
  clip,
  describe,
  formatTree,
  mapTree,
  parentsOf,
  summarize,
  walkTree,
  type FilteredNode,
  type GroupedNode,
  type GroupInfo,
} from "./types.js";

export type GroupOptions = { maxCalls?: number; concurrency?: number };

/** the author already grouped the children of these */
const SKIP_TAGS = new Set([
  "UL",
  "OL",
  "LI",
  "TABLE",
  "TBODY",
  "TR",
  "SELECT",
  "NAV",
]);
/** only join neighbours when Jev is confident; otherwise leave the page alone */
const JOIN_THRESHOLD = 0.7;
const TITLE_CONFIDENCE = 0.6;

/** run `tasks` with at most `concurrency` in flight */
const pool = async <T>(tasks: (() => Promise<T>)[], concurrency: number) => {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
};

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

const outline = (n: GroupedNode, maxDepth = 2) =>
  clip(formatTree(n, describe, { maxDepth }).join("\n"), 1200);

const pairState = (
  parent: GroupedNode,
  a: GroupedNode,
  b: GroupedNode,
  parents: Map<GroupedNode, GroupedNode | null>,
) => {
  const mark = (n: GroupedNode) =>
    `${n === a ? "[A] " : n === b ? "[B] " : ""}${describe(n)}`;
  const context = clip(
    formatTree(parent, mark, { maxDepth: 2 }).join("\n"),
    2500,
  );
  return [
    `Element A:\n${outline(a)}`,
    `Element B (the next sibling of A):\n${outline(b)}`,
    `Their parent, with A and B marked:\n${context}`,
    `Ancestors of the parent:\n${ancestorOutline(parent, parents)}`,
  ].join("\n\n");
};

const groupState = (members: GroupedNode[]) =>
  members.map((m, i) => `Member m${i}:\n${outline(m)}`).join("\n\n");

// ---------------------------------------------------------------------------
// Jev questions
// ---------------------------------------------------------------------------

type PairAnswer = { sameUnit: number; aTitlesB: number };

const askPair = async (
  client: TypeSafeClient,
  state: string,
): Promise<PairAnswer> => {
  const { answers } = await client.systemOne({
    state,
    questions: {
      same_unit: noul(
        "Element A and element B are parts of the same unit of content, such as one card, one section, or a label and its field",
      ),
      a_titles_b: noul("Element A is a heading, title, or label for element B"),
    },
  });
  return {
    sameUnit: answers.same_unit.noul,
    aTitlesB: answers.a_titles_b.noul,
  };
};

const askGroup = async (
  client: TypeSafeClient,
  members: GroupedNode[],
  firstPair: PairAnswer | undefined,
  synthetic: boolean,
): Promise<GroupInfo> => {
  const options: Record<string, string> = Object.fromEntries(
    members.map((m, i) => [`m${i}`, clip(summarize(m), 120)]),
  );
  options.none = "No member is a title";

  const { answers } = await client.systemOne({
    state: groupState(members),
    questions: {
      title: choice("Which member is the title of this group?", options),
      kind: choice("What kind of group are these members together?", {
        section: "A heading followed by the content it introduces.",
        card: "One item, like a project, product, or news story, with its title and details.",
        label_and_field: "A form field and the text that labels it.",
        other: "Some other unit of related content.",
      }),
    },
  });

  const t = answers.title;
  const picked =
    t.choice !== "none" && t.confidence > TITLE_CONFIDENCE
      ? members[Number(t.choice.slice(1))]
      : // cheap tie-breaker: the first member titles the one after it
        firstPair && firstPair.aTitlesB > JOIN_THRESHOLD
        ? members[0]
        : undefined;

  return {
    kind: answers.kind.choice,
    synthetic,
    ...(picked && { labelledBy: picked.id }),
  };
};

// ---------------------------------------------------------------------------
// grouping
// ---------------------------------------------------------------------------

/** a run of neighbouring children that Jev joined; `start` is the index of the first */
type Run = {
  parent: GroupedNode;
  start: number;
  members: GroupedNode[];
  pairs: PairAnswer[];
};

/** split children into runs, joining neighbour i and i+1 when Jev is confident */
const runsOf = (parent: GroupedNode, answers: (PairAnswer | undefined)[]) => {
  const runs: Run[] = [];
  let run: Run = {
    parent,
    start: 0,
    members: [parent.children[0]!],
    pairs: [],
  };
  parent.children.slice(1).forEach((child, i) => {
    const a = answers[i];
    if (a && a.sameUnit > JOIN_THRESHOLD) {
      run.members.push(child);
      run.pairs.push(a);
    } else {
      runs.push(run);
      run = { parent, start: i + 1, members: [child], pairs: [] };
    }
  });
  runs.push(run);
  return runs.filter((r) => r.members.length >= 2);
};

/**
 * returns a grouped copy of `root` (the input isn't changed), every group node
 * (annotated parents and synthetic GROUPs), and counts for reporting.
 */
export const group = async (
  root: FilteredNode,
  client: TypeSafeClient,
  { maxCalls = 500, concurrency = 16 }: GroupOptions = {},
) => {
  const tree: GroupedNode = mapTree(root, (n) => ({
    merged: n.merged,
    status: n.status,
    ...(n.jev && { jev: n.jev }),
  }));
  const parents = parentsOf(tree);

  const candidates: GroupedNode[] = [];
  walkTree(tree, (n) => {
    if (n.status === "kept" && n.children.length >= 2 && !SKIP_TAGS.has(n.tag))
      candidates.push(n);
  });

  // 1. one call per pair of neighbouring siblings, up to the budget
  const pairJobs = candidates.flatMap((parent) =>
    parent.children
      .slice(1)
      .map((b, i) => ({ parent, i, a: parent.children[i]!, b })),
  );
  const budgeted = pairJobs.slice(0, maxCalls);
  const pairAnswers = await pool(
    budgeted.map(
      (j) => () => askPair(client, pairState(j.parent, j.a, j.b, parents)),
    ),
    concurrency,
  );
  const answersByParent = new Map<GroupedNode, (PairAnswer | undefined)[]>();
  budgeted.forEach((j, k) => {
    const list = answersByParent.get(j.parent) ?? [];
    list[j.i] = pairAnswers[k];
    answersByParent.set(j.parent, list);
  });

  // 2. runs of joined neighbours become groups
  const runs = candidates.flatMap((p) =>
    runsOf(p, answersByParent.get(p) ?? []),
  );

  // 3. one call per group, for its title and kind
  const infos = await pool(
    runs.map(
      (r) => () =>
        askGroup(
          client,
          r.members,
          r.pairs[0],
          r.members.length < r.parent.children.length,
        ),
    ),
    concurrency,
  );

  // 4. apply: annotate parents whose children are all one group, wrap the rest.
  // go backwards so splicing doesn't shift the start of runs not yet applied
  const groups: GroupedNode[] = [];
  let nextSyntheticId = -1;
  runs.forEach((r, k) => {
    const info = infos[k]!;
    if (!info.synthetic) {
      r.parent.group = info;
      groups.push(r.parent);
    }
  });
  runs
    .map((r, k) => ({ r, info: infos[k]! }))
    .filter(({ info }) => info.synthetic)
    .reverse()
    .forEach(({ r, info }) => {
      const node: GroupedNode = {
        id: nextSyntheticId--,
        tag: "GROUP",
        aria: {},
        text: "",
        children: r.members,
        merged: [],
        status: "kept",
        group: info,
      };
      r.parent.children.splice(r.start, r.members.length, node);
      groups.push(node);
    });

  return {
    tree,
    groups,
    calls: budgeted.length + runs.length,
    stats: {
      candidateParents: candidates.length,
      pairs: pairJobs.length,
      pairsAsked: budgeted.length,
    },
  };
};

/** one line per group (kind, title) followed by its members, for printing */
export const formatGroups = (tree: GroupedNode, groups: GroupedNode[]) => {
  const byId = new Map<number, GroupedNode>();
  walkTree(tree, (n) => {
    byId.set(n.id, n);
  });

  return [...groups]
    .sort((x, y) => Math.abs(x.id) - Math.abs(y.id))
    .flatMap((g) => {
      const info = g.group!;
      const title =
        info.labelledBy !== undefined ? byId.get(info.labelledBy) : undefined;
      return [
        `#${g.id} ${describe(g)} ${info.kind}${info.synthetic ? " (synthetic)" : ""}` +
          ` title=${title ? `#${title.id} ${clip(summarize(title), 60)}` : "-"}`,
        ...g.children.map((m) => `    #${m.id} ${clip(summarize(m), 90)}`),
      ];
    });
};
