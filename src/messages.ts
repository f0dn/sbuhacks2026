// messages between the content script, the service worker and the popup.

import type { GroupedNode, ParsedNode } from './vdom/types.js';

/** content script -> service worker: run the passes on this page */
export type AnalyzeRequest = { type: 'analyze'; tree: ParsedNode };

/** service worker -> content script */
export type AnalyzeResponse =
  | { ok: true; tree: GroupedNode; stats: { jevCalls: number; ms: number } }
  | { ok: false; error: string };

/** popup -> content script: turn section mode on or off */
export type ToggleSections = { type: 'toggle-sections' };
