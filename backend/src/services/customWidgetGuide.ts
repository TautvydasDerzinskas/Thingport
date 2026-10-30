// How to write a custom dashboard widget: what the `widget_guide` MCP tool hands an AI before it writes one, and what
// docs/guides/custom-widgets.md and docs/developers/ explain to people. The format itself is checked by
// customWidgetsService. What the script's `thingport` has is generated from the SDK's types (sdkReference.generated.ts),
// the same text docs/developers/sdk-reference.md shows, so it isn't written out here.

import { WIDGET_SDK_REFERENCE } from "./sdkReference.generated";

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

What the \`thingport\` argument has is listed under **What \`thingport\` has** below. The theme's colours are on the
panel as CSS variables as well (the \`SdkTheme\` table names them), so a stylesheet can use them without the script
copying anything across.

## What \`thingport\` has

${WIDGET_SDK_REFERENCE}

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
