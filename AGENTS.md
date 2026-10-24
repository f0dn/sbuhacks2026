# AGENTS.md - EnhanceScreenReader Extension

A Chrome extension (Manifest V3) that uses TypeSafe AI's **Jev** model to
work out what each part of a web page is and what it does, so screen readers
can describe the page better. Built for SBU Hacks 2026.

## 1. What Jev is

Jev is TypeSafe AI's first "System One" model. It makes decisions that
software can use directly; it doesn't write text for people to read. You give
it a **state** (any text or JSON, here a piece of HTML) and a set of **typed
questions**, and it returns typed answers with probabilities. There is no
prompt and no output to parse.

- SDK: `@typesafe-ai/sdk` (`TypeSafeClient`). It reads the API key from
  `TYPESAFE_API_KEY` (loaded from `.env` through `dotenv`).
- Entry point: `client.systemOne({ state, questions, model? })`.
- Question types:
  - `choice(instructions, { key: description | null, ... })` picks one option.
    It returns `.choice`, `.probabilities` and `.confidence`.
  - `score(instructions, [lowest, ..., highest])` rates on an ordered scale.
    It returns `.score`, `.probabilities` and `.confidence`.
  - `noul(statement)` returns `.noul`, a number from 0 to 1 for how likely the
    statement is to be true.
  - `box(instructions)` finds a region in an image. It is experimental, needs
    `model: "jev-preview"`, and needs the
    `TypeSafe-Danger-Zone-Images: true` header.
- Models: `jev-latest` (the default) and `jev-preview`.
- All questions are evaluated in parallel against the same state, so adding
  questions to a call costs little extra time. TypeSafe says a call takes
  70–500ms.
- Keep each question narrow. For a judgment that depends on several factors,
  ask about each factor separately and combine the answers in code.

See `tests/route_ticket.ts` for a minimal example and `tests/hello.ts` for an
example that classifies a page element.

## 2. The problem

Screen readers build their picture of a page from the **accessibility tree**,
which comes from semantic HTML (`<h1>`, `<nav>`, `<label for>`, `<button>`)
and ARIA attributes (`role`, `aria-label`, `aria-labelledby`, `aria-hidden`).
Many real pages give them little to work with:

- Headings are styled `<div>`s and `<span>`s, for example
  `<span class="kt-typed-text">` inside a `<strong>` (see
  `tests/wastedata.html`).
- Inputs have a nearby text `<span>` that looks like a label but isn't
  connected to the input.
- Clickable `<div>`s are never announced as buttons.
- Decorative elements (blinking cursors, dividers, layout wrappers) and
  duplicated text get read aloud, while the important content gets no more
  weight than anything else.

A sighted user picks all of this up from the visual layout. A screen reader
user hears a flat list of generic elements. **The goal is to use Jev to infer
the semantics the author left out (role, label relationships, importance,
decorative or not) and give them to the screen reader.**

## 3. Methodology

The pipeline runs in four stages. Stages 1–2 are partly built; stages 3–4 are
planned.

### The shared tree: `src/vdom/types.ts`

Every stage works on the same tree type, `DomNode<Data>`:
`{ id, tag, aria, text, children }` plus whatever the earlier passes attached
through `Data`. `aria` maps attribute names (`aria-*` and `role`) to values,
and `text` is the element's own text, not its descendants'. Each pass adds
its data by intersection, e.g. `FilteredNode = DomNode<FilterData>` and
`EnrichedNode = DomNode<FilterData & { semantics?: Semantics }>`.

Nodes have no parent pointer and no live-element reference, so the tree can
go through `JSON.stringify` and `chrome.runtime.sendMessage`. Use `id` to get
back to the live element (see Stage 1) and `parentsOf(root)` when a pass
needs ancestors. Shared helpers (`mapTree`, `countNodes`, `findTag`,
`parentsOf`) live in the same file. Add new per-pass data there; don't define
a new tree type.

### Stage 1: Read the DOM into a `ParsedNode` tree (built)

`src/content-script.ts` runs on every `https://*/*` page and calls
`parse(document.documentElement, elements)` in `src/vdom/parse.ts`. That
function walks the DOM, builds a `ParsedNode` tree, and records every element
in `elements` (a `Map<id, Element>` the content script keeps for Stage 4).
The tree goes to the service worker with `chrome.runtime.sendMessage`.

### Stage 2: Classify elements with Jev (prototyped in `tests/hello.ts`)

The service worker (`src/background.ts`) makes the network calls, because
that's where the project puts HTTP requests. For each element we want to
classify, it sends Jev one `systemOne` call:

- **state**: the surrounding HTML for context, plus the element itself marked
  as "Element of interest".
- **questions**, for example:
  - `choice`: what kind of element is it? (paragraph, heading, list, link,
    image, button, container, ...)
  - `score`: how important is it to the page's content?
  - `noul`: is it decorative or a duplicate?
  - `noul`: does this text label the nearby input?

Ask several narrow questions in one call; don't write one broad question.
Use `.probabilities` and `.confidence` to decide whether to act on an answer.
If Jev isn't confident, leave the page as the author wrote it.

### Stage 3: Build the `EnrichedNode` tree (planned)

Combine the Jev answers into `Semantics` on an `EnrichedNode` tree. The doc
comment on `Semantics` in `src/vdom/types.ts` describes the target: a tree of
proper semantics (`<h1>`, `<label for>`, `<button type="submit">`, main
content) that can answer questions like "what is the label for this input?".

### Stage 4: Give the semantics to the screen reader (planned)

Send the virtual tree back to the content script, which adds ARIA to the live
page: `role`, `aria-level`, `aria-labelledby` and `aria-label`, plus
`aria-hidden` on decorative or duplicate elements. Screen readers then pick up
the changes with no extra steps from the user. The popup (`src/popup.tsx`,
still a placeholder) could show a summary or offer navigation.

Rules for this stage:

- **Add attributes; don't override the author.** Leave correct existing
  semantics alone, and only fill in what's missing.
- Keep page content and layout exactly as they are; change only the
  accessibility tree.

## Project layout and commands

| Path                    | Purpose                                         |
| ----------------------- | ----------------------------------------------- |
| `src/manifest.json`     | Extension manifest; also the Parcel entry point |
| `src/content-script.ts` | Runs in the page, reads the DOM, sends the tree |
| `src/background.ts`     | Service worker; this is where Jev is called     |
| `src/vdom/types.ts`     | The `DomNode` tree type shared by every stage   |
| `src/vdom/parse.ts`     | Turns the DOM into a `ParsedNode` tree          |
| `src/popup.tsx`         | Popup UI (React + Tailwind)                     |
| `tests/*.ts`            | Scripts that try out Jev, run with `tsx`        |
| `tests/wastedata.html`  | Sample page with poor semantics                 |

- `pnpm dev`: Parcel rebuilds into `dist/` on every change. Load `dist/` as
  an unpacked extension in Chrome.
- `pnpm build`: production build.
- `pnpm tsx tests/hello.ts`: runs a Jev experiment. It needs
  `TYPESAFE_API_KEY` in `.env`.

## Known gaps

- `tests/example-real-dom.json` was converted from the old parse format, so
  its `aria` objects are empty and its `text` was recovered approximately.
  Re-capture it from Chrome for exact data.
- `background.ts` only logs the incoming message. No Jev calls are wired
  into the extension yet.
- The API key must not be bundled into a shipped extension. That's fine for
  a hackathon demo, but call it out.
