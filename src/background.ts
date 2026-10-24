// this is the service worker.
//
// you can only make HTTP requests from here!!!

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("got message", { sender, message });
});
