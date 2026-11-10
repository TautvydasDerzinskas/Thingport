#!/usr/bin/env node
// Captures the README and website screenshots from a running instance with a populated library, each in the light and
// the dark theme: frontend/src/assets/screenshots/light/*.png and dark/*.png. The extension's screenshots aren't covered.
//
//   npm --prefix regression run screenshots -- --url https://thingport.example --email me@example.com \
//     --model <id> --quality-model <id>
//
// The password comes from THINGPORT_PASSWORD (or --password). Options, also settable as env vars:
//   --url                   THINGPORT_URL                    instance to capture (required)
//   --email                 THINGPORT_EMAIL                  admin account to sign in with (required)
//   --password              THINGPORT_PASSWORD
//   --model                 SCREENSHOT_MODEL                 id of the model for the details and 3D preview shots
//   --quality-model         SCREENSHOT_QUALITY_MODEL         id of a model whose print quality check found problems
//   --generative-model      SCREENSHOT_GENERATIVE_MODEL      a model that came with its script; default the first one
//   --synced-collection     SCREENSHOT_SYNCED_COLLECTION     a synced collection; default the first one
//   --ai-description-model  SCREENSHOT_AI_DESCRIPTION_MODEL  a model whose description AI rewrote; skipped without one
//   --studio-design         SCREENSHOT_STUDIO_DESIGN         a Studio design Ask AI built; default the one edited last
//   --profiles-model        SCREENSHOT_PROFILES_MODEL        a model with print profiles and a licence, both read already
//   --license-model         SCREENSHOT_LICENSE_MODEL         a model whose licence was read, default --profiles-model
//   --connect-to            SCREENSHOT_CONNECT_TO            an instance's address for the Connect dialog (48), looked up only
//   --host-rules            SCREENSHOT_HOST_RULES            Chromium --host-resolver-rules, for names this machine can't resolve
//   --shared-collection     SCREENSHOT_SHARED_COLLECTION     a collection of the account's to show the sharing form on
//   --themes                SCREENSHOT_THEMES                comma-separated, default light,dark
//   --only                  SCREENSHOT_ONLY                  comma-separated shot names or numbers, e.g. 06,07
//   --out                   SCREENSHOT_OUT                   output folder, holding one folder per theme
//   --no-blur                                                leave addresses unblurred, on a demo instance whose
//                                                            handles (name@instance) are what the shots show
//   --headed                                                 show the browser
//
// The account's theme, Categories/Folders choice and print profiles layout are switched for the shots and restored
// afterwards, and so are social features, which are on for the run so the sidebar has Explore and Chats and
// Administration -> Social shows them on. Nothing is changed in the library: the merge and download dialogs are only
// opened, and System Health's full test only checks connections. Email addresses on the page are blurred. The import
// queue's rows are made up and answered in the browser, so nothing is queued on the instance, and so are Explore (the
// library's own models, shown as shared by made-up people) and who the sharing form's collection is shared with. The
// Studio prompt layout is switched for its shot and restored afterwards.
//
// The connected-instances shots (43-49) need a partner instance, and are skipped without one: 43-45 and 48 are taken
// on the instance that connects from home, as its admin, 46, 47 and 49 on the one it connects to. 48 looks up
// --connect-to and 49 reviews a waiting request, so those two come before the request is approved. On a partner
// reached over a link, 48's lookup is shown suggesting the link and 47's Public URL as confirmed, answered in the
// browser, as a demo pair on one machine sees itself as local.
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
    "generative-model": { type: "string" },
    "synced-collection": { type: "string" },
    "ai-description-model": { type: "string" },
    "studio-design": { type: "string" },
    "profiles-model": { type: "string" },
    "license-model": { type: "string" },
    "shared-collection": { type: "string" },
    "connect-to": { type: "string" },
    "host-rules": { type: "string" },
    themes: { type: "string" },
    only: { type: "string" },
    out: { type: "string" },
    "no-blur": { type: "boolean", default: false },
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
const optionalIds = {
  generativeModel: args["generative-model"] || process.env.SCREENSHOT_GENERATIVE_MODEL,
  syncedCollection: args["synced-collection"] || process.env.SCREENSHOT_SYNCED_COLLECTION,
  aiDescriptionModel: args["ai-description-model"] || process.env.SCREENSHOT_AI_DESCRIPTION_MODEL,
  studioDesign: args["studio-design"] || process.env.SCREENSHOT_STUDIO_DESIGN,
  profilesModel: args["profiles-model"] || process.env.SCREENSHOT_PROFILES_MODEL,
  sharedCollection: args["shared-collection"] || process.env.SCREENSHOT_SHARED_COLLECTION,
};
optionalIds.connectTo = args["connect-to"] || process.env.SCREENSHOT_CONNECT_TO;
const hostRules = args["host-rules"] || process.env.SCREENSHOT_HOST_RULES;
optionalIds.licenseModel = args["license-model"] || process.env.SCREENSHOT_LICENSE_MODEL || optionalIds.profilesModel;
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

// What the import queue shot shows. An empty queue says nothing, and a real one would have to run on the instance.
function queueAnswers(displayName) {
  const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
  const you = { id: "you", display_name: displayName, email: "" };
  const alex = { id: "alex", display_name: "Alex Morgan", email: "" };
  const sam = { id: "sam", display_name: "Sam Rivera", email: "" };
  const job = (id, owner, source_label, fields) => ({
    id,
    owner,
    source_label,
    source_url: `https://example.com/${id}`,
    type: "LINKS",
    total: 1,
    created_at: ago(12),
    updated_at: ago(2),
    can_delete: true,
    ...fields,
  });
  const inLine = (position, fields) => ({
    status: "QUEUED",
    position,
    can_pause: true,
    created_at: ago(position),
    ...fields,
  });
  const onHold = (fields) => ({ status: "PAUSED", can_start: true, ...fields });
  const running = job("wall-mounts", you, "Workshop wall mounts", {
    status: "RUNNING",
    provider: "makerworld",
    total: 12,
    processed: 5,
    imported: 5,
    pending_count: 7,
    done_count: 5,
    started_at: ago(6),
    can_pause: true,
    can_delete: false,
  });
  const planters = job(
    "planters",
    you,
    "Favourite planters",
    inLine(3, { type: "COLLECTION", provider: "makerworld", total: 24 }),
  );
  return {
    own: {
      jobs: [running, planters],
      finished_total: 0,
      line: {
        now: { mine: true, person: "you", job_id: running.id },
        rows: [
          { position: 1, mine: false, person: "alex", job_id: null },
          { position: 2, mine: false, person: "sam", job_id: null },
          { position: 3, mine: true, person: "you", job_id: planters.id },
        ],
        length: 3,
      },
      settings: { start_grab_links: false },
    },
    everyone: {
      jobs: [
        running,
        job("dragon", alex, "Articulated dragon", inLine(1, { single: true, provider: "printables" })),
        job("organiser", sam, "Desk organiser set", inLine(2, { provider: "thingiverse", total: 8, pending_count: 8 })),
        planters,
        job(
          "grab-links",
          alex,
          "Sent from Thingport Grab",
          onHold({ provider: "makerworld", total: 3, pending_count: 3 }),
        ),
        job("tool-holders", sam, "Tool holders", onHold({ single: true, provider: "printables", queued_at: ago(30) })),
        job("gearbox", sam, "Planetary gearbox", {
          status: "DONE",
          single: true,
          provider: "thingiverse",
          failed_count: 1,
          attention: true,
          can_retry: true,
          failure_reason: "The model's page answered 404.",
        }),
        job("cable-clips", alex, "Cable clips", { status: "DONE", provider: "makerworld", imported: 1, processed: 1 }),
        job("hooks", you, "Pegboard hooks", {
          status: "DONE",
          provider: "printables",
          total: 9,
          processed: 9,
          imported: 9,
          updated_at: ago(90),
        }),
      ],
    },
  };
}

// What the Explore shot shows: the library's own models and collections, as two made-up people's shares.
async function exploreAnswers(api) {
  const alex = { id: "alex", display_name: "Alex Morgan", avatar_url: null };
  const sam = { id: "sam", display_name: "Sam Rivera", avatar_url: null };
  const models = (await api("GET", "/prints?limit=40")).filter((m) => m.preview_images?.length);
  const collections = (await api("GET", "/collections")).filter((c) => !c.tool_id && !c.system_key && c.item_count > 3);
  const owned = (list, i) => ({ ...list, owner: i % 3 === 2 ? sam : alex });
  const shared = collections
    .slice(4, 7)
    .map((collection, i) => ({ ...owned(collection, i + 1), visibility: "shared" }));
  return {
    shared_with_you: shared,
    shared_with_you_total: shared.length,
    people: [
      { ...alex, collection_count: 3, model_count: 41 },
      { ...sam, collection_count: 2, model_count: 17 },
    ],
    recent_models: models.slice(0, 10).map(owned),
    recent_collections: collections.slice(0, 4).map(owned),
    most_collected: models.slice(10, 15).map((model, i) => ({ model: owned(model, i), copies: 4 - (i % 3) })),
  };
}

/** What partner instances share on this one's Explore. */
async function partnerContent(ctx) {
  const overview = await ctx.api("GET", "/explore").catch(() => null);
  return { models: overview?.elsewhere?.recent_models ?? [], people: overview?.elsewhere?.people ?? [] };
}

/** The partner instances this one is connected with. */
async function partners(ctx) {
  const instances = await ctx.api("GET", "/federation/instances").catch(() => null);
  return instances?.partners ?? [];
}

/** This instance's Public URL shown as confirmed by a partner, as it is on a real one on the internet. */
async function confirmedPublicUrl(page) {
  await page.route(/\/api\/federation\/settings$/, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const reachability = { ...json.reachability, kind: "public", reason: null, detail: null };
    await route.fulfill({ response, json: { ...json, reachability, confirmedBy: Math.max(1, json.confirmedBy ?? 0) } });
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
    run: async (page, ctx) => {
      // Print profiles as most people see them: the default picker.
      await ctx.api("PATCH", "/settings/print-profiles-view", { view: "picker" });
      await open(page, `/models/${modelId}`);
    },
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
      await selectFirst(page, "Select tags", 4);
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
  // The rest of Administration, for the website's page about it.
  { name: "22_admin_auth", run: (page) => open(page, "/admin-auth") },
  { name: "23_admin_users", run: (page) => open(page, "/admin-users") },
  {
    name: "24_admin_queue",
    run: async (page, ctx) => {
      const { own, everyone } = queueAnswers(ctx.displayName);
      await page.route(/\/api\/import\/queue$/, (route) => route.fulfill({ json: own }));
      await page.route(/\/api\/admin\/import-queue\?queue=1$/, (route) => route.fulfill({ json: everyone }));
      await open(page, "/admin");
      // From the top bar, which leaves this page behind the dialog, where the /admin-queue address has the dashboard.
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await page.getByRole("dialog", { name: "Add" }).getByRole("button", { name: "Open", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("group", { name: "Whose imports" })
        .getByRole("button", { name: "Everyone" })
        .click();
      const dialog = page.getByRole("dialog", { name: "Server import queue" });
      await dialog
        .getByRole("button", { name: /^Waiting/ })
        .first()
        .click();
      await dialog.getByRole("article").first().waitFor();
    },
  },
  { name: "25_admin_logs", run: (page) => open(page, "/admin-logs") },
  { name: "27_admin_connections", run: (page) => open(page, "/admin-connections") },
  { name: "28_admin_rendering", run: (page) => open(page, "/admin-rendering") },
  { name: "29_admin_captcha", run: (page) => open(page, "/admin-captcha") },
  { name: "30_admin_tools", run: (page) => open(page, "/admin-tools") },
  {
    name: "31_tools",
    run: async (page) => {
      await open(page, "/tools");
      await page.getByRole("heading", { name: "Tools", exact: true }).waitFor();
    },
  },
  {
    name: "32_tool_window",
    run: async (page) => {
      await open(page, "/tools");
      await page.getByRole("button", { name: /^QR code generator:/ }).dblclick();
      await page.getByRole("dialog").waitFor();
      // The tool draws its first code once its script has loaded.
      await settle(page, 1500);
    },
  },
  {
    name: "33_my_models",
    run: async (page) => {
      // A profile with links under its bio, answered in the browser, so the account's own aren't changed.
      await page.route(/\/api\/me$/, async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        if (json.user && !json.user.links?.length) {
          json.user.links = ["https://github.com/TautvydasDerzinskas/Thingport", "https://thingport.net"];
        }
        await route.fulfill({ response, json });
      });
      await open(page, "/authors/self");
    },
  },
  {
    name: "34_models_filters",
    run: async (page) => {
      await open(page, "/models");
      await page.getByRole("button", { name: "Filters" }).click();
      await page.locator(".MuiPopover-paper, .MuiMenu-paper").first().waitFor();
    },
  },
  {
    name: "35_model_customize",
    optional: "generativeModel",
    run: async (page, ctx) => {
      await open(page, `/models/${ctx.generativeModel}`);
      // Named exactly: a model may also carry a tag called "Customize", whose chip is a button earlier in the page.
      await page.getByRole("button", { name: "Customize…", exact: true }).click();
      // A model that came with several scripts asks which one first.
      const pick = page.getByRole("dialog").filter({ hasText: "Which script?" });
      if (await pick.isVisible().catch(() => false)) await pick.getByRole("button").first().click();
      // An empty stage says nothing about what the parameters do, so it is generated before the shot. The button reads
      // "Generating…" until the model is on the stage; "Generated in" alone may be left over from an earlier run.
      const generate = page.getByRole("button", { name: "Generate", exact: true });
      await generate.waitFor({ timeout: 120000 });
      await generate.click();
      await page
        .getByRole("button", { name: /^Generating/ })
        .waitFor({ timeout: 5000 })
        .catch(() => undefined);
      await generate
        .and(page.locator(":enabled"))
        .waitFor({ timeout: 180000 })
        .catch(() => console.warn("  nothing generated in time; the stage may be empty"));
      await settle(page, 1500);
    },
  },
  {
    name: "36_collection_sync",
    optional: "syncedCollection",
    run: async (page, ctx) => {
      await open(page, `/models/collections/${ctx.syncedCollection}`);
      await page.getByRole("button", { name: /Sync configuration$/ }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "37_ai_model",
    run: async (page) => {
      await open(page, "/admin-ai");
      // A click only selects the card; a double click opens its editor, as in a file manager.
      await page.getByRole("button", { name: /default AI$/ }).dblclick();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "38_ai_categorization",
    run: async (page) => {
      await open(page, "/admin-ai");
      await page.getByRole("button", { name: "AI Categorization settings" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "39_ai_description_compare",
    optional: "aiDescriptionModel",
    run: async (page, ctx) => {
      await open(page, `/models/${ctx.aiDescriptionModel}`);
      await page.getByRole("button", { name: /^Description by AI/ }).click();
      await page.getByRole("menuitem", { name: "Compare with the original" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    name: "40_system_health",
    run: async (page) => {
      // Tall enough for every part of the check, as the System Health guide shows it.
      await page.setViewportSize({ width: VIEWPORT.width, height: 1500 });
      await open(page, "/admin");
      const run = page.getByRole("button", { name: "Run full test" });
      await run.click();
      // Disabled while any part is still being tested; the slowest gives up after its own timeout.
      await run
        .and(page.locator(":disabled"))
        .waitFor({ timeout: 5000 })
        .catch(() => undefined);
      await run
        .and(page.locator(":enabled"))
        .waitFor({ timeout: 90000 })
        .catch(() => console.warn("  the full test was still running"));
    },
  },
  // The guides' cut-outs, saved next to the guides rather than with the README shots.
  {
    name: "41_studio",
    optional: "studioDesign",
    run: async (page, ctx) => {
      // The conversation beside the design rather than over it.
      await ctx.api("PATCH", "/studio/settings", { prompt_layout: "panel" });
      await open(page, `/studio?design=${encodeURIComponent(ctx.studioDesign)}`);
      await page.getByRole("button", { name: "Edit design" }).waitFor({ timeout: 30000 });
      // The bodies are built in a worker once the design arrives, and the camera eases onto them.
      await page.locator("canvas").first().waitFor();
      await page.waitForTimeout(3000);
      // The picker shows the AI that wrote the conversation's last answer, so the two agree.
      const thread = await ctx.api("GET", `/studio/designs/${encodeURIComponent(ctx.studioDesign)}/assistant`);
      const model = thread.messages.findLast((message) => message.role === "assistant")?.model;
      const picker = page.getByRole("combobox", { name: "AI model" });
      if (model && (await picker.isVisible().catch(() => false))) {
        await picker.click();
        const option = page.getByRole("option", { name: model }).first();
        if (await option.isVisible().catch(() => false)) await option.click();
        else await page.keyboard.press("Escape");
      }
    },
  },
  {
    name: "42_explore",
    run: async (page, ctx) => {
      const overview = await exploreAnswers(ctx.api);
      await page.route(/\/api\/social$/, (route) =>
        route.fulfill({ json: { enabled: true, explore: true, chats: true } }),
      );
      await page.route(/\/api\/explore$/, (route) => route.fulfill({ json: overview }));
      // Chats is in the sidebar beside Explore; an empty count keeps it from asking the instance.
      await page.route(/\/api\/chats\/unread/, (route) => route.fulfill({ json: { unread: 0, latest: null } }));
      await open(page, "/explore");
      await page.getByText("Alex Morgan").first().waitFor();
    },
  },
  {
    name: "43_explore_everywhere",
    run: async (page, ctx) => {
      if (!(await partnerContent(ctx)).models.length) return { skip: "no partner's models on Explore" };
      await open(page, "/explore");
      await page.getByRole("button", { name: "Everywhere" }).first().waitFor();
    },
  },
  {
    name: "44_partner_model",
    run: async (page, ctx) => {
      const { models } = await partnerContent(ctx);
      const model = models.find((m) => /vase/i.test(m.name ?? m.title ?? "")) ?? models[0];
      if (!model) return { skip: "no partner's models on Explore" };
      await open(page, `/explore/elsewhere/models/${encodeURIComponent(model.id)}`);
      await page
        .getByRole("button", { name: /^Copy to my library|^Open my copy/ })
        .first()
        .waitFor();
    },
  },
  {
    name: "45_partner_profile",
    run: async (page, ctx) => {
      const { people } = await partnerContent(ctx);
      const person = people.find((p) => p.model_count > 0) ?? people[0];
      if (!person) return { skip: "no partner's people on Explore" };
      await open(page, `/explore/elsewhere/people/${encodeURIComponent(person.id)}`);
      await page.getByRole("button", { name: "Message" }).first().waitFor();
    },
  },
  {
    name: "46_chat_partner",
    run: async (page, ctx) => {
      const chats = await ctx.api("GET", "/chats").catch(() => null);
      const list = Array.isArray(chats) ? chats : (chats?.chats ?? []);
      const room = list.find((c) => c.kind === "room" && (c.instances ?? 1) > 1);
      if (!room) return { skip: "no room with a partner's people in it" };
      await open(page, `/chats/${encodeURIComponent(room.id)}`);
      await page.getByPlaceholder(/^Message /).waitFor();
    },
  },
  {
    name: "47_admin_partners",
    run: async (page, ctx) => {
      if (!(await partners(ctx)).length) return { skip: "no partner instance" };
      await confirmedPublicUrl(page);
      await open(page, "/admin-social");
      await page
        .getByRole("button", { name: /^Partners/ })
        .or(page.getByRole("tab", { name: /^Partners/ }))
        .first()
        .click();
      await page
        .getByRole("button", { name: /^More for / })
        .first()
        .waitFor();
    },
  },
  {
    name: "48_connect_link",
    optional: "connectTo",
    run: async (page, ctx) => {
      // The other instance's lookup, shown suggesting the link a home instance keeps open.
      await page.route(/\/api\/federation\/lookup/, async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        await route.fulfill({ response, json: { ...json, suggestLink: "local" } });
      });
      await open(page, "/admin-social");
      await page.getByRole("button", { name: "Connect to an instance" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Its address").fill(ctx.connectTo);
      await dialog.getByRole("button", { name: "Look up" }).click();
      await dialog.getByText("The keys match").waitFor({ timeout: 20000 });
      await dialog.getByText("The keys match").click();
      await dialog.getByLabel("Note for their admin (optional)").fill("Hi from Sam's garage workshop!");
    },
  },
  {
    name: "49_request_link",
    run: async (page, ctx) => {
      const instances = await ctx.api("GET", "/federation/instances").catch(() => null);
      const request = instances?.incoming?.[0];
      if (!request) return { skip: "no request waiting" };
      // In its own dialog, as the admin's notification opens it.
      await open(page, `/admin-social?request=${encodeURIComponent(request.id)}`);
      await page
        .getByText(/ wants to connect$/)
        .first()
        .waitFor();
    },
  },
  {
    name: "50_model_print_profiles",
    optional: "profilesModel",
    run: async (page, ctx) => {
      await ctx.api("PATCH", "/settings/print-profiles-view", { view: "tiles" });
      await open(page, `/models/${ctx.profilesModel}`);
      await page
        .getByText(/^Print profiles? · \d+$/)
        .first()
        .waitFor();
    },
  },
  {
    name: "51_model_license",
    optional: "licenseModel",
    run: async (page, ctx) => {
      await ctx.api("PATCH", "/settings/print-profiles-view", { view: "picker" });
      await open(page, `/models/${ctx.licenseModel}`);
      const strip = page.getByRole("button", { name: /: licence details$/ });
      await strip.scrollIntoViewIfNeeded();
      await strip.click();
      await page.getByRole("button", { name: "Copy credit line" }).waitFor();
    },
  },
  {
    name: "52_collection_sharing",
    optional: "sharedCollection",
    run: async (page, ctx) => {
      // Shared with made-up people, answered in the browser: the form is only opened, never saved.
      const person = (id, display_name, username) => ({ id, display_name, username, avatar_url: null });
      const people = [
        person("alex", "Alex Morgan", "alex"),
        person("sam", "Sam Rivera", "sam"),
        person("lena", "Lena Fischer", "lena"),
      ];
      await page.route(/\/api\/collection\/[^/]+\/sharing$/, (route) =>
        route.fulfill({ json: { visibility: "shared", people, max_people: 100 } }),
      );
      await page.route(/\/api\/social\/people/, (route) => route.fulfill({ json: { people } }));
      await open(page, `/models/collections/${ctx.sharedCollection}`);
      await page.getByRole("button", { name: "More", exact: true }).first().click();
      await page.getByRole("menuitem", { name: "Share…" }).click();
      await page.getByRole("dialog").getByText("Sam Rivera").waitFor();
    },
  },
  { name: "53_admin_social", run: (page) => open(page, "/admin-social") },
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
      const menu = page.getByRole("dialog", { name: "Add" });
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

const browser = await chromium.launch({
  headless: !args.headed,
  args: hostRules ? [`--host-resolver-rules=${hostRules}`] : [],
});
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
  // A library that has lost files greets every visit with a dialog, which hides the page behind it from role queries.
  localStorage.setItem("thingport.missingFiles.dismissedAt", "999999");
  // A screenshot outlives the season it was taken in, so the logo is shown without its seasonal edition.
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = 'img[alt="Thingport"] + img[aria-hidden="true"] { display: none !important; }';
    document.head.append(style);
  });
});
const page = await context.newPage();

let token = null;
let originalTheme;
let originalView;
let originalLayout;
let originalProfilesView;
let originalSocial;
let failed = 0;
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
  originalProfilesView = (await api(token, "GET", "/settings/print-profiles-view")).view;
  // Explore and Chats in the sidebar, and switched on under Administration -> Social.
  const social = await api(token, "GET", "/social/settings");
  originalSocial = { enabled: social.enabled, chats: social.chats };
  await api(token, "PATCH", "/social/settings", { enabled: true, chats: true });
  // The models page shows the category tree, not folders.
  originalView = (await api(token, "GET", "/settings/categories-view")).view;
  await api(token, "PATCH", "/settings/categories-view", { view: "categories" });

  // Picked from the library when not given; there's no way to look up a model whose description AI rewrote.
  optionalIds.generativeModel ??= (await api(token, "GET", "/prints?generative=1&limit=1"))[0]?.id;
  optionalIds.syncedCollection ??= (await api(token, "GET", "/collections")).find((c) => c.sync)?.id;

  // The newest Studio design with something in it when none was named: the latest may be an empty one just opened.
  optionalIds.studioDesign ??= await api(token, "GET", "/studio/designs")
    .then((designs) => designs.find((design) => design.feature_count > 0)?.id)
    .catch(() => undefined);
  if (shots.some((shot) => shot.name === "41_studio")) {
    originalLayout = await api(token, "GET", "/studio/settings")
      .then((settings) => settings.prompt_layout)
      .catch(() => undefined);
    // The shot changes the layout, so without one to put back it isn't taken.
    if (originalLayout === undefined) optionalIds.studioDesign = undefined;
  }

  const ctx = { displayName, ...optionalIds, api: (method, url, body) => api(token, method, url, body) };
  for (const theme of themes) {
    await api(token, "PATCH", "/settings/theme", { theme });
    await page.emulateMedia({ colorScheme: theme });
    fs.mkdirSync(path.join(outDir, theme), { recursive: true });
    for (const shot of shots.filter((s) => !s.guide || theme === "light")) {
      process.stdout.write(`${theme}/${shot.name}... `);
      if (shot.optional && !ctx[shot.optional]) {
        console.log("skipped, nothing to show it with");
        continue;
      }
      // One shot that can't be taken shouldn't cost the rest of a long run.
      try {
        await page.setViewportSize(VIEWPORT);
        const result = await shot.run(page, ctx);
        if (result?.skip) {
          console.log(`skipped, ${result.skip}`);
          continue;
        }
        if (!result?.saved) {
          // Off the page, so no tooltip shows up under the pointer.
          await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
          await settle(page);
          if (!args["no-blur"]) await blurEmails(page);
          await blurLocation(page);
          await page.screenshot({ path: path.join(outDir, theme, `${shot.name}.png`) });
        }
        console.log("done");
      } catch (err) {
        failed++;
        console.log(`failed: ${err.message.split("\n")[0]}`);
      }
      // Twice: a dialog can open over another one.
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  }
  console.log(`Saved to ${outDir}${failed ? `; ${failed} failed` : ""}`);
  if (failed) process.exitCode = 1;
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
  if (token && originalProfilesView !== undefined) {
    await api(token, "PATCH", "/settings/print-profiles-view", { view: originalProfilesView }).catch((err) =>
      console.error(`Couldn't restore the print profiles layout (${originalProfilesView}): ${err.message}`),
    );
  }
  if (token && originalSocial !== undefined) {
    await api(token, "PATCH", "/social/settings", originalSocial).catch((err) =>
      console.error(`Couldn't restore social features (${JSON.stringify(originalSocial)}): ${err.message}`),
    );
  }
  if (token && originalLayout !== undefined) {
    await api(token, "PATCH", "/studio/settings", { prompt_layout: originalLayout }).catch((err) =>
      console.error(`Couldn't restore the Studio prompt layout (${originalLayout}): ${err.message}`),
    );
  }
  // Each run signs in afresh, so without this every run would leave a session behind on the account.
  if (token) {
    await context.request
      .post(`${baseUrl}/api/logout`, { headers: { Authorization: `Bearer ${token}` } })
      .catch(() => undefined);
  }
  await browser.close();
}
