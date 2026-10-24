// renders a DOM json (from any pass: parsed, filtered, enriched) into a single
// html file with a collapsible tree, so you can look through it in a browser.
//
// usage: pnpm tsx tests/render-dom.ts [input.json] [output.html]
// output defaults to the input path with .html instead of .json

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { countNodes, walkTree, type DomNode } from "../src/vdom/types.js";

const INPUT = process.argv[2] ?? "tests/example-filtered-dom.json";
const OUTPUT = process.argv[3] ?? INPUT.replace(/\.json$/, "") + ".html";
/** nodes shallower than this start expanded */
const OPEN_DEPTH = 4;

/** the fields every `DomNode` has; anything else was added by a pass */
const BASE_KEYS = new Set(["id", "tag", "aria", "text", "children"]);

type AnyNode = DomNode<Record<string, unknown>>;

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmt = (v: unknown) =>
  typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);

// ---------------------------------------------------------------------------
// one node
// ---------------------------------------------------------------------------

/** pass data (status, jev, semantics, ...) flattened to `jev.region`-style keys */
const passFields = (n: AnyNode): [string, string][] =>
  Object.entries(n)
    .filter(([k]) => !BASE_KEYS.has(k))
    .flatMap(([k, v]): [string, string][] =>
      v && typeof v === "object"
        ? Object.entries(v).map(([fk, fv]) => [`${k}.${fk}`, fmt(fv)])
        : [[k, fmt(v)]],
    );

/**
 * the right-hand column. every field is in the html, but css only shows the
 * one picked in the toolbar; hovering shows them all.
 */
const meta = (n: AnyNode) => {
  const fields = passFields(n);
  if (fields.length === 0) return "";
  const title = fields.map(([k, v]) => `${k}: ${v}`).join("\n");
  const spans = fields
    .map(([k, v]) => `<span data-k="${esc(k)}">${esc(v)}</span>`)
    .join("");
  return `<span class="meta" title="${esc(title)}">${spans}</span>`;
};

const label = (n: AnyNode) => {
  const aria = Object.entries(n.aria)
    .map(([k, v]) => `<span class="aria">${esc(k)}=${esc(v)}</span>`)
    .join("");
  const text = n.text ? `<span class="text">"${esc(n.text)}"</span>` : "";
  const kids = n.children.length
    ? `<span class="count">${countNodes(n) - 1}</span>`
    : "";
  return `<span class="main"><span class="tag">&lt;${esc(n.tag.toLowerCase())}&gt;</span><span class="id">#${n.id}</span>${aria}${text}${kids}</span>${meta(n)}`;
};

const render = (n: AnyNode, depth = 0): string => {
  const cls = typeof n.status === "string" ? ` class="${esc(n.status)}"` : "";
  if (n.children.length === 0) return `<li${cls}><div class="row leaf">${label(n)}</div></li>`;
  const open = depth < OPEN_DEPTH && n.status !== "pruned" ? " open" : "";
  return `<li${cls}><details${open}><summary class="row">${label(n)}</summary><ul>${n.children
    .map((c) => render(c, depth + 1))
    .join("")}</ul></details></li>`;
};

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const root: AnyNode = JSON.parse(readFileSync(INPUT, "utf8"));

const statuses: Record<string, number> = {};
const fieldKeys = new Set<string>();
walkTree(root, (n) => {
  if (typeof n.status === "string") statuses[n.status] = (statuses[n.status] ?? 0) + 1;
  for (const [k] of passFields(n)) fieldKeys.add(k);
});
const firstField = fieldKeys.has("jev.region") ? "jev.region" : [...fieldKeys][0];
const fieldPicker = fieldKeys.size
  ? `<label>show <select id="field">${[...fieldKeys]
      .map((k) => `<option${k === firstField ? " selected" : ""}>${esc(k)}</option>`)
      .join("")}</select></label>`
  : "";
const summary = [
  `${countNodes(root)} nodes`,
  ...Object.entries(statuses).map(([s, c]) => `${c} ${s}`),
].join(" · ");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(basename(INPUT))}</title>
<style id="field-style">.meta > [data-k="${esc(firstField ?? "")}"] { display: inline; }</style>
<style>
  :root {
    --bg: #fff; --fg: #1f2328; --muted: #6e7781; --line: #d0d7de; --hover: #f6f8fa;
    --tag: #0550ae; --aria: #8250df; --text: #116329; --mark: #fff8c5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --hover: #161b22;
      --tag: #79c0ff; --aria: #d2a8ff; --text: #7ee787; --mark: #4d3d00;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
         font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  header { position: sticky; top: 0; z-index: 1; background: var(--bg);
           border-bottom: 1px solid var(--line); padding: 10px 16px;
           display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  h1 { font-size: 14px; margin: 0 12px 0 0; }
  .summary { color: var(--muted); margin-right: auto; }
  input, button, select { font: inherit; color: inherit; background: var(--hover);
                  border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; }
  input { width: 220px; }
  label { color: var(--muted); }
  main { padding: 8px 16px 40px; }
  ul { list-style: none; margin: 0; padding-left: 18px; border-left: 1px dotted var(--line); }
  main > ul { padding-left: 0; border: 0; }
  summary { cursor: pointer; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: "▸"; width: 14px; flex: none; color: var(--muted); }
  details[open] > summary::before { content: "▾"; }
  .row { display: flex; align-items: baseline; gap: 12px;
         padding: 1px 4px; border-radius: 4px; }
  .row:hover { background: var(--hover); }
  .leaf { padding-left: 18px; }
  .main { flex: 1; min-width: 0; }
  .main > span { margin-right: 6px; }
  .meta { flex: none; min-width: 120px; text-align: right; color: var(--muted);
          font-size: 12px; font-variant-numeric: tabular-nums; cursor: help; }
  .meta > span { display: none; }
  .tag { color: var(--tag); font-weight: 600; margin-right: 2px !important; }
  .id { color: var(--muted); font-size: 11px; }
  .aria { color: var(--aria); }
  .text { color: var(--text); }
  .count { color: var(--muted); font-size: 11px; }
  .count::before { content: "+"; }
  li.pruned > * > .row, li.pruned > .row { opacity: .55; }
  body.hide-pruned li.pruned { display: none; }
  .match > .row, .match > details > .row { background: var(--mark); }
  li.nomatch { display: none; }
</style>
</head>
<body>
<header>
  <h1>${esc(basename(INPUT))}</h1>
  <span class="summary">${esc(summary)}</span>
  <input id="q" type="search" placeholder="filter by tag, text, aria…">
  ${fieldPicker}
  ${statuses.pruned ? `<label><input id="hp" type="checkbox"> hide pruned</label>` : ""}
  <button id="open">expand all</button>
  <button id="close">collapse all</button>
</header>
<main><ul>${render(root)}</ul></main>
<script>
  const all = (s) => [...document.querySelectorAll(s)];
  document.getElementById("open").onclick = () => all("details").forEach((d) => (d.open = true));
  document.getElementById("close").onclick = () => all("details").forEach((d) => (d.open = false));
  const field = document.getElementById("field");
  if (field)
    field.onchange = () =>
      (document.getElementById("field-style").textContent =
        '.meta > [data-k="' + CSS.escape(field.value) + '"] { display: inline; }');
  const hp = document.getElementById("hp");
  if (hp) hp.onchange = () => document.body.classList.toggle("hide-pruned", hp.checked);

  // show matching nodes and their ancestors; hide everything else
  const filter = (q) => {
    q = q.trim().toLowerCase();
    all("li").forEach((li) => li.classList.remove("match", "nomatch"));
    if (!q) return;
    const visit = (li) => {
      const row = li.querySelector(":scope > .row, :scope > details > .row");
      const self = row.textContent.toLowerCase().includes(q);
      let any = false;
      for (const c of li.querySelectorAll(":scope > details > ul > li")) any = visit(c) || any;
      if (self) li.classList.add("match");
      if (any) li.querySelector(":scope > details").open = true;
      if (!self && !any) li.classList.add("nomatch");
      return self || any;
    };
    all("main > ul > li").forEach(visit);
  };
  let t;
  document.getElementById("q").oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(() => filter(e.target.value), 150);
  };
</script>
</body>
</html>
`;

writeFileSync(OUTPUT, page);
console.log(`wrote ${OUTPUT} (${summary})`);
