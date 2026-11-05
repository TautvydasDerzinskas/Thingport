#!/usr/bin/env node
// Captures the What's new pictures for a release from a running instance with a populated library, cropped to the
// thing each one is about and written as WebP into release-notes/screenshots/, named after the version:
//
//   THINGPORT_PASSWORD='…' THINGPORT_VIEWER_PASSWORD='…' npm --prefix regression run release-shots -- \
//     --url https://thingport.example --email me@example.com --viewer-email someone@example.com
//
// Options, also settable as env vars:
//   --url                 THINGPORT_URL              instance to capture (required)
//   --email               THINGPORT_EMAIL            admin account to sign in with (required)
//   --password            THINGPORT_PASSWORD
//   --viewer-email        THINGPORT_VIEWER_EMAIL     a second account, for Explore, which leaves out your own shares
//   --viewer-password     THINGPORT_VIEWER_PASSWORD
//   --studio-design       SCREENSHOT_STUDIO_DESIGN   a design Ask AI built, default the one edited last
//   --chat                SCREENSHOT_CHAT            the chat to show, default the one written in last
//   --version             RELEASE_SHOTS_VERSION      names the files, default the version the notes name
//   --theme               RELEASE_SHOTS_THEME        light (the default) or dark
//   --only                RELEASE_SHOTS_ONLY         comma-separated shot names, e.g. studio-ai,chats
//   --out                 RELEASE_SHOTS_OUT          output folder, default release-notes/screenshots
//   --headed                                         show the browser
//
// Shots needing something the instance doesn't have -- a Claude AI, social features or chats switched on, a second
// account -- are skipped with a line saying so, and the rest still run. Nothing in the library is changed: dialogs
// and panels are only opened. Email addresses are blurred. The accounts' themes, and the admin's Studio prompt layout,
// are switched for the run and restored afterwards.
//
// What the shots show has to be there first: a Studio design Ask AI built, with its conversation; a public collection
// of the admin's for the viewer's Explore; and a chat with a model sent in it.
//
// Thingport Grab's own pictures aren't covered: they come from `npm --prefix extension run screenshots`, which
// loads the built extension into a visible browser. Convert the ones you want with `sharp` as this script does.
//
// The file a shot writes is what a release-notes item then names in its `images`, e.g.
//
//   { "src": "screenshots/1.5.0-chats.webp", "caption": "A room, with a model sent in it" }
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
    "viewer-email": { type: "string" },
    "viewer-password": { type: "string" },
    "studio-design": { type: "string" },
    chat: { type: "string" },
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
const viewerEmail = args["viewer-email"] || process.env.THINGPORT_VIEWER_EMAIL;
const viewerPassword = args["viewer-password"] || process.env.THINGPORT_VIEWER_PASSWORD;
const designId = args["studio-design"] || process.env.SCREENSHOT_STUDIO_DESIGN;
const chatId = args.chat || process.env.SCREENSHOT_CHAT;
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

/** Studio on the design, its geometry built. */
async function openStudio(page) {
  await open(page, designId ? `/studio?design=${encodeURIComponent(designId)}` : "/studio");
  await page.getByRole("button", { name: "Edit design" }).waitFor({ timeout: 30000 });
  await page.locator("canvas").first().waitFor();
  // The bodies are built in a worker once the design arrives, and the camera eases onto them.
  await settle(page, 3000);
}

const SHOTS = [
  {
    name: "studio-ai",
    run: async (page, { api }) => {
      // Beside the view rather than over it, so the conversation and the design both show.
      await api("PATCH", "/studio/settings", { prompt_layout: "panel" });
      await openStudio(page);
      // The design's conversation doesn't say which AI had it; the shot is about what Claude does, when it's there.
      const model = page.getByRole("combobox", { name: "AI model" });
      if (await model.isVisible().catch(() => false)) {
        await model.click();
        const claude = page.getByRole("option", { name: /claude/i }).first();
        if (await claude.isVisible().catch(() => false)) await claude.click();
        else await page.keyboard.press("Escape");
      }
      // The steps the answer took, folded under it until asked for.
      const steps = page.getByRole("button", { name: /^\d+ steps?$/ }).last();
      if (await steps.isVisible().catch(() => false)) await steps.click();
      await settle(page, 1000);
      return { clip: await mainClip(page) };
    },
  },
  {
    name: "studio-edit",
    run: async (page, { api }) => {
      await api("PATCH", "/studio/settings", { prompt_layout: "bar" });
      await openStudio(page);
      // The prompt folds to its button, leaving the view to the design and the panels.
      await page.getByRole("button", { name: "Minimise" }).click();
      await page.getByRole("button", { name: "Edit design" }).click();
      const top = page.getByRole("tree").getByRole("treeitem").first();
      await top.waitFor();
      // Selected, so Properties shows its exact values, and opened one level to show what it's built from: clicked
      // past the chevron, which only folds, then the right arrow, which opens a row as in a file tree.
      await top
        .locator(".MuiListItemButton-root")
        .first()
        .click({ position: { x: 120, y: 16 } });
      await page.keyboard.press("ArrowRight");
      await settle(page, 1200);
      return { clip: await mainClip(page) };
    },
  },
  {
    name: "studio-assistant",
    run: async (page) => {
      await open(page, "/admin-ai");
      const tile = page.getByRole("button", { name: "Studio assistant settings" });
      if (!(await tile.isVisible().catch(() => false))) return { skip: "Studio isn't on this instance" };
      await tile.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("Available models").waitFor();
      await settle(page, 600);
      return { clip: await clipOf(page, dialog, 0) };
    },
  },
  {
    name: "ai-claude",
    run: async (page) => {
      await open(page, "/admin-ai");
      // An AI's tile is named after its model. A saved API key never comes back to the page, so the field shows dots.
      const tile = page.getByRole("button", { name: /^claude/i }).first();
      if (!(await tile.isVisible().catch(() => false))) return { skip: "no Claude AI under Administration → AI" };
      await tile.dblclick();
      const dialog = page.getByRole("dialog");
      await dialog.getByText("Effort", { exact: true }).first().waitFor();
      await settle(page, 600);
      return { clip: await clipOf(page, dialog, 0) };
    },
  },
  {
    name: "import-queue",
    run: async (page) => {
      await open(page, "/models");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("button", { name: "Open", exact: true }).click();
      const dialog = page.getByRole("dialog").filter({ hasText: "Import queue" });
      await dialog.waitFor();
      // An idle queue opens on an empty Importing, so it goes to the first section with something in it.
      for (const section of [/^Importing\s*[1-9]/, /^Waiting\s*[1-9]/, /^Finished\s*[1-9]/]) {
        const button = dialog.getByRole("button", { name: section });
        if (await button.isVisible().catch(() => false)) {
          await button.click();
          break;
        }
      }
      await settle(page);
      return { clip: await clipOf(page, dialog, 0) };
    },
  },
  {
    name: "add-hub",
    run: async (page) => {
      await open(page, "/models");
      const button = page.getByRole("button", { name: "Add", exact: true });
      // Measured first: an open popover hides the rest of the page from role queries. The whole row of top-bar
      // buttons, so the crop doesn't cut through the bell beside Add.
      const row = await button.locator("xpath=ancestor::*[count(.//button) >= 4][1]").boundingBox();
      await button.click();
      const hub = page.locator(".MuiPopover-paper").first();
      await hub.waitFor();
      await settle(page, 500);
      return { clip: clipAround([row, await hub.boundingBox()]) };
    },
  },
  {
    name: "providers",
    run: async (page) => {
      await open(page, "/admin-providers");
      await settle(page);
      // The newest site is at the foot of the list, which is what this shot is about.
      await page.getByText("Meshy", { exact: true }).first().scrollIntoViewIfNeeded();
      await settle(page, 400);
    },
  },
  {
    name: "social-switch",
    run: async (page) => {
      // Narrower, so the switch's card and the people under it make a picture rather than a strip.
      await page.setViewportSize({ width: 1200, height: VIEWPORT.height });
      await open(page, "/admin-users");
      const label = page.getByText("Social features", { exact: true }).first();
      await label.waitFor();
      const card = label.locator("xpath=ancestor::*[contains(@class, 'MuiPaper-root')][1]");
      await settle(page);
      const boxes = [await card.boundingBox(), await page.getByRole("table").first().boundingBox()];
      return { clip: clipAround(boxes.filter(Boolean)) };
    },
  },
  {
    name: "explore",
    needs: { viewer: "--viewer-email" },
    run: async (_page, { viewer }) => {
      const page = await viewer();
      await open(page, "/explore");
      if (
        !(await page
          .getByText("People", { exact: true })
          .first()
          .isVisible()
          .catch(() => false))
      ) {
        return { skip: "Explore is empty for the viewer: turn social features on and make a collection public" };
      }
      await settle(page);
      return { page };
    },
  },
  {
    name: "chats",
    run: async (page) => {
      // Shorter than the others: a conversation is a few lines, and the rest of a tall window is empty.
      await page.setViewportSize({ width: VIEWPORT.width, height: 600 });
      await open(page, chatId ? `/chats/${encodeURIComponent(chatId)}` : "/chats");
      if (
        await page
          .getByText("Chats are off on this instance")
          .isVisible()
          .catch(() => false)
      ) {
        return { skip: "chats are off" };
      }
      if (!chatId) {
        // The list is newest first.
        const first = page.locator("[href^='/chats/']").first();
        if (!(await first.isVisible().catch(() => false))) return { skip: "no chats yet" };
        await first.click();
      }
      await settle(page, 1500);
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
const missing = { viewer: !viewerEmail || !viewerPassword };
const wanted = SHOTS.filter((shot) => !only.length || only.includes(shot.name));

const browser = await chromium.launch({ headless: !args.headed });

/** A signed-in browser context of its own, with the run's theme on its account until `restore`. */
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
  await api("PATCH", "/settings/theme", { theme });
  await page.emulateMedia({ colorScheme: theme });
  const restore = () =>
    api("PATCH", "/settings/theme", { theme: originalTheme }).catch((err) =>
      console.error(`Couldn't restore ${accountEmail}'s theme (${originalTheme}): ${err.message}`),
    );
  return { page, api, restore };
}

const sessions = [];
let originalLayout;
let admin;
try {
  admin = await signIn(email, password);
  sessions.push(admin);
  if (wanted.some((shot) => shot.name.startsWith("studio-"))) {
    originalLayout = (await admin.api("GET", "/studio/settings")).prompt_layout;
  }
  let viewerPage;
  const viewer = async () => {
    if (!viewerPage) {
      const session = await signIn(viewerEmail, viewerPassword);
      sessions.push(session);
      viewerPage = session.page;
    }
    return viewerPage;
  };
  fs.mkdirSync(outDir, { recursive: true });

  for (const shot of wanted) {
    const needs = shot.needs && Object.entries(shot.needs).find(([key]) => missing[key]);
    if (needs) {
      console.log(`${shot.name}... skipped, needs ${needs[1]}`);
      continue;
    }
    process.stdout.write(`${shot.name}... `);
    try {
      await admin.page.setViewportSize(VIEWPORT);
      const result = await shot.run(admin.page, { api: admin.api, viewer });
      if (result?.skip) {
        console.log(`skipped, ${result.skip}`);
        continue;
      }
      const page = result?.page ?? admin.page;
      // Off the page, so no tooltip shows up under the pointer.
      const size = page.viewportSize() ?? VIEWPORT;
      await page.mouse.move(size.width - 1, size.height - 1);
      await settle(page, 300);
      await blurEmails(page);
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
    }
  }
  console.log(`Saved to ${outDir}`);
} finally {
  if (admin && originalLayout !== undefined) {
    await admin
      .api("PATCH", "/studio/settings", { prompt_layout: originalLayout })
      .catch((err) => console.error(`Couldn't restore the Studio prompt layout (${originalLayout}): ${err.message}`));
  }
  for (const session of sessions) await session.restore();
  await browser.close();
}
