// the one representation of the DOM that every pass works on.
//
// each pass (parse -> filter -> classify -> apply ARIA) keeps the same tree
// and attaches its own data to every node through the `Data` parameter, so
// `DomNode<FilterData & { semantics?: Semantics }>` still has everything the
// earlier passes added.
//
// nodes have no parent pointer and no reference to the live element, so the
// tree survives `JSON.stringify` and `chrome.runtime.sendMessage`. use `id`
// (plus the map that `parse` fills in) to get back to the live element, and
// `parentsOf` when a pass needs ancestors.

/** one node of our copy of the DOM. `Data` is what earlier passes attached. */
export type DomNode<Data = {}> = {
  /** unique within one parse; maps back to the live element in the content script */
  id: number;
  /** the tag name of the element, as `tagName` reports it (e.g. "DIV", "svg") */
  tag: string;
  /** aria-* and role attributes, by name, e.g. { "aria-label": "Close", role: "button" } */
  aria: Record<string, string>;
  /** this element's own text (direct text nodes only), whitespace squashed */
  text: string;
  children: DomNode<Data>[];
} & Data;

/** stage 1: straight out of src/vdom/parse.ts */
export type ParsedNode = DomNode;

/** stage 2: Jev's answers from the top-down filter pass */
export type FilterVerdict = {
  region: string;
  regionConfidence: number;
  hasContent: number;
  isDecorative: number;
  importance: number;
  interesting: boolean;
};

export type FilterData = {
  status: "kept" | "pruned" | "unvisited";
  jev?: FilterVerdict;
};

export type FilteredNode = DomNode<FilterData>;

/**
 * stage 3 (planned): the semantics Jev inferred for an element, which stage 4
 * turns into ARIA on the live page.
 *
 * As an example, a tree representing this HTML:
 * ```
 * div
 *  span: font-bold, "Hello world"
 *  div: border-b
 *  form
 *    div
 *      span: "Name"
 *      input
 *    button: "Submit"
 * ```
 *
 * can be enriched with the information that: "Name" span is labeling the
 * input, and that the button is a submit button, that "Hello world" is a
 * heading, etc. This creates the virtual tree:
 *
 * ```
 * <main content>
 *  <h1>Hello world</h1>
 *  <hr>
 *  <form>
 *    <label for="name">Name</label>
 *    <input id="name" />
 *    <button type="submit">Submit</button>
 * ```
 *
 * With this virtual tree, we can then navigate the DOM in a more meaninful
 * way, answering questions like "what is the label for this input?".
 */
export type Semantics = {
  role?: string;
  headingLevel?: number;
  /** id of the node that labels this one */
  labelledBy?: number;
  label?: string;
  decorative?: boolean;
};

export type EnrichedNode = DomNode<FilterData & { semantics?: Semantics }>;

// ---------------------------------------------------------------------------
// helpers that work on any pass
// ---------------------------------------------------------------------------

/** rebuild the tree, replacing each node's pass data with `f(node)` */
export const mapTree = <A, B>(
  node: DomNode<A>,
  f: (n: DomNode<A>) => B,
): DomNode<B> =>
  ({
    ...f(node),
    id: node.id,
    tag: node.tag,
    aria: node.aria,
    text: node.text,
    children: node.children.map((c) => mapTree(c, f)),
  }) as DomNode<B>;

/**
 * keep only the nodes where `keep(node, parent)` is true; a dropped node takes
 * its whole subtree with it. returns null if the root itself is dropped.
 */
export const filterTree = <D>(
  node: DomNode<D>,
  keep: (n: DomNode<D>, parent: DomNode<D> | null) => boolean,
  parent: DomNode<D> | null = null,
): DomNode<D> | null =>
  keep(node, parent)
    ? {
        ...node,
        children: node.children
          .map((c) => filterTree(c, keep, node))
          .filter((c): c is DomNode<D> => c !== null),
      }
    : null;

/** visit every node top-down; return `false` from `visit` to skip its children */
export const walkTree = <D>(
  node: DomNode<D>,
  visit: (n: DomNode<D>, depth: number) => boolean | void,
  depth = 0,
) => {
  if (visit(node, depth) === false) return;
  for (const c of node.children) walkTree(c, visit, depth + 1);
};

/**
 * visit nodes top-down (breadth first), up to `concurrency` at a time. a
 * node's children are only visited if `visit` resolves to true. no new visits
 * start once `limit` is reached. returns how many nodes were visited.
 */
export const walkTreeAsync = async <D>(
  root: DomNode<D>,
  visit: (n: DomNode<D>) => Promise<boolean>,
  {
    concurrency = 8,
    limit = Infinity,
  }: { concurrency?: number; limit?: number } = {},
): Promise<number> => {
  const queue = [root];
  let active = 0;
  let started = 0;

  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      while (active < concurrency && queue.length > 0 && started < limit) {
        const n = queue.shift()!;
        active++;
        started++;
        visit(n)
          .then((descend) => {
            if (descend) queue.push(...n.children);
          })
          .catch(reject)
          .finally(() => {
            active--;
            pump();
          });
      }
      // queue empty or out of budget: whatever is left stays unvisited
      if (active === 0) resolve();
    };
    pump();
  });
  return started;
};

export const clip = (s: string, n: number) =>
  s.length > n ? s.slice(0, n) + "..." : s;

/** one line for a node, e.g. `<button> [aria-label=Close] "Close"` */
export const describe = (n: DomNode) => {
  const attrs = Object.entries(n.aria).map(([k, v]) => `${k}=${v}`);
  const aria = attrs.length ? ` [${attrs.join(", ")}]` : "";
  const text = n.text ? ` "${clip(n.text, 80)}"` : "";
  return `<${n.tag.toLowerCase()}>${aria}${text}`;
};

/**
 * one indented line per node, as given by `line`. doesn't go deeper than
 * `maxDepth` (noting how many children were cut), or below nodes where
 * `expand` is false.
 */
export const formatTree = <D>(
  root: DomNode<D>,
  line: (n: DomNode<D>) => string = describe,
  {
    maxDepth = Infinity,
    expand = () => true,
  }: { maxDepth?: number; expand?: (n: DomNode<D>) => boolean } = {},
): string[] => {
  const lines: string[] = [];
  walkTree(root, (n, depth) => {
    lines.push(`${"  ".repeat(depth)}${line(n)}`);
    if (depth < maxDepth) return expand(n);
    if (n.children.length)
      lines.push(`${"  ".repeat(depth + 1)}... ${n.children.length} children`);
    return false;
  });
  return lines;
};

/** true if `test` holds for the node or any of its descendants */
export const someNode = <D>(
  node: DomNode<D>,
  test: (n: DomNode<D>) => boolean,
): boolean => test(node) || node.children.some((c) => someNode(c, test));

export const countNodes = <D>(node: DomNode<D>): number =>
  1 + node.children.reduce((n, c) => n + countNodes(c), 0);

export const findTag = <D>(node: DomNode<D>, tag: string): DomNode<D> | null =>
  node.tag === tag
    ? node
    : node.children.reduce<DomNode<D> | null>(
        (found, c) => found ?? findTag(c, tag),
        null,
      );

/** map from each node to its parent (the root maps to null) */
export const parentsOf = <D>(root: DomNode<D>) => {
  const parents = new Map<DomNode<D>, DomNode<D> | null>([[root, null]]);
  const visit = (n: DomNode<D>) => {
    for (const c of n.children) {
      parents.set(c, n);
      visit(c);
    }
  };
  visit(root);
  return parents;
};
