// the content script is the script that needs to run in the context of the web
// page we are trying to scrape. it has access to the DOM and can read the HTML
// of the page.
//
// it does nothing until the navigator is opened (Alt+Shift+N, or the popup's
// button). then it parses the page, sends the tree to the service worker
// (which runs the passes with Jev), and shows the result in the navigator.

import type {
  AnalyzeRequest,
  AnalyzeResponse,
  ToggleNavigator,
} from './messages.js';
import { createNavigator } from './navigator.js';
import { parse } from './vdom/parse.js';

/** node id -> live element, so the navigator can find what it's reading */
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

const navigator = createNavigator({ elements, analyze });

window.addEventListener(
  'keydown',
  (e) => {
    // e.code, not e.key: on a Mac, Alt+Shift+N types a character instead
    if (e.altKey && e.shiftKey && e.code === 'KeyN') {
      e.preventDefault();
      e.stopPropagation();
      navigator.toggle();
    }
  },
  true,
);

chrome.runtime.onMessage.addListener((message: ToggleNavigator) => {
  if (message?.type === 'toggle-navigator') navigator.toggle();
});
