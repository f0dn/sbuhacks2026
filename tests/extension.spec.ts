import { test, chromium, type BrowserContext } from "@playwright/test";

test("Load extension and test popup", async () => {
  const pathToExtension = "dist";

  // Extensions require a persistent context and the Chromium channel
  const context = await chromium.launchPersistentContext("", {
    headless: false, // Extension testing traditionally requires headed mode
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });

  // 1. Get the background service worker to extract the Extension ID
  const [background] = context.serviceWorkers();
  if (!background) {
    await context.waitForEvent("serviceworker");
  }

  const extensionId = background.url().split("/")[2];

  // 2. Open and test your extension's popup page
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // Run your assertions here
  await context.close();
});
