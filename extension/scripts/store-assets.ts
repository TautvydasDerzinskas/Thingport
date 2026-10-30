// Renders the store listing images from the HTML templates in store-assets/ into docs/store/:
//
//   npm run store-assets [-- --out=<dir> --corners=<dir>]
//
//   logo.png        300x300    store logo (Edge Add-ons "Extension logo")
//   store-icon.png  128x128    Chrome Web Store icon (transparent, 96px artwork + 16px padding)
//   tile-small.png  440x280    small promotional tile
//   tile-large.png  1400x560   large promotional tile (the extension's real panel on a placeholder page)
//   screenshots/1-providers.png  1280x800  the logo among every site Grab works on, and what it does
//   screenshots/2-popup.png      1280x800  the popup: not connected yet, and each tab once it is
//   screenshots/3-sites.png      1280x800  a model page's corner on each site, with Grab's button or panel
//
// 1280x800 PNG is what the Chrome Web Store, Edge Add-ons and Firefox Add-ons all take. The popup pictures come from
// docs/screenshots/popup-*.png and the corners from docs/store/corners/ (or --corners=<dir>): run
// `npm run screenshots -- --corners` first to refresh them. A site with no corner is left out of the mosaic.
//
// Needs Playwright's Chromium once: `npx playwright install chromium`.

import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import * as sass from "sass";
import { MANIFESTS, PROVIDER_IDS, type Logo, type ProviderId } from "../src/providers/index.generated";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = path.join(ROOT, "store-assets");
const SCREENSHOTS_DIR = path.join(ROOT, "docs", "screenshots");
const STORE_SCREENSHOT = { width: 1280, height: 800 };

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const OUT_DIR = path.resolve(argValue("out") ?? path.join(ROOT, "docs", "store"));
const CORNERS_DIR = path.resolve(argValue("corners") ?? path.join(ROOT, "docs", "store", "corners"));

// The content script's stylesheet, with `:host` properties re-scoped to `.tg-scope`. Transitions
// are off so buttons aren't captured mid-fade.
const CONTENT_CSS =
  sass.compile(path.join(ROOT, "src", "content", "styles", "content.scss")).css.replaceAll(":host", ".tg-scope") +
  "\n*, *::before, *::after { transition: none !important; }";

const ASSETS = [
  { template: "logo.html", out: "logo.png", width: 300, height: 300 },
  { template: "store-icon.html", out: "store-icon.png", width: 128, height: 128, transparent: true },
  { template: "tile-small.html", out: "tile-small.png", width: 440, height: 280 },
  { template: "tile-large.html", out: "tile-large.png", width: 1400, height: 560 },
  { template: "screenshot-providers.html", out: "screenshots/1-providers.png", ...STORE_SCREENSHOT },
  { template: "screenshot-popup.html", out: "screenshots/2-popup.png", ...STORE_SCREENSHOT },
  { template: "screenshot-sites.html", out: "screenshots/3-sites.png", ...STORE_SCREENSHOT },
];

const rule = (value?: string) => (value ? ` fill-rule="${value}"` : "");

/** A site's logo in its own colours, as the popup draws it (popup/sites.ts). */
function logoSvg(id: ProviderId): string {
  const logo: Logo = MANIFESTS[id].brand.logo;
  const { path: d, color, viewBox = "0 0 24 24", fillRule, layers = [] } = logo;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" aria-hidden="true">` +
    `<path d="${d}" fill="${color}"${rule(fillRule)}/>` +
    layers.map((layer) => `<path d="${layer.d}" fill="${layer.color}"${rule(layer.fillRule)}/>`).join("") +
    `</svg>`
  );
}

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );
const fileUrl = async (file: string) => ((await exists(file)) ? pathToFileURL(file).href : null);

// What the screenshot templates draw from, handed to their render().
const providers = PROVIDER_IDS.map((id) => ({ id, name: MANIFESTS[id].name, logo: logoSvg(id) }));
const data = {
  providers,
  popups: Object.fromEntries(
    await Promise.all(
      ["setup", "connected", "features", "history"].map(async (name) => [
        name,
        await fileUrl(path.join(SCREENSHOTS_DIR, `popup-${name}.png`)),
      ]),
    ),
  ),
  corners: await Promise.all(
    providers.map(async ({ id, name, logo }) => ({
      id,
      name,
      logo,
      button: await fileUrl(path.join(CORNERS_DIR, `${id}.jpg`)),
      panel: await fileUrl(path.join(CORNERS_DIR, `${id}-panel.jpg`)),
    })),
  ),
};
const missing = data.corners.filter((corner) => !corner.button).map((corner) => corner.id);
if (missing.length) console.warn(`No corner for ${missing.join(", ")}: left out of the mosaic.`);

await mkdir(path.join(OUT_DIR, "screenshots"), { recursive: true });
const browser = await chromium.launch();
try {
  for (const asset of ASSETS) {
    const page = await browser.newPage({
      viewport: { width: asset.width, height: asset.height },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(path.join(TEMPLATES, asset.template)).href, { waitUntil: "load" });
    await page.addStyleTag({ content: CONTENT_CSS });
    await page.evaluate((input) => {
      const render = (window as unknown as { render?: (input: unknown) => void }).render;
      if (render) render(input);
    }, data);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    await page.screenshot({ path: path.join(OUT_DIR, asset.out), omitBackground: "transparent" in asset });
    await page.close();
    const file = path.join(OUT_DIR, asset.out);
    console.log(`${file.startsWith(ROOT) ? path.relative(ROOT, file) : file}  ${asset.width}x${asset.height}`);
  }
} finally {
  await browser.close();
}
