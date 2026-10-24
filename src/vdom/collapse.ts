// folds chains of single-child wrapper divs (div > div > div > ...) into the
// outermost one. no Jev; just shrinks the tree before anything gets judged.
//
// the surviving div is enriched with what the removed ones carried: their
// aria/role attributes, their text, and their ids (in `merged`), so stage 4
// can still reach the live elements.

import { walkTreePost, type CollapseData, type DomNode } from './types.js';

/** tags that are only layout; add SPAN/SECTION here to fold those too */
const WRAPPER_TAGS = new Set(['DIV']);

/** true if both maps set the same attribute to different values */
const conflicts = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).some((k) => k in b && a[k] !== b[k]);

export const collapse = <D>(root: DomNode<D>): DomNode<D & CollapseData> =>
  walkTreePost<D, DomNode<D & CollapseData>>(root, (n, cs) => {
    const child = cs.length === 1 ? cs[0] : undefined;
    const foldable =
      child !== undefined &&
      WRAPPER_TAGS.has(n.tag) &&
      WRAPPER_TAGS.has(child.tag) &&
      // both have text: folding would lose its order
      !(n.text && child.text) &&
      // don't override what the author wrote
      !conflicts(n.aria, child.aria);

    if (!child || !foldable) return { ...n, merged: [], children: cs };

    return {
      ...n,
      aria: { ...child.aria, ...n.aria },
      text: n.text || child.text,
      children: child.children,
      merged: [
        { id: child.id, tag: child.tag, aria: child.aria, text: child.text },
        ...child.merged,
      ],
    };
  });
