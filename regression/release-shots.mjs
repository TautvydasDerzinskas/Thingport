#!/usr/bin/env node
// Captures the What's new pictures for a release from a running instance with a populated library, cropped to the
// thing each one is about and written as WebP into release-notes/screenshots/, named after the version:
//
//   THINGPORT_PASSWORD='…' npm --prefix regression run release-shots -- --url https://thingport.example \
//     --email me@example.com --profiles-model <id>
//
// Options, also settable as env vars:
//   --url                 THINGPORT_URL              instance to capture (required)
//   --email               THINGPORT_EMAIL            admin account to sign in with (required)
//   --password            THINGPORT_PASSWORD
//   --profiles-model      SCREENSHOT_PROFILES_MODEL  a MakerWorld model with print profiles, read already (open it once
//                                                    first), for the Open adapted shots
//   --host-rules          SCREENSHOT_HOST_RULES      Chromium --host-resolver-rules, for names this machine can't resolve
//   --no-blur                                        leave addresses unblurred, on a demo instance of made-up handles
//   --version             RELEASE_SHOTS_VERSION      names the files, default the version the notes name
//   --theme               RELEASE_SHOTS_THEME        light (the default) or dark
//   --only                RELEASE_SHOTS_ONLY         comma-separated shot names, e.g. open-adapted,storage
//   --out                 RELEASE_SHOTS_OUT          output folder, default release-notes/screenshots
//   --headed                                         show the browser
//
// Shots needing something the instance doesn't have, such as a model with print profiles, are skipped with a line
// saying so, and the rest still run. Nothing in the library is changed: dialogs and menus are only opened, and what a
// shot needs of the account that it may not have -- slicers and printers for Open adapted, achievements while an admin
// has them off -- is answered in the browser. Email addresses are blurred. The account's theme and print profiles
// layout are switched for the run and restored afterwards.
//
// Thingport Grab's own pictures aren't covered: they come from `npm --prefix extension run screenshots`, which loads
// the built extension into a visible browser. Convert the ones you want with `sharp` as this script does.
//
// The file a shot writes is what a release-notes item then names in its `images`, e.g.
//
//   { "src": "screenshots/1.7.0-storage.webp", "caption": "Administration → Storage: what takes the disk, by kind" }
//
// so a shot added here wants an item in release-notes/latest-release-notes.json to put it in, and the other way
// round: an item naming a picture nothing captures leaves a gap in What's new. Earlier releases' shots are in this
// file's git history.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Only the backend has sharp, and one script isn't worth a dependency of its own here.
let sharp;
try {
  sharp = require(path.join(here, "../backend/node_modules/sharp"));
} catch {
  console.error("Needs the backend's sharp: run `npm --prefix backend install` first.");
  process.exit(1);
}

const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
    "profiles-model": { type: "string" },
    "host-rules": { type: "string" },
    "no-blur": { type: "boolean", default: false },
    version: { type: "string" },
    theme: { type: "string" },
    only: { type: "string" },
    out: { type: "string" },
    headed: { type: "boolean", default: false },
  },
});

const list = (value) =>
  (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const baseUrl = (args.url || process.env.THINGPORT_URL || "").replace(/\/+$/, "");
const email = args.email || process.env.THINGPORT_EMAIL;
const password = args.password || process.env.THINGPORT_PASSWORD;
const profilesModel = args["profiles-model"] || process.env.SCREENSHOT_PROFILES_MODEL;
const hostRules = args["host-rules"] || process.env.SCREENSHOT_HOST_RULES;
const theme = args.theme || process.env.RELEASE_SHOTS_THEME || "light";
const only = list(args.only || process.env.RELEASE_SHOTS_ONLY);
const outDir = path.resolve(
  args.out || process.env.RELEASE_SHOTS_OUT || path.join(here, "../release-notes/screenshots"),
);

if (!baseUrl || !email || !password) {
  console.error("Needs --url, --email and THINGPORT_PASSWORD (or --password). See the header of this file.");
  process.exit(1);
}

// Wider than the README's shots: a cut-out of one panel wants room around it, not a phone-shaped column.
const VIEWPORT = { width: 1500, height: 940 };
// What a crop leaves around the thing it is about, so nothing sits hard against the edge.
const PAD = 16;
// Captured at 2x for sharpness, then down to this: What's new shows a dozen of these, and the earlier releases'
// run 30-60 kB apiece rather than the quarter of a megabyte a full-size retina crop costs.
const MAX_WIDTH = 1600;

/** Waits for the page's requests and every visible image, so no shot has half-loaded cards. */
async function settle(page, extraMs = 700) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page
    .waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 15000 })
    .catch(() => console.warn("  some images were still loading"));
  await page.waitForTimeout(extraMs);
}

async function open(page, url) {
  await page.goto(url);
  // It floats over whatever is under it, and lands in a shot that had to scroll to reach its subject.
  await page.addStyleTag({ content: '[aria-label="Back to top"] { visibility: hidden !important; }' });
  await settle(page, 0);
}

/** The box a locator covers, padded and held inside the viewport, for `clip`. */
async function clipOf(page, locator, pad = PAD) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("nothing to crop to");
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    width: Math.min(VIEWPORT.width - x, box.width + pad * 2),
    height: Math.min(VIEWPORT.height - y, box.height + pad * 2),
  };
}

/** The box covering several boxes at once, e.g. a button and the popover it opened. */
function clipAround(boxes, pad = PAD) {
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(VIEWPORT.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(VIEWPORT.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Everything right of the sidebar, top bar included: the page without the navigation it's always shown with. */
async function mainClip(page) {
  const main = await page.locator("main").first().boundingBox();
  if (!main) throw new Error("no main area to crop to");
  return { x: main.x, y: 0, width: VIEWPORT.width - main.x, height: VIEWPORT.height };
}

// No address, the account's own included, should end up in a published screenshot.
async function blurEmails(page) {
  await page.evaluate(() => {
    const email = /[^\s@]+@[^\s@]+\.[^\s@]+/;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (email.test(node.textContent ?? "") && node.parentElement) node.parentElement.style.filter = "blur(5px)";
    }
    for (const input of document.querySelectorAll("input, textarea")) {
      if (email.test(input.value)) input.style.filter = "blur(5px)";
    }
  });
}

/** The nearest card around a locator. */
const cardOf = (locator) => locator.locator("xpath=ancestor::*[contains(@class, 'MuiPaper-root')][1]");

/** The account's slicers and printers answered in the browser, so a Bambu Studio project offers Open adapted:
 *  OrcaSlicer, used last, and PrusaSlicer, with a Bambu Lab P1S and an A1 mini from the printer catalogue. `printerFor`
 *  is OrcaSlicer's printer, the A1 mini, as a project made for the very printer needs no copy for it; without one,
 *  opening a model adapted asks which. */
async function stubAdaptSlicers(page, api, { printerFor = "bambulab-a1mini" } = {}) {
  const catalogue = await api("GET", "/printers/catalogue");
  const brandName = (printer) => catalogue.brands.find((brand) => brand.id === printer.brand)?.name ?? printer.brand;
  const printers = ["bambulab-p1s", "bambulab-a1mini"]
    .map((id) => catalogue.printers.find((printer) => printer.id === id))
    .filter(Boolean)
    .map((printer) => {
      const name = `${brandName(printer)} ${printer.model} 0.4 nozzle`;
      return {
        printer,
        brandName: brandName(printer),
        nozzle: "0.4",
        presets: { orcaslicer: name, bambustudio: name },
      };
    });
  const slicers = {
    slicer: "orcaslicer",
    slicers: ["orcaslicer", "prusaslicer"],
    bridged: [],
    unadapted: [],
    printers: printerFor ? { orcaslicer: printerFor } : {},
  };
  await page.route(/\/api\/settings\/slicer$/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: slicers }) : route.continue(),
  );
  await page.route(/\/api\/me\/printers$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { printers, suggestions: [], accounts: [] } })
      : route.continue(),
  );
}

/** The profiles model's page in the Picker layout, and its side panel: the card with Open in the slicer. */
async function modelPanel(page, api) {
  await api("PATCH", "/settings/print-profiles-view", { view: "picker" });
  await open(page, `/models/${encodeURIComponent(profilesModel)}`);
  const adapted = page.getByRole("group", { name: "Open or download the adapted copy" });
  await adapted.waitFor({ timeout: 20000 });
  await settle(page, 800);
  return { adapted, panel: cardOf(adapted) };
}

// Badges like a well-used library's, the counts close to this one's own: the shot answers them in the browser, as
// achievements are usually off until an admin turns them on.
const earned = (day) => `2026-11-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const BADGES = [
  { id: "imports", tier: 4, earned_at: earned(13), count: 633, next: 1000, seen: true },
  { id: "site:makerworld", tier: 2, earned_at: earned(13), count: 435, next: null, seen: true },
  { id: "downloads", tier: 3, earned_at: earned(14), count: 240, next: 500, seen: true },
  { id: "site:thingiverse", tier: 2, earned_at: earned(13), count: 102, next: null, seen: true },
  { id: "site:printables", tier: 1, earned_at: earned(13), count: 44, next: 100, seen: true },
  { id: "synced", tier: 1, earned_at: earned(13), count: 6, next: 10, seen: true },
  { id: "sync-sources", tier: 0, earned_at: earned(13), count: 3, next: null, seen: true },
  { id: "studio", tier: 0, earned_at: earned(14), count: 3, next: 10, seen: true },
  { id: "tool:keyring-generator", tier: 0, earned_at: earned(14), count: 2, next: 10, seen: true },
  { id: "regular", tier: 0, earned_at: earned(15), count: 24, next: null, seen: true },
  { id: "secret:weather-scene/guest", tier: 0, earned_at: earned(14), count: null, next: null, seen: true },
];

const SHOTS = [
  {
    name: "open-adapted",
    run: async (page, { api }) => {
      if (!profilesModel) return { skip: "needs --profiles-model" };
      await stubAdaptSlicers(page, api);
      const { panel } = await modelPanel(page, api);
      // The side panel from its print profile down to the buttons, big enough to read.
      const box = await panel.boundingBox();
      const from = await panel.getByText("Print profile", { exact: true }).first().boundingBox();
      return { clip: clipAround([{ ...box, y: from.y, height: box.y + box.height - from.y }]) };
    },
  },
  {
    name: "which-printer",
    run: async (page, { api }) => {
      if (!profilesModel) return { skip: "needs --profiles-model" };
      // Two printers and none set for OrcaSlicer: opening the model adapted asks which. The dialog is only opened.
      await stubAdaptSlicers(page, api, { printerFor: null });
      const { adapted } = await modelPanel(page, api);
      await adapted.getByRole("button").first().click();
      const dialog = page.getByRole("dialog", { name: "Which printer is this for?" });
      await dialog.waitFor();
      await settle(page, 500);
      return { clip: await clipOf(page, dialog, 0) };
    },
  },
  {
    name: "printers",
    run: async (page) => {
      // The account's printers and the ones its library suggests, as they are on the instance.
      await open(page, "/?configuration=printers");
      const dialog = page.getByRole("dialog", { name: "Configuration" });
      await dialog.getByRole("button", { name: "Add", exact: true }).waitFor();
      await settle(page, 600);
      // The dialog down to the line under the printers, not the empty rest of it.
      const box = await dialog.boundingBox();
      const last = await dialog.getByText(/^Add the printers you print on/).boundingBox();
      return { clip: clipAround([{ ...box, height: last.y + last.height + PAD - box.y }], 0) };
    },
  },
  {
    name: "storage",
    run: async (page) => {
      await open(page, "/admin-storage");
      const button = page.getByRole("button", { name: "Free up space" }).first();
      await button.waitFor();
      await settle(page, 600);
      return { clip: await clipOf(page, cardOf(button)) };
    },
  },
  {
    name: "free-up-space",
    run: async (page) => {
      await open(page, "/admin-storage");
      await page.getByRole("button", { name: "Free up space" }).first().click();
      // Measured as it opens; only opened, so nothing is removed.
      const dialog = page.getByRole("dialog", { name: "Free up space" });
      await dialog.getByRole("button", { name: "Cancel" }).waitFor();
      await settle(page, 1500);
      return { clip: await clipOf(page, dialog, 0) };
    },
  },
  {
    name: "providers",
    run: async (page) => {
      await open(page, "/admin-providers");
      // Newest first: the two sites this release adds lead the grid.
      await page
        .getByRole("tab", { name: "Newest" })
        .or(page.getByRole("button", { name: "Newest", exact: true }))
        .first()
        .click();
      await settle(page);
      return { clip: await mainClip(page) };
    },
  },
  {
    name: "migrate",
    run: async (page) => {
      await open(page, "/admin-migrate");
      const token = page.getByRole("button", { name: "Create a token" });
      await token.waitFor();
      await settle(page, 400);
      // Both sources and the line for moving away, without the list of migrations under them.
      const boxes = await Promise.all(
        [
          cardOf(page.getByText("From Manyfold", { exact: true })),
          cardOf(page.getByText("From another Thingport instance", { exact: true })),
          cardOf(token),
        ].map((card) => card.boundingBox()),
      );
      return { clip: clipAround(boxes.filter(Boolean)) };
    },
  },
  {
    name: "achievements",
    run: async (page) => {
      await page.route(/\/api\/social$/, async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        await route.fulfill({ response, json: { ...json, achievements: true } });
      });
      await page.route(/\/api\/me\/achievements(\?.*)?$/, (route) =>
        route.fulfill({ json: new URL(route.request().url()).searchParams.has("unseen") ? [] : BADGES }),
      );
      await open(page, "/authors/self");
      const shelf = page.getByRole("region", { name: "Achievements" });
      await shelf.waitFor();
      await shelf.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await settle(page, 800);
      return { clip: await clipOf(page, shelf) };
    },
  },
  {
    name: "languages",
    run: async (page, { displayName }) => {
      await open(page, "/models");
      await page.getByRole("button", { name: displayName }).click();
      await page.getByRole("menuitem", { name: "Configuration" }).click();
      const dialog = page.getByRole("dialog");
      const picker = dialog.getByRole("button", { name: /^Language: / });
      await picker.waitFor();
      const pickerBox = await picker.boundingBox();
      await picker.click();
      const languages = page.getByRole("listbox", { name: "Language" });
      await languages.waitFor();
      // Down to the newest, at the foot of the list.
      await languages.getByRole("option", { name: /简体中文/ }).scrollIntoViewIfNeeded();
      await settle(page, 500);
      const listBox = await cardOf(languages).boundingBox();
      return { clip: clipAround([pickerBox, listBox ?? (await languages.boundingBox())]) };
    },
  },
];

// The notes being written are what the pictures are for, so the version they name is the one to name files after.
const notesFile = path.join(here, "../release-notes/latest-release-notes.json");
const version =
  args.version ||
  process.env.RELEASE_SHOTS_VERSION ||
  (() => {
    try {
      return JSON.parse(fs.readFileSync(notesFile, "utf8")).version;
    } catch {
      return null;
    }
  })();
if (!version) {
  console.error(`Couldn't read a version from ${notesFile}; pass --version.`);
  process.exit(1);
}
const wanted = SHOTS.filter((shot) => !only.length || only.includes(shot.name));
if (only.length && !wanted.length) {
  console.error(`No shot is named ${only.join(", ")}. Shots: ${SHOTS.map((shot) => shot.name).join(", ")}.`);
  process.exit(1);
}

const browser = await chromium.launch({
  headless: !args.headed,
  args: hostRules ? [`--host-resolver-rules=${hostRules}`] : [],
});

// What puts each account's theme back at the end, newest first.
const restores = [];

/** A signed-in browser context of its own, with the run's theme on its account until the end of the run. */
async function signIn(accountEmail, accountPassword) {
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: "en-US",
    // Self-hosted instances often run on a self-signed certificate.
    ignoreHTTPSErrors: true,
  });
  await context.addInitScript(() => {
    localStorage.setItem("thingport_language", "en");
    localStorage.setItem("thingport_sidebar_collapsed", "false");
    // A library that has lost files greets every visit with a dialog, seconds after the page loads, and an open
    // dialog takes everything behind it out of the accessibility tree -- so no shot could find what it came for.
    localStorage.setItem("thingport.missingFiles.dismissedAt", "999999");
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("Email").fill(accountEmail);
  await page.getByLabel(/^Password/).fill(accountPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Not a button on the page: an instance with broken models greets you with a dialog, and a dialog hides
  // everything behind it from role queries. The session landing is what says the sign-in worked.
  await page.waitForFunction(() => !!localStorage.getItem("thingport_auth_token"), null, { timeout: 30000 });
  const token = await page.evaluate(() => localStorage.getItem("thingport_auth_token"));
  if (!token) throw new Error(`Signed in as ${accountEmail}, but couldn't read the session from the page`);

  /** Through the browser context, so a self-signed certificate is accepted the same way. */
  const api = async (method, url, body) => {
    const res = await context.request.fetch(`${baseUrl}/api${url}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      data: body,
    });
    if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
    return res.json();
  };
  const originalTheme = (await api("GET", "/settings/theme")).theme;
  // Before the theme changes, so a failure right after it still puts it back.
  restores.unshift(() =>
    api("PATCH", "/settings/theme", { theme: originalTheme }).catch((err) =>
      console.error(`Couldn't restore ${accountEmail}'s theme (${originalTheme}): ${err.message}`),
    ),
  );
  await api("PATCH", "/settings/theme", { theme });
  await page.emulateMedia({ colorScheme: theme });
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem("thingport_auth_user"))) || "{}");
  const displayName = user.display_name || user.displayName;
  // Shots open the user menu by it, and an empty name would match every button.
  if (!displayName) throw new Error(`Signed in as ${accountEmail}, but couldn't read its display name from the page`);
  return { page, api, displayName };
}

let originalProfilesView;
let admin;
try {
  admin = await signIn(email, password);
  originalProfilesView = await admin.api("GET", "/settings/print-profiles-view").then(
    (settings) => settings.view,
    () => undefined,
  );
  fs.mkdirSync(outDir, { recursive: true });

  for (const shot of wanted) {
    process.stdout.write(`${shot.name}... `);
    try {
      await admin.page.setViewportSize(VIEWPORT);
      const result = await shot.run(admin.page, { api: admin.api, displayName: admin.displayName });
      if (result?.skip) {
        console.log(`skipped, ${result.skip}`);
        continue;
      }
      const page = result?.page ?? admin.page;
      // Off the page, so no tooltip shows up under the pointer.
      const size = page.viewportSize() ?? VIEWPORT;
      await page.mouse.move(size.width - 1, size.height - 1);
      await settle(page, 300);
      if (!args["no-blur"]) await blurEmails(page);
      const png = await page.screenshot(result?.clip ? { clip: result.clip } : {});
      const file = path.join(outDir, `${version}-${shot.name}.webp`);
      await sharp(png).resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 85 }).toFile(file);
      console.log(`${(fs.statSync(file).size / 1024).toFixed(0)} kB`);
    } catch (err) {
      console.log(`failed: ${err.message}`);
    } finally {
      // Twice: a dialog can open over another one.
      await admin.page.keyboard.press("Escape").catch(() => undefined);
      await admin.page.keyboard.press("Escape").catch(() => undefined);
      await admin.page.unrouteAll({ behavior: "ignoreErrors" });
    }
  }
  console.log(`Saved to ${outDir}`);
} finally {
  if (admin && originalProfilesView !== undefined) {
    await admin
      .api("PATCH", "/settings/print-profiles-view", { view: originalProfilesView })
      .catch((err) =>
        console.error(`Couldn't restore the print profiles layout (${originalProfilesView}): ${err.message}`),
      );
  }
  for (const restore of restores) await restore();
  await browser.close();
}
