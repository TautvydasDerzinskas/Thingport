# Tools

A tool is a small app that opens in a window of its own from the **Tools** page: a planner, a generator, a calculator.
It's a short JavaScript module with some HTML and CSS, like a [custom dashboard widget](custom-widgets.md), and it works
with your library: it can browse and make collections, find models, read their files, and save the models it makes.

Open **Tools** in the sidebar. Double-click a tool to open it, or press <kbd>Enter</kbd> on it; right-click it, or press
the context menu key, for **About**, **Its models** and, on your own tools, **Edit** and **Delete**.

> [!WARNING]
> A tool's script runs in your browser with your access to Thingport, like code you paste into the browser console. The
> tools in the repository are read before they're merged; only make or keep your own tools if you trust their code.

## For admins

**Administration → Tools** has three parts.

- **Who sees tools**: admins only, everyone, or admins and the users you pick. Only they see **Tools** in the sidebar and
  get the models tools bring. **Users' own tools** lets them also make their own, in the editor below; it's off at first.
- **From the repository**: the tools in the Thingport repository's [`tools`](../../tools) folder, with screenshots
  to look through first: click one to see them large, and the arrow keys move between them. **Install** makes one
  available to everyone who sees tools; **Update** appears when its author changes it. Its ⋮ menu uninstalls it.
- **Users' own tools**: the tools users made, and whose they are.

### Tools that bring models

A tool may need models: a wall planner its tiles, for example. They come in a collection of their own, **Tool:
&lt;name&gt;**, in the library of everyone who sees tools, listed after their own collections. Its models open, appear in
search, download and go to a slicer like any other, but neither they nor the collection can be edited or deleted; they
go, from every library, when you uninstall the tool. A user who loses access to tools loses them too, and gets them back
with it.

A tool's models are either files in its repository folder, or model pages Thingport imports when you install it, **as
you**: for designs that may be downloaded but not passed on, such as Multiboard's. For those, connect the provider first
(**Configuration → Providers**). The tool's row shows how many have come in; a provider that limits daily downloads, or
a sign-in that's missing, stops the fetch, and **Fetch missing models** tries the rest again later.

## Making your own

With **Users' own tools** on, **New tool** on the Tools page opens the editor:

- **Details**: its name, icon, version, author, the size its window opens at, and the hosts it may reach.
- **Script**: an ES module. The editor starts with a working tool, _Cube maker_, that uses most of what a tool can do;
  the **SDK reference** beside it lists the rest.
- **HTML & CSS**: markup and a `<style>` block, put into the window before the script runs. Scope the styles to a class
  of your own so they stay in the tool.
- **Preview**: the tool running alone, as its window will show it. Until it's saved, what it keeps lasts only as long as
  the preview, and it can't reach other hosts.

A tool you make is yours alone: other users don't see it.

## What a tool's script gets

The default export is called with `thingport` when the window opens, and the function it returns is called when the
window closes:

```js
export default async function mount(thingport) {
  const { root, theme, storage, models, collections, ui } = thingport;
  root.querySelector("#save").addEventListener("click", async () => {
    const collection = await ui.pickCollection({ title: "Save the bin to" });
    if (!collection) return;
    await models.create({ name: "Bin 2×3", collectionId: collection.id, files: [{ name: "bin.stl", data: stl }] });
    ui.toast("Saved", "success");
  });
  return () => {}; // stop timers and remove window listeners here
}
```

| `thingport.`                                                                                             | What it is                                                                                               |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `root`, `selector`                                                                                       | The window's element, with the tool's HTML in it, and a CSS selector for it                              |
| `theme`                                                                                                  | `{ mode, primary, background, paper, text, textSecondary, divider, error, success, fontFamily }`         |
| `size`, `onResize(fn)`                                                                                   | The window's size in pixels, and a way to hear when it changes                                           |
| `tool`                                                                                                   | `{ id, slug, name, version, source }`                                                                    |
| `storage.get(key)`, `set(key, value)`, `remove(key)`, `keys()`                                           | JSON kept for the user, by key: up to 1 MB a value and 20 MB a tool                                      |
| `collections.list()`, `get(id)`, `create({ name, description, tags })`                                   | The user's collections                                                                                   |
| `collections.models(id)`, `add(id, modelIds)`, `remove(id, modelIds)`                                    | A collection's models                                                                                    |
| `collections.pick({ title })`                                                                            | Asks the user for one of their collections, or a new one; `null` when they cancel                        |
| `models.list({ q, tags, collectionId, limit, offset })`, `search(q)`, `get(id)`                          | Models in the library                                                                                    |
| `models.file(id, fileId?)`                                                                               | One of a model's files, as an `ArrayBuffer`                                                              |
| `models.create({ name, description, tags, collectionId, files })`                                        | A new model; each file `{ name, data }`, data a `Blob`, `ArrayBuffer` or string                          |
| `models.addFiles(id, files)`, `replaceFile(id, fileId, file)`, `update(id, { name, description, tags })` | Changing a model the user owns                                                                           |
| `models.open(id)`                                                                                        | Closes the tool and opens the model's page                                                               |
| `toolModels()`                                                                                           | The models a repository tool brings: `{ key, name, source, printId }`, `printId` null until it's come in |
| `fetch(url, init)`                                                                                       | A request through Thingport to one of the tool's declared hosts, answered like `fetch`                   |
| `api(path, init)`                                                                                        | Thingport's own API, as the user                                                                         |
| `download({ name, data })`                                                                               | Hands the user a file                                                                                    |
| `ui.toast(message, severity)`, `ui.confirm({ title, message })`, `ui.close()`                            | Thingport's own toast, confirmation and closing the window                                               |

A model's files are `{ id, name, size, url }`; a model a tool brought has `toolOwned: true` and can't be changed.

## Sharing a tool

A tool in the repository is a folder under [`tools/`](../../tools), listed in its `index.json`:

- `tool.json` (or `tool.yml`): the metadata, as the editor's **Details** make it, plus `author`, and the models it
  brings, if any:

  ```json
  {
    "name": "Bin planner",
    "version": "1.0.0",
    "author": "Your Name",
    "window": { "width": 1100, "height": 720 },
    "hosts": [],
    "collection": {
      "name": "Bin parts",
      "models": [
        { "key": "baseplate", "name": "Baseplate 1×1", "files": ["models/baseplate.stl"] },
        { "key": "tile-8x8", "name": "8×8 tile", "source": "https://thangs.com/m/974214" }
      ]
    }
  }
  ```

  Each model has a `key` the tool finds it by, a `name`, and either `files` from the tool's folder, which the
  repository may carry only when the design's licence allows it, or a `source` page Thingport imports when an admin
  installs the tool. `screenshots` lists up to eight PNG, JPEG or WebP pictures in its folder, each `{ "file",
"caption" }`, which admins look through before installing it. The `iconUrl` may also be an SVG as a `data:image/svg+xml` address, so the icon comes with the tool.

- `tool.js` and, optionally, `tool.html`.
- `README.md`: what it does, what it reaches, and where its models come from.

Open a pull request; a check validates the folder (`npx tsx scripts/validateTools.ts` in `backend/` runs it locally), and
a maintainer reads the code. The [tools README](../../tools/README.md) lists what reviewers look for.

### Where the tools come from

**Administration → Tools** says which of these it's reading:

| Thingport running                                                 | Offers the tools from                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| From a checkout: `npm run dev` ([development](../DEVELOPMENT.md)) | The checkout's own `tools` folder, read afresh each time: edit, then refresh |
| The local `docker-compose.yml`, which builds from the checkout    | The checkout's `tools` folder, mounted into the backend                      |
| The `:dev` image                                                  | The repository's `develop` branch on GitHub                                  |
| The `:latest` image, or a version's                               | The repository's `main` branch on GitHub                                     |

`TOOLS_DIR` points the backend at any folder instead, and `TOOLS_URL` at another repository's `tools` folder as raw
files, such as a fork's (`https://raw.githubusercontent.com/<you>/Thingport/<branch>/tools`). From GitHub, the list is
read again at most hourly; installing or updating a tool always reads it afresh.
