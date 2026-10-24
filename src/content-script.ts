// the content script is the script that needs to run in the context of the web
// page we are trying to scrape. it has access to the DOM and can read the HTML
// of the page.

import { parse } from "./vdom/parse.js";

/** node id -> live element, for when we write ARIA back onto the page */
const elements = new Map<number, Element>();

const scrapeAndSendElements = async () => {
  // TODO: walk HTML tree and turn the elements into JSON data.

  return parse(document.documentElement, elements);
};

const run = async () => {
  const result = await scrapeAndSendElements();
  console.log("sending result", { result });
  await chrome.runtime.sendMessage(result);
};

run().then(() => {
  console.log("content script finished running!");
});
