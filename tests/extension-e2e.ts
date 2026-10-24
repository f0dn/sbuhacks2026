// loads the built extension (dist/, from `pnpm build`) into Chromium, opens a
// real page, opens the navigator with Alt+Shift+N, and drives it with keys,
// printing what it says after each one. saves screenshots to test-results/.
//
// usage: pnpm build && pnpm tsx tests/extension-e2e.ts [url]
// (needs Playwright's Chromium: `npx playwright install chromium`)

import { chromium, type Page } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const URL = process.argv[2] ?? "https://wastedata.info/";
const DIST = resolve("dist");
const SHOTS = "test-results";
const TIMEOUT_MS = 60_000;

const profile = mkdtempSync(join(tmpdir(), "esr-e2e-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.CHROME_CHANNEL ?? "chromium",
  headless: true,
  viewport: { width: 1400, height: 900 },
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    // branded Chrome ignores --load-extension unless this is turned off
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
  ],
});

const worker =
  context.serviceWorkers()[0] ??
  (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
console.log("extension loaded:", worker.url());

const page = await context.newPage();
const said: string[] = [];
let ready: () => void;
const isReady = new Promise<void>((r) => (ready = r));
page.on("console", (m) => {
  const text = m.text();
  if (text.startsWith("[esr] say:")) said.push(text.slice("[esr] say: ".length));
  else if (text.startsWith("[esr]")) console.log(text);
  if (text.startsWith("[esr] navigator ready")) ready();
  if (text.startsWith("[esr] analysis failed")) ready();
});

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);
await page.keyboard.press("Alt+Shift+N");
await Promise.race([
  isReady,
  page.waitForTimeout(TIMEOUT_MS).then(() => {
    throw new Error("navigator never became ready");
  }),
]);
console.log(`opened: "${said.at(-1)}"`);

const outline = await page
  .locator("esr-navigator li")
  .evaluateAll((lis) =>
    lis.map((li) => `${" ".repeat((parseInt((li as HTMLElement).style.paddingLeft) - 14) / 7)}${li.textContent}`),
  );
console.log(`\noutline (${outline.length} rows):\n${outline.join("\n")}`);

mkdirSync(SHOTS, { recursive: true });
const shot = (name: string) => page.screenshot({ path: `${SHOTS}/navigator-${name}.png` });

/** press `key`, then print what the navigator said */
const press = async (p: Page, key: string) => {
  const before = said.length;
  await p.keyboard.press(key);
  await p.waitForTimeout(450);
  console.log(`  ${key.padEnd(12)} -> ${said.slice(before).join(" | ") || "(nothing)"}`);
};

console.log("\nkeys:");
for (const key of ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowDown", "ArrowLeft"])
  await press(page, key);
await press(page, "d");
await press(page, "d");
await press(page, "g");
await shot("group");
await press(page, "g");
await press(page, "ArrowRight");
await press(page, "h");
await press(page, "h");
await press(page, "Shift+H");
await press(page, "f");
await shot("field");
await press(page, "k");
await press(page, "1");

// the page itself must be untouched: no attributes we added, nothing hidden
const touched = await page.$$eval(
  "[data-esr], [id^='esr-']",
  (els) => els.length,
);
console.log(`\npage elements with our attributes: ${touched}`);

await press(page, "Escape");
console.log(
  `navigator open after Escape: ${await page.locator("esr-navigator").isVisible()}`,
);

await context.close();
rmSync(profile, { recursive: true, force: true });
console.log(`screenshots in ${SHOTS}/`);
