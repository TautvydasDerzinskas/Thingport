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
> is offered when its author changes it, and you approve it again before it runs. An admin can turn users' own widgets and
> community widgets off separately for the whole instance under **Administration → Dashboard**, which also lists the
> widgets in use.

## Have an AI write one

The quickest way to make a widget is to describe it to an AI assistant connected to Thingport.

1. [Connect your assistant over MCP](mcp.md) with your API token.
2. A new token already allows **Save a dashboard widget** (`save_widget`) and **Upload an icon** (`upload_icon`). For
   its icon, the assistant searches Thingport's icons with `list_icons`, and uploads one of its own when none fits.
3. Ask for what you want, e.g. _"Make me a Thingport widget showing my OctoPrint printer's progress. It's at
   http://octopi.local."_ The assistant reads the `widget_guide` tool first, which teaches it the format below, then
   saves the widget — labels and all, so ask for it in whichever languages you want.
4. Add it from **Add panel** while editing your dashboard. To change it, ask again; `list_widgets` lets the assistant
   read what it wrote before.

[Build with an AI assistant](../developers/ai-assistant.md) has more: the permissions it needs, example prompts, and
checking what it made.

## What a widget is made of

This is the shape of one. To write your own, start with [your first widget](../developers/first-widget.md), a
step-by-step example; the [developer docs](../developers/overview.md) cover how a widget runs, the SDK and recipes.

### Metadata

JSON or YAML:

```yaml
name: Print farm status
description: Shows each OctoPrint printer's state and progress.
iconUrl: builtin:services/octoprint
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

| Field         | What it is                                                                                                                                                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | Up to 40 characters.                                                                                                                                                                                                                                                                                                       |
| `description` | Up to 300 characters, shown in the list of widgets.                                                                                                                                                                                                                                                                        |
| `iconUrl`     | Optional: its icon, picked in the editor's icon browser: one of Thingport's own, such as `builtin:thingport/hourglass` or `builtin:services/octoprint`, one you uploaded (`/api/icons/…`, which only your Thingport has), or an `http(s)` image address. Prefer an SVG: it stays sharp. Without one, a jigsaw piece shows. |
| `author`      | Your full name. Left out, saving fills in the name from your profile; community widgets need one.                                                                                                                                                                                                                          |
| `authorUrl`   | Optional: a page of yours, such as your GitHub profile, linked from your name.                                                                                                                                                                                                                                             |
| `size`        | Its size when added, in grid cells (12 columns wide; rows 64 px tall). `minW`/`minH` limit how small it resizes.                                                                                                                                                                                                           |
| `settings`    | What its cog lets you change: `text` (`secret: true` for tokens), `number`, `toggle` or `choice` (2 to 8).                                                                                                                                                                                                                 |
| `hosts`       | The hosts `thingport.fetch` may call: `host`, `host:port` or `*.domain`. Local network addresses are fine.                                                                                                                                                                                                                 |
| `locales`     | The languages it has labels for. Filled in from the **Labels** tab when you save, so there's nothing to type here.                                                                                                                                                                                                         |
| `screenshots` | Only for a widget shared through the repository, which carries the image files: each `{ file, caption }`, up to eight.                                                                                                                                                                                                     |

### Script

An ES module whose default export draws the widget. It's called each time the panel appears, and again when its
settings, the theme or the language change; the function it returns, if any, cleans up first.

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

Its `thingport` argument has the panel's element, size and settings, the theme, the widget's own words, your
library, `fetch` through Thingport to the hosts it declares, Thingport's own API, and the libraries Thingport carries.
Each is in the [SDK reference](../developers/sdk-reference.md), generated from the SDK itself.

### HTML

Optional markup put into the panel before the script runs. Put a widget's CSS in a `<style>` element here, scoped
with class names of its own. The theme is already on the panel as the `--tp-*` variables above, so the stylesheet
can use them without the script copying anything across.

### The words it shows

A widget's words don't belong in its script: buried there they can't be read as text or handed to a translator. The
editor's **Labels** tab keeps them beside it instead, one file per language, a flat map of key to sentence:

```
en.json   { "state.loading": "Loading…", "state.printing": "Printing {state}" }
lt.json   { "state.loading": "Kraunama…", "state.printing": "Spausdina {state}" }
```

The script asks for them by key — `t("state.printing", { state })` — and `{name}` is filled in from what you pass.
**English is the fallback, key by key**, so a half-finished language shows its own words where it has them and
English where it doesn't; a key with no words anywhere comes back as itself, so nothing silently disappears.

The markup can carry the keys instead: `data-t` sets an element's text, and `data-t-title`, `data-t-aria` and
`data-t-placeholder` fill those attributes. `labels()` fills them all in, and running it again after adding markup
is harmless.

A setting's **label** or **placeholder**, and a choice option's label, that is written as a label key — like
`settings.refresh` — is shown in your language too, so the panel's cog needs nothing extra. One written as a
sentence is shown as it is. The widget's `name` works the same way on the dashboard.

The widget is drawn again when you change language, as it is when you change theme, so `t` is read at the top of
the script rather than watched. At most 128 KB a language and 1 MB in all.

## Publishing to the community

1. Under **Mine**, open your widget's ⋮ menu and choose **Download for publishing**. You get a zip with its
   `widget.json`, `widget.js`, `widget.html` (if it has one), its `locales/<code>.json` files and a `README.md` to
   fill in.
2. Fork the [Thingport repository](https://github.com/TautvydasDerzinskas/Thingport) and unzip it into
   `community-widgets/<slug>/`.
3. Add a `screenshots/` folder with a picture or two of it on a dashboard, and list them under `screenshots` in
   `widget.json` as `{ "file", "caption" }`: they're what someone looks through under **Community** before
   installing it.
4. Add `<slug>` to `community-widgets/index.json`, and say in the README what it does and which services it calls.
5. Open a pull request. A check validates the widget, and a maintainer reads its code before merging; the
   [community widgets README](../../community-widgets/README.md) says what they look for.

Once merged, it shows up under **Community** on every Thingport. Raise its `version` when you change it, and users
who installed it are offered the update.

To try the folder before opening the pull request, run `npx tsx scripts/validateCommunityWidgets.ts` from `backend/`.
A Thingport reads the community widgets from GitHub's `main` branch, or `develop` on the `:dev` image; set
`COMMUNITY_WIDGETS_URL` to read them from somewhere else, such as your fork.
