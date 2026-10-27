// How to write a Thingport tool: what the `tool_guide` MCP tool hands an AI before it writes one, and what
// docs/guides/tools.md explains to people. The format itself is checked by toolFormat.ts and toolsService.ts.

export const TOOL_GUIDE = `# Writing a Thingport tool

A tool is a small app that opens in a window of its own from the user's **Tools** page: a planner, a generator, a
calculator. It works with their library — it can browse and make collections, find models, read their files, and save
the models it makes. It has four parts:

1. **Metadata** (JSON or YAML): its name, icon, the size its window opens at, and the hosts it may reach.
2. **A script**: an ES module whose default export is called with \`thingport\` when the window opens.
3. **HTML** (optional): markup and a \`<style>\` block put into the window before the script runs.
4. **Labels** (optional): the words it shows, one flat map per language, so they aren't buried in the script.

Save it with the \`save_tool\` tool. The user then opens it from **Tools** in the sidebar, by double-clicking it.

A tool the user saves is theirs alone. For it to be saved at all, an admin has to have turned tools on for them and
ticked **Users' own tools** under **Administration → Tools**; \`save_tool\` says so when they haven't.

## Metadata

\`\`\`json
{
  "name": "Label maker",
  "description": "Turns a few words into a printable label, and saves it to the library.",
  "iconUrl": "builtin:thingport/tag",
  "version": "1.0.0",
  "author": "Jane Doe",
  "authorUrl": "https://github.com/janedoe",
  "window": { "width": 1100, "height": 720 },
  "hosts": [],
  "category": "generators"
}
\`\`\`

- **name**: up to 40 characters. **description**: up to 300, saying what it makes.
- **iconUrl**: best is one of Thingport's own icons, \`builtin:<group>/<name>\` such as \`builtin:thingport/tag\`:
  find one with the \`list_icons\` tool. When none fits, upload an SVG with \`upload_icon\` and use the address it
  returns, \`/api/icons/<file>\`. An http(s) image address and an SVG as a \`data:image/svg+xml\` address both work.
  Keep an icon the user already set.
- **version**: raise it when you change the tool, so the user can tell versions apart.
- **author**: leave it out and saving puts in the user's own name. **authorUrl** is optional.
- **window**: the size the window opens at, in pixels: 320-1920 wide, 240-1200 tall. A smaller screen gets what fits,
  so a tool must still work narrow. 960 x 640 if you say nothing.
- **hosts**: the hosts \`thingport.fetch\` may reach through the server, as \`host\`, \`host:port\` or \`*.domain\`.
  Leave it empty when the tool calls no outside service, which most don't. Local network hosts are fine.
- **category**: which shelf the Tools page starts it on — \`generators\`, \`planners\`, \`calculators\`, \`files\`,
  \`library\` or \`other\`. The user can move it themselves afterwards, and their move wins.
- **locales** is filled in from the labels you save; don't set it yourself.
- Only a tool in the Thingport repository may bring models of its own (a \`collection\`), because its files are what a
  reviewer reads. A tool the user saves saves what it makes into their library instead.

## Script

An ES module. Its default export is called with \`thingport\` when the window opens, and the function it returns is
called when the window closes — that is where timers and window listeners are cleaned up.

\`\`\`js
export default async function mount(thingport) {
  const { root, t, labels, models, collections, ui, download } = thingport;
  labels(); // fills every data-t in the HTML from the tool's own words

  const name = root.querySelector("#name");
  const save = root.querySelector("#save");

  save.addEventListener("click", async () => {
    const stl = buildLabel(name.value); // your geometry, as a string or an ArrayBuffer
    const collection = await collections.pick({ title: t("save.pickCollection") });
    if (!collection) return; // the user changed their mind
    const model = await models.create({
      name: name.value,
      description: t("save.notes", { text: name.value }),
      tags: ["label", "generated"],
      collectionId: collection.id,
      files: [{ name: \`\${name.value}.stl\`, data: stl }],
    });
    ui.toast(t("save.done", { name: model.name }), "success");
  });

  root.querySelector("#download").addEventListener("click", () => {
    download({ name: "label.stl", data: buildLabel(name.value) });
  });

  return () => {}; // stop timers and remove window listeners here
}
\`\`\`

The \`thingport\` argument has:

- **root**: the window's element, with the tool's HTML already in it. Draw only inside it. **selector**: a CSS
  selector for it, unique on the page, for scoping styles.
- **theme**: \`{ mode: "light" | "dark", primary, primaryContrast, background, paper, text, textSecondary, divider,
  error, warning, success, fontFamily }\`. The same colours are already on the window as CSS variables —
  \`--tp-accent\`, \`--tp-accent-ink\`, \`--tp-background\`, \`--tp-paper\`, \`--tp-text\`, \`--tp-text-muted\`,
  \`--tp-divider\`, \`--tp-error\`, \`--tp-warning\`, \`--tp-success\` and \`--tp-font\` — so a stylesheet can use them
  without the script copying anything across. Text and icons on an accent-filled button take \`--tp-accent-ink\`,
  never the paper colour, which is dark in the dark theme.
- **size**, **onResize(callback)**: the window's size in pixels, and a way to hear when it changes.
- **tool**: \`{ id, slug, name, version, source }\`.
- **storage**: \`get(key)\`, \`set(key, value)\`, \`remove(key)\`, \`keys()\`. JSON kept for this user and this tool, up
  to 1 MB a value and 20 MB a tool. Keep what the user was working on here, so the window opens where they left it.
- **collections**: \`list()\`, \`get(id)\`, \`create({ name, description, tags })\`, \`models(id)\`,
  \`add(id, modelIds)\`, \`remove(id, modelIds)\`, and \`pick({ title })\`, which asks the user for one of their
  collections or a new one and gives \`null\` when they cancel.
- **models**: \`list({ q, tags, collectionId, limit, offset })\`, \`search(q)\`, \`get(id)\`,
  \`file(id, fileId?)\` (an \`ArrayBuffer\`), \`create({ name, description, tags, collectionId, files })\` where each
  file is \`{ name, data }\` and data a \`Blob\`, \`ArrayBuffer\` or string, \`addFiles(id, files)\`,
  \`addImages(id, images)\` (the first becomes the cover), \`replaceFile(id, fileId, file)\`,
  \`update(id, { name, description, tags })\`, and \`open(id)\`, which closes the tool and opens the model's page.
- **toolModels()**: the models a repository tool brings, by the keys its metadata gave them.
- **library(name)**, **libraries**: a library Thingport carries, so the tool needn't ship it. See below.
- **fetch(url, init)**: a request made by the Thingport server to one of the metadata's \`hosts\`, answered like
  \`fetch\`, so CORS and the local network aren't in the way. Any other host throws.
- **api(path, init)**: Thingport's own API, as the user: \`api("/prints?limit=5")\`.
- **download({ name, data })**: hands the user a file to keep.
- **ui**: \`toast(message, severity)\`, \`confirm({ title, message, confirmLabel, destructive })\`, \`close()\`.
  Use these rather than \`alert\` or \`window.confirm\`, which look nothing like the rest of Thingport.
- **t(key, vars)**, **labels(where?)**, **language**, **languages**: the tool's own words. See below.

## The words it shows

A tool's labels don't belong in its script: buried there they can't be read as text or handed to a translator. So
they go beside it, a flat map of key to sentence per language, which \`save_tool\` takes as \`locales\`:

\`\`\`json
{
  "en": { "save.title": "Save to Thingport", "rings.ring": "Ring {n}" },
  "lt": { "save.title": "Įrašyti į Thingport", "rings.ring": "Žiedas {n}" }
}
\`\`\`

- Flat, because a tool looks a label up by its whole key. A key is letters, digits, \`.\`, \`-\` and \`_\`.
- \`{name}\` in a sentence is filled in from what \`t\` is given: \`t("rings.ring", { n: 2 })\`.
- **English is the fallback, key by key**, so a half-finished language shows its own words where it has them and
  English where it doesn't. A tool with labels wants \`en\`. A key with no words anywhere comes back as itself, so a
  label nobody wrote shows up in the window rather than vanishing.
- The markup carries the key where the sentence would be, and \`labels()\` fills them all in: \`data-t\` sets the
  text, and \`data-t-title\`, \`data-t-aria\` and \`data-t-placeholder\` fill those attributes. Leave readable English
  in the HTML as well — it is what someone reading the markup sees, and what shows if the labels never arrive.
- \`language\` is the language Thingport is in, and \`languages\` every language it has. The tool is started again
  when the user changes language, as it is when they change theme, so \`t\` is read at the top of \`mount\` rather
  than watched.
- At most 128 KB a language and 1 MB in all.

Write the words the user asked for in their own language. If you don't know which that is, ask, or write English and
say so.

## The libraries a tool can borrow

A tool is one script, and the big machinery lives in Thingport rather than in it. \`library(name)\` hands over
Thingport's own copy; nothing is fetched until a tool asks, and every tool after that shares it.

| \`library(…)\` | What comes back |
| --- | --- |
| \`"three"\` | Three.js, the one Thingport draws models with, plus \`mergeGeometries\` and \`mergeVertices\` |
| \`"opentype"\` | opentype.js: a glyph's real outline, counters and all |
| \`"manifold"\` | Manifold, started and ready: watertight booleans, and 2D cross-sections and offsetting |
| \`"fonts"\` | \`{ list, bytes(id), load(id) }\` — the typefaces Thingport ships, \`load\` giving one parsed by opentype |

\`\`\`js
const [{ CrossSection, Manifold }, fonts] = await Promise.all([
  thingport.library("manifold"),
  thingport.library("fonts"),
]);
const font = await fonts.load(fonts.list[0].id);
\`\`\`

The fonts are all static faces: a variable font's outlines are only right once its deltas are applied, which the
parser doesn't do, so letters come back collapsed. Load a library only when the tool actually needs it — a window
that opens instantly is worth more than one that waits on a WebAssembly download it may never use.

## Rules

- Draw only inside \`root\`, and scope every CSS rule to a class of your own so none of it reaches the rest of
  Thingport. Watch the specificity: a reset written \`.yours button { color: inherit }\` outranks
  \`.yours-button { color: … }\` and quietly wins, so wrap such a reset in \`:where()\`.
- Clean up in the returned function: timers, \`window\` listeners, observers, WebGL contexts.
- Use \`thingport.fetch\` for anything outside Thingport, and list each host in the metadata.
- Change the user's library only when they ask, and say what you did with \`ui.toast\`. Ask with \`ui.confirm\`
  before anything that can't be undone.
- Take colours from the theme or the \`--tp-*\` variables, and check both themes. Never hard-code a hex colour.
- Keep it dense and scannable: short labels, tight spacing, an explanation behind a \`?\` rather than a paragraph in
  the window. Secondary actions belong in a menu behind a \`⋮\` button.
- Keep what the user was working on in \`storage\`, so the window opens where they left it.
- Animate state changes briefly (150-300 ms) with \`transform\` and \`opacity\`, and honour
  \`@media (prefers-reduced-motion: reduce)\`.
- Give an icon-only button an \`aria-label\`, make everything work by keyboard, and leave focus visible.
- Plain JavaScript: no build step and no npm imports. A library from a CDN can be loaded with
  \`await import("https://esm.sh/…")\`, but Thingport's own libraries are better.
- Say what went wrong, in the window, rather than leaving it empty: a tool that can't build says which setting to
  change.

## What to do after saving it

\`save_tool\` returns the tool's id and slug. Tell the user to open **Tools** in the sidebar and double-click it;
its ⋮ menu has **About**, **Edit** and **Delete**. To change a tool, read what is there with \`list_tools\`
(\`include_code\` gives you the script, the HTML and the labels), then save it again under the same slug.

## Sharing it

To offer a tool to every Thingport, open a pull request to the Thingport repository: a folder \`tools/<slug>/\` with
\`tool.json\` (or \`tool.yml\`), \`tool.js\`, optionally \`tool.html\`, \`locales/<code>.json\` for each language its
metadata names, a \`README.md\` saying what it does and what it reaches, and optional \`screenshots/\`. Add the slug
to \`tools/index.json\`. A maintainer reads the code before it is merged; see \`docs/guides/tools.md\` and
\`tools/README.md\` in the repository for what reviewers look for.
`;
