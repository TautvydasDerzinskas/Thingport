# Tool development

How a tool (a small app that opens in a window from the **Tools** page) is built, what the format allows, and the steps
to get one into the repository. How people install and use them is in the [tools guide](guides/tools.md), which also
carries the SDK reference; what reviewers look for is in the [tools README](../tools/README.md).

A tool is plain web code: an ES module, optional markup and styles, and a JSON file saying what it is. It runs in its
user's page with their access to Thingport, so nothing about it is compiled, bundled by us, or fetched at run time —
what the review reads is what runs.

## Two kinds of tool

|                  | A user's own                              | One from the repository                                     |
| ---------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Made in          | The editor on the Tools page, or over MCP | A folder under [`tools/`](../tools), merged by pull request |
| Who sees it      | Only its author                           | Everyone an admin lets use tools, once installed            |
| Reviewed         | No                                        | Yes, before it's merged                                     |
| May bring models | No                                        | Yes, in a collection of its own                             |
| Kept in          | The database                              | The database, as installed, until an admin takes an update  |

Both run the same way and get the same SDK, so a tool written in the editor can become a repository tool by moving its
parts into a folder. This document is about that folder; the editor is covered in the guide.

## A tool's folder

| File                   | What it is                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `tool.json`/`tool.yml` | The metadata below. JSON or YAML, whichever you prefer                                   |
| `tool.js`              | An ES module whose default export Thingport calls with `thingport`                       |
| `tool.html`            | Optional markup and a `<style>` block, put into the window before the script runs        |
| `locales/<code>.json`  | The words it shows, one file per language its metadata names                             |
| `screenshots/`         | Pictures of it at work, which admins look through before installing it                   |
| `README.md`            | What it does, what it reaches and why, and where its models come from                    |
| `source/`              | Optional: what `tool.js` was built from, when it's built rather than written as one file |

The folder's name is its slug (lowercase letters, digits and dashes), and it only exists for Thingport once it's listed
in [`tools/index.json`](../tools/index.json).

### The metadata

| Field         | Limits                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `name`        | 1–40 characters. Required                                                                      |
| `description` | Up to 300 characters, shown to admins and in **About**                                         |
| `version`     | Up to 20 characters, `1.0.0` by default. Raise it and admins are offered the update            |
| `author`      | Up to 60 characters, with an optional `authorUrl`. The validator insists on an author          |
| `iconUrl`     | An image address, `builtin:<group>/<name>`, `/api/icons/<file>`, or an SVG as a `data:` URL    |
| `window`      | `{ width, height }` in pixels: 320–1920 by 240–1200, `960 × 640` by default                    |
| `hosts`       | Up to 20 host names its `thingport.fetch` may reach. Empty means it reaches nothing            |
| `category`    | `generators`, `planners`, `calculators`, `files`, `library` or `other`: the shelf it starts on |
| `locales`     | The language codes it has labels for, up to 40                                                 |
| `screenshots` | Up to 8 `{ "file", "caption" }`, captions up to 200 characters                                 |
| `collection`  | The models it brings, below                                                                    |

An SVG `iconUrl` keeps the icon inside the metadata, which is why the tools here use one.

### The script

```js
export default async function mount(thingport) {
  const { root, theme, storage, models, collections, ui, t } = thingport;
  // draw into root, and keep every listener and timer you make
  return () => {
    /* called when the window closes: stop timers, remove window listeners */
  };
}
```

What `thingport` carries — storage, models, collections, `fetch`, `library()`, `ui`, `t()` and the rest — is listed in
[what a tool's script gets](guides/tools.md#what-a-tools-script-gets). The rules the format itself enforces, or the
review does:

- It draws only inside `thingport.root` and scopes its styles to a class of its own. Wrap a reset in `:where()` so it
  doesn't outrank your own classes.
- Colours come from the theme: the CSS variables (`--tp-accent`, `--tp-paper`, `--tp-text`, …) or `thingport.theme`.
  Both themes are then right without the tool knowing which is on.
- Anything outside Thingport goes through `thingport.fetch`, to a host the metadata lists, and the README says why.
- It changes the user's library only when they ask, and says what it did through `ui.toast`.
- No minified or obfuscated code, and nothing loaded at run time the review can't see. A built `tool.js` comes with its
  `source/` and a header saying what built it.

A heavy library doesn't have to be bundled: `thingport.library("three" | "opentype" | "manifold" | "fonts" |
"openscad")` hands over the copy Thingport already ships, loaded once and shared between tools.

`"openscad"` is the engine for a tool that draws rather than reads: `parameters(script)` says what settings a script
offers and `render(script, { parameters, format })` gives the model those settings make, as the file's bytes and as
the geometry behind them. The 3MF writer comes with it — `writeThreeMf(parts, { name })`, `layoutRow(parts)` and
`meshBounds(mesh)` — so a tool that works out a dozen parts saves one 3MF with each of them named inside, rather
than handing over a dozen downloads. A 3MF carries one copy of a shape however many are wanted, so a part's name is
where its count belongs: `"8x8 Core Tile x4"`.

### The words it shows

Labels live in `locales/<code>.json`, not in the script, so a tool can be translated without touching its code. The
script asks for them with `t("key")`, or `thingport.labels()` fills every `data-t` in the markup. English is the
fallback key by key, so a half-finished translation shows its own words where it has them and English where it doesn't.
A file is up to 128 KB, and all of them together up to 1 MB. The guide's
[the words a tool shows](guides/tools.md#the-words-a-tool-shows) has the shape of a file.

### The models it brings

A repository tool may bring the models it needs — a planner's parts, a generator's templates — in a collection of its
own, **Tool: &lt;name&gt;**, in the library of everyone who can use tools:

```json
"collection": {
  "name": "Bin parts",
  "models": [
    { "key": "baseplate", "name": "Baseplate 1×1", "files": ["models/baseplate.stl"] },
    { "key": "tile-8x8", "name": "8×8 tile", "source": "https://thangs.com/m/974214" }
  ]
}
```

- Each model has a `key` the script finds it by, a `name`, and either `files` or a `source`, never both.
- `files` are `.stl`, `.3mf`, `.step` or `.obj` files in the tool's folder, in plate order: up to 20 a model, 50 MB a
  file and 250 MB for the folder. Only for designs whose licence lets this repository carry them.
- `source` is a model page Thingport imports from when an admin installs the tool, as that admin: for designs that may
  be downloaded but not passed on.
- Up to 300 models, each `key` used once.
- The files are the tool's, kept once for the instance however many people use it; each user gets their own model
  pointing at them.

Changing the `collection` replaces everyone's copies, so give a changed file a new name or key rather than editing it in
place. A tool installed without its models still works — `fetchToolModels(keys)` brings in the few a piece of work
needs.

### Screenshots

Admins look through these before installing, so show the tool working, not an empty window.

- PNG, JPEG or WebP, up to 8 of them, 5 MB each. WebP at around 80% quality is what the tools here use.
- Shoot the window's content at the size the metadata asks for, at 2× — a `1320 × 840` window gives a `2640 × 1680`
  picture — and nothing around it: no browser, no Thingport chrome.
- Show the light theme and the dark one, since both are what users see.
- Give each a caption saying what it's showing, not what the tool is.

## Working on one locally

Run Thingport from a checkout (`npm run dev`, see [DEVELOPMENT.md](DEVELOPMENT.md)) and **Administration → Tools**
offers the checkout's own `tools` folder, read afresh each time: edit a file, install or update the tool, and reload.
`TOOLS_DIR` points the backend at any other folder, and `TOOLS_URL` at a fork's `tools` folder on GitHub; the guide's
[where the tools come from](guides/tools.md#where-the-tools-come-from) has the whole table.

Before opening a pull request:

```sh
cd backend && npx tsx scripts/validateTools.ts # what CI runs: metadata, script, labels, models, screenshots
```

It checks the folder the way Thingport reads it when an admin installs the tool, for every tool in `index.json`, and
[`.github/workflows/tools.yml`](../.github/workflows/tools.yml) runs the same thing on every pull request that touches
`tools/`. A tool built from `source/` builds and tests itself with plain Node — see the QR code generator's
`source/build.mjs` and `source/test_qr.mjs` for the pattern.

## Adding one to the repository

1. Open an issue first if it's substantial, as with [providers](PROVIDER_DEVELOPMENT.md): it saves writing a tool that
   doesn't fit.
2. Make the folder under `tools/`, and add its slug to `tools/index.json`.
3. Write the `README.md`: what it does, every host it reaches and why, and where any models come from, with their
   licences.
4. Run the validator, and check it in both themes and in English at least.
5. Open the pull request. A maintainer reads the script — see the [tools README](../tools/README.md) for what that
   looks for.

After it's merged, any change raises `version`, so admins are offered the update; the tool stays exactly as installed on
every instance until each admin takes it.
