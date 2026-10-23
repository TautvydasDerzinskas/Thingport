#!/usr/bin/env node
// Captures the README and website screenshots from a running instance with a populated library, each in the light and
// the dark theme: frontend/src/assets/screenshots/light/*.png and dark/*.png. The extension's screenshots aren't covered.
//
//   npm --prefix regression run screenshots -- --url https://thingport.example --email me@example.com \
//     --model <id> --quality-model <id>
//
// The password comes from THINGPORT_PASSWORD (or --password). Options, also settable as env vars:
//   --url            THINGPORT_URL              instance to capture (required)
//   --email          THINGPORT_EMAIL            admin account to sign in with (required)
//   --password       THINGPORT_PASSWORD
//   --model          SCREENSHOT_MODEL           id of the model for the details and 3D preview shots
//   --quality-model  SCREENSHOT_QUALITY_MODEL   id of a model whose print quality check found problems
//   --themes         SCREENSHOT_THEMES          comma-separated, default light,dark
//   --only           SCREENSHOT_ONLY            comma-separated shot names or numbers, e.g. 06,07
//   --out            SCREENSHOT_OUT             output folder, holding one folder per theme
//   --headed                                    show the browser
//
// The account's theme and Categories/Folders choice are switched for the shots and restored afterwards. Nothing is
// changed in the library: the merge and download dialogs are only opened. Email addresses on the page are blurred.
//
// The guide_* cut-outs replace the images in docs/guides/images, light only, and run only when named with --only;
// guide_consume_settings needs the consume folder mounted.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
    model: { type: "string" },
    "quality-model": { type: "string" },
    themes: { type: "string" },
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
const qualityModelId = args["quality-model"] || process.env.SCREENSHOT_QUALITY_MODEL;
const themes = list(args.themes || process.env.SCREENSHOT_THEMES || "light,dark");
const outDir = path.resolve(
  args.out || process.env.SCREENSHOT_OUT || path.join(here, "../frontend/src/assets/screenshots"),
);
const guideImagesDir = path.join(here, "../docs/guides/images");
const only = list(args.only || process.env.SCREENSHOT_ONLY);

if (!baseUrl || !email || !password) {
  console.error("Needs --url, --email and THINGPORT_PASSWORD (or --password). See the header of this file.");
  process.exit(1);
}

// 1400x790 at 2x, the size the README and site layouts were made for.
const VIEWPORT = { width: 1400, height: 790 };

/** Waits for the page's requests and every visible image, so no shot has half-loaded cards. */
async function settle(page, extraMs = 800) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page
    .waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 15000 })
    .catch(() => console.warn("  some images were still loading"));
  await page.waitForTimeout(extraMs);
}

async function open(page, url) {
  await page.goto(url);
  await settle(page, 0);
}

// Opening menus can nudge the page; the shots should start at the top.
async function scrollToTop(page) {
  await page.evaluate(() => {
    for (const el of [document.scrollingElement, ...document.querySelectorAll("*")]) {
      if (el && el.scrollTop) el.scrollTop = 0;
    }
  });
}

/** Ticks the first `count` items of a page in selection mode, passing over the checkboxes named in `skip`. */
async function selectFirst(page, enterLabel, count, skip = []) {
  await page.getByRole("button", { name: enterLabel }).click();
  await page.getByRole("checkbox").first().waitFor();
  const boxes = await page.getByRole("checkbox").all();
  for (const name of skip) await page.getByRole("checkbox", { name, exact: true }).waitFor();
  let picked = 0;
  for (const box of boxes) {
    if (picked === count) break;
    if (skip.length && (await box.evaluate((el, skip) => skip.includes(el.labels?.[0]?.textContent?.trim()), skip))) {
      continue;
    }
    await box.click();
    picked++;
  }
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

// The weather card names the account's saved location.
async function blurLocation(page) {
  await page.evaluate(() => {
    for (const button of document.querySelectorAll('button[aria-label="Change location"]')) {
      const name = button.previousElementSibling;
      if (name instanceof HTMLElement) name.style.filter = "blur(5px)";
    }
  });
}

const SHOTS = [
  {
    name: "01_dashboard",
    run: (page) => open(page, "/"),
  },
  {
    name: "02_dashboard_customize",
    run: async (page) => {
      await open(page, "/");
      await page.getByRole("button", { name: "Edit dashboard" }).click();
      await page.getByRole("button", { name: /^Templates:/ }).click();
      await page.getByRole("menuitem", { name: /^Manage templates/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Panels", exact: true }).click();
    },
  },
  {
    name: "03_dashboard_configuration",
    run: async (page, ctx) => {
      await open(page, "/");
      await page.getByRole("button", { name: ctx.displayName }).click();
      await page.getByRole("menuitem", { name: "Configuration" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Providers", exact: true }).click();
    },
  },
  {
    name: "04_models",
    run: (page) => open(page, "/models"),
  },
  {
    name: "05_models_download",
    run: async (page) => {
      await open(page, "/models");
      await selectFirst(page, "Select models", 3);
      await page.getByRole("button", { name: "Download", exact: true }).click();
      // Shows the models' total size once it's worked out.
      await page.getByRole("dialog").getByText(/~/).waitFor();
    },
  },
  {
    name: "06_model_details",
    needs: "model",
    run: (page) => open(page, `/models/${modelId}`),
  },
  {
    name: "07_model_3d_preview",
    needs: "model",
    run: async (page) => {
      await open(page, `/models/${modelId}`);
      await page.getByRole("button", { name: "3D Preview" }).click();
      await page.locator("canvas").first().waitFor();
      // The model streams in and the camera eases to fit it.
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(4000);
    },
  },
  {
    name: "08_model_print_quality",
    needs: "qualityModel",
    run: async (page) => {
      await open(page, `/models/${qualityModelId}`);
      await page.getByRole("button", { name: "Print problems found" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "09_collections",
    run: (page) => open(page, "/models/collections"),
  },
  {
    name: "10_collections_merge",
    run: async (page) => {
      await open(page, "/models/collections");
      // Built-in collections have no checkbox, so these are the first three of the user's own.
      await selectFirst(page, "Select collections", 3);
      await page.getByRole("button", { name: "Merge", exact: true }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "11_tags",
    run: (page) => open(page, "/models/tags"),
  },
  {
    name: "12_tags_select",
    run: async (page) => {
      await open(page, "/models/tags");
      await selectFirst(page, "Select tags", 4, ["Hide tags used once"]);
    },
  },
  {
    name: "13_downloads",
    run: (page) => open(page, "/downloads"),
  },
  {
    name: "14_profile",
    run: async (page) => {
      await open(page, "/profile");
      await page
        .getByText(/activit(y|ies) in /)
        .first()
        .waitFor();
    },
  },
  {
    name: "15_profile_configuration",
    run: async (page, ctx) => {
      await open(page, "/profile");
      await page.getByRole("button", { name: ctx.displayName }).click();
      await page.getByRole("menuitem", { name: "Configuration" }).click();
      await page.getByRole("dialog").waitFor();
      await scrollToTop(page);
    },
  },
  { name: "16_admin_overview", run: (page) => open(page, "/admin") },
  { name: "17_admin_providers", run: (page) => open(page, "/admin-providers") },
  { name: "18_admin_storage", run: (page) => open(page, "/admin-storage") },
  { name: "19_admin_dashboard", run: (page) => open(page, "/admin-dashboard") },
  { name: "20_admin_ai", run: (page) => open(page, "/admin-ai") },
  {
    name: "21_admin_captcha_search",
    run: async (page) => {
      await open(page, "/admin-captcha");
      // Empty, so it shows what search offers before anything is typed.
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("option").first().waitFor();
    },
  },
  // The guides' cut-outs, saved next to the guides rather than with the README shots.
  {
    name: "guide_consume_settings",
    guide: true,
    run: async (page) => {
      // Shows "Watching /app/consume" only on an instance with the consume folder mounted.
      await open(page, "/admin-storage");
      await blurEmails(page);
      const save = page.getByRole("button", { name: "Save consume settings" });
      await save.scrollIntoViewIfNeeded();
      const clip = await page.evaluate(() => {
        const heading = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].find(
          (el) => el.textContent?.trim() === "Consume Folder",
        );
        const button = [...document.querySelectorAll("button")].find(
          (el) => el.textContent?.trim() === "Save consume settings",
        );
        const card = button?.closest(".MuiPaper-root") ?? button?.parentElement;
        if (!heading || !card) return null;
        const top = heading.getBoundingClientRect();
        const box = card.getBoundingClientRect();
        return { x: box.left - 16, y: top.top - 16, width: box.width + 32, height: box.bottom - top.top + 32 };
      });
      if (!clip) throw new Error("Consume Folder section not found");
      // Scrolled down, the floating back-to-top button lands in the cut-out.
      await page.addStyleTag({ content: '[aria-label="Back to top"] { visibility: hidden !important; }' });
      await settle(page);
      await page.screenshot({ path: path.join(guideImagesDir, "consume-settings.png"), clip });
      return { saved: true };
    },
  },
  {
    name: "guide_add_menu",
    guide: true,
    run: async (page) => {
      await open(page, "/");
      const add = page.getByRole("button", { name: "Add", exact: true });
      // Measured first: the open menu hides the rest of the page from role queries.
      const button = await add.boundingBox();
      await add.click();
      const menu = page.getByRole("menu");
      await menu.waitFor();
      await page.waitForTimeout(400);
      const box = await menu.boundingBox();
      const left = Math.min(button.x, box.x) - 16;
      const right = Math.max(button.x + button.width, box.x + box.width) + 16;
      const clip = { x: left, y: button.y - 16, width: right - left, height: box.y + box.height - button.y + 32 };
      await page.screenshot({ path: path.join(guideImagesDir, "add-menu.png"), clip });
      return { saved: true };
    },
  },
];

function wanted(shot) {
  if (!only.length) return !shot.guide;
  return only.some((o) => shot.name === o || shot.name.startsWith(`${o}_`) || shot.name.split("_")[0] === o);
}

const shots = SHOTS.filter(wanted);
const missing = { model: !modelId && "--model", qualityModel: !qualityModelId && "--quality-model" };
for (const shot of shots) {
  if (shot.needs && missing[shot.needs]) {
    console.error(`${shot.name} needs ${missing[shot.needs]}; see the header of this file.`);
    process.exit(1);
  }
}

// Through the browser context, so a self-signed certificate is accepted the same way.
async function api(token, method, url, body) {
  const res = await context.request.fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
  return res.json();
}

const browser = await chromium.launch({ headless: !args.headed });
const context = await browser.newContext({
  baseURL: baseUrl,
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: "en-US",
  // Self-hosted instances often run on a self-signed certificate.
  ignoreHTTPSErrors: true,
});
// English UI and an expanded sidebar, whatever this browser profile last had.
await context.addInitScript(() => {
  localStorage.setItem("thingport_language", "en");
  localStorage.setItem("thingport_sidebar_collapsed", "false");
});
const page = await context.newPage();

let token = null;
let originalTheme;
let originalView;
try {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).waitFor();
  token = await page.evaluate(() => localStorage.getItem("thingport_auth_token"));
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem("thingport_auth_user"))) || "{}");
  const displayName = user.display_name || user.displayName;
  if (!token || !displayName) throw new Error("Signed in, but couldn't read the session from the page");

  originalTheme = (await api(token, "GET", "/settings/theme")).theme;
  // The models page shows the category tree, not folders.
  originalView = (await api(token, "GET", "/settings/categories-view")).view;
  await api(token, "PATCH", "/settings/categories-view", { view: "categories" });

  const ctx = { displayName };
  for (const theme of themes) {
    await api(token, "PATCH", "/settings/theme", { theme });
    await page.emulateMedia({ colorScheme: theme });
    fs.mkdirSync(path.join(outDir, theme), { recursive: true });
    for (const shot of shots.filter((s) => !s.guide || theme === themes[0])) {
      process.stdout.write(`${theme}/${shot.name}... `);
      await page.setViewportSize(VIEWPORT);
      const result = await shot.run(page, ctx);
      if (!result?.saved) {
        // Off the page, so no tooltip shows up under the pointer.
        await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
        await settle(page);
        await blurEmails(page);
        await blurLocation(page);
        await page.screenshot({ path: path.join(outDir, theme, `${shot.name}.png`) });
      }
      console.log("done");
      // Twice: a dialog can open over another one.
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
    }
  }
  console.log(`Saved to ${outDir}`);
} finally {
  if (token && originalTheme !== undefined) {
    await api(token, "PATCH", "/settings/theme", { theme: originalTheme }).catch((err) =>
      console.error(`Couldn't restore the account's theme (${originalTheme}): ${err.message}`),
    );
  }
  if (token && originalView !== undefined) {
    await api(token, "PATCH", "/settings/categories-view", { view: originalView }).catch((err) =>
      console.error(`Couldn't restore the Categories/Folders choice (${originalView}): ${err.message}`),
    );
  }
  await browser.close();
}
