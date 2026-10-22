# Custom dashboard widgets

A custom widget is a dashboard panel you write yourself, or install from the community: a short JavaScript module that
draws into the panel, plus a little metadata saying what it's called and what can be set. Once added, it behaves like
any other panel: you move it, resize it, put it in tabs, add it more than once and change its settings from its cog.

Open them from **Edit → Add panel → Manage custom widgets**, or **Customize dashboard → Custom widgets**:

- **Mine**: the widgets you've written or installed. **New widget** opens the editor with a working example to start from.
- **Community**: widgets shared in the [Thingport repository](../../community-widgets), ready to install.
- **Build & share**: how to have an AI write one, and how to publish yours.

A widget is yours alone: other users on the same Thingport don't see it unless they install it too.

> [!WARNING]
> A widget's script runs in your dashboard with your access to Thingport, like code you paste into the browser console.
> Only write or install widgets you trust. An installed community widget stays exactly as you installed it: an update
> is offered when its author changes it, and you approve it again before it runs. An admin can turn custom widgets off
> for the whole instance under **Administration → Auth → Custom widgets**.

## Have an AI write one

The quickest way to make a widget is to describe it to an AI assistant connected to Thingport.

1. [Connect your assistant over MCP](mcp.md) with your API token.
2. In the token's permissions, allow **Save a dashboard widget** (`save_widget`). It's off until you turn it on.
3. Ask for what you want, e.g. _"Make me a Thingport widget showing my OctoPrint printer's progress. It's at
   http://octopi.local."_ The assistant reads the `widget_guide` tool first, which teaches it the format below, then
   saves the widget.
4. Add it from **Add panel** while editing your dashboard. To change it, ask again; `list_widgets` lets the assistant
   read what it wrote before.

## What a widget is made of

### Metadata

JSON or YAML:

```yaml
name: Print farm status
description: Shows each OctoPrint printer's state and progress.
icon: 🖨️
iconUrl: https://example.com/octoprint.svg
version: 1.0.0
author: Jane Doe
authorUrl: https://github.com/janedoe
size: { w: 4, h: 4, minW: 3, minH: 2 }
settings:
  - { key: baseUrl, type: text, label: OctoPrint address, placeholder: "http://octopi.local" }
  - { key: apiKey, type: text, label: API key, secret: true }
  - { key: showTemps, type: toggle, label: Show temperatures, default: true }
  - key: refresh
    type: choice
    label: Refresh
    default: "30"
    options: [{ value: "10", label: 10 s }, { value: "30", label: 30 s }]
hosts: [octopi.local]
```

| Field         | What it is                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `name`        | Up to 40 characters.                                                                                             |
| `description` | Up to 300 characters, shown in the list of widgets.                                                              |
| `iconUrl`     | Optional: an `http(s)` address of the icon's image, shown in place of `icon`. Prefer an SVG: it stays sharp.     |
| `icon`        | Optional, shown without `iconUrl`: an emoji or an SVG `data:` address.                                           |
| `author`      | Your full name. Left out, saving fills in the name from your profile; community widgets need one.                |
| `authorUrl`   | Optional: a page of yours, such as your GitHub profile, linked from your name.                                   |
| `size`        | Its size when added, in grid cells (12 columns wide; rows 64 px tall). `minW`/`minH` limit how small it resizes. |
| `settings`    | What its cog lets you change: `text` (`secret: true` for tokens), `number`, `toggle` or `choice` (2 to 8).       |
| `hosts`       | The hosts `thingport.fetch` may call: `host`, `host:port` or `*.domain`. Local network addresses are fine.       |

### Script

An ES module whose default export draws the widget. It's called each time the panel appears, and again when its
settings or the theme change; the function it returns, if any, cleans up first.

```js
export default function mount(thingport) {
  const { root, settings, theme } = thingport;
  root.innerHTML = `<div class="state" style="padding:16px;color:${theme.text}">Loading…</div>`;
  const state = root.querySelector(".state");

  async function refresh() {
    const res = await thingport.fetch(`${settings.baseUrl}/api/printer`, { headers: { "X-Api-Key": settings.apiKey } });
    state.textContent = res.ok ? (await res.json()).state.text : "Couldn't reach OctoPrint";
  }
  refresh();
  const timer = setInterval(refresh, Number(settings.refresh) * 1000);
  return () => clearInterval(timer);
}
```

Its `thingport` argument:

| Property             | What it is                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `root`               | The element to draw into. It fills the panel.                                                                              |
| `selector`           | A CSS selector for `root`, unique on the page, to scope styles: `${selector} .state { … }`.                                |
| `size`               | `{ width, height }` in pixels and `{ cols, rows }` in grid cells, kept current as the panel is resized.                    |
| `onResize(callback)` | Calls `callback(size)` when the size changes; returns a function that stops it.                                            |
| `settings`           | The panel's settings, defaults filled in. Toggles are booleans; the rest are strings.                                      |
| `theme`              | `mode`, `primary`, `background`, `paper`, `text`, `textSecondary`, `divider`, `fontFamily`.                                |
| `fetch(url, init)`   | Like `fetch`, but made by the Thingport server, so CORS and your network don't get in the way. Only `hosts`; others throw. |
| `api(path, init)`    | Calls Thingport's own API as you, e.g. `thingport.api("/dashboard/summary")`.                                              |
| `widgetId`           | The widget's id, and `instanceId` the panel's, when it's on the dashboard more than once.                                  |

### HTML

Optional markup put into the panel before the script runs. Put a widget's CSS in a `<style>` element here, scoped
with class names of its own.

## Publishing to the community

1. Under **Mine**, open your widget's ⋮ menu and choose **Download for publishing**. You get a zip with its
   `widget.json`, `widget.js`, `widget.html` (if it has one) and a `README.md` to fill in.
2. Fork the [Thingport repository](https://github.com/TautvydasDerzinskas/Thingport) and unzip it into
   `community-widgets/<slug>/`.
3. Add `<slug>` to `community-widgets/index.json`, and say in the README what it does and which services it calls.
4. Open a pull request. A check validates the widget, and a maintainer reads its code before merging; the
   [community widgets README](../../community-widgets/README.md) says what they look for.

Once merged, it shows up under **Community** on every Thingport. Raise its `version` when you change it, and users
who installed it are offered the update.

To try the folder before opening the pull request, run `npx tsx scripts/validateCommunityWidgets.ts` from `backend/`.
A Thingport reads the community widgets from GitHub's `main` branch; set `COMMUNITY_WIDGETS_URL` to read them from
somewhere else, such as your fork.
