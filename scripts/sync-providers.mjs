// Copies providers/ into the backend, frontend and extension, each of which builds on its own (their own Docker
// contexts and lockfiles), and writes the index that lists them. Each copy goes beside the package's own code for that
// provider, named <file>.generated.ts (src/providers/<id>/manifest.generated.ts, src/providers/_lib/,
// src/providers/index.generated.ts), and only *.generated.* files are ever written or removed there. It writes the docs
// from the manifests and each <id>/docs.ts too: the logos in docs/assets/providers/, the list and table between the
// providers: markers in docs/PROVIDER_SETUP.md, the website's provider pages and the same table for their foot
// (web/src/lib/providers.generated.mjs), and the bug form's Provider options and a label for each, between the same
// markers in .github/. All of it is committed:
//
//   npm run providers:sync    rewrite them
//   npm run providers:check   fail when one is out of date (CI)
//
// Manifests import only types, so Node's own type stripping loads them, as it does the app's slicer list; nothing needs
// compiling.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as prettier from "prettier";
import { SLICER_OPTIONS } from "../frontend/src/constants/settingsOptions.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "providers");
const TARGETS = ["backend/src/providers", "frontend/src/providers", "extension/src/providers"];
const GENERATED = /\.generated\.[a-z]+$/;
// Grab's manifest.json lists these sites; any change makes browsers disable it until each user approves the update.
const BUILTIN_SITES = ["makerworld", "printables", "thingiverse"];
// What each provider's folder holds, copied as they are. Its docs.ts is read here only.
const PROVIDER_FILES = ["manifest.ts", "urls.ts"];
const DOCS_LOGOS = "docs/assets/providers";
const SETUP_PAGE = "docs/PROVIDER_SETUP.md";
// docs.ts `about` is shown in a card in Grab's popup, which is 380px wide: longer than this and it stops fitting.
const ABOUT_MAX_CHARS = 240;
// docs.ts `highlight` is read at a glance on the provider's page on the website, before the page itself.
const HIGHLIGHT_MAX_CHARS = { title: 48, text: 220 };
// A website docs page by its slug, as in /docs/<slug>/, and maybe the anchor of one of its headings.
const DOCS_LINK = /^[a-z0-9-]+(\/[a-z0-9-]+)*(#[a-z0-9-]+)?$/;
// Manifests' slicer ids as the app's slicer setting names them, for the website. "other" is the setting's, not a slicer.
const SLICER_NAMES = Object.fromEntries(
  SLICER_OPTIONS.filter(({ id }) => id !== "other").map(({ id, label }) => [id, label]),
);
const WEB_DOCS = "web/src/lib/providers.generated.mjs";
const BUG_FORM = ".github/ISSUE_TEMPLATE/bug_report.yml";
const LABELS = ".github/labels.yml";

/** `file.ts` as its copy is named. */
const generatedName = (file) => file.replace(/\.ts$/, ".generated.ts");

/** A copied file's relative imports, which are all of other copies, by their copies' names. */
const pointAtCopies = (text) => text.replace(/(from\s+"\.{1,2}\/[^"]+?)(")/g, "$1.generated$2");

const header = (from) =>
  `// GENERATED from ${from} by scripts/sync-providers.mjs. Don't edit it here:\n` +
  `// change providers/ and run npm run providers:sync.\n`;

async function loadManifests() {
  const ids = readdirSync(SOURCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
  const manifests = [];
  for (const id of ids) {
    for (const required of [...PROVIDER_FILES, "docs.ts"]) {
      if (!existsSync(path.join(SOURCE, id, required))) throw new Error(`providers/${id} has no ${required}`);
    }
    const file = path.join(SOURCE, id, "manifest.ts");
    const manifest = (await import(pathToFileURL(file).href)).default;
    if (manifest.id !== id) throw new Error(`providers/${id}/manifest.ts says its id is "${manifest.id}"`);
    manifest.docs = (await import(pathToFileURL(path.join(SOURCE, id, "docs.ts")).href)).default;
    manifests.push(manifest);
  }
  manifests.sort((a, b) => a.order - b.order);
  const orders = manifests.map((manifest) => manifest.order);
  if (new Set(orders).size !== orders.length) throw new Error(`Two providers share an order: ${orders.join(", ")}`);
  const builtin = manifests.filter((manifest) => manifest.extension.site === "builtin").map((manifest) => manifest.id);
  if (builtin.toSorted().join() !== BUILTIN_SITES.toSorted().join()) {
    throw new Error(`Only ${BUILTIN_SITES.join(", ")} may be built-in Grab sites; new ones are "optional"`);
  }
  const cookies = manifests.filter((m) => m.extension.cookies && m.extension.site !== "builtin").map((m) => m.id);
  if (cookies.length) throw new Error(`Only built-in sites take cookies in the manifest, not ${cookies.join(", ")}`);
  const tooLong = manifests.filter((manifest) => manifest.docs.about.length > ABOUT_MAX_CHARS).map((m) => m.id);
  if (tooLong.length) throw new Error(`docs.ts "about" is over ${ABOUT_MAX_CHARS} characters: ${tooLong.join(", ")}`);
  const highlights = manifests.flatMap((m) =>
    highlightProblems(m.docs.highlight).map((problem) => `${m.id}: ${problem}`),
  );
  if (highlights.length) throw new Error(`docs.ts "highlight" is wrong:\n  ${highlights.join("\n  ")}`);
  const unnamed = manifests.flatMap((m) =>
    (m.slicers ?? []).filter((id) => !Object.hasOwn(SLICER_NAMES, id)).map((id) => `${m.id}'s "${id}"`),
  );
  if (unnamed.length) {
    throw new Error(`Slicers the app's slicer setting (SLICER_OPTIONS) doesn't list: ${unnamed.join(", ")}`);
  }
  const ranks = manifests.flatMap((manifest) =>
    manifest.capabilities.trending ? [manifest.capabilities.trending.rank] : [],
  );
  if (new Set(ranks).size !== ranks.length) throw new Error(`Two providers share a trending rank: ${ranks.join(", ")}`);
  const destinations = new Set();
  for (const manifest of manifests) {
    for (const [destination, rule] of Object.entries(manifest.credentialHosts ?? {})) {
      if (!destination.startsWith(`${manifest.id}-`) || destinations.has(destination)) {
        throw new Error(`Invalid or duplicate credential destination ${destination} in ${manifest.id}`);
      }
      if (!rule.exact?.length || rule.exact.some((host) => !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host))) {
        throw new Error(`Invalid credential hosts for ${destination}`);
      }
      destinations.add(destination);
    }
  }
  return manifests;
}

function credentialHosts(manifests) {
  const rules = Object.fromEntries(manifests.flatMap((manifest) => Object.entries(manifest.credentialHosts ?? {})));
  return `${header("providers/*/manifest.ts")}
/** Destinations that may receive provider credentials. URL recognition is deliberately broader. */
export const CREDENTIAL_HOSTS = ${JSON.stringify(rules, null, 2)} as const;
export type CredentialDestination = keyof typeof CREDENTIAL_HOSTS;
`;
}

/** What's wrong with a docs.ts `highlight`, if anything. */
function highlightProblems(highlight) {
  const isText = (value) => typeof value === "string" && value.trim() !== "";
  if (!isText(highlight?.title) || !isText(highlight.text)) return ["it needs a title and a text"];
  const problems = Object.entries(HIGHLIGHT_MAX_CHARS)
    .filter(([field, max]) => highlight[field].length > max)
    .map(([field, max]) => `its ${field} is ${highlight[field].length} characters, over ${max}`);
  const { link } = highlight;
  if (link !== undefined && !(typeof link === "string" && DOCS_LINK.test(link))) {
    problems.push(
      `its link ${JSON.stringify(link)} isn't a website docs page's slug with an optional #anchor, ` +
        `as in "guides/ai#ai-categorization"`,
    );
  }
  return problems;
}

function index(manifests) {
  const ids = manifests.map((manifest) => manifest.id);
  const trending = manifests
    .filter((manifest) => manifest.capabilities.trending)
    .sort((a, b) => a.capabilities.trending.rank - b.capabilities.trending.rank)
    .map((manifest) => manifest.id);
  return `${header("providers/*/")}
import { hostIs } from "./_lib/hosts.generated";
import type { ListLink, ModelLink, ProviderManifest, ProviderUrls } from "./_lib/types.generated";
${ids.map((id) => `import ${id} from "./${id}/manifest.generated";\nimport { urls as ${id}Urls } from "./${id}/urls.generated";`).join("\n")}

export type {
  AuthField,
  AuthSlot,
  LegacyIdsField,
  ListKind,
  ListLink,
  Logo,
  ModelLink,
  Need,
  ProviderManifest,
  ProviderUrls,
  SignIn,
} from "./_lib/types.generated";
export { hostIs } from "./_lib/hosts.generated";
export { LIKES_ID_PREFIX } from "./_lib/lists.generated";

/** Every provider, in the order lists show them. */
export const PROVIDER_IDS = [${ids.map((id) => JSON.stringify(id)).join(", ")}] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const MANIFESTS = { ${ids.join(", ")} } as const;

/** What each site is, in two or three sentences (providers/<id>/docs.ts), for the UI that introduces a provider
 *  rather than listing it: Thingport Grab's popup, which shows it for the site the user is on. */
export const ABOUT: { readonly [K in ProviderId]: string } = ${JSON.stringify(
    Object.fromEntries(manifests.map((m) => [m.id, m.docs.about])),
    null,
    2,
  )};

/** The providers with a list for the dashboard's trending panel, in the panel's order. */
export const TRENDING_PROVIDER_IDS = [${trending.map((id) => JSON.stringify(id)).join(", ")}] as const;
export type TrendingProviderId = (typeof TRENDING_PROVIDER_IDS)[number];

export const URLS: { readonly [K in ProviderId]: ProviderUrls } = { ${ids.map((id) => `${id}: ${id}Urls`).join(", ")} };

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(MANIFESTS, value);
}

/** A provider's manifest as the type says any can be, for the fields only some have. */
export function manifestOf(id: ProviderId): ProviderManifest {
  return MANIFESTS[id];
}

/** The provider whose site \`hostname\` is, subdomains included; null for any other site. */
export function providerOfHost(hostname: string): ProviderId | null {
  return PROVIDER_IDS.find((id) => MANIFESTS[id].hosts.some((domain) => hostIs(hostname, domain))) ?? null;
}

/** The provider whose links a URL's host is, as its parsers read them (narrower than providerOfHost: Snapmaker's
 *  are on space.snapmaker.com only); null for any other site or no URL. */
export function detectProvider(url: string): ProviderId | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  return PROVIDER_IDS.find((id) => URLS[id].isHost(hostname)) ?? null;
}

/** The model a link is the page of, on whichever provider. */
export function parseModelUrl(url: string): (ModelLink & { provider: ProviderId }) | null {
  const provider = detectProvider(url);
  const model = provider && URLS[provider].parseModel(url);
  return model ? { provider: provider!, ...model } : null;
}

/** The list (collection, likes, bookmarks) a link is the page of, on whichever provider. */
export function parseListUrl(url: string): (ListLink & { provider: ProviderId }) | null {
  const provider = detectProvider(url);
  const list = provider && URLS[provider].parseList(url);
  return list ? { provider: provider!, ...list } : null;
}

/** A model's page; null for a provider there's no manifest for. */
export function modelUrl(provider: string, externalId: string): string | null {
  return isProviderId(provider) ? URLS[provider].modelUrl(externalId) : null;
}
`;
}

/** Its logo on the white tile the docs show every provider's on. */
function docsLogo({ logo }) {
  const [x, y, w, h] = (logo.viewBox ?? "0 0 24 24").split(/\s+/).map(Number);
  const round = (value) => Number(value.toFixed(4));
  const pad = Math.max(w, h) * 0.22;
  const size = round(Math.max(w, h) * 1.44);
  const [left, top] = [round(x - pad), round(y - pad)];
  // A black-and-white mark is drawn near-black, as the tile is white in both themes.
  const fill = (color) => (color === "currentColor" ? "#111111" : color);
  const paths = [
    `<path d="${logo.path}" fill="${fill(logo.color)}"${logo.fillRule ? ` fill-rule="${logo.fillRule}"` : ""}/>`,
    ...(logo.layers ?? []).map(
      (layer) =>
        `<path d="${layer.d}" fill="${layer.color}"${layer.fillRule ? ` fill-rule="${layer.fillRule}"` : ""}/>`,
    ),
  ];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="${left} ${top} ${size} ${size}">` +
    `<rect x="${left}" y="${top}" width="${size}" height="${size}" rx="${round(size * 0.24)}" fill="#ffffff" ` +
    `stroke="#00000014" stroke-width="${round(size * 0.02)}"/>${paths.join("")}</svg>\n`
  );
}

const SUPERSCRIPTS = "¹²³⁴⁵⁶⁷⁸⁹";
const NEEDS = { required: "**Required**", recommended: "Recommended", optional: "Optional", none: "" };
const GENERATED_NOTE = "Written by scripts/sync-providers.mjs from providers/: change it there.";

/** `text` with the lines between its `<!-- providers:<name> -->` markers replaced. */
function fillMarkdown(text, file, name, lines) {
  const open = `<!-- providers:${name} -->`;
  const close = `<!-- /providers:${name} -->`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start === -1 || end === -1) throw new Error(`${file} has no ${open} ... ${close}`);
  return `${text.slice(0, start + open.length)}\n<!-- ${GENERATED_NOTE} -->\n\n${lines.join("\n")}\n\n${text.slice(end)}`;
}

/** The same in YAML, between `# providers:<name>` comment lines, the lines indented as the opening one is. */
function fillYaml(text, file, name, lines) {
  const block = new RegExp(`^( *)# providers:${name}\n[^]*?^ *# /providers:${name}$`, "m");
  if (!block.test(text)) throw new Error(`${file} has no # providers:${name} ... # /providers:${name}`);
  return text.replace(block, (_, indent) =>
    [`# providers:${name}`, `# ${GENERATED_NOTE}`, ...lines, `# /providers:${name}`]
      .map((line) => indent + line)
      .join("\n"),
  );
}

/** A YAML string: plain where that reads the same, quoted otherwise. */
const yamlString = (text) => (/^[A-Za-z0-9][\w .()+-]*$/.test(text) && !/ #/.test(text) ? text : JSON.stringify(text));

/** The label .github/workflows/issue-provider-label.yml puts on an issue about a provider. */
const providerLabel = (name) => `provider: ${name}`;

/**
 * The providers side by side: the providers page's table, and the one at the foot of each provider's page on the
 * website, are both drawn from this alone, so they can't disagree. A row per provider, with a cell for each column
 * after Provider: `{ text }`, `{ need }` (Grab's or FlareSolverr's, "none" included) or `{ yes }`, and `note`, the
 * number of the footnote the cell carries.
 */
function comparison(manifests) {
  const noted = manifests.filter((m) => m.docs.note);
  const empty = (cell) => cell.need === "none" || cell.yes === false;
  const rows = manifests.map((m) => {
    const { capabilities: c, docs, helpers } = m;
    // Marked on the cells it qualifies that have something in them to qualify.
    const note = (column, cell) =>
      docs.note?.on.includes(column) && !empty(cell) ? { ...cell, note: noted.indexOf(m) + 1 } : cell;
    return {
      docsSlug: m.docsSlug,
      name: m.name,
      cells: [
        { text: docs.signIn },
        note("grab", { need: helpers.grab }),
        { need: helpers.flaresolverr },
        // Named where the site calls its lists something else.
        c.collections && docs.collections ? { text: docs.collections } : { yes: c.collections },
        note("likes", { yes: c.likes }),
        { yes: c.collections || c.likes },
        { yes: c.profiles },
      ],
    };
  });
  return {
    columns: [
      "Provider",
      "Sign-in",
      "Thingport Grab",
      "FlareSolverr",
      "Collections",
      "Likes",
      "Sync",
      "Print profiles",
    ],
    rows,
    notes: noted.map((m) => m.docs.note.text),
  };
}

/** A comparison cell as the providers page's Markdown writes it. */
function markdownCell(cell) {
  const value = cell.text ?? (cell.need ? NEEDS[cell.need] : cell.yes ? "✓" : "");
  return cell.note ? `${value}${SUPERSCRIPTS[cell.note - 1]}` : value;
}

/** The providers page's list and comparison table, between its markers. */
function setupPage(manifests, compared, current) {
  const icon = ({ docsSlug }) =>
    `<img src="assets/providers/${docsSlug}.svg" alt="" width="18" height="18" align="absmiddle">`;
  const link = (m) => `${icon(m)} [${m.name}](providers/${m.docsSlug}.md)`;
  const list = manifests.map((m) => `- ${link(m)} -- ${m.docs.summary}`);
  const row = (cells) => `| ${cells.join(" | ")} |`;
  const table = [
    row(compared.columns),
    row(compared.columns.map(() => "---")),
    ...compared.rows.map((r) => row([link(r), ...r.cells.map(markdownCell)])),
    "",
    ...compared.notes.map((note, i) => `${i + 1}. ${note}`),
  ];
  return fillMarkdown(fillMarkdown(current, SETUP_PAGE, "list", list), SETUP_PAGE, "table", table);
}

/** The bug form's Provider options: each provider's name, which the website's report links fill it in with. */
const bugForm = (manifests, current) =>
  fillYaml(
    current,
    BUG_FORM,
    "bug-form",
    manifests.map((m) => `- ${yamlString(m.name)}`),
  );

/** A label per provider, in its brand colour, for the repo's label sync (.github/workflows/labels.yml), which deletes
 *  labels its file doesn't list. */
function labels(manifests, current) {
  const lines = manifests.flatMap((m) => {
    if (!/^#[0-9a-f]{6}$/i.test(m.brand.accent)) throw new Error(`${m.id}'s brand.accent isn't a #rrggbb colour`);
    return [
      `- name: ${JSON.stringify(providerLabel(m.name))}`,
      `  color: "${m.brand.accent.slice(1).toLowerCase()}"`,
      `  description: ${yamlString(`About ${m.name}, from the bug form's Provider answer`)}`,
    ];
  });
  return fillYaml(current, LABELS, "labels", lines);
}

/** What a provider's page on the website shows besides its Markdown and the comparison table. Kept out of its DOCS
 *  entry, as DOCS is read wherever the docs are listed, the wiki's build among them. */
function pageExtras(m) {
  const { capabilities: c, docs, helpers } = m;
  const { title, text, link } = docs.highlight;
  return {
    docsSlug: m.docsSlug,
    accent: m.brand.accent,
    highlight: { title, text, ...(link && { link }) },
    facts: {
      signIn: m.signIn,
      grab: helpers.grab,
      grabSite: m.extension.site,
      flaresolverr: helpers.flaresolverr,
      collections: c.collections,
      likes: c.likes,
      sync: c.collections || c.likes,
      profiles: c.profiles,
      slicers: (m.slicers ?? []).map((id) => SLICER_NAMES[id]),
      bambuProjects: c.bambuProjects ?? false,
      trending: c.trending ? c.trending.kind : null,
      categories: c.categoryIds !== "none",
    },
  };
}

/** The website's page for each provider, in docs/providers/, what it shows besides its Markdown, and the table at
 *  their foot. */
function webDocs(manifests, compared) {
  const pages = manifests.map((m) => ({
    slug: `providers/${m.docsSlug}`,
    source: `docs/providers/${m.docsSlug}.md`,
    group: "Providers",
    title: m.name,
    nav: m.name,
    description: m.docs.description,
  }));
  const max = HIGHLIGHT_MAX_CHARS;
  return `${header("providers/*/")}
/** The providers' pages, in the order lists show them. */
export const PROVIDER_DOCS = ${JSON.stringify(pages, null, 2)};

/** What each provider's page shows besides its Markdown and the comparison table, from its manifest and docs.ts: a
 *  row per provider in the order lists show them, by its \`docsSlug\` (/docs/providers/<docsSlug>/), with
 *  - \`accent\`: its own colour, as hex (brand.accent). Few have text contrast in both themes (Thangs' yellow on white,
 *    Cults3D's purple on the dark one), so tint with it, or shift it for text and icons.
 *  - \`highlight\`: \`{ title, text, link? }\`, what sets it apart, in plain text: a title of at most
 *    ${max.title} characters and a sentence or two of at most ${max.text}. \`link\` is the docs page that says more,
 *    by its slug, with an optional anchor: "grab#setup" is /docs/grab/#setup.
 *  - \`facts\`: what the links to its feature pages are chosen by. \`signIn\`: "none", "admin", "user", "adminUser"
 *    or "userOptional" (the manifest's). \`grab\` and \`flaresolverr\`: how much it leans on each, "required",
 *    "recommended", "optional" or "none". \`grabSite\`: "builtin", or "optional", which Grab's popup turns on once.
 *    \`collections\` and \`likes\`, and \`sync\`, true with either: a sync follows both. \`profiles\`: print profiles.
 *    \`slicers\`: the names of its printer maker's own, if any. \`bambuProjects\`: Bambu Studio 3MFs, which other
 *    slicers open normalized. \`trending\`: the dashboard's trending panel's list, "trending", "popular", "featured"
 *    or "recommended", or null where it has none. \`categories\`: false where its models name none, so they come in
 *    uncategorized. */
export const PROVIDER_PAGES = ${JSON.stringify(manifests.map(pageExtras), null, 2)};

/** The comparison table of docs/PROVIDER_SETUP.md, for the foot of each provider's page: the columns' headings, a row
 *  per provider in the order lists show them, and the footnotes. A row has a cell for each column after Provider:
 *  \`{ text }\`, \`{ need }\` ("required", "recommended", "optional" or "none") or \`{ yes }\`, and \`note\`, the
 *  number of the footnote the cell carries. */
export const PROVIDER_COMPARISON = ${JSON.stringify(compared)};
`;
}

/** The docs files the generator owns, by path from the repository's root. */
async function docsOutputs(manifests) {
  const files = new Map();
  const compared = comparison(manifests);
  for (const m of manifests) files.set(`${DOCS_LOGOS}/${m.docsSlug}.svg`, docsLogo(m.brand));
  files.set(SETUP_PAGE, setupPage(manifests, compared, readFileSync(path.join(ROOT, SETUP_PAGE), "utf8")));
  files.set(WEB_DOCS, webDocs(manifests, compared));
  files.set(BUG_FORM, bugForm(manifests, readFileSync(path.join(ROOT, BUG_FORM), "utf8")));
  files.set(LABELS, labels(manifests, readFileSync(path.join(ROOT, LABELS), "utf8")));
  const config = await prettier.resolveConfig(path.join(ROOT, "package.json"));
  for (const file of [SETUP_PAGE, WEB_DOCS, BUG_FORM, LABELS]) {
    files.set(file, await prettier.format(files.get(file), { ...config, filepath: file }));
  }
  return files;
}

/** Every file a target should hold, by path relative to it. */
async function outputs(manifests) {
  const files = new Map();
  for (const file of readdirSync(path.join(SOURCE, "_lib")).filter((file) => file.endsWith(".ts"))) {
    const text = readFileSync(path.join(SOURCE, "_lib", file), "utf8");
    files.set(`_lib/${generatedName(file)}`, header(`providers/_lib/${file}`) + pointAtCopies(text));
  }
  files.set("_lib/credentialHosts.generated.ts", credentialHosts(manifests));
  for (const { id } of manifests) {
    for (const file of PROVIDER_FILES) {
      const from = `providers/${id}/${file}`;
      files.set(
        `${id}/${generatedName(file)}`,
        header(from) + pointAtCopies(readFileSync(path.join(ROOT, from), "utf8")),
      );
    }
  }
  files.set("index.generated.ts", index(manifests));
  const config = await prettier.resolveConfig(path.join(ROOT, "package.json"));
  for (const [file, text] of files) files.set(file, await prettier.format(text, { ...config, filepath: file }));
  return files;
}

/** The generated files a target holds, beside the package's own. */
function listGenerated(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listGenerated(path.join(dir, entry.name), `${prefix}${entry.name}/`)
      : GENERATED.test(entry.name)
        ? [`${prefix}${entry.name}`]
        : [],
  );
}

const check = process.argv.includes("--check");
const manifests = await loadManifests();
const files = await outputs(manifests);
const stale = [];
const docs = await docsOutputs(manifests);
for (const file of readdirSync(path.join(ROOT, DOCS_LOGOS))) {
  if (docs.has(`${DOCS_LOGOS}/${file}`)) continue;
  stale.push(`${DOCS_LOGOS}/${file}`);
  if (!check) rmSync(path.join(ROOT, DOCS_LOGOS, file));
}
for (const [file, text] of docs) {
  const out = path.join(ROOT, file);
  if (existsSync(out) && readFileSync(out, "utf8") === text) continue;
  stale.push(file);
  if (!check) writeFileSync(out, text);
}
for (const target of TARGETS) {
  const dir = path.join(ROOT, target);
  // Browser UI code never sends provider credentials; only backend and Grab need this security map.
  const targetFiles =
    target === "frontend/src/providers"
      ? new Map([...files].filter(([file]) => file !== "_lib/credentialHosts.generated.ts"))
      : files;
  for (const file of listGenerated(dir)) {
    if (targetFiles.has(file)) continue;
    stale.push(`${target}/${file}`);
    if (!check) rmSync(path.join(dir, file));
  }
  for (const [file, text] of targetFiles) {
    const out = path.join(dir, file);
    if (existsSync(out) && readFileSync(out, "utf8") === text) continue;
    stale.push(`${target}/${file}`);
    if (!check) {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, text);
    }
  }
}
if (check && stale.length) {
  console.error(`Out of date with providers/ (run npm run providers:sync):\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
if (!check) console.log(stale.length ? `Updated:\n  ${stale.join("\n  ")}` : "Up to date.");
