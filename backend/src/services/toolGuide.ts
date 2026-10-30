// How to write a Thingport tool: what the `tool_guide` MCP tool hands an AI before it writes one, and what
// docs/guides/tools.md and docs/developers/ explain to people. The format itself is checked by toolFormat.ts and
// toolsService.ts. What the script's `thingport` has is generated from the SDK's types (sdkReference.generated.ts), the
// same text docs/developers/sdk-reference.md shows, so it isn't written out here.

import { TOOL_SDK_REFERENCE } from "./sdkReference.generated";

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

What the \`thingport\` argument has is listed under **What \`thingport\` has** below. The theme's colours are on the
window as CSS variables as well (the \`SdkTheme\` table names them), so a stylesheet can use them without the script
copying anything across.

## What \`thingport\` has

${TOOL_SDK_REFERENCE}

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
- At most 128 KB a language and 1 MB in all.

Write the words the user asked for in their own language. If you don't know which that is, ask, or write English and
say so.

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
