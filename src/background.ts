// this is the service worker.
//
// you can only make HTTP requests from here!!! the content script sends us the
// parsed page, we run every pass (with Jev) and send back the grouped tree for
// section mode.
//
// NOTE: Parcel inlines TYPESAFE_API_KEY from .env into this bundle. fine for a
// hackathon demo, but anyone with the extension can read the key; a shipped
// extension needs a server in between.

import { TypeSafeClient } from '@typesafe-ai/sdk';
import type { AnalyzeRequest, AnalyzeResponse } from './messages.js';
import { runPipeline } from './vdom/pipeline.js';

const client = new TypeSafeClient({
  apiKey: process.env.TYPESAFE_API_KEY ?? '',
  defaultModel: 'jev-latest',
});

const analyze = async (req: AnalyzeRequest): Promise<AnalyzeResponse> => {
  try {
    const { grouping, stages } = await runPipeline(req.tree, client);
    console.table(stages);
    return {
      ok: true,
      tree: grouping.tree,
      stats: {
        jevCalls: stages.reduce((n, s) => n + s.jevCalls, 0),
        ms: stages.reduce((n, s) => n + s.ms, 0),
      },
    };
  } catch (e) {
    console.error('pipeline failed', e);
    return { ok: false, error: String(e) };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'analyze') return;
  console.log('analyzing', sender.tab?.url);
  analyze(message as AnalyzeRequest).then(sendResponse);
  // keep the channel open: the answer comes back asynchronously
  return true;
});
