// How to write a custom dashboard widget: what the `widget_guide` MCP tool hands an AI before it writes one, and what
// docs/guides/custom-widgets.md explains to people. The format itself is checked by customWidgetsService.

export const CUSTOM_WIDGET_GUIDE = `# Writing a Thingport dashboard widget

A widget is a panel on the user's Thingport dashboard. It has four parts:

1. **Metadata** (JSON or YAML): its name and what the user can set.
2. **A script**: an ES module whose default export draws the widget into the panel.
3. **HTML** (optional): markup put into the panel before the script runs. Put CSS in a <style> element here.
4. **Labels** (optional): the words it shows, one flat map per language, so they aren't buried in the script.

Save it with the \`save_widget\` tool, labels and all. The user then adds it from **Add panel** while editing their
dashboard.

## Metadata

\`\`\`json
{
  "name": "Print farm status",
  "description": "Shows each OctoPrint printer's state and progress.",
  "iconUrl": "builtin:services/octoprint",
  "version": "1.0.0",
  "author": "Jane Doe",
  "authorUrl": "https://github.com/janedoe",
  "size": { "w": 4, "h": 4, "minW": 3, "minH": 2 },
  "settings": [
    { "key": "baseUrl", "type": "text", "label": "OctoPrint address", "placeholder": "http://octopi.local" },
    { "key": "apiKey", "type": "text", "label": "API key", "secret": true },
    { "key": "refresh", "type": "choice", "label": "Refresh", "default": "30",
      "options": [{ "value": "10", "label": "10 s" }, { "value": "30", "label": "30 s" }] },
    { "key": "showTemps", "type": "toggle", "label": "Show temperatures", "default": true },
    { "key": "maxJobs", "type": "number", "label": "Jobs shown", "default": 5 }
  ],
  "hosts": ["octopi.local", "*.example.com"]
}
\`\`\`

- **name**: up to 40 characters. **description**: up to 300.
- **iconUrl**: the widget's icon. Best is one of Thingport's own icons, \`builtin:<group>/<name>\`, such as
  \`builtin:services/octoprint\` or \`builtin:thingport/hourglass\`: find one with the \`list_icons\` tool. When none
  fits, upload an SVG with \`upload_icon\` and use the address it returns, \`/api/icons/<file>\`; an http(s) image
  address works too. Prefer an SVG with a transparent background, which stays sharp from the 16 px tab icon up. Keep
  an icon the user already set. There's no emoji icon.
- **author**: the author's full name. Leave it out and saving puts in the user's name from their profile.
  **authorUrl**: optional, a page of theirs, such as a GitHub profile.
- **size**: the panel's size when added, in grid cells. The wide grid is 12 columns; a row is 64 px tall, with 16 px
  between cells. \`minW\`/\`minH\` are the smallest the user can resize it to.
- **settings**: what the user can change from the panel's cog. Each has a \`key\` (letters, digits, \`_\`) and a
  \`label\`. The types are:
  - \`text\`, with an optional \`placeholder\`; \`secret: true\` shows it as a password field, for tokens.
  - \`number\`.
  - \`toggle\`, a switch.
  - \`choice\`: 2 to 8 \`options\`, each \`{ value, label }\`.
- **hosts**: the hosts \`thingport.fetch\` may reach, as \`host\`, \`host:port\` or \`*.domain\` for its subdomains.
  Leave it empty if the widget calls no outside service. Local network hosts are fine.
- **locales** is filled in from the labels you save, so don't set it yourself.
- **screenshots** belong only to a widget shared through the repository, which carries the image files beside its
  metadata. Saving one of the user's own with \`screenshots\` is refused, so leave the field out; add it when you
  prepare the folder for a pull request (see **Sharing it**).

## Script

An ES module. Its default export is called once each time the widget appears, and again whenever its settings, the
theme or the language change. It may return a cleanup function, which runs before the widget goes away or redraws.

\`\`\`js
export default function mount(thingport) {
  const { root, settings, t, labels } = thingport;
  labels(); // fills every data-t in the HTML from the widget's own words
  root.innerHTML = \`<div class="status">\${t("state.loading")}</div>\`;
  const status = root.querySelector(".status");

  async function refresh() {
    const res = await thingport.fetch(\`\${settings.baseUrl}/api/printer\`, {
      headers: { "X-Api-Key": settings.apiKey },
    });
    if (!res.ok) {
      status.textContent = t("state.unreachable");
      return;
    }
    const data = await res.json();
    status.textContent = t("state.printing", { state: data.state.text });
  }

  refresh();
  const timer = setInterval(refresh, Number(settings.refresh) * 1000);
  const stopResize = thingport.onResize(({ width }) => {
    status.style.fontSize = width < 300 ? "14px" : "18px";
  });
  return () => {
    clearInterval(timer);
    stopResize();
  };
}
\`\`\`

The \`thingport\` argument has:

- **root**: the element to draw into. It fills the panel. Draw only inside it. **selector**: a CSS selector for it,
  unique on the page, for scoping styles: \`\${selector} .status { … }\`.
- **settings**: the values of the settings the metadata declares, with their defaults filled in. Toggles are
  booleans; everything else is a string, numbers included.
- **size**: \`{ width, height }\` in pixels and \`{ cols, rows }\` in grid cells, as the user resizes the panel.
  **onResize(callback)**: calls \`callback(size)\` when that changes; returns a function that stops it.
- **theme**: \`{ mode: "light" | "dark", primary, primaryContrast, background, paper, text, textSecondary, divider,
  error, warning, success, fontFamily }\`. The same colours are already on the panel as CSS variables —
  \`--tp-accent\`, \`--tp-accent-ink\`, \`--tp-background\`, \`--tp-paper\`, \`--tp-text\`, \`--tp-text-muted\`,
  \`--tp-divider\`, \`--tp-error\`, \`--tp-warning\`, \`--tp-success\` and \`--tp-font\` — so a stylesheet in the HTML
  can use them without the script copying anything across. Text and icons on an accent-filled button take
  \`--tp-accent-ink\`, never the paper colour, which is dark in the dark theme.
- **t(key, vars)**, **labels(where?)**, **language**, **languages**: the widget's own words. See below.
- **models**: \`list({ q, tags, collectionId, limit, offset })\`, \`search(q)\`, \`get(id)\`,
  \`file(id, fileId?)\` (an \`ArrayBuffer\`), \`create({ name, description, tags, collectionId, files })\` where each
  file is \`{ name, data }\`, \`addFiles\`, \`addImages\`, \`replaceFile\`, \`update(id, { name, description, tags })\`
  and \`open(id)\`, which leaves the dashboard for the model's page. A panel usually only reads.
- **collections**: \`list()\`, \`get(id)\`, \`create({ name, description, tags })\`, \`models(id)\`,
  \`add(id, modelIds)\`, \`remove(id, modelIds)\`. A dashboard has no "save where?" dialog, so there is no
  \`collections.pick\` here (a tool has one): save into a collection the widget's settings name instead.
- **library(name)**, **libraries**: a library Thingport carries, so the widget needn't ship it: \`"three"\` to draw
  geometry, \`"opentype"\` for a font's real outlines, \`"manifold"\` for solid modelling, \`"fonts"\` for the
  typefaces Thingport ships. Fetched the first time anything asks and shared with every widget and tool after that,
  so load one only if the widget really needs it — a panel that draws itself in HTML should not pull in WebAssembly.
- **fetch(url, init)**: like \`window.fetch\`, but made by the Thingport server, so CORS and the local network aren't
  in the way. Only to the metadata's \`hosts\`: any other host throws. Returns a \`Response\`.
- **api(path, init)**: Thingport's own API as the user, e.g. \`thingport.api("/dashboard/summary")\`.
- **download({ name, data })**: hands the user a file to keep.
- **ui**: \`toast(message, severity)\`, \`confirm({ title, message, confirmLabel, destructive })\`,
  \`openModel(id)\`. Use these rather than \`alert\` or \`window.confirm\`.
- **widget**: \`{ id, slug, name, version, source }\`. **widgetId** and **instanceId**: the widget's id, and this
  panel's, where several panels show the same widget.

## The words it shows

A widget's labels don't belong in its script: buried there they can't be read as text or handed to a translator. So
they go beside it, a flat map of key to sentence per language, which \`save_widget\` takes as \`locales\`:

\`\`\`json
{
  "en": { "state.loading": "Loading…", "state.printing": "Printing {state}", "settings.refresh": "Refresh" },
  "lt": { "state.loading": "Kraunama…", "state.printing": "Spausdina {state}", "settings.refresh": "Atnaujinti" }
}
\`\`\`

- Flat, because a widget looks a label up by its whole key. A key is letters, digits, \`.\`, \`-\` and \`_\`.
- \`{name}\` in a sentence is filled in from what \`t\` is given: \`t("state.printing", { state: "Printing" })\`.
- **English is the fallback, key by key**, so a half-finished language shows its own words where it has them and
  English where it doesn't. A widget with labels wants \`en\`. A key with no words anywhere comes back as itself, so
  a label nobody wrote shows up in the panel rather than vanishing.
- The HTML carries the key where the sentence would be, and \`labels()\` fills them all in: \`data-t\` sets the text,
  and \`data-t-title\`, \`data-t-aria\` and \`data-t-placeholder\` fill those attributes. Leave readable English in the
  markup as well — it is what someone reading it sees, and what shows if the labels never arrive.
- **The metadata's own words go through the labels too.** A setting's \`label\` or \`placeholder\`, and a choice
  option's \`label\`, that is written as a label key — \`settings.refresh\` — is shown in the user's language; one
  written as a sentence is shown as it is. So the cog translates with no second place to declare anything. The
  widget's \`name\` works the same way.
- \`language\` is the language Thingport is in, and \`languages\` every language it has. The widget is drawn again
  when the user changes language, as it is when they change theme, so \`t\` is read at the top of \`mount\` rather
  than watched.
- At most 128 KB a language and 1 MB in all.

Write the words the user asked for in their own language. If you don't know which that is, ask, or write English and
say so. \`list_widgets\` with \`include_code\` gives back the labels of a widget you wrote before, so another
language can be added without rewriting it.

## Rules

- Draw only inside \`root\`, and scope CSS with \`selector\` or class names of your own. Don't change the rest of the
  page.
- Clean up in the returned function: timers, listeners, observers. The widget redraws when its settings, the theme
  or the language change.
- Use \`thingport.fetch\` for outside services, and list each host in the metadata.
- Take colours from \`thingport.theme\` or the \`--tp-*\` variables, never a hard-coded hex, and check both themes.
  Keep the text short; the panel can be small.
- Keep every word the widget shows in its labels, and ask for it with \`t()\`.
- Change the user's library only when they ask, and say what you did with \`ui.toast\`.
- Plain JavaScript: no build step, no npm imports. A library from a CDN can be loaded with
  \`await import("https://esm.sh/...")\`, but Thingport's own are better.
- Show a short message when something fails, rather than an empty panel.

## Sharing it

To share a widget with everyone, open a pull request to the Thingport repository. Add a folder
\`community-widgets/<slug>/\` with:

- \`widget.json\` (or \`widget.yml\`) — the metadata, now with \`locales\` listing the languages and \`screenshots\`
  listing the pictures, each \`{ "file", "caption" }\`, up to eight.
- \`widget.js\`, and \`widget.html\` if it has one.
- \`locales/<code>.json\` for each language the metadata names, as above. A language it names without a file is an
  error, not a shrug, so a missing translation can't be merged quietly.
- \`screenshots/<name>.png\` (or .jpg, .webp), up to 5 MB each: what it looks like on a dashboard, which is what
  someone looks at before installing it.
- \`README.md\` saying what it does and which services it calls.

Then add the slug to \`community-widgets/index.json\`. Once it's merged, every Thingport can install it from the
Community tab, screenshots and all.
`;
