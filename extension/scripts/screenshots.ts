// Regenerates the README screenshots in docs/screenshots/ from the built Chrome extension:
//
//   npm run screenshots
//
// Opens a visible Chromium window (Printables' Cloudflare check turns headless browsers away) with
// dist/chrome loaded, and serves a mock Thingport instance on localhost. The provider pages are the
// live sites: the first model linked from each front page, unless given explicitly, e.g.
//
//   npm run screenshots -- --makerworld=https://makerworld.com/en/models/123 --printables=...
//
// The collection shots use fixed collections, changeable with --printables-collection=<url>,
// --makerworld-collection=<url> and --myminifactory-collection=<url>. --only=<names> refreshes just those shots, e.g.
// --only=collection-printables,collection-makerworld.
//
// Needs Playwright's Chromium once: `npx playwright install chromium`.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright";
import type { BatchEntriesResult } from "../src/shared/api";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_DIR = path.join(ROOT, "dist", "chrome");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const PAGE_VIEWPORT = { width: 1280, height: 800 };
const DEMO_HOST = "thingport.home.arpa";
const POPUP_WIDTH = 320;
const NEW_COLLECTION_NAME = "Desk organizers";
const PRINTABLES_COLLECTION = "https://www.printables.com/@Thinkable/collections/342542";
const MAKERWORLD_COLLECTION = "https://makerworld.com/en/collections/15756490-little-coin";
// Free models, so the shots never need a MyMiniFactory account with purchases.
const MYMINIFACTORY_COLLECTION =
  "https://www.myminifactory.com/users/Scan%20The%20World/collection/egyptian-collection";

type ProviderName = "makerworld" | "thingiverse" | "printables" | "myminifactory" | "crealitycloud";
// `fixed`: always this model, unless one's given. MyMiniFactory's front page is mostly paid miniatures, some not
// safe for work. `lightOnly`: the site has no dark theme to shoot.
const PROVIDERS: {
  name: ProviderName;
  label: string;
  home: string;
  modelLink: RegExp;
  fixed?: string;
  lightOnly?: boolean;
}[] = [
  {
    name: "makerworld",
    label: "MakerWorld",
    home: "https://makerworld.com/en",
    modelLink: /^https:\/\/makerworld\.com\/[a-z-]+\/models\/\d+/,
  },
  {
    name: "thingiverse",
    label: "Thingiverse",
    home: "https://www.thingiverse.com/",
    modelLink: /^https:\/\/www\.thingiverse\.com\/thing:\d+$/,
    lightOnly: true,
  },
  {
    name: "printables",
    label: "Printables",
    home: "https://www.printables.com/",
    modelLink: /^https:\/\/www\.printables\.com\/model\/\d+-[^/?#]+$/,
  },
  {
    name: "myminifactory",
    label: "MyMiniFactory",
    home: "https://www.myminifactory.com/",
    modelLink: /^https:\/\/www\.myminifactory\.com\/object\/3d-print-[^/?#]+-\d+$/,
    fixed: "https://www.myminifactory.com/object/3d-print-funny-pen-holder-or-vase-skull-100000",
  },
  {
    name: "crealitycloud",
    label: "Creality Cloud",
    home: "https://www.crealitycloud.com/",
    modelLink: /^https:\/\/www\.crealitycloud\.com\/model-detail\/[^/?#]+$/,
  },
];

/** CORS is open, so the extension reaches it without a host permission. */
type MockState = { inspectTitle: string | null; batch: BatchEntriesResult | null };

function startMockInstance(state: MockState): Promise<{ url: string; close: () => void }> {
  const collections = [
    { id: "c1", name: "Workshop organizers", system_key: null },
    { id: "c2", name: "Gifts", system_key: null },
    { id: "c3", name: "Printer upgrades", system_key: null },
  ];
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Thingport-Client");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const route = `${req.method} ${(req.url ?? "").split("?")[0]}`;
    const json = (body: unknown, status = 200) =>
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    switch (route) {
      case "POST /api/login":
        return json({ token: "screenshot-token", expires_in: 86400 });
      case "GET /api/import/status":
        return json({ already_imported: false, state: "not_imported", print_id: null });
      case "POST /api/import/inspect":
        return json({ title: state.inspectTitle, is_zip: false });
      case "POST /api/import/printables-collection/entries":
      case "POST /api/import/myminifactory-collection/entries":
        return json(state.batch ?? { title: null, entries: [] });
      case "GET /api/collections":
        return json(collections);
      case "GET /api/collection-sync":
        return json({ supported: true, sync: null });
      case "POST /api/import":
        return json({ id: "demo-imported", title: state.inspectTitle, import_outcome: "created", thumb_url: null });
      // No slicer, so MakerWorld pages don't add their "Download normalized" button.
      case "GET /api/settings/slicer":
        return json({ slicer: null });
      case "PATCH /api/settings/makerworld":
        return json({});
      default:
        console.warn(`  mock instance: ${route} isn't mocked`);
        return json({ detail: `Not mocked: ${route}` }, 404);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const ONLY = argValue("only")?.split(",").filter(Boolean) ?? [];

function wanted(...files: string[]): boolean {
  return !ONLY.length || files.some((file) => ONLY.includes(file.replace(/\.\w+$/, "")));
}

/** dist/chrome with the optional sites already granted, as the popup's Enable buttons leave it: Playwright
 *  can't click the browser's permission prompt. Grab still registers its content script on the optional sites itself. */
async function extensionWithOptionalSites(): Promise<string> {
  const dir = path.join(os.tmpdir(), `thingport-grab-screenshots-ext-${process.pid}`);
  await rm(dir, { recursive: true, force: true });
  await cp(EXTENSION_DIR, dir, { recursive: true });
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { host_permissions: string[] };
  manifest.host_permissions.push("*://*/*");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

async function launch(mockPort: number): Promise<{ context: BrowserContext; worker: Worker; extensionId: string }> {
  const userDataDir = path.join(os.tmpdir(), `thingport-grab-screenshots-${process.pid}`);
  const extensionDir = await extensionWithOptionalSites();
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: PAGE_VIEWPORT,
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      // Otherwise Cloudflare (Printables) recognizes the automated browser.
      "--disable-blink-features=AutomationControlled",
      `--host-resolver-rules=MAP ${DEMO_HOST}:80 127.0.0.1:${mockPort}`,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId };
}

async function dismissBanners(page: Page): Promise<void> {
  const button = page
    .getByRole("button", { name: /^(accept( all)?( cookies)?|allow all|agree|i agree|got it|ok)$/i })
    .first();
  // Through the DOM: Grab's own button can sit on top of it.
  if (await button.isVisible().catch(() => false)) {
    await button.evaluate((el) => (el as HTMLElement).click()).catch(() => undefined);
  }
}

async function openPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !/just a moment/i.test(document.title), undefined, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await dismissBanners(page);
}

/** The first one is replaced by --<provider>=<url> when given. */
async function findModelUrls(page: Page, provider: (typeof PROVIDERS)[number], count: number): Promise<string[]> {
  const fixed = argValue(provider.name) ?? provider.fixed;
  if (fixed) return [fixed];
  await openPage(page, provider.home);
  const links = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href.split(/[?#]/)[0]));
  const found = [...new Set(links.filter((href) => provider.modelLink.test(href)))];
  const override = argValue(provider.name);
  const urls = [...(override ? [override] : []), ...found.filter((href) => href !== override)].slice(0, count);
  if (!urls.length) throw new Error(`No model link found on ${provider.home} -- pass --${provider.name}=<model url>`);
  return urls;
}

type ModelInfo = { url: string; title: string; image: string | null };

async function readModelInfo(page: Page): Promise<ModelInfo> {
  // og:title/og:image are unreliable here. No inner function declarations: tsx would wrap them in
  // a `__name` helper the page doesn't have.
  const meta = await page.evaluate(() => ({
    title: document.querySelector("h1")?.textContent?.trim() || document.title,
    image:
      [...document.images]
        .filter((img) => img.currentSrc.startsWith("http") && img.getBoundingClientRect().width >= 200)
        .map((img) => ({
          src: img.currentSrc,
          area: img.getBoundingClientRect().width * img.getBoundingClientRect().height,
        }))
        .toSorted((a, b) => b.area - a.area)[0]?.src ?? null,
  }));
  // MakerWorld has no <h1>, so strip the site's suffix from the tab title.
  const title = meta.title.replace(/\s*-\s*Free 3D Print Model\b.*$/i, "").replace(/\s*[-|]\s*MakerWorld$/i, "");
  return { url: page.url(), title, image: meta.image };
}

/** What the instance would list for a Printables collection, read from the page itself. */
async function readPrintablesCollection(page: Page): Promise<BatchEntriesResult> {
  await page.locator('a[href*="/model/"]').first().waitFor({ timeout: 30000 });
  const { title, links } = await page.evaluate(() => ({
    title: document.querySelector("h1")?.textContent?.trim() || null,
    links: [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/model/"]')].map((a) => ({
      href: a.href,
      text: a.textContent?.trim() || "",
    })),
  }));
  const titles = new Map<string, string>();
  for (const { href, text } of links) {
    const id = href.match(/\/model\/(\d+)/)?.[1];
    // A card links its model twice: the image (no text), then the name.
    if (id && !titles.get(id)) titles.set(id, text);
  }
  const entries = [...titles].map(([id, name], i) => ({
    design_id: id,
    title: name || null,
    // A couple already in the library, to show how those are marked.
    already_imported: i === 1 || i === 4,
  }));
  return { title, entries };
}

/** The same for a MyMiniFactory collection, whose cards link each object twice too. */
async function readMyminifactoryCollection(page: Page): Promise<BatchEntriesResult> {
  await page.locator('a[href*="/object/3d-print-"]').first().waitFor({ timeout: 30000 });
  const { title, links } = await page.evaluate(() => ({
    title: document.querySelector(".collection-title, h1")?.textContent?.trim() || null,
    links: [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/object/3d-print-"]')].map((a) => ({
      href: a.href,
      text: a.getAttribute("title") || a.textContent?.trim() || "",
    })),
  }));
  const titles = new Map<string, string>();
  for (const { href, text } of links) {
    const id = href.match(/-(\d+)\/?$/)?.[1];
    if (id && !titles.get(id)) titles.set(id, text);
  }
  const entries = [...titles].map(([id, name], i) => ({
    design_id: id,
    title: name || null,
    already_imported: i === 2,
  }));
  return { title, entries };
}

async function toDataUrl(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

async function screenshotPopup(
  context: BrowserContext,
  extensionId: string,
  file: string,
  colorScheme: "light" | "dark",
): Promise<void> {
  if (!wanted(file)) return;
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme });
  await page.setViewportSize({ width: POPUP_WIDTH, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForTimeout(800);
  await page.locator("body").screenshot({ path: path.join(OUT_DIR, file) });
  await page.close();
}

async function screenshotViewport(page: Page, file: string): Promise<void> {
  if (!wanted(file)) return;
  // Some cookie banners only show up after a while.
  await dismissBanners(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, file), type: "jpeg", quality: 82 });
}

async function main(): Promise<void> {
  if (!ONLY.length) await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const mockState: MockState = { inspectTitle: null, batch: null };
  const instance = await startMockInstance(mockState);
  const mockPort = Number(new URL(instance.url).port);
  const instanceUrl = `http://${DEMO_HOST}`;
  const { context, worker, extensionId } = await launch(mockPort);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await screenshotPopup(context, extensionId, "popup-setup.png", "light");
    await screenshotPopup(context, extensionId, "popup-setup-dark.png", "dark");

    const modelShots =
      wanted("setup-dialog-makerworld", "popup-connected", "popup-connected-dark") ||
      PROVIDERS.some((p) => wanted(`panel-${p.name}`, `panel-${p.name}-dark`, `imported-${p.name}`));
    const models = new Map<ProviderName, ModelInfo>();
    const recentModels: ModelInfo[] = [];
    for (const provider of modelShots ? PROVIDERS : []) {
      const urls = await findModelUrls(page, provider, provider.name === "thingiverse" ? 1 : 2);
      for (const url of urls) {
        await openPage(page, url);
        const info = await readModelInfo(page);
        if (!models.has(provider.name)) models.set(provider.name, info);
        recentModels.push(info);
        console.log(`${provider.label}: ${url} -- ${info.title}`);
      }
    }

    if (wanted("setup-dialog-makerworld")) {
      await openPage(page, models.get("makerworld")!.url);
      await page.locator(".tg-fab--inactive").click();
      await page.locator(".tg-modal").waitFor();
      await screenshotViewport(page, "setup-dialog-makerworld.jpg");
    }

    const recent = await Promise.all(
      recentModels.slice(0, 5).map(async (model, i) => ({
        printId: `demo-${i}`,
        title: model.title,
        url: `${instanceUrl}/models/demo-${i}`,
        thumbDataUrl: await toDataUrl(model.image),
        instanceUrl,
        email: "maker@example.com",
      })),
    );
    await worker.evaluate(
      (config) =>
        chrome.storage.local.set({ ...config, email: "maker@example.com", password: "screenshots", disabled: false }),
      { instanceUrl, recentImports: recent },
    );
    await screenshotPopup(context, extensionId, "popup-connected.png", "light");
    await screenshotPopup(context, extensionId, "popup-connected-dark.png", "dark");

    // Each shot again over the site's dark scheme, for the READMEs' <picture>. Grab's panel stays light either way.
    // Printables and Creality Cloud ignore the emulated scheme and follow the OS one, so take their shots of each
    // scheme with the OS set to match (--only=panel-printables,collection-printables,panel-crealitycloud, then the
    // -dark ones).
    for (const scheme of ["light", "dark"] as const) {
      const suffix = scheme === "dark" ? "-dark" : "";
      await page.emulateMedia({ colorScheme: scheme });

      for (const provider of PROVIDERS.filter((p) => models.has(p.name) && !(scheme === "dark" && p.lightOnly))) {
        const imported = scheme === "light" && wanted(`imported-${provider.name}`);
        if (!wanted(`panel-${provider.name}${suffix}`) && !imported) continue;
        const model = models.get(provider.name)!;
        mockState.inspectTitle = model.title;
        await openPage(page, model.url);
        await page.locator(".tg-fab:not(.tg-fab--inactive)").click();
        await page.locator('.tg-panel [data-action="import"]').waitFor({ timeout: 20000 });
        if (provider.name === "thingiverse") {
          await page.locator("#tg-collection").selectOption("__new__");
          await page.locator("#tg-new-collection").fill(NEW_COLLECTION_NAME);
        }
        await screenshotViewport(page, `panel-${provider.name}${suffix}.jpg`);

        // Not MakerWorld: its import clicks the page's real Download button.
        if (provider.name === "printables" && imported) {
          await page.locator('.tg-panel [data-action="import"]').click();
          await page.getByRole("link", { name: "Open in Thingport" }).waitFor({ timeout: 20000 });
          await screenshotViewport(page, `imported-${provider.name}.jpg`);
        }
      }

      // The sync box is shown ticked, so the shots show what it's for.
      if (wanted(`collection-printables${suffix}`)) {
        const printablesCollection = argValue("printables-collection") ?? PRINTABLES_COLLECTION;
        await openPage(page, printablesCollection);
        mockState.batch = await readPrintablesCollection(page);
        console.log(`Printables collection: ${printablesCollection} -- ${mockState.batch.entries.length} models`);
        await page.locator(".tg-fab:not(.tg-fab--inactive)").click();
        await page.locator('.tg-panel [data-action="import"]').waitFor({ timeout: 20000 });
        await page.locator("#tg-sync").check();
        await screenshotViewport(page, `collection-printables${suffix}.jpg`);
      }

      // The panel comes up once the whole collection has been scrolled through.
      if (wanted(`collection-makerworld${suffix}`)) {
        const makerworldCollection = argValue("makerworld-collection") ?? MAKERWORLD_COLLECTION;
        await openPage(page, makerworldCollection);
        console.log(`MakerWorld collection: ${makerworldCollection}`);
        await page.locator(".tg-fab:not(.tg-fab--inactive)").click();
        await page.locator('.tg-panel [data-action="start"]').waitFor({ timeout: 180000 });
        await page.locator("#tg-step-delay").selectOption("30000");
        await page.locator("#tg-sync").check();
        await page.evaluate(() => window.scrollTo(0, 0));
        await screenshotViewport(page, `collection-makerworld${suffix}.jpg`);
      }

      if (scheme === "light" && wanted("collection-myminifactory")) {
        const myminifactoryCollection = argValue("myminifactory-collection") ?? MYMINIFACTORY_COLLECTION;
        await openPage(page, myminifactoryCollection);
        mockState.batch = await readMyminifactoryCollection(page);
        console.log(`MyMiniFactory collection: ${myminifactoryCollection} -- ${mockState.batch.entries.length} models`);
        await page.locator(".tg-fab:not(.tg-fab--inactive)").click();
        await page.locator('.tg-panel [data-action="import"]').waitFor({ timeout: 20000 });
        await page.locator("#tg-sync").check();
        await screenshotViewport(page, "collection-myminifactory.jpg");
      }
    }

    console.log(`Screenshots written to ${path.relative(process.cwd(), OUT_DIR)}/`);
  } finally {
    await context.close();
    instance.close();
  }
}

await main();
