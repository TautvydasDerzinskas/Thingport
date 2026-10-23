// How to write a custom dashboard widget: what the `widget_guide` MCP tool hands an AI before it writes one, and what
// docs/guides/custom-widgets.md explains to people. The format itself is checked by customWidgetsService.

export const CUSTOM_WIDGET_GUIDE = `# Writing a Thingport dashboard widget

A widget is a panel on the user's Thingport dashboard. It has three parts:

1. **Metadata** (JSON or YAML): its name and what the user can set.
2. **A script**: an ES module whose default export draws the widget into the panel.
3. **HTML** (optional): markup put into the panel before the script runs. Put CSS in a <style> element here.

Save it with the \`save_widget\` tool. The user then adds it from **Add panel** while editing their dashboard.

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

## Script

An ES module. Its default export is called once each time the widget appears, and again whenever its settings
change. It may return a cleanup function, which runs before the widget goes away or redraws.

\`\`\`js
export default function mount(thingport) {
  const { root, settings } = thingport;
  root.innerHTML = \`<div class="status">Loading…</div>\`;
  const status = root.querySelector(".status");

  async function refresh() {
    const res = await thingport.fetch(\`\${settings.baseUrl}/api/printer\`, {
      headers: { "X-Api-Key": settings.apiKey },
    });
    if (!res.ok) {
      status.textContent = "Couldn't reach OctoPrint";
      return;
    }
    const data = await res.json();
    status.textContent = data.state.text;
  }

  refresh();
  const timer = setInterval(refresh, Number(settings.refresh) * 1000);
  const stopResize = thingport.onResize(({ width, height }) => {
    status.style.fontSize = width < 300 ? "14px" : "18px";
  });
  return () => {
    clearInterval(timer);
    stopResize();
  };
}
\`\`\`

The \`thingport\` argument has:

- **root**: the element to draw into. It fills the panel. Draw only inside it.
- **selector**: a CSS selector for \`root\`, unique on the page, for scoping styles: \`\${selector} .status { … }\`.
- **size**: \`{ width, height }\` in pixels, and \`{ cols, rows }\` in grid cells. It changes as the user resizes the
  panel.
- **onResize(callback)**: calls \`callback(size)\` whenever the size changes. Returns a function that stops it.
- **settings**: the values of the settings the metadata declares, with their defaults filled in. Toggles are
  booleans; everything else is a string, numbers included.
- **theme**: \`{ mode: "light" | "dark", primary, background, paper, text, textSecondary, divider, fontFamily }\`, the
  dashboard's colours. Use them so the widget fits both themes.
- **fetch(url, init)**: like \`window.fetch\`, but made by the Thingport server, so CORS and the local network aren't in
  the way. Only to the metadata's \`hosts\`: any other host throws. Returns a \`Response\`; read it with \`.json()\` or \`.text()\`.
- **api(path, init)**: calls Thingport's own API as the user, e.g. \`thingport.api("/dashboard/summary")\`.
- **widgetId**: the widget's id, and **instanceId**: this panel's, if several panels show the same widget.

## Rules

- Draw only inside \`root\`, and scope CSS with \`selector\` or class names of your own. Don't change the rest of the
  page.
- Clean up in the returned function: timers, listeners, observers. The widget redraws when its settings change.
- Use \`thingport.fetch\` for outside services, and list each host in the metadata.
- Take colours from \`thingport.theme\`. Keep the text short; the panel can be small.
- Plain JavaScript: no build step, no npm imports. A library from a CDN can be loaded with
  \`await import("https://esm.sh/...")\`.
- Show a short message when something fails, rather than an empty panel.

## Sharing it

To share a widget with everyone, open a pull request to the Thingport repository. Add a folder
\`community-widgets/<slug>/\` with \`widget.json\` (or \`widget.yml\`), \`widget.js\`, optionally \`widget.html\`, and a
\`README.md\` saying what it does. Then add the slug to \`community-widgets/index.json\`. Once it's merged, every
Thingport can install it from the Community tab.
`;
