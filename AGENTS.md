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

### Stage 1: Read the DOM into a `RealElement` tree (built)

`src/content-script.ts` runs on every `https://*/*` page and calls
`parse(document.documentElement)` in `src/vdom/parse.ts`. That function walks
the DOM and builds a plain tree of `{ tag, ariaAttributes, text, children }`,
which it sends to the service worker with `chrome.runtime.sendMessage`.

The fuller shape we're aiming for is the `RealElement` interface in
`tests/classify-dom.ts`. It adds a reference to the live element, a parent
link, and `ariaLabel` and `ariaRole` fields.

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

### Stage 3: Build the `VirtualElement` tree (planned)

Combine the Jev answers into a `VirtualElement` tree. It is still a stub in
`tests/classify-dom.ts`, but its doc comment describes the target: a tree of
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
| `src/vdom/parse.ts`     | Turns the DOM into a `RealElement` tree         |
| `src/popup.tsx`         | Popup UI (React + Tailwind)                     |
| `tests/*.ts`            | Scripts that try out Jev, run with `tsx`        |
| `tests/wastedata.html`  | Sample page with poor semantics                 |

- `pnpm dev`: Parcel rebuilds into `dist/` on every change. Load `dist/` as
  an unpacked extension in Chrome.
- `pnpm build`: production build.
- `pnpm tsx tests/hello.ts`: runs a Jev experiment. It needs
  `TYPESAFE_API_KEY` in `.env`.

## Known gaps

- `parse.ts` collects the _values_ of `aria-*` attributes but not their
  names, and `text` is `textContent`, which includes the text of every
  descendant. Both need fixing before the tree is useful as Jev state.
- `background.ts` only logs the incoming message. No Jev calls are wired
  into the extension yet.
- The API key must not be bundled into a shipped extension. That's fine for
  a hackathon demo, but call it out.
