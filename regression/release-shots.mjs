#!/usr/bin/env node
// Captures the What's new pictures for a release from a running instance with a populated library, cropped to the
// thing each one is about and written as WebP into release-notes/screenshots/, named after the version:
//
//   THINGPORT_PASSWORD='…' npm --prefix regression run release-shots -- --url https://thingport.example \
//     --email me@example.com --profiles-model <id> --license-model <id> --shared-collection <id>
//
// Options, also settable as env vars:
//   --url                 THINGPORT_URL              instance to capture (required)
//   --email               THINGPORT_EMAIL            admin account to sign in with (required)
//   --password            THINGPORT_PASSWORD
//   --profiles-model      SCREENSHOT_PROFILES_MODEL  a model with print profiles, read already (open it once first)
//   --license-model       SCREENSHOT_LICENSE_MODEL   a model whose licence was read, default --profiles-model
//   --shared-collection   SCREENSHOT_SHARED_COLLECTION  a collection to show the sharing form on
//   --connect-to          SCREENSHOT_CONNECT_TO      an instance's address for the Connect dialog, looked up only
//   --host-rules          SCREENSHOT_HOST_RULES      Chromium --host-resolver-rules, for names this machine can't resolve
//   --no-blur                                        leave addresses unblurred, on a demo instance of made-up handles
//   --version             RELEASE_SHOTS_VERSION      names the files, default the version the notes name
//   --theme               RELEASE_SHOTS_THEME        light (the default) or dark
//   --only                RELEASE_SHOTS_ONLY         comma-separated shot names, e.g. print-profiles-tiles,licence
//   --out                 RELEASE_SHOTS_OUT          output folder, default release-notes/screenshots
//   --headed                                         show the browser
//
// Shots needing something the instance doesn't have -- a model with print profiles, a partner instance -- are
// skipped with a line saying so, and the rest still run. Nothing in the library is changed: dialogs and menus are only
// opened, and what the sharing form and Explore show of other people is answered in the browser, so social features
// needn't be on. Email addresses are blurred. The account's theme and print profiles layout are switched for the run
// and restored afterwards.
//
// The connected-instances shots need a partner, so they're taken from an instance that has one, with --only naming
// them: explore-everywhere, partner-model and connect-link on the one that connects from home, partners on the one it
// connects to. As in screenshots.mjs, a demo pair on one machine has the Connect dialog's lookup shown suggesting the
// link, and the Public URL shown confirmed, answered in the browser. Thingport Grab's own pictures aren't covered:
// they come from `npm --prefix extension run screenshots`, which loads the built extension into a visible browser.
// Convert the ones you want with `sharp` as this script does.
//
// The file a shot writes is what a release-notes item then names in its `images`, e.g.
//
//   { "src": "screenshots/1.6.0-licence.webp", "caption": "A model's licence: what it allows, its terms and a credit line to copy" }
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
    "license-model": { type: "string" },
    "shared-collection": { type: "string" },
    "connect-to": { type: "string" },
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
const licenseModel = args["license-model"] || process.env.SCREENSHOT_LICENSE_MODEL || profilesModel;
const sharedCollection = args["shared-collection"] || process.env.SCREENSHOT_SHARED_COLLECTION;
const connectTo = args["connect-to"] || process.env.SCREENSHOT_CONNECT_TO;
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

// Made-up people for what the sharing form and Explore show, so nobody real is in a published picture.
const person = (id, display_name) => ({ id, display_name, username: id, avatar_url: null });
const ALEX = person("alex", "Alex Morgan");
const SAM = person("sam", "Sam Rivera");
const LENA = person("lena", "Lena Fischer");

/** Explore and the sidebar's Explore and Chats answered in the browser, with `overview` as what Explore shows. */
async function stubSocial(page, overview) {
  await page.route(/\/api\/social$/, (route) => route.fulfill({ json: { enabled: true, explore: true, chats: true } }));
  await page.route(/\/api\/chats\/unread/, (route) => route.fulfill({ json: { unread: 0, latest: null } }));
  if (overview) await page.route(/\/api\/explore$/, (route) => route.fulfill({ json: overview }));
}

/** A model's page in a print profiles layout, and the box of its side panel: the one with Open in the slicer. */
async function profilesPanel(page, api, view) {
  if (!profilesModel) return { skip: "needs --profiles-model" };
  await api("PATCH", "/settings/print-profiles-view", { view });
  await open(page, `/models/${encodeURIComponent(profilesModel)}`);
  // A link when the slicer opens by address, a button otherwise.
  const openButton = page
    .getByRole("link", { name: /^Open in / })
    .or(page.getByRole("button", { name: /^Open in / }))
    .first();
  await openButton.waitFor({ timeout: 20000 });
  const panel = openButton.locator("xpath=ancestor::*[contains(@class, 'MuiPaper-root')][1]");
  await settle(page, 800);
  return { panel };
}

/** A clip around `boxes` that may reach past VIEWPORT, for shots taken in a taller window. */
function clipIn(page, boxes, pad = PAD) {
  const size = page.viewportSize() ?? VIEWPORT;
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(size.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(size.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** What partner instances share on this one's Explore. */
async function partnerContent(api) {
  const overview = await api("GET", "/explore").catch(() => null);
  return { models: overview?.elsewhere?.recent_models ?? [], people: overview?.elsewhere?.people ?? [] };
}

const SHOTS = [
  {
    name: "print-profiles-picker",
    run: async (page, { api }) => {
      const { skip, panel } = await profilesPanel(page, api, "picker");
      if (skip) return { skip };
      // The model's picture beside the panel, cut off where the panel ends.
      const main = await page.locator("main").first().boundingBox();
      const box = await panel.boundingBox();
      return { clip: clipAround([{ x: main.x + PAD, y: 0, width: 1, height: 1 }, box]) };
    },
  },
  {
    name: "print-profiles-tiles",
    run: async (page, { api }) => {
      // Taller, so every tile fits.
      await page.setViewportSize({ width: VIEWPORT.width, height: 1500 });
      const { skip, panel } = await profilesPanel(page, api, "tiles");
      if (skip) return { skip };
      return { clip: clipIn(page, [await panel.boundingBox()]) };
    },
  },
  {
    name: "print-profiles-list",
    run: async (page, { api }) => {
      await page.setViewportSize({ width: VIEWPORT.width, height: 1500 });
      const { skip, panel } = await profilesPanel(page, api, "list");
      if (skip) return { skip };
      return { clip: clipIn(page, [await panel.boundingBox()]) };
    },
  },
  {
    name: "licence",
    run: async (page, { api }) => {
      if (!licenseModel) return { skip: "needs --license-model" };
      await api("PATCH", "/settings/print-profiles-view", { view: "picker" });
      await open(page, `/models/${encodeURIComponent(licenseModel)}`);
      const strip = page.getByRole("button", { name: /: licence details$/ });
      if (!(await strip.isVisible().catch(() => false)))
        return { skip: "the model shows no licence yet: open it once" };
      // Its description box with the strip at its foot, and the details it opens.
      const box = strip.locator("xpath=ancestor::*[contains(@class, 'MuiPaper-root')][1]");
      await box.scrollIntoViewIfNeeded();
      await settle(page, 300);
      // Measured first: the open popover hides the rest of the page from role queries.
      const stripBox = await strip.boundingBox();
      await strip.click();
      const details = page.locator(".MuiPopover-paper").first();
      await page.getByRole("button", { name: "Copy credit line" }).waitFor();
      await settle(page, 400);
      return { clip: clipAround([stripBox, await details.boundingBox()].filter(Boolean)) };
    },
  },
  {
    name: "licence-filter",
    run: async (page) => {
      await page.setViewportSize({ width: VIEWPORT.width, height: 1300 });
      await open(page, "/models");
      const button = page.getByRole("button", { name: "Filters" });
      const buttonBox = await button.boundingBox();
      await button.click();
      const popover = page.locator(".MuiPopover-paper, .MuiMenu-paper").first();
      await popover.getByText("Licence allows").waitFor();
      await settle(page, 400);
      return { clip: clipIn(page, [buttonBox, await popover.boundingBox()]) };
    },
  },
  {
    name: "providers",
    run: async (page) => {
      await open(page, "/admin-providers");
      // Newest first: the three sites this release adds lead the grid.
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
    name: "share-collection",
    run: async (page) => {
      if (!sharedCollection) return { skip: "needs --shared-collection" };
      await stubSocial(page);
      // Who it's shared with, answered in the browser: the form is only opened, never saved.
      await page.route(/\/api\/collection\/[^/]+\/sharing$/, (route) =>
        route.fulfill({ json: { visibility: "shared", people: [ALEX, SAM, LENA], max_people: 100 } }),
      );
      await page.route(/\/api\/social\/people/, (route) => route.fulfill({ json: { people: [ALEX, SAM, LENA] } }));
      await open(page, `/models/collections/${encodeURIComponent(sharedCollection)}`);
      await page.getByRole("button", { name: "More", exact: true }).first().click();
      await page.getByRole("menuitem", { name: "Share…" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("Sam Rivera").waitFor();
      await settle(page, 500);
      return { clip: await clipOf(page, dialog, 0) };
    },
  },
  {
    name: "shared-with-you",
    run: async (page, { api }) => {
      // The library's own collections and models, as the made-up people's shares.
      const models = (await api("GET", "/prints?limit=40")).filter((m) => m.preview_images?.length);
      const collections = (await api("GET", "/collections")).filter(
        (c) => !c.tool_id && !c.system_key && c.item_count > 3,
      );
      const owner = (i) => [ALEX, SAM, LENA][i % 3];
      const shared = collections.slice(0, 3).map((c, i) => ({ ...c, visibility: "shared", owner: owner(i) }));
      await stubSocial(page, {
        shared_with_you: shared,
        shared_with_you_total: shared.length,
        people: [
          { ...ALEX, collection_count: 3, model_count: 41 },
          { ...SAM, collection_count: 2, model_count: 17 },
          { ...LENA, collection_count: 1, model_count: 9 },
        ],
        recent_models: models.slice(0, 10).map((m, i) => ({ ...m, owner: owner(i) })),
        recent_collections: collections.slice(3, 7).map((c, i) => ({ ...c, visibility: "public", owner: owner(i) })),
        most_collected: [],
      });
      await open(page, "/explore");
      const heading = page.getByText("Shared with you", { exact: true }).first();
      await heading.waitFor();
      await settle(page);
      const main = await page.locator("main").first().boundingBox();
      const top = await heading.boundingBox();
      // Down to the heading of the section after it.
      const next = await page.getByText("People", { exact: true }).first().boundingBox();
      const bottom = next && next.y > top.y ? next.y - 8 : top.y + 380;
      return {
        clip: { x: main.x, y: top.y - PAD, width: VIEWPORT.width - main.x, height: bottom - top.y + PAD },
      };
    },
  },
  {
    name: "profile",
    run: async (page) => {
      // Links under the bio, answered in the browser when the account has none, so its own aren't changed.
      await page.route(/\/api\/me$/, async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        if (json.user && !json.user.links?.length) {
          json.user.links = ["https://github.com/TautvydasDerzinskas/Thingport", "https://thingport.net"];
        }
        await route.fulfill({ response, json });
      });
      await open(page, "/authors/self");
      const edit = page.getByRole("button", { name: "Edit profile" });
      await edit.waitFor();
      await settle(page);
      const main = await page.locator("main").first().boundingBox();
      const lastLink = page.getByRole("link", { name: /thingport\.net/ }).last();
      const end = (await lastLink.boundingBox()) ?? (await edit.boundingBox());
      return { clip: { x: main.x, y: 0, width: VIEWPORT.width - main.x, height: end.y + end.height + PAD * 2 } };
    },
  },
  {
    name: "avatar",
    run: async (page) => {
      await open(page, "/authors/self");
      await page.getByRole("button", { name: "Change avatar" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await settle(page, 600);
      return { clip: await clipOf(page, dialog, 0) };
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
      const list = page.getByRole("listbox", { name: "Language" });
      await list.waitFor();
      await settle(page, 500);
      const listBox = await list.locator("xpath=ancestor::*[contains(@class, 'MuiPaper-root')][1]").boundingBox();
      return { clip: clipAround([pickerBox, listBox ?? (await list.boundingBox())]) };
    },
  },
  {
    name: "explore-everywhere",
    run: async (page, { api }) => {
      if (!(await partnerContent(api)).models.length) return { skip: "no partner's models on Explore" };
      await open(page, "/explore");
      await page.getByRole("button", { name: "Everywhere" }).first().waitFor();
      await settle(page);
      return { clip: await mainClip(page) };
    },
  },
  {
    name: "partner-model",
    run: async (page, { api }) => {
      const { models } = await partnerContent(api);
      const model = models.find((m) => /vase/i.test(m.name ?? m.title ?? "")) ?? models[0];
      if (!model) return { skip: "no partner's models on Explore" };
      await open(page, `/explore/elsewhere/models/${encodeURIComponent(model.id)}`);
      await page
        .getByRole("button", { name: /^Copy to my library|^Open my copy/ })
        .first()
        .waitFor();
      await settle(page);
      return { clip: await mainClip(page) };
    },
  },
  {
    name: "connect-link",
    run: async (page) => {
      if (!connectTo) return { skip: "needs --connect-to" };
      await page.route(/\/api\/federation\/lookup/, async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        await route.fulfill({ response, json: { ...json, suggestLink: "local" } });
      });
      await open(page, "/admin-social");
      await page.getByRole("button", { name: "Connect to an instance" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Its address").fill(connectTo);
      await dialog.getByRole("button", { name: "Look up" }).click();
      await dialog.getByText("The keys match").waitFor({ timeout: 20000 });
      await dialog.getByText("The keys match").click();
      await dialog.getByLabel("Note for their admin (optional)").fill("Hi from Sam's garage workshop!");
      await settle(page, 500);
      return { clip: await clipOf(page, dialog, 0) };
    },
  },
  {
    name: "partners",
    run: async (page, { api }) => {
      const instances = await api("GET", "/federation/instances").catch(() => null);
      if (!instances?.partners?.length) return { skip: "no partner instance" };
      await page.route(/\/api\/federation\/settings$/, async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        const reachability = { ...json.reachability, kind: "public", reason: null, detail: null };
        await route.fulfill({
          response,
          json: { ...json, reachability, confirmedBy: Math.max(1, json.confirmedBy ?? 0) },
        });
      });
      await open(page, "/admin-social");
      await page
        .getByRole("button", { name: /^Partners/ })
        .or(page.getByRole("tab", { name: /^Partners/ }))
        .first()
        .click();
      const more = page.getByRole("button", { name: /^More for / }).first();
      await more.waitFor();
      await settle(page);
      // From the connected instances switch down to the partners under it.
      const row = page.getByText("Connected instances", { exact: true }).first();
      const top = row.locator("xpath=ancestor::*[contains(@class, 'MuiPaper-root')][1]");
      const list = more.locator("xpath=ancestor::*[contains(@class, 'MuiPaper-root')][1]");
      const boxes = [await top.boundingBox(), await list.boundingBox()].filter(Boolean);
      return { clip: clipAround(boxes) };
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
