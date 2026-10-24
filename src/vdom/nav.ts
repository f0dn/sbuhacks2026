// turns the grouped tree into an outline of the page, the way a screen reader
// would see it: landmarks, groups (with their titles), headings, lists, links,
// buttons, fields, images and text. layout wrappers disappear; their children
// are hoisted into the parent. `sectionsOf` picks out the sections (landmarks
// and groups) that the section navigator moves between.
//
// pure, no DOM: the content script fills in what only the live page knows.

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
  /** what it is, e.g. "navigation", "card", "heading level 2" */
  role: string;
  label: string;
  /** ids of the live elements to highlight (a synthetic group's members) */
  elementIds: number[];
  /**
   * for a section: the element that names it (its heading, or what it starts
   * with). focusing it makes a screen reader read the section's real title
   */
  titleId?: number;
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
  /**
   * a group's title: the first heading in its title member, else its first
   * text; with the id of the element it comes from
   */
  const titleOf = (n: GroupedNode): { text: string; id?: number } => {
    const t = n.group?.labelledBy;
    const node = t === undefined ? undefined : byId.get(t);
    if (!node) return { text: "" };
    let heading: GroupedNode | undefined;
    walkTree(node, (c) => {
      if (heading) return false;
      if (/^H[1-6]$/.test(c.tag) || c.aria.role === "heading") heading = c;
    });
    return heading
      ? { text: allText(heading), id: heading.id }
      : { text: firstText(node), id: node.id };
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
    if (landmark) {
      const title = titleOf(n);
      const l = item(n, "landmark", landmark, n.aria["aria-label"] ?? title.text, kids);
      if (title.id !== undefined) l.titleId = title.id;
      return [l];
    }

    if (n.group) {
      // no title: name it after what it starts with ("22+, card"), so it can
      // be told apart from the groups next to it
      const title = titleOf(n);
      const first = kids[0]!;
      const label = title.text || firstWords(first.label, 8);
      const g = item(n, "group", GROUP_ROLES[n.group.kind] ?? "group", label, kids);
      const titleId = title.text ? title.id : first.id >= 0 ? first.id : undefined;
      if (titleId !== undefined) g.titleId = titleId;
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

/** a part of the page the section navigator stops at */
export type Section = {
  item: NavItem;
  /** how many sections it's inside */
  depth: number;
};

/** landmarks and groups, except one field and its label (too small to be a section) */
const isSection = (it: NavItem) =>
  it.kind === "landmark" || (it.kind === "group" && it.role !== "form field");

/** every section in `root`, in reading order */
export const sectionsOf = (root: NavItem): Section[] => {
  const out: Section[] = [];
  const visit = (it: NavItem, depth: number) => {
    // a group inside a group of the same name ("Visit Us" > "Visit Us") would
    // be the same stop twice; keep the outer one
    const prev = out.at(-1);
    const repeat =
      prev && prev.depth === depth - 1 && sectionName(prev.item) === sectionName(it);
    const here = isSection(it) && !repeat;
    if (here) out.push({ item: it, depth });
    for (const c of it.children) visit(c, here ? depth + 1 : depth);
  };
  visit(root, 0);
  return out;
};

/** a section's name, falling back to its role ("main content", "footer") */
export const sectionName = (it: NavItem) => it.label || it.role;
