#!/usr/bin/env node
// Captures the README and website screenshots (frontend/src/assets/screenshots) from a running
// instance with a populated library. The extension's screenshots aren't covered.
//
//   npm --prefix regression run screenshots -- --url https://thingport.example --email me@example.com
//
// The password comes from THINGPORT_PASSWORD (or --password). Options, also settable as env vars:
//   --url       THINGPORT_URL       instance to capture (required)
//   --email     THINGPORT_EMAIL     account to sign in with (required)
//   --password  THINGPORT_PASSWORD
//   --model     SCREENSHOT_MODEL    search text picking the model for the details and 3D shots
//   --collection SCREENSHOT_COLLECTION  name of the synced collection for the sync shot (default: the largest)
//   --only      SCREENSHOT_ONLY     comma-separated shot names or numbers, e.g. 03,04
//   --out       SCREENSHOT_OUT      output folder
//   --headed                        show the browser
//
// The account's theme and Categories/Folders choice are switched for the shots and restored afterwards.
//
// The administration, AI and single sign-on shots (13 onwards) need an admin account, at least one AI model with
// both AI features on and some suggestions waiting, and an OIDC provider that's switched on and connected to the
// account. Email addresses on the page are blurred.
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
    collection: { type: "string" },
    only: { type: "string" },
    out: { type: "string" },
    headed: { type: "boolean", default: false },
  },
});

const baseUrl = (args.url || process.env.THINGPORT_URL || "").replace(/\/+$/, "");
const email = args.email || process.env.THINGPORT_EMAIL;
const password = args.password || process.env.THINGPORT_PASSWORD;
const modelQuery = args.model || process.env.SCREENSHOT_MODEL || "Adjustable Telescopic Wall Hook";
const collectionName = args.collection || process.env.SCREENSHOT_COLLECTION;
const outDir = path.resolve(
  args.out || process.env.SCREENSHOT_OUT || path.join(here, "../frontend/src/assets/screenshots"),
);
const only = (args.only || process.env.SCREENSHOT_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

// Opening menus can nudge the page; the shots should start at the top.
async function scrollToTop(page) {
  await page.evaluate(() => {
    for (const el of [document.scrollingElement, ...document.querySelectorAll("*")]) {
      if (el && el.scrollTop) el.scrollTop = 0;
    }
  });
}

async function openUserMenu(page, displayName) {
  await page.getByRole("button", { name: displayName }).click();
  await page.getByRole("menuitem", { name: "Configuration" }).waitFor();
}

async function openConfiguration(page, displayName, tab) {
  await openUserMenu(page, displayName);
  await page.getByRole("menuitem", { name: "Configuration" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: tab, exact: true }).click();
  return dialog;
}

// Other people's addresses (Users, Logs) and the account's own shouldn't end up in published screenshots.
async function blurEmails(page) {
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(node.textContent ?? "") && node.parentElement) {
        node.parentElement.style.filter = "blur(5px)";
      }
    }
  });
}

async function openAdmin(page, path) {
  await page.goto(path);
  await settle(page, 0);
}

/** Opens an AI feature's dialog from its tile on the AI page, on the given tab. */
async function openAiFeature(page, feature, tab) {
  await openAdmin(page, "/admin-ai");
  await page.getByRole("button", { name: `${feature} settings`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  if (tab) await dialog.getByRole("button", { name: tab, exact: true }).click();
  await settle(page);
  return dialog;
}

const SHOTS = [
  {
    name: "01_dashboard",
    run: async (page) => {
      await page.goto("/");
      await settle(page, 0);
      // The weather card names the account's saved location; blur it.
      await page.evaluate(() => {
        for (const button of document.querySelectorAll('button[aria-label="Change location"]')) {
          const name = button.previousElementSibling;
          if (name instanceof HTMLElement) name.style.filter = "blur(5px)";
        }
      });
    },
  },
  {
    name: "02_models",
    run: async (page) => {
      await page.goto("/models");
    },
  },
  {
    name: "03_model_details",
    needsModel: true,
    run: async (page, ctx) => {
      await page.goto(`/models/${ctx.modelId}`);
    },
  },
  {
    name: "04_model_details_3d_preview",
    needsModel: true,
    run: async (page, ctx) => {
      await page.goto(`/models/${ctx.modelId}`);
      await settle(page);
      await page.getByRole("button", { name: "3D Preview" }).click();
      await page.locator("canvas").first().waitFor();
      // The model streams in and the camera eases to fit it.
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(4000);
    },
  },
  {
    name: "05_collections",
    run: async (page) => {
      await page.goto("/models/collections");
    },
  },
  {
    name: "12_collection_sync",
    needsSyncedCollection: true,
    run: async (page, ctx) => {
      await page.goto(`/models/collections/${ctx.syncedCollectionId}`);
      await settle(page, 0);
      await page.getByRole("button", { name: /Sync configuration$/ }).click();
      await page.getByRole("dialog").waitFor();
      // Lets the chain's pulse get going.
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "06_tags",
    run: async (page) => {
      await page.goto("/models/tags");
    },
  },
  {
    name: "07_downloads",
    run: async (page) => {
      await page.goto("/downloads");
    },
  },
  {
    name: "08_my_models",
    run: async (page, ctx) => {
      await page.goto("/");
      await settle(page, 0);
      await openUserMenu(page, ctx.displayName);
      await page.getByRole("menuitem", { name: "My models" }).click();
      await settle(page);
      await openUserMenu(page, ctx.displayName);
      await scrollToTop(page);
    },
  },
  {
    name: "09_dark_theme",
    run: async (page, ctx) => {
      await page.goto("/models");
      await settle(page, 0);
      const dialog = await openConfiguration(page, ctx.displayName, "Appearance");
      await dialog.getByRole("button", { name: "Dark", exact: true }).click();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await settle(page, 0);
      await openUserMenu(page, ctx.displayName);
      await scrollToTop(page);
    },
  },
  {
    name: "10_profile",
    run: async (page) => {
      await page.goto("/profile");
      await page
        .getByText(/activit(y|ies) in /)
        .first()
        .waitFor();
    },
  },
  {
    name: "11_configuration_providers",
    run: async (page, ctx) => {
      await page.goto("/models");
      await settle(page, 0);
      await openConfiguration(page, ctx.displayName, "Providers");
    },
  },
  { name: "13_admin_overview", run: (page) => openAdmin(page, "/admin") },
  { name: "14_admin_providers", run: (page) => openAdmin(page, "/admin-providers") },
  { name: "15_admin_storage", run: (page) => openAdmin(page, "/admin-storage") },
  {
    name: "16_admin_auth",
    run: async (page) => {
      await openAdmin(page, "/admin-auth");
      // The sign-in methods, with any OIDC providers, at the top rather than just peeking in at the bottom.
      await page.getByText("Sign-in Methods", { exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
    },
  },
  { name: "17_admin_ai", run: (page) => openAdmin(page, "/admin-ai") },
  {
    name: "18_admin_users",
    run: async (page) => {
      await openAdmin(page, "/admin-users");
      await blurEmails(page);
    },
  },
  {
    name: "19_admin_logs",
    run: async (page) => {
      await openAdmin(page, "/admin-logs");
      await blurEmails(page);
    },
  },
  {
    name: "20_ai_add_model",
    run: async (page) => {
      await openAdmin(page, "/admin-ai");
      // The default model's own settings, so the form is filled in and its model list loads.
      await page.getByLabel(/, default AI$/).dblclick();
      await page.getByRole("dialog").waitFor();
    },
  },
  { name: "21_ai_categorization_settings", run: (page) => openAiFeature(page, "AI Categorization", "Settings") },
  { name: "22_ai_suggestions", run: (page) => openAiFeature(page, "AI Categorization", "Manage") },
  {
    name: "23_ai_description_compare",
    run: async (page) => {
      const dialog = await openAiFeature(page, "Improved descriptions", "Manage");
      await dialog.getByRole("button", { name: "Compare", exact: true }).first().click();
      // The dialog underneath is hidden from the accessibility tree while this one is open.
      await page.getByRole("dialog").filter({ hasText: "Original" }).waitFor();
    },
  },
  {
    name: "24_oidc_provider_dialog",
    run: async (page) => {
      await openAdmin(page, "/admin-auth");
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "25_sign_in_sso",
    run: async (page) => {
      // Signed out, in a context of its own, so the session used for the other shots stays.
      const signedOut = await browser.newContext(contextOptions);
      const other = await signedOut.newPage();
      try {
        await other.goto("/");
        await other
          .getByRole("link", { name: /^Continue with / })
          .first()
          .waitFor();
        await settle(other);
        await other.screenshot({ path: path.join(outDir, "25_sign_in_sso.png") });
      } finally {
        await signedOut.close();
      }
      return { saved: true };
    },
  },
  {
    name: "26_profile_sign_in",
    run: async (page) => {
      await page.goto("/profile");
      await settle(page, 0);
      await page
        .getByText(/^Connected as |^Connected$|Not connected\. Connect it/)
        .first()
        .scrollIntoViewIfNeeded();
      await blurEmails(page);
    },
  },
  { name: "27_admin_import_queue", run: (page) => openAdmin(page, "/admin-queue") },
  { name: "28_admin_connections", run: (page) => openAdmin(page, "/admin-connections") },
  { name: "29_admin_rendering", run: (page) => openAdmin(page, "/admin-rendering") },
  { name: "30_admin_captcha", run: (page) => openAdmin(page, "/admin-captcha") },
  {
    name: "32_system_health",
    run: async (page) => {
      await openAdmin(page, "/admin");
      await page.getByRole("button", { name: "Run full test" }).click();
      // Disabled while the checks run; FlareSolverr and a local AI model can take a while to answer.
      await page.waitForFunction(
        () => {
          const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Run full test"));
          return button && !button.disabled;
        },
        null,
        { timeout: 120000 },
      );
      // Taller, so every part fits under the heading.
      await page.setViewportSize({ width: VIEWPORT.width, height: 1500 });
      await page.getByText("System Health", { exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
    },
  },
  {
    name: "31_admin_triggers",
    run: async (page) => {
      await openAdmin(page, "/admin-triggers");
      await blurEmails(page);
    },
  },
];

function wanted(shot) {
  if (!only.length) return true;
  return only.some((o) => shot.name === o || shot.name.startsWith(`${o}_`) || shot.name.split("_")[0] === o);
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
const contextOptions = {
  baseURL: baseUrl,
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  locale: "en-US",
  colorScheme: "light",
  // Self-hosted instances often run on a self-signed certificate.
  ignoreHTTPSErrors: true,
};
const context = await browser.newContext(contextOptions);
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
  await api(token, "PATCH", "/settings/theme", { theme: "light" });
  // The models page shows the category tree, not folders.
  originalView = (await api(token, "GET", "/settings/categories-view")).view;
  await api(token, "PATCH", "/settings/categories-view", { view: "categories" });
  await page.reload();

  const found = await api(token, "GET", `/prints?q=${encodeURIComponent(modelQuery)}&limit=1`);
  const modelId = found[0]?.id;
  if (!modelId && SHOTS.some((shot) => wanted(shot) && shot.needsModel)) {
    throw new Error(`No model matches "${modelQuery}"; pick one with --model`);
  }

  const synced = (await api(token, "GET", "/collections"))
    .filter((c) => c.sync && (!collectionName || c.name === collectionName))
    .toSorted((a, b) => b.item_count - a.item_count);
  const syncedCollectionId = synced[0]?.id;
  if (!syncedCollectionId && SHOTS.some((shot) => wanted(shot) && shot.needsSyncedCollection)) {
    throw new Error(`No synced collection${collectionName ? ` named "${collectionName}"` : ""}; sync one with Grab`);
  }

  const ctx = { displayName, modelId, syncedCollectionId };
  for (const shot of SHOTS.filter(wanted)) {
    process.stdout.write(`${shot.name}... `);
    // 09 switches to dark through the UI, which saves it to the account.
    await api(token, "PATCH", "/settings/theme", { theme: "light" });
    await page.setViewportSize(VIEWPORT);
    const result = await shot.run(page, ctx);
    if (!result?.saved) {
      await settle(page);
      await page.screenshot({ path: path.join(outDir, `${shot.name}.png`) });
    }
    console.log("done");
    // Twice: a dialog can open over another one.
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.keyboard.press("Escape").catch(() => undefined);
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
