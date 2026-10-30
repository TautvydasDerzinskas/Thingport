// Renders every seasonal edition of Grab's icon (src/shared/seasonalMark.ts) into one page, to check them before
// their day comes: the popup's header and the floating icon, light and dark, with the real stylesheets.
//
//   npm run preview:seasonal -- [out.html]      (default dist/seasonal-preview.html)

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import * as sass from "sass";
import { SEASONS, seasonFor, type Season } from "../src/shared/season";
import { SEASONAL_PLACEMENT, composeSeasonalMark, svgDataUrl } from "../src/shared/seasonalMark";
import {
  SHARED_SCRIPT_EXPLAINER,
  SHARED_SCRIPT_NOTE_HTML,
  WITHHELD_SCRIPT_EXPLAINER,
  WITHHELD_SCRIPT_NOTE_HTML,
} from "../src/content/scriptNote";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const out = path.resolve(process.argv[2] ?? path.join(ROOT, "dist", "seasonal-preview.html"));

const NAMES: Record<Season, string> = {
  newYear: "New Year",
  lunarNewYear: "Lunar New Year",
  valentines: "Valentine's Day",
  holi: "Holi",
  womensDay: "Women's Day",
  stPatricks: "St Patrick's Day",
  spring: "Spring equinox",
  ramadan: "Ramadan & Eid al-Fitr",
  aprilFools: "April Fools' Day",
  easter: "Easter",
  saltibarsciai: "Šaltibarščių diena",
  summer: "Summer solstice",
  jonines: "Joninės",
  birthday: "Thingport's birthday",
  programmersDay: "Programmers' Day",
  autumn: "Autumn equinox",
  coffee: "Coffee Day",
  diwali: "Diwali",
  halloween: "Halloween",
  muertos: "Día de Muertos",
  hanukkah: "Hanukkah",
  winter: "Winter solstice",
  christmas: "Christmas",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dateLabel = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The next run of days, from today, that shows `season`. */
function nextDays(season: Season, from: Date): string {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  for (let i = 0; i < 800; i++) {
    const day = new Date(start.getTime() + i * DAY_MS);
    if (seasonFor(day) !== season) continue;
    let last = day;
    while (seasonFor(new Date(last.getTime() + DAY_MS)) === season) last = new Date(last.getTime() + DAY_MS);
    return last.getTime() === day.getTime() ? dateLabel(day) : `${dateLabel(day)} – ${dateLabel(last)}`;
  }
  return "not in the next two years";
}

const icon = (await readFile(path.join(SRC, "assets", "thingport-icon-color.svg"), "utf8"))
  .replace(/<\?xml[^>]*>\s*/, "")
  .replace(/<title[^>]*>[\s\S]*?<\/title>/, "")
  .replace(/ role="img" aria-labelledby="title"/, ' aria-hidden="true"');

async function overlayFor(season: Season): Promise<string> {
  const svg = await readFile(path.join(SRC, "assets", "seasonal", `${season.toLowerCase()}.svg`), "utf8");
  return svgDataUrl(composeSeasonalMark(season, svg));
}

const placement = Object.entries(SEASONAL_PLACEMENT)
  .map(([key, value]) => `${key}:${value}`)
  .join(";");
const overlayImg = (src: string | null, cls: string) =>
  src ? `<img class="${cls}" src="${src}" alt="" style="${placement}">` : "";

// The popup's own stylesheet, in a frame per theme; dark is forced by redefining its colours after it.
const popupCss = sass.compile(path.join(SRC, "popup", "styles", "popup.scss")).css;
const darkVars = sass.compileString(`@use "tokens" as t; :root { @include t.theme-vars(t.$palette-dark); }`, {
  loadPaths: [path.join(SRC, "styles")],
}).css;
function popupHeader(overlay: string | null, dark: boolean): string {
  const doc = `<!doctype html><html><head><style>${popupCss}${dark ? darkVars : ""}
    body { width: auto; padding: 16px 16px 8px; overflow: hidden; } .header { margin: 0; }</style></head><body>
    <header class="header${overlay ? " header--seasonal" : ""}"><span class="header__icon">${icon}${overlayImg(overlay, "header__season")}</span>
    <div class="header__text"><h1 class="header__title">Thingport Grab</h1>
    <div class="instance"><span class="instance__url">thingport.example.com</span></div></div></header></body></html>`;
  return `<iframe class="popup" title="Popup header" srcdoc="${doc.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>`;
}

// The floating icon's stylesheet, with both palettes as classes instead of following the system.
const fabCss = sass.compileString(
  `@use "fab"; @use "fab-note"; @use "../../styles/tokens" as t;
   .tg-light { @include t.theme-vars(t.$palette-light); } .tg-dark { @include t.theme-vars(t.$palette-dark); }
   svg [stroke="#1f1f1f"] { stroke: t.c("text"); }`,
  { url: pathToFileURL(path.join(SRC, "content", "styles", "_preview.scss")) },
).css;
const mark = (overlay: string | null, dodge: boolean, extra = "") =>
  `<span class="tg-fab__mark${extra}"${dodge ? " data-dodge" : ""}>${icon}${overlayImg(overlay, "tg-fab__season")}</span>`;
const fab = (overlay: string | null, dodge: boolean) =>
  `<button type="button" class="tg-fab" aria-label="Import to Thingport"><span class="tg-fab__body"><span class="tg-fab__blob"></span>` +
  `${mark(overlay, dodge)}</span></button>`;

// The icon with the line it wears under it on a model built from a generator script (content/scriptNote.ts):
// one for a script that comes along, one for a script its creator held back.
const attr = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const fabWithNote = (overlay: string | null, dodge: boolean, shared: boolean) =>
  `${fab(overlay, dodge)}<div class="tg-fab-note" title="${attr(shared ? SHARED_SCRIPT_EXPLAINER : WITHHELD_SCRIPT_EXPLAINER)}">` +
  `${shared ? SHARED_SCRIPT_NOTE_HTML : WITHHELD_SCRIPT_NOTE_HTML}</div>`;

// The floating icon's own pull (src/content/magnet.ts), on each one here.
const magnetJs = (
  await esbuild.build({
    stdin: {
      contents: `import { attachMagnet } from "./src/content/magnet";
        for (const button of document.querySelectorAll(".page .tg-fab")) {
          const mark = button.querySelector(".tg-fab__mark");
          attachMagnet(button, button.querySelector(".tg-fab__body"), {
            paused: () => false,
            dodges: () => "dodge" in mark.dataset,
          });
        }`,
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
  })
).outputFiles[0].text;

const today = seasonFor(new Date());
const cards: string[] = [];
for (const season of [null, ...SEASONS] as (Season | null)[]) {
  const overlay = season ? await overlayFor(season) : null;
  const dodge = season === "aprilFools";
  cards.push(`<section class="card${season && season === today ? " card--today" : ""}">
    <header class="card__head"><h2>${season ? NAMES[season] : "Ordinary day"}</h2>
      <span class="card__when">${season ? (season === today ? "Today · " : "") + nextDays(season, new Date()) : "Every other day"}</span></header>
    <div class="card__row">
      <div class="big tg-light">${mark(overlay, false, " big__mark")}</div>
      <div class="stack">${popupHeader(overlay, false)}${popupHeader(overlay, true)}</div>
      <div class="page tg-light">${fab(overlay, dodge)}</div>
      <div class="page page--dark tg-dark">${fab(overlay, dodge)}</div>
      <div class="page page--noted tg-light">${fabWithNote(overlay, dodge, true)}</div>
      <div class="page page--noted page--dark tg-dark">${fabWithNote(overlay, dodge, true)}</div>
      <div class="page page--noted tg-light">${fabWithNote(overlay, dodge, false)}</div>
      <div class="page page--noted page--dark tg-dark">${fabWithNote(overlay, dodge, false)}</div>
    </div>
  </section>`);
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Grab seasonal icons</title>
<style>
${fabCss}
:root { color-scheme: light; --bg: #f6f7f9; --card: #fff; --line: #e3e5ea; --text: #1f1f1f; --muted: #6b6f78; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 24px 64px; background: var(--bg); color: var(--text);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; }
.lead { margin: 0 0 24px; color: var(--muted); }
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 660px), 1fr)); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
.card--today { border-color: #00b800; box-shadow: 0 0 0 2px rgba(0, 184, 0, 0.25); }
.card__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.card__head h2 { margin: 0; font-size: 15px; }
.card__when { color: var(--muted); font-size: 12px; text-align: right; }
.card__row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.big { display: grid; place-items: center; width: 120px; height: 140px; border-radius: 10px; background: #fff;
  border: 1px solid var(--line); overflow: hidden; }
.big .big__mark { width: 64px; height: 64px; transform: none; }
.stack { display: flex; flex-direction: column; gap: 6px; }
.popup { display: block; width: 216px; height: 72px; border: 1px solid var(--line); border-radius: 8px; }
/* 140px apart, the pull's reach: hovering one doesn't tug its neighbour. */
.page { position: relative; display: grid; place-items: center; width: 130px; height: 140px; border-radius: 10px;
  background: #eef0f4; border: 1px solid var(--line); }
.page--dark { background: #12151c; }
.page .tg-fab { position: relative; right: auto; bottom: auto; }
/* Fixed to the viewport's corner on a real page; here the icon and its line are stacked so both can be seen. */
.page--noted { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.page--noted .tg-fab-note { position: relative; right: auto; bottom: auto; transform: none; animation: none; }
</style>
</head>
<body>
<h1>Grab seasonal icons</h1>
<p class="lead">Each occasion's icon as Grab shows it: large, in the popup's header (light, dark), as the floating
icon on a page (light, dark), then with the line it wears under it on a model built from a generator script -- the
script shared (light, dark), and the script kept back by its creator (light, dark). Bring the mouse near a floating
icon to feel its pull; on April Fools' it dodges. Hover a line for what it says. Made ${dateLabel(new Date())}.</p>
<div class="grid">${cards.join("\n")}</div>
<script>${magnetJs}</script>
</body>
</html>
`;

await writeFile(out, html);
console.log(`Wrote ${path.relative(process.cwd(), out) || out}`);
