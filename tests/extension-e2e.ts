// loads the built extension (dist/, from `pnpm build`) into Chromium, opens a
// real page and jumps through its sections with Alt+Shift+Down, printing for
// each what is read out loud, the element that receives focus (read by a
// screen reader itself) and what the live region announces. saves a
// screenshot to test-results/.
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
const announced: string[] = [];
const spoken: string[] = [];
let ready: () => void;
const isReady = new Promise<void>((r) => (ready = r));
page.on("console", (m) => {
  const text = m.text();
  if (text.startsWith("[esr] announce:")) announced.push(text.slice("[esr] announce: ".length));
  if (text.startsWith("[esr] speak:")) spoken.push(text.slice("[esr] speak: ".length));
  if (text.startsWith("[esr] sections ready") || text.startsWith("[esr] analysis failed")) {
    console.log(text);
    ready();
  }
});

/** the focused element, roughly as a screen reader would read it */
const focused = (p: Page) =>
  p.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "(nothing)";
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return `<${el.tagName.toLowerCase()}> "${text.slice(0, 70)}${text.length > 70 ? "…" : ""}"`;
  });

/** press `key`, then print what got focus and what was announced */
const press = async (key: string) => {
  const before = announced.length;
  const spokenBefore = spoken.length;
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
  await page.waitForTimeout(500); // the retry for content that scrolls in
  const said = announced.slice(before).filter((a) => a !== "Finding sections");
  const out = spoken.slice(spokenBefore).join(" / ") || "-";
  console.log(`  ${key.padEnd(16)} speaks "${out}"  |  focus ${await focused(page)}  |  live: ${said.join(" / ") || "-"}`);
};

/** elements with tabindex=-1, or any attribute of ours */
const marked = (p: Page) =>
  p.$$eval("[data-esr], [id^='esr-'], [tabindex='-1']", (els) =>
    els.map((el) => `<${el.tagName.toLowerCase()}> ${(el.textContent ?? "").trim().slice(0, 30)}`),
  );

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(500);
const markedBefore = await marked(page);

// the first Alt+Shift+Down analyzes the page, then goes to the first section
await page.keyboard.press("Alt+Shift+ArrowDown");
await Promise.race([
  isReady,
  page.waitForTimeout(TIMEOUT_MS).then(() => {
    throw new Error("sections never became ready");
  }),
]);
await page.waitForTimeout(300);
console.log(`\n  ${"Alt+Shift+Down".padEnd(16)} speaks "${spoken.at(-1)}"  |  focus ${await focused(page)}  |  live: ${announced.at(-1)}`);

for (let i = 0; i < 40; i++) {
  const before = announced.length;
  await press("Alt+Shift+ArrowDown");
  if (announced.slice(before).includes("last section")) break;
  if (i === 6) {
    await page.waitForTimeout(800); // let smooth scrolling finish
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/sections-card.png` });
  }
}
await press("Alt+Shift+ArrowUp");

// section mode: plain arrows work too, Escape leaves it with focus kept
console.log("\nsection mode (plain keys):");
await press("Home");
await press("ArrowDown");
await press("Escape");
await press("ArrowDown"); // section mode is off: the page gets this key again

// nothing we did may stay on the page: our temporary tabindex goes on blur
await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const markedAfter = await marked(page);
const added = markedAfter.filter((m) => !markedBefore.includes(m));
console.log(
  `\ntabindex=-1 before: ${markedBefore.length}, after: ${markedAfter.length}; left behind by us: ${added.length}`,
  added,
);

await context.close();
rmSync(profile, { recursive: true, force: true });
console.log(`screenshot in ${SHOTS}/`);
