#!/usr/bin/env node
// Captures the What's new pictures for a release from a running instance with a populated library, cropped to the
// thing each one is about and written as WebP into release-notes/screenshots/, named after the version:
//
//   THINGPORT_PASSWORD='…' npm --prefix regression run release-shots -- --url https://thingport.example \
//     --email me@example.com --model <id> --studio-design <id>
//
// Options, also settable as env vars:
//   --url                 THINGPORT_URL              instance to capture (required)
//   --email               THINGPORT_EMAIL            admin account to sign in with (required)
//   --password            THINGPORT_PASSWORD
//   --model               SCREENSHOT_MODEL           a model with a few pictures, for its menu, Edit model's thumbnail
//                                                    and its supporting files (made up in the browser)
//   --studio-design       SCREENSHOT_STUDIO_DESIGN   a Studio design opened from a 3MF, its plates in colour and a print
//                                                    profile set, for the Studio shots
//   --host-rules          SCREENSHOT_HOST_RULES      Chromium --host-resolver-rules, for names this machine can't resolve
//   --no-blur                                        leave addresses unblurred, on a demo instance of made-up handles
//   --version             RELEASE_SHOTS_VERSION      names the files, default the version the notes name
//   --theme               RELEASE_SHOTS_THEME        light (the default) or dark
//   --only                RELEASE_SHOTS_ONLY         comma-separated shot names, e.g. open-adapted,storage
//   --out                 RELEASE_SHOTS_OUT          output folder, default release-notes/screenshots
//   --headed                                         show the browser
//
// Shots needing something the instance doesn't have, such as a Studio design, are skipped with a line saying so, and
// the rest still run. Nothing in the library is changed: dialogs and menus are only opened, and what a shot needs of
// the account that it may not have -- a model's README, parts list and assembly guide, Send to places -- is answered
// in the browser. A tool's pictures are its own screenshots, converted. Email addresses are blurred. The account's
// theme and print profiles layout are switched for the run and restored afterwards.
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
import { stubSendTargets, stubSupportingFiles } from "./shot-stubs.mjs";

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
    model: { type: "string" },
    "studio-design": { type: "string" },
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
const model = args.model || process.env.SCREENSHOT_MODEL;
const studioDesign = args["studio-design"] || process.env.SCREENSHOT_STUDIO_DESIGN;
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

/** A design opened in Studio, its bodies built: a 3MF's meshes are made in a worker once the design arrives. */
async function openDesign(page) {
  await open(page, `/studio?design=${encodeURIComponent(studioDesign)}`);
  await page.getByRole("button", { name: "Edit design" }).waitFor({ timeout: 60000 });
  await page.locator("canvas").first().waitFor();
  await page.waitForTimeout(10000);
}

/** The camera on the plate, then a little closer, so the bodies fill the view rather than the bed's grid. */
async function frameDesign(page) {
  const home = page.getByRole("button", { name: "Home view" });
  if (await home.isVisible().catch(() => false)) await home.click();
  await page.waitForTimeout(1200);
  const canvas = await page.locator("canvas").first().boundingBox();
  if (!canvas) return;
  await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.55);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
}

/** The model's page with its ⋯ menu open: in the page's header it lays its actions out as tiles. */
async function openModelMenu(page) {
  await open(page, `/models/${encodeURIComponent(model)}`);
  await page.getByRole("button", { name: "More actions" }).first().click();
  const download = page.getByRole("menuitem", { name: "Download" }).first();
  await download.waitFor();
  await settle(page, 500);
  return download;
}

const SHOTS = [
  {
    name: "studio-3mf",
    run: async (page) => {
      if (!studioDesign) return { skip: "no --studio-design" };
      await openDesign(page);
      await frameDesign(page);
      return { clip: await mainClip(page) };
    },
  },
  {
    name: "studio-print-profile",
    run: async (page) => {
      if (!studioDesign) return { skip: "no --studio-design" };
      await openDesign(page);
      await page.getByRole("button", { name: "Edit design" }).click();
      const tab = page.getByRole("tab", { name: "Print" });
      await tab.click();
      await page.getByRole("button", { name: "Suggest with AI" }).waitFor();
      await frameDesign(page);
      // The panel, and enough of the view beside it to see what the profile is for: below the toolbar, above the
      // status bar.
      const tabBox = await tab.boundingBox();
      const x = Math.max(0, tabBox.x - 520);
      const y = tabBox.y - 12;
      return { clip: { x, y, width: VIEWPORT.width - x, height: VIEWPORT.height - 64 - y } };
    },
  },
  {
    name: "studio-save",
    run: async (page) => {
      if (!studioDesign) return { skip: "no --studio-design" };
      await openDesign(page);
      await page.getByRole("button", { name: "Save" }).click();
      await page.getByRole("menuitem", { name: "Save to Thingport" }).click();
      const dialog = page.getByRole("dialog", { name: "Save to Thingport" });
      await dialog.getByRole("button", { name: "Add to a model" }).waitFor();
      await settle(page, 500);
      return { clip: await clipOf(page, dialog) };
    },
  },
  { name: "print-queue", from: "tools/print-queue/screenshots/board.webp" },
  { name: "filament-shelf", from: "tools/filament-shelf/screenshots/shelf.webp" },
  { name: "notes", from: "tools/notes/screenshots/notes.webp" },
  { name: "wiki", from: "tools/3d-printing-wiki/screenshots/search-light.webp" },
  {
    name: "send-to",
    run: async (page) => {
      await stubSendTargets(page);
      await open(page, "/models?configuration=sendTo");
      const dialog = page.getByRole("dialog", { name: "Configuration" });
      await dialog.getByText("Workshop OctoPrint").waitFor();
      await settle(page, 500);
      return { clip: await clipOf(page, dialog) };
    },
  },
  {
    name: "supporting-files",
    run: async (page) => {
      if (!model) return { skip: "no --model" };
      await stubSupportingFiles(page, model);
      await open(page, `/models/${encodeURIComponent(model)}?file=shotreadme`);
      const dialog = page.getByRole("dialog");
      await dialog.getByText("What you need").waitFor({ timeout: 20000 });
      await settle(page, 500);
      return { clip: await clipOf(page, dialog) };
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
      // From the top: German, the newest, sorts second, just under English.
      await languages.getByRole("option", { name: /Deutsch/ }).waitFor();
      await languages.evaluate((list) => (list.scrollTop = 0));
      await settle(page, 500);
      const listBox = await cardOf(languages).boundingBox();
      return { clip: clipAround([pickerBox, listBox ?? (await languages.boundingBox())]) };
    },
  },
  {
    name: "thumbnail",
    run: async (page) => {
      if (!model) return { skip: "no --model" };
      await openModelMenu(page);
      await page.getByRole("menuitem", { name: "Edit" }).click();
      const dialog = page.getByRole("dialog", { name: "Edit model" });
      const use = dialog.getByRole("button", { name: "Use as thumbnail" });
      await use.first().waitFor();
      await settle(page, 500);
      // Pointing at the second picture shows its button and the tooltip saying what it does.
      await use.first().hover({ force: true });
      await page.waitForTimeout(800);
      const label = await dialog.getByText("Preview images", { exact: true }).boundingBox();
      const add = await dialog.getByRole("button", { name: "Add", exact: true }).boundingBox();
      const paper = await dialog.boundingBox();
      return {
        clip: {
          x: paper.x,
          y: label.y - 20,
          width: paper.width,
          height: add.y + add.height - label.y + 44,
        },
        mouse: false,
      };
    },
  },
  {
    name: "model-menu",
    run: async (page) => {
      if (!model) return { skip: "no --model" };
      const download = await openModelMenu(page);
      const menu = page.getByRole("menu").filter({ has: download });
      // From the main area's corner, so the model's name above the menu is in the picture too. An open menu hides
      // the page from role queries, so the area is found by its element.
      const main = await page.locator("main").first().boundingBox();
      const box = await menu.boundingBox();
      return { clip: clipAround([box, { x: main.x + 8, y: 8, width: 1, height: 1 }], 24) };
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
      const file = path.join(outDir, `${version}-${shot.name}.webp`);
      if (shot.from) {
        // A tool's own screenshot: already the picture its window is best shown by.
        await sharp(path.join(here, "..", shot.from))
          .resize({ width: MAX_WIDTH, withoutEnlargement: true })
          .webp({ quality: 85 })
          .toFile(file);
        console.log(`${(fs.statSync(file).size / 1024).toFixed(0)} kB, from ${shot.from}`);
        continue;
      }
      await admin.page.setViewportSize(VIEWPORT);
      const result = await shot.run(admin.page, { api: admin.api, displayName: admin.displayName });
      if (result?.skip) {
        console.log(`skipped, ${result.skip}`);
        continue;
      }
      const page = result?.page ?? admin.page;
      // Off the page, so no tooltip shows up under the pointer, unless the tooltip is what the shot is about.
      if (result?.mouse !== false) {
        const size = page.viewportSize() ?? VIEWPORT;
        await page.mouse.move(size.width - 1, size.height - 1);
      }
      await settle(page, 300);
      if (!args["no-blur"]) await blurEmails(page);
      const png = await page.screenshot(result?.clip ? { clip: result.clip } : {});
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
