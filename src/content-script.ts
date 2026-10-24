// the content script is the script that needs to run in the context of the web
// page we are trying to scrape. it has access to the DOM and can read the HTML
// of the page.
//
// it does nothing until section mode is used (Alt+Shift+N, Alt+Shift+Down/Up,
// or the popup's button). then it parses the page, sends the tree to the service
// worker (which runs the passes with Jev), and lets you move between the
// sections it found.

import type {
  AnalyzeRequest,
  AnalyzeResponse,
  ToggleSections,
} from './messages.js';
import { createSectionNav } from './section-nav.js';
import { parse } from './vdom/parse.js';

/** node id -> live element, so section mode can find what it highlights */
const elements = new Map<number, Element>();

const analyze = async () => {
  elements.clear();
  const tree = parse(document.documentElement, elements);
  console.log('[esr] sending page', { nodes: elements.size });

  const request: AnalyzeRequest = { type: 'analyze', tree };
  const response: AnalyzeResponse = await chrome.runtime.sendMessage(request);
  if (!response?.ok) throw new Error(response?.error ?? 'no response');
  return { tree: response.tree, ...response.stats };
};

const sections = createSectionNav({ elements, analyze });

window.addEventListener(
  'keydown',
  (e) => {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    // e.code, not e.key: on a Mac, Alt+Shift+N types a character instead
    const action =
      e.code === 'KeyN'
        ? sections.toggle
        : e.code === 'ArrowDown'
          ? sections.next
          : e.code === 'ArrowUp'
            ? sections.previous
            : undefined;
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    void action();
  },
  true,
);

chrome.runtime.onMessage.addListener((message: ToggleSections) => {
  if (message?.type === 'toggle-sections') void sections.toggle();
});
