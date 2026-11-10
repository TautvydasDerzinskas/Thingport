#!/usr/bin/env node
// Draws the README's pictures from readme-art/art.html, each in the light and the dark theme, into
// docs/assets/readme/<name>-light.webp and -dark.webp. The README shows the one matching the reader's GitHub theme.
//
//   npm --prefix regression run readme-art [-- --only demo-video,bridge]
//
// The sites, their order and their count come from the providers' generated list, and the screens from
// frontend/src/assets/screenshots, so run it again after `npm run providers:sync` adds a site or the screenshots are
// retaken. Needs the backend's sharp: `npm --prefix backend install`.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { PROVIDER_DOCS } from "../web/src/lib/providers.generated.mjs";

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

const { values: args } = parseArgs({ options: { only: { type: "string" } } });

const OUT = path.join(here, "../docs/assets/readme");
const THEMES = ["light", "dark"];
// Twice the size the README shows them at, for high-density screens.
const SCALE = 2;

const data = { providers: PROVIDER_DOCS.map((doc) => doc.slug.slice("providers/".length)) };

let browser;
try {
  browser = await chromium.launch();
} catch {
  // Playwright's own Chromium isn't downloaded: an installed Chrome does as well.
  browser = await chromium.launch({ channel: "chrome" });
}
const page = await browser.newPage({ viewport: { width: 1000, height: 400 }, deviceScaleFactor: SCALE });
await page.goto(pathToFileURL(path.join(here, "readme-art/art.html")).href);

const names = await page.evaluate(() => window.names());
const only = args.only?.split(",").map((s) => s.trim());
const unknown = only?.filter((name) => !names.includes(name)) ?? [];
if (unknown.length) {
  console.error(`No such picture: ${unknown.join(", ")}. There are: ${names.join(", ")}.`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
for (const name of only ?? names) {
  for (const theme of THEMES) {
    await page.evaluate((opts) => window.render(opts), { name, theme, data });
    const png = await page.locator("#art > .art").screenshot({ omitBackground: true, animations: "disabled" });
    const file = path.join(OUT, `${name}-${theme}.webp`);
    await sharp(png).webp({ quality: 90, alphaQuality: 100 }).toFile(file);
    console.log(path.relative(process.cwd(), file));
  }
}
await browser.close();
