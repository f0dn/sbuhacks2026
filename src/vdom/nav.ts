// turns the grouped tree into the outline the navigator UI moves through, the
// way a screen reader would present the page: landmarks, groups (with their
// titles), headings, lists, links, buttons, fields, images and text. layout
// wrappers disappear; their children are hoisted into the parent.
//
// pure, no DOM: the content script fills in what only the live page knows
// (image alt text, field labels) with `fillLabel`.

import { firstText, walkTree, type GroupedNode } from "./types.js";

export type NavKind =
  | "page"
  | "landmark"
  | "group"
  | "list"
  | "item"
  | "heading"
  | "link"
  | "button"
  | "field"
  | "image"
  | "text";

export type NavItem = {
  /** node id of the live element; negative for a synthetic group */
  id: number;
  kind: NavKind;
  /** said after the label, e.g. "navigation", "card", "heading level 2" */
  role: string;
  label: string;
  /** ids of the live elements to highlight (a synthetic group's members) */
  elementIds: number[];
  children: NavItem[];
};

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

const firstWords = (s: string, n: number) => {
  const words = s.split(" ");
  return words.length > n ? `${words.slice(0, n).join(" ")}…` : s;
};

/** all the text under `n`, own text first */
const allText = (n: GroupedNode): string =>
  squash([n.text, ...n.children.map(allText)].join(" "));

const LANDMARK_TAGS: Record<string, string> = {
  HEADER: "header",
  NAV: "navigation",
  MAIN: "main content",
  FOOTER: "footer",
  ASIDE: "sidebar",
  FORM: "form",
};
const LANDMARK_ROLES: Record<string, string> = {
  banner: "header",
  navigation: "navigation",
  main: "main content",
  contentinfo: "footer",
  complementary: "sidebar",
  search: "search",
  form: "form",
  region: "region",
};
const GROUP_ROLES: Record<string, string> = {
  section: "section",
  card: "card",
  label_and_field: "form field",
  other: "group",
};
const FIELD_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
/** blocks of text that are read as one item */
const TEXT_TAGS = new Set([
  "P",
  "PRE",
  "BLOCKQUOTE",
  "FIGCAPTION",
  "LABEL",
  "TIME",
  "DT",
  "DD",
  "TD",
  "TH",
  "CAPTION",
  "ADDRESS",
]);

const item = (
  n: GroupedNode,
  kind: NavKind,
  role: string,
  label: string,
  children: NavItem[] = [],
): NavItem => ({ id: n.id, kind, role, label, elementIds: [n.id], children });

/** an item read as a whole, without descending into it */
const leafOf = (n: GroupedNode): NavItem | null => {
  const role = n.aria.role;
  const name = n.aria["aria-label"];
  const heading = /^H([1-6])$/.exec(n.tag);
  if (heading || role === "heading")
    return item(n, "heading", `heading level ${heading?.[1] ?? n.aria["aria-level"] ?? 2}`, name ?? allText(n));
  if (n.tag === "A" || role === "link") return item(n, "link", "link", name ?? allText(n));
  if (n.tag === "BUTTON" || role === "button") return item(n, "button", "button", name ?? allText(n));
  if (FIELD_TAGS.has(n.tag)) return item(n, "field", n.tag === "SELECT" ? "combo box" : "edit field", name ?? "");
  if (n.tag === "IMG" || n.tag === "svg" || role === "img") return item(n, "image", "image", name ?? "");
  if (TEXT_TAGS.has(n.tag)) return item(n, "text", "text", allText(n));
  return null;
};

/**
 * `keepEmpty` keeps headings, links and text with no text in the tree, for
 * when the caller can fill them in from the live page (text that an animation
 * hadn't typed in yet when the page was parsed)
 */
export const buildNav = (
  root: GroupedNode,
  title = "",
  { keepEmpty = false }: { keepEmpty?: boolean } = {},
): NavItem => {
  const byId = new Map<number, GroupedNode>();
  walkTree(root, (n) => {
    byId.set(n.id, n);
  });
  /** a group's title: the first heading in its title member, else its first text */
  const titleOf = (n: GroupedNode) => {
    const t = n.group?.labelledBy;
    const node = t === undefined ? undefined : byId.get(t);
    if (!node) return "";
    let heading: GroupedNode | undefined;
    walkTree(node, (c) => {
      if (heading) return false;
      if (/^H[1-6]$/.test(c.tag) || c.aria.role === "heading") heading = c;
    });
    return heading ? allText(heading) : firstText(node);
  };

  const build = (n: GroupedNode): NavItem[] => {
    // the author hid it from screen readers; so do we
    if (n.aria["aria-hidden"] === "true") return [];

    const leaf = leafOf(n);
    if (leaf) {
      // empty text and links are noise, but an unnamed field or image still matters
      const nameless =
        keepEmpty || leaf.kind === "field" || leaf.kind === "image" || leaf.kind === "button";
      return leaf.label || nameless ? [leaf] : [];
    }

    const kids = n.children.flatMap(build);
    // a wrapper that has text of its own, beside its children
    if (n.text) kids.unshift(item(n, "text", "text", n.text));
    if (kids.length === 0) return [];

    const landmark = LANDMARK_ROLES[n.aria.role ?? ""] ?? LANDMARK_TAGS[n.tag];
    if (landmark)
      return [item(n, "landmark", landmark, n.aria["aria-label"] ?? titleOf(n), kids)];

    if (n.group) {
      // no title: name it after what it starts with ("22+, card"), so it can
      // be told apart from the groups next to it
      const label = titleOf(n) || firstWords(kids[0]!.label, 8);
      const g = item(n, "group", GROUP_ROLES[n.group.kind] ?? "group", label, kids);
      // a synthetic group has no element of its own: highlight its members
      if (n.group.synthetic) g.elementIds = n.children.map((c) => c.id).filter((id) => id >= 0);
      return [g];
    }

    if (n.tag === "UL" || n.tag === "OL" || n.aria.role === "list")
      return [item(n, "list", "list", n.aria["aria-label"] ?? "", kids)];
    // a list item with one thing in it is just that thing
    if (n.tag === "LI" && kids.length > 1) return [item(n, "item", "list item", "", kids)];

    // a layout wrapper: hoist its children
    return kids;
  };

  return { ...item(root, "page", "page", title, root.children.flatMap(build)) };
};

/** what to say when the navigator lands on `it` */
export const speakable = (it: NavItem) => {
  const count =
    it.children.length > 0
      ? `, ${it.children.length} ${it.children.length === 1 ? "item" : "items"}`
      : "";
  return [it.label, it.role].filter((s) => s).join(", ") + count;
};
