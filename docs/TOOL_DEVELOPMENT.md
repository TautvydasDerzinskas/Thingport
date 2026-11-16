# Tool development

How a tool (a small app that opens in a window from the **Tools** page) is built, what the format allows, and the steps
to get one into the repository. How people install and use them is in the [tools guide](guides/tools.md), what a tool's script
gets is in the [SDK reference](developers/sdk-reference.md), and what reviewers look for is in the
[tools README](../tools/README.md). [Your first tool](developers/first-tool.md) builds one step by step.

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
| `version`     | Up to 20 characters, `1.0.0` by default. Shown to admins, and what **Update** offers them      |
| `author`      | Up to 60 characters, with an optional `authorUrl`. The validator insists on an author          |
| `iconUrl`     | An image address, `builtin:<group>/<name>`, `/api/icons/<file>`, or an SVG as a `data:` URL    |
| `window`      | `{ width, height }` in pixels: 320–1920 by 240–1200, `960 × 640` by default                    |
| `hosts`       | Up to 20 host names its `thingport.fetch` may reach. Empty means it reaches nothing            |
| `category`    | `generators`, `planners`, `calculators`, `files`, `library` or `other`: the shelf it starts on |
| `locales`     | The language codes it has labels for, up to 40                                                 |
| `screenshots` | Up to 8 `{ "file", "caption" }`, captions up to 200 characters                                 |
| `collection`  | The models it brings, below                                                                    |
| `commands`    | Up to 10 things it offers on a model's page, below                                             |
| `modelInfo`   | `{ title, command }`: a part of every model's page showing what its users shared, below        |

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

What `thingport` carries — storage, models, collections, `fetch`, `library()`, `ui`, `t()` and the rest — is in the
[SDK reference](developers/sdk-reference.md). The rules the format itself enforces, or the
review does:

- It draws only inside `thingport.root` and scopes its styles to a class of its own. Wrap a reset in `:where()` so it
  doesn't outrank your own classes.
- Colours come from the theme: the CSS variables (`--tp-accent`, `--tp-paper`, `--tp-text`, …) or `thingport.theme`.
  Both themes are then right without the tool knowing which is on.
- Anything outside Thingport goes through `thingport.fetch`, to a host the metadata lists, and the README says why.
- It changes the user's library only when they ask, and says what it did through `ui.toast`, with `openModel` on a
  toast about a model it saved, so the toast has an Open button.
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

### Commands on a model's page

A tool that works on a model can offer that from the model's page: its `commands` show in the menu beside the Open
button, under **Tools**, after a divider. Thingport reads them from the metadata, so it lists them without running the
tool, and a tool with none changes nothing there.

```json
"commands": [
  { "id": "estimate", "title": "Estimate print cost", "on": "file", "fileTypes": ["stl", "3mf", "gcode"] },
  { "id": "queue", "title": "Add to my print queue", "window": false }
]
```

| Field       | What it does                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `id`        | 1–40 lowercase letters, digits and dashes, different for each command                              |
| `title`     | Up to 60 characters. A label `commands.<id>` in `locales/` translates it                           |
| `on`        | `"model"` (default) for the model, or `"file"` for the file picked on the page                     |
| `fileTypes` | For `"file"`: the endings it takes, without the dot (`"stl"`, `"gcode.3mf"`); any file when absent |
| `window`    | `true` (default) opens the tool's window; `false` calls its `run` export with no window            |

A command that opens the window finds what it was picked on in `thingport.context`: `{ command, modelId, fileId }`,
`fileId` being one of the model's `files` for a command on a file (the prepared print isn't one, so a file command
isn't offered for it). One with `"window": false` gets the same `thingport` in its `run` export, and reports back
through `ui.toast`, asking through `ui.confirm` where it must:

```js
export async function run(command, thingport) {
  const { modelId } = thingport.context;
  // …do it, then say so
  thingport.ui.toast(thingport.t("queued"), "success");
}
```

Print cost estimator's **Estimate print cost** is the example in this repository.

### Shared with the tool's other users

`thingport.storage` is each user's own. `thingport.shared` is what a tool's users share with each other, such as a print
queue the household keeps together:

- **Each entry is its writer's.** `set(key, value)` and `remove(key)` change only the user's own entries, and two
  users' entries under the same key are two entries. `list({ prefix })` reads everyone's, newest first, with who wrote
  each one and whether it's `mine`: 5,000 a read, and `before` set to the last one's `cursor` reads the next ones.
- **Who reads them is the writer's choice.** Everyone who can use tools, unless they keep theirs to the people they
  pick: `share()` opens Thingport's own dialog for that, and `audience()` says what they chose.
- **An entry can be about a model.** `set(key, value, { model })` ties it to a model the user can open, and
  `list({ model })` finds everyone's entries about that model or any copy of it: the same original, or imported from
  the same page. That's how a tool warns that someone else has the model queued.

A tool whose metadata has `modelInfo` gets a part of every model's page, titled `title` (a label `modelInfo.title`
translates it). An entry set with `info` shows there as a chip: the writer's avatar, a dot coloured by `tone` and a
`label`, which is one of the tool's label keys so each reader sees their own language. Each person's latest entry about
the model shows, and clicking it opens the tool's window on the model. `command`, one of the tool's commands, is offered
there as a chip of its own:

```js
await thingport.shared.set(
  `about:${modelId}`,
  { jobs: 2 },
  {
    model: modelId,
    info: { label: "status.printing", tone: "active", date: new Date().toISOString() },
  },
);
```

Tones are `waiting`, `active`, `done`, `failed` and `neutral`. A value is at most 256 KB as JSON, and a user shares at
most 5 MB and 5,000 entries a tool. Nothing in a shared value should be private to its writer: a model's thumbnail
address, for one, carries their session, so read it as the viewer instead. **Print queue** in this repository uses all
of it.

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
offers the checkout's own `tools` folder, read afresh each time: edit a file, install the tool or take the **Update**
its tile then offers, and reload.
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

After it's merged, raise `version` with every change. In **Administration → Tools**, an installed tool's tile carries a
blue **Update** chip, offering the new version, wherever its metadata, script, markup or labels differ from the
repository's, and a green **Latest** where they don't; the tool stays exactly as installed on every instance until an
admin takes the update. An update brings the tool's models only where the instance already has them: one that
installed it without them, or whose installed version brought none, gets a newly added collection only when an admin
imports it from the tool's details.
