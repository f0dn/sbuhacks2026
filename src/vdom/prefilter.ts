// drops what can never matter to a screen reader before anything else runs:
// head/script/style and friends, svg internals, and subtrees with no text.
// no Jev.

import { filterTree, someNode, type DomNode } from "./types.js";

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
/** worth keeping even with no text anywhere inside */
const KEEP_WITHOUT_TEXT = new Set([
  "IMG",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
  "svg",
]);

export const prefilter = <D>(root: DomNode<D>) =>
  filterTree(
    root,
    (el, parent) =>
      !DROP_TAGS.has(el.tag) &&
      // keep the svg itself, but not its paths/circles/masks
      parent?.tag !== "svg" &&
      (KEEP_WITHOUT_TEXT.has(el.tag) || someNode(el, (n) => n.text !== "")),
  );
