#!/usr/bin/env node
// Captures the What's new pictures for a release from a running instance with a populated library, cropped to the
// thing each one is about and written as WebP into release-notes/screenshots/, named after the version:
//
//   THINGPORT_PASSWORD='…' npm --prefix regression run release-shots -- --url https://thingport.example \
//     --email me@example.com --model <id> --generative-model <id>
//
// Options, also settable as env vars:
//   --url                 THINGPORT_URL              instance to capture (required)
//   --email               THINGPORT_EMAIL            admin account to sign in with (required)
//   --password            THINGPORT_PASSWORD
//   --version             RELEASE_SHOTS_VERSION      names the files, default the version the notes name
//   --model               SCREENSHOT_MODEL           a multicolour model, for the 3D preview shot
//   --generative-model    SCREENSHOT_GENERATIVE      a model that came with its OpenSCAD script
//   --theme               RELEASE_SHOTS_THEME        light (the default) or dark
//   --only                RELEASE_SHOTS_ONLY         comma-separated shot names, e.g. tools,admin-tools
//   --out                 RELEASE_SHOTS_OUT          output folder, default release-notes/screenshots
//   --headed                                         show the browser
//
// Shots needing a tool that isn't installed, or a model that wasn't given, are skipped with a line saying so --
// the rest still run. Nothing in the library is changed: dialogs and panels are only opened. Email addresses are
// blurred. The account's theme is switched for the run and restored afterwards.
//
// Thingport Grab's own pictures aren't covered: they come from `npm --prefix extension run screenshots`, which
// loads the built extension into a visible browser. Convert the ones you want with `sharp` as this script does.
//
// The file a shot writes is what a release-notes item then names in its `images`, e.g.
//
//   { "src": "screenshots/1.4.0-tools.webp", "caption": "The Tools page, with the tools split into shelves" }
//
// so a shot added here wants an item in release-notes/latest-release-notes.json to put it in, and the other way
// round: an item naming a picture nothing captures leaves a gap in What's new.
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
    version: { type: "string" },
    model: { type: "string" },
    "generative-model": { type: "string" },
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
const modelId = args.model || process.env.SCREENSHOT_MODEL;
const generativeId = args["generative-model"] || process.env.SCREENSHOT_GENERATIVE;
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

/** The box covering several locators at once, e.g. a button and the menu it opened. */
async function clipAround(page, locators, pad = PAD) {
  const boxes = (await Promise.all(locators.map((l) => l.boundingBox()))).filter(Boolean);
  if (!boxes.length) throw new Error("nothing to crop to");
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(VIEWPORT.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const bottom = Math.min(VIEWPORT.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return { x: left, y: top, width: right - left, height: bottom - top };
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

const SHOTS = [
  {
    name: "tools",
    run: async (page) => {
      await open(page, "/tools");
      await page.getByRole("heading", { name: "Tools", exact: true }).waitFor();
      await settle(page);
      // Down to the last shelf: the tools rarely fill the page, and the blank below them says nothing.
      const bottom = await page.evaluate(() => {
        const tiles = [...document.querySelectorAll("[aria-label*='press Enter to open']")];
        return tiles.length ? Math.max(...tiles.map((t) => t.getBoundingClientRect().bottom)) : null;
      });
      return bottom
        ? { clip: { x: 0, y: 0, width: VIEWPORT.width, height: Math.min(VIEWPORT.height, bottom + 48) } }
        : undefined;
    },
  },
  {
    name: "tools-ai",
    needsUserTools: true,
    run: async (page) => {
      await open(page, "/tools");
      await page.getByRole("button", { name: "New tool" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Use AI" }).click();
      await dialog.getByText("Build a tool with AI").waitFor();
      return { clip: await clipOf(page, dialog) };
    },
  },
  {
    name: "tool-editor",
    needsUserTools: true,
    run: async (page) => {
      await open(page, "/tools");
      await page.getByRole("button", { name: "New tool" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Script", exact: true }).click();
      await settle(page);
      return { clip: await clipOf(page, dialog) };
    },
  },
  {
    name: "admin-tools",
    run: async (page) => {
      await open(page, "/admin-tools");
      // The tile grid, not the access settings above it.
      const grid = page.getByRole("heading", { name: /repository/i }).locator("xpath=../..");
      await settle(page);
      return { clip: await clipOf(page, grid) };
    },
  },
  {
    name: "generative-model",
    needs: { generativeId: "--generative-model" },
    run: async (page) => {
      await open(page, `/models/${generativeId}`);
      // Customize takes the main button on a model that came with its script, where Open would otherwise be.
      // Named exactly: a model may also carry a tag called "Customize", whose chip is a button earlier in the page.
      await page.getByRole("button", { name: "Customize\u2026", exact: true }).waitFor({ timeout: 30000 });
      await settle(page);
    },
  },
  {
    name: "customizer",
    needs: { generativeId: "--generative-model" },
    run: async (page) => {
      await open(page, `/models/${generativeId}`);
      await page.getByRole("button", { name: "Customize\u2026", exact: true }).click();
      // A model that came with several scripts asks which one first.
      const pick = page.getByRole("dialog").filter({ hasText: "Which script?" });
      if (await pick.isVisible().catch(() => false)) await pick.getByRole("button").first().click();
      // The script is read and its controls built from it, which is the engine's first run of the visit.
      const generate = page.getByRole("button", { name: "Generate" });
      await generate.waitFor({ timeout: 120000 });
      // An empty stage says nothing about what the parameters do, so it is generated before the shot.
      await generate.click();
      await page
        .getByText(/Generated in/)
        .waitFor({ timeout: 180000 })
        .catch(() => console.warn("  nothing generated in time; the stage may be empty"));
      await settle(page, 1500);
    },
  },
  {
    name: "filters",
    run: async (page) => {
      await open(page, "/models");
      const button = page.getByRole("button", { name: "Filters" });
      // Measured first: an open popover hides the rest of the page from role queries.
      const anchor = await button.boundingBox();
      await button.click();
      const panel = page.locator(".MuiPopover-paper, .MuiMenu-paper").first();
      await panel.waitFor();
      await settle(page, 500);
      const box = await panel.boundingBox();
      const left = Math.max(0, Math.min(anchor.x, box.x) - PAD);
      const right = Math.min(VIEWPORT.width, Math.max(anchor.x + anchor.width, box.x + box.width) + PAD);
      const top = Math.max(0, anchor.y - PAD);
      return {
        clip: {
          x: left,
          y: top,
          width: right - left,
          height: Math.min(VIEWPORT.height - top, box.y + box.height - top + PAD),
        },
      };
    },
  },
  {
    name: "multicolor",
    needs: { modelId: "--model" },
    run: async (page) => {
      await open(page, `/models/${modelId}`);
      await page.getByRole("button", { name: "3D Preview" }).click();
      await page.locator("canvas").first().waitFor();
      // The model streams in and the camera eases to fit it.
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(4500);
      return { clip: await clipOf(page, page.getByRole("dialog").first(), 0) };
    },
  },
  {
    name: "providers",
    run: async (page) => {
      await open(page, "/admin-providers");
      await settle(page);
      // The newest sites are at the foot of a list of seventeen, which is what this shot is about.
      await page.getByText("GrabCAD", { exact: true }).scrollIntoViewIfNeeded();
      await settle(page, 400);
    },
  },
  {
    name: "repair",
    run: async (page) => {
      // On a library that has lost files, the dialog comes up on its own and says what was found; the panel
      // behind Manage categories is the way in otherwise, and all a healthy library has to show.
      await page.evaluate(() => localStorage.removeItem("thingport.missingFiles.dismissedAt"));
      await page.goto("/");
      await settle(page, 0);
      const prompt = page.getByRole("dialog").filter({ hasText: "Some models have lost their files" });
      if (await prompt.isVisible().catch(() => false)) {
        await settle(page);
        return { clip: await clipOf(page, prompt) };
      }
      await open(page, "/models");
      await page.getByRole("button", { name: "Manage categories" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Repair", exact: true }).click();
      await dialog.waitFor();
      // The look through the library takes a moment on a real one.
      await dialog
        .getByText(/Looking through/)
        .waitFor({ state: "detached", timeout: 60000 })
        .catch(() => undefined);
      await settle(page);
      return { clip: await clipOf(page, dialog) };
    },
  },
  {
    name: "multiboard",
    run: async (page) => {
      await open(page, "/tools");
      await page.getByRole("button", { name: /Multiboard planner/ }).dblclick();
      const window_ = page.getByRole("dialog");
      await window_.waitFor();
      // The board is drawn from the plan once the tool's script has started.
      await window_.locator("svg, canvas").first().waitFor({ timeout: 30000 });
      await settle(page, 1500);
      return { clip: await clipOf(page, window_) };
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
const missing = { modelId: !modelId, generativeId: !generativeId };
const wanted = SHOTS.filter((shot) => !only.length || only.includes(shot.name));

const browser = await chromium.launch({ headless: !args.headed });
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
  // dialog takes everything behind it out of the accessibility tree -- so no other shot could find what it came
  // for. Marked dismissed before anything loads it never opens; the repair shot, which wants it, clears this.
  localStorage.setItem("thingport.missingFiles.dismissedAt", "999999");
});
const page = await context.newPage();

/** Through the browser context, so a self-signed certificate is accepted the same way. */
async function api(token, method, url, body) {
  const res = await context.request.fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
  return res.json();
}

let token = null;
let originalTheme;
let originalUserTools;
try {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Not a button on the page: an instance with broken models greets you with a dialog, and a dialog hides
  // everything behind it from role queries. The session landing is what says the sign-in worked.
  await page.waitForFunction(() => !!localStorage.getItem("thingport_auth_token"), null, { timeout: 30000 });
  token = await page.evaluate(() => localStorage.getItem("thingport_auth_token"));
  if (!token) throw new Error("Signed in, but couldn't read the session from the page");

  if (wanted.some((shot) => shot.needsUserTools)) {
    const access = await api(token, "GET", "/admin/tools/access");
    if (!access.userTools) {
      originalUserTools = false;
      await api(token, "POST", "/admin/tools/access", { userTools: true });
      console.log("Turned Users' own tools on for the editor shots; it goes back off at the end.");
    }
  }
  originalTheme = (await api(token, "GET", "/settings/theme")).theme;
  await api(token, "PATCH", "/settings/theme", { theme });
  await page.emulateMedia({ colorScheme: theme });
  fs.mkdirSync(outDir, { recursive: true });

  for (const shot of wanted) {
    const needs = shot.needs && Object.entries(shot.needs).find(([key]) => missing[key]);
    if (needs) {
      console.log(`${shot.name}... skipped, needs ${needs[1]}`);
      continue;
    }
    process.stdout.write(`${shot.name}... `);
    try {
      await page.setViewportSize(VIEWPORT);
      const result = await shot.run(page);
      // Off the page, so no tooltip shows up under the pointer.
      await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
      await settle(page, 300);
      await blurEmails(page);
      const png = await page.screenshot(result?.clip ? { clip: result.clip } : {});
      const file = path.join(outDir, `${version}-${shot.name}.webp`);
      await sharp(png).resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 85 }).toFile(file);
      console.log(`${(fs.statSync(file).size / 1024).toFixed(0)} kB`);
    } catch (err) {
      console.log(`failed: ${err.message}`);
    }
    // Twice: a dialog can open over another one.
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  console.log(`Saved to ${outDir}`);
} finally {
  if (token && originalUserTools === false) {
    await api(token, "POST", "/admin/tools/access", { userTools: false }).catch((err) =>
      console.error(`Couldn't turn Users' own tools back off: ${err.message}`),
    );
  }
  if (token && originalTheme !== undefined) {
    await api(token, "PATCH", "/settings/theme", { theme: originalTheme }).catch((err) =>
      console.error(`Couldn't restore the account's theme (${originalTheme}): ${err.message}`),
    );
  }
  await browser.close();
}
