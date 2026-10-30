# SDK reference

Everything the `thingport` object has: what a widget's or a tool's default export is called with. Most of it is the
same for both; the **At a glance** table says which has what, and a member that differs shows each form. How a script
runs, and what it may reach, is in the [overview](overview.md).

> [!NOTE]
> This reference is generated from the SDK's own types, [`frontend/src/sdk/types.ts`](../../frontend/src/sdk/types.ts),
> by `npm run sdk:sync`, and CI fails when it's out of date. The guides an AI assistant reads over MCP are generated
> from the same file.

Signatures are written in TypeScript; scripts are plain JavaScript. For an editor that completes `thingport.` and
checks your calls, put [`thingport.d.ts`](examples/thingport.d.ts) beside the script and start it with:

```js
// @ts-check

/** @param {import("./thingport").WidgetSdk} thingport */
export default function mount(thingport) {}
```

For a tool, the type is `ToolSdk`.

<!-- sdk:reference -->
<!-- Written by scripts/sync-sdk-docs.mjs from frontend/src/sdk/types.ts: change it there. -->

## At a glance

| Member                                    | Widget | Tool | What it is                                                                                                                                                    |
| ----------------------------------------- | :----: | :--: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`root`](#root)                           |   ✓    |  ✓   | The element to draw into: the panel or the window, with the HTML already in it.                                                                               |
| [`selector`](#selector)                   |   ✓    |  ✓   | A CSS selector for `root`, unique on the page, to scope styles to it.                                                                                         |
| [`size`](#size)                           |   ✓    |  ✓   | The size of `root` in pixels, kept current as it's resized.                                                                                                   |
| [`onResize`](#onresizelistener)           |   ✓    |  ✓   | Hears when `root` is resized.                                                                                                                                 |
| [`theme`](#theme)                         |   ✓    |  ✓   | Thingport's colours and font, light or dark.                                                                                                                  |
| [`settings`](#settings)                   |   ✓    |      | The panel's settings, as the metadata's `settings` declares them, with their defaults filled in.                                                              |
| [`widget`](#widget)                       |   ✓    |      | The widget itself.                                                                                                                                            |
| [`widgetId`](#widgetid)                   |   ✓    |      | The widget's id, as `widget.id`.                                                                                                                              |
| [`instanceId`](#instanceid)               |   ✓    |      | This panel's id, for a widget that's on the dashboard more than once and keeps something per panel.                                                           |
| [`language`](#language)                   |   ✓    |  ✓   | The language Thingport is in, as a code like `"en"` or `"lt"`, already matched to one it has (`"pt-BR"` gets `"pt"` where that exists, else `"en"`).          |
| [`languages`](#languages)                 |   ✓    |  ✓   | Every language Thingport has, English first.                                                                                                                  |
| [`t`](#tkey-vars)                         |   ✓    |  ✓   | The script's own words, from its `locales/<code>.json` labels, in the user's language.                                                                        |
| [`labels`](#labelswhere)                  |   ✓    |  ✓   | Fills in the script's words in its markup: `data-t` sets an element's text, and `data-t-title`, `data-t-aria` and `data-t-placeholder` fill those attributes. |
| [`models`](#models)                       |   ✓    |  ✓   | The user's models, as the user.                                                                                                                               |
| [`collections`](#collections)             |   ✓    |  ✓   | The user's collections.                                                                                                                                       |
| [`fetch`](#fetchurl-init)                 |   ✓    |  ✓   | A request to one of the hosts the metadata's `hosts` lists, made by the Thingport server, so CORS and the local network aren't in the way.                    |
| [`api`](#apipath-init)                    |   ✓    |  ✓   | Thingport's own REST API, as the user, signed in as the page is.                                                                                              |
| [`download`](#downloadfile)               |   ✓    |  ✓   | Hands the user a file to keep, as a browser download.                                                                                                         |
| [`ui`](#ui)                               |   ✓    |  ✓   | Thingport's own toast and confirmation.                                                                                                                       |
| [`close`](#close)                         |        |  ✓   | Closes the tool's window.                                                                                                                                     |
| [`library`](#libraryname)                 |   ✓    |  ✓   | A library Thingport carries, for a job a script can't fit inside itself.                                                                                      |
| [`libraries`](#libraries)                 |   ✓    |  ✓   | The names `library()` takes.                                                                                                                                  |
| [`tool`](#tool)                           |        |  ✓   | The tool itself.                                                                                                                                              |
| [`context`](#context)                     |        |  ✓   | What the tool was opened on: `{ modelId }` when it's opened on a model, and empty when it's opened from the Tools page.                                       |
| [`storage`](#storage)                     |        |  ✓   | JSON kept for this user and this tool, so the window opens where they left it.                                                                                |
| [`toolModels`](#toolmodels)               |        |  ✓   | The models a tool from the repository brings, by the keys its metadata gives them.                                                                            |
| [`fetchToolModels`](#fetchtoolmodelskeys) |        |  ✓   | Fetches the tool's models that aren't here yet and gives the user their copies.                                                                               |

## Basics

### `root`

_Widgets and tools_

```ts
thingport.root: HTMLElement
```

The element to draw into: the panel or the window, with the HTML already in it. The theme is on it as CSS variables (see `theme`). Draw only inside it; it's emptied when the script stops.

```js
thingport.root.querySelector("h2").textContent = "Hello";
```

### `selector`

_Widgets and tools_

```ts
thingport.selector: string
```

A CSS selector for `root`, unique on the page, to scope styles to it.

```js
style.textContent = `${thingport.selector} .row { display: flex; }`;
```

### `size`

**In a widget:**

```ts
thingport.size: WidgetSize
```

The size of the panel in pixels and in grid cells, kept current as the user resizes it.

See [`WidgetSize`](#widgetsize).

**In a tool:**

```ts
thingport.size: SdkSize
```

The size of `root` in pixels, kept current as it's resized.

See [`SdkSize`](#sdksize).

### `onResize(listener)`

**In a widget:**

```ts
thingport.onResize(listener: (size: WidgetSize) => void): () => void
```

Hears when the panel is resized.

| Parameter  | What it is                |
| ---------- | ------------------------- |
| `listener` | Called with the new size. |

**Returns:** A function that stops it, for the cleanup.

See [`WidgetSize`](#widgetsize).

```js
const stop = thingport.onResize(({ cols }) => list.classList.toggle("wide", cols >= 6));
```

**In a tool:**

```ts
thingport.onResize(listener: (size: SdkSize) => void): () => void
```

Hears when `root` is resized.

| Parameter  | What it is                |
| ---------- | ------------------------- |
| `listener` | Called with the new size. |

**Returns:** A function that stops it, for the cleanup.

See [`SdkSize`](#sdksize).

```js
const stop = thingport.onResize(({ width }) => root.classList.toggle("narrow", width < 400));
```

### `theme`

_Widgets and tools_

```ts
thingport.theme: SdkTheme
```

Thingport's colours and font, light or dark. The same values are on `root` as CSS variables, so a stylesheet can use them without the script copying anything across. The script runs again when the user changes theme.

See [`SdkTheme`](#sdktheme).

```js
canvas.style.background = thingport.theme.paper;
```

### `settings`

_Widgets only_

```ts
thingport.settings: Record<string, any>
```

The panel's settings, as the metadata's `settings` declares them, with their defaults filled in. A toggle is a boolean; text, number and choice settings are strings, numbers included. The widget runs again when they change.

```js
const every = Number(thingport.settings.refresh) * 1000;
```

### `widget`

_Widgets only_

```ts
thingport.widget: { id: string; slug: string; name: string; version: string; source: "own" | "community" }
```

The widget itself. `source` is `"own"` for one the user made, `"community"` for one installed from the repository.

### `widgetId`

_Widgets only_

```ts
thingport.widgetId: string
```

The widget's id, as `widget.id`.

### `instanceId`

_Widgets only_

```ts
thingport.instanceId: string
```

This panel's id, for a widget that's on the dashboard more than once and keeps something per panel.

## Words

### `language`

_Widgets and tools_

```ts
thingport.language: string
```

The language Thingport is in, as a code like `"en"` or `"lt"`, already matched to one it has (`"pt-BR"` gets `"pt"` where that exists, else `"en"`). The script runs again when the user changes language, so this is read once rather than watched.

### `languages`

_Widgets and tools_

```ts
thingport.languages: SdkLanguage[]
```

Every language Thingport has, English first.

See [`SdkLanguage`](#sdklanguage).

### `t(key, vars?)`

_Widgets and tools_

```ts
thingport.t(key: string, vars?: Record<string, unknown>): string
```

The script's own words, from its `locales/<code>.json` labels, in the user's language. A missing word falls back to English key by key, and a key with no words anywhere comes back as itself, so the gap shows.

| Parameter | What it is                                  |
| --------- | ------------------------------------------- |
| `key`     | The label's key.                            |
| `vars`    | Values for the `{name}` placeholders in it. |

**Returns:** The sentence.

```js
t("rings.ring", { n: 2 }); // "Ring 2", or "Žiedas 2" in Lithuanian
```

### `labels(where?)`

_Widgets and tools_

```ts
thingport.labels(where?: ParentNode): void
```

Fills in the script's words in its markup: `data-t` sets an element's text, and `data-t-title`, `data-t-aria` and `data-t-placeholder` fill those attributes. Running it again after adding markup is harmless.

| Parameter | What it is                                          |
| --------- | --------------------------------------------------- |
| `where`   | The element to fill in under: `root` when left out. |

```js
// <h2 data-t="wall.title">Wall size</h2>
thingport.labels();
```

## Your library

### `models`

_Widgets and tools_

```ts
thingport.models: SdkModels
```

The user's models, as the user. A widget usually only reads.

#### `models.list(options?)`

```ts
thingport.models.list(options?: SdkModelQuery): Promise<SdkModelPage>
```

A page of the library's models, newest first.

| Parameter | What it is                            |
| --------- | ------------------------------------- |
| `options` | What to narrow it to, and which page. |

See [`SdkModelQuery`](#sdkmodelquery), [`SdkModelPage`](#sdkmodelpage).

```js
const { models, hasMore } = await thingport.models.list({ tags: ["gridfinity"], limit: 20 });
```

#### `models.search(q)`

```ts
thingport.models.search(q: string): Promise<SdkSearchResult>
```

The best matches for a search, as the search box finds them: models, collections and tags.

| Parameter | What it is             |
| --------- | ---------------------- |
| `q`       | The words to look for. |

See [`SdkSearchResult`](#sdksearchresult).

```js
const { models, tags } = await thingport.models.search("benchy");
```

#### `models.get(id)`

```ts
thingport.models.get(id: string): Promise<SdkModel>
```

One model.

| Parameter | What it is      |
| --------- | --------------- |
| `id`      | The model's id. |

See [`SdkModel`](#sdkmodel).

```js
const model = await thingport.models.get(id);
```

#### `models.file(id, fileId?)`

```ts
thingport.models.file(id: string, fileId?: string): Promise<ArrayBuffer>
```

One of a model's 3D files.

| Parameter | What it is                                   |
| --------- | -------------------------------------------- |
| `id`      | The model's id.                              |
| `fileId`  | One of its `files`; the first when left out. |

**Returns:** The file's bytes. Throws when the model has no such file, or when the file is missing from storage.

```js
const stl = await thingport.models.file(model.id);
```

#### `models.relatedFiles(id)`

```ts
thingport.models.relatedFiles(id: string): Promise<SdkRelatedFile[]>
```

The files kept beside a model that aren't plates: the script it was generated from, a readme, a diagram.

| Parameter | What it is      |
| --------- | --------------- |
| `id`      | The model's id. |

See [`SdkRelatedFile`](#sdkrelatedfile).

```js
const scad = (await thingport.models.relatedFiles(id)).find((file) => file.name.endsWith(".scad"));
```

#### `models.relatedText(id, fileId)`

```ts
thingport.models.relatedText(id: string, fileId: string): Promise<string>
```

One of those files, as text.

| Parameter | What it is                 |
| --------- | -------------------------- |
| `id`      | The model's id.            |
| `fileId`  | One of its `relatedFiles`. |

```js
const source = await thingport.models.relatedText(id, scad.id);
```

#### `models.create(input)`

```ts
thingport.models.create(input: SdkNewModel): Promise<SdkModel>
```

Makes a model of the files given, each one a plate, in a collection when one is given.

| Parameter | What it is                                         |
| --------- | -------------------------------------------------- |
| `input`   | Its name, description, tags, collection and files. |

**Returns:** The new model.

See [`SdkNewModel`](#sdknewmodel), [`SdkModel`](#sdkmodel).

```js
const model = await thingport.models.create({
  name: "Cube 20 mm",
  tags: ["generated"],
  files: [{ name: "cube-20.stl", data: stl }],
});
```

#### `models.addFiles(id, files)`

```ts
thingport.models.addFiles(id: string, files: SdkFileInput[]): Promise<SdkModel>
```

Adds files to a model, each a plate.

| Parameter | What it is        |
| --------- | ----------------- |
| `id`      | The model's id.   |
| `files`   | The files to add. |

**Returns:** The model as it is now.

See [`SdkFileInput`](#sdkfileinput), [`SdkModel`](#sdkmodel).

#### `models.addImages(id, images)`

```ts
thingport.models.addImages(id: string, images: SdkFileInput[]): Promise<SdkModel>
```

Adds pictures (PNG, JPEG, WebP) to a model's gallery. The first becomes its cover in place of the render.

| Parameter | What it is      |
| --------- | --------------- |
| `id`      | The model's id. |
| `images`  | The pictures.   |

**Returns:** The model as it is now.

See [`SdkFileInput`](#sdkfileinput), [`SdkModel`](#sdkmodel).

```js
const png = await new Promise((done) => canvas.toBlob(done));
await thingport.models.addImages(model.id, [{ name: "cover.png", data: png }]);
```

#### `models.replaceFile(id, fileId, file)`

```ts
thingport.models.replaceFile(id: string, fileId: string, file: SdkFileInput): Promise<SdkModel>
```

Replaces one of a model's files with a new one, in the same place in its order.

| Parameter | What it is                               |
| --------- | ---------------------------------------- |
| `id`      | The model's id.                          |
| `fileId`  | The file to replace, one of its `files`. |
| `file`    | The new file.                            |

**Returns:** The model as it is now.

See [`SdkFileInput`](#sdkfileinput), [`SdkModel`](#sdkmodel).

#### `models.update(id, patch)`

```ts
thingport.models.update(id: string, patch: { name?: string; description?: string; tags?: string[] }): Promise<SdkModel>
```

Changes a model's name, description or tags. Only what's given changes; `tags` replaces the list.

| Parameter | What it is      |
| --------- | --------------- |
| `id`      | The model's id. |
| `patch`   | What to change. |

**Returns:** The model as it is now.

See [`SdkModel`](#sdkmodel).

```js
await thingport.models.update(model.id, { tags: [...model.tags, "printed"] });
```

#### `models.open(id)`

```ts
thingport.models.open(id: string): void
```

Leaves for the model's page. A tool's window closes first.

| Parameter | What it is      |
| --------- | --------------- |
| `id`      | The model's id. |

### `collections`

**In a widget:**

```ts
thingport.collections: SdkCollections
```

The user's collections.

**In a tool:**

```ts
thingport.collections: ToolCollections
```

The user's collections, and a dialog asking them for one.

#### `collections.list()`

```ts
thingport.collections.list(): Promise<SdkCollection[]>
```

The user's collections, without the built-in Favourites and Browsing History.

See [`SdkCollection`](#sdkcollection).

```js
const collections = await thingport.collections.list();
```

#### `collections.get(id)`

```ts
thingport.collections.get(id: string): Promise<SdkCollection>
```

One collection.

| Parameter | What it is           |
| --------- | -------------------- |
| `id`      | The collection's id. |

See [`SdkCollection`](#sdkcollection).

#### `collections.create(input)`

```ts
thingport.collections.create(input: SdkNewCollection): Promise<SdkCollection>
```

Makes a collection.

| Parameter | What it is                      |
| --------- | ------------------------------- |
| `input`   | Its name, description and tags. |

**Returns:** The new collection.

See [`SdkNewCollection`](#sdknewcollection), [`SdkCollection`](#sdkcollection).

```js
const shelf = await thingport.collections.create({ name: "Labels" });
```

#### `collections.models(id, options?)`

```ts
thingport.collections.models(id: string, options?: SdkPage): Promise<SdkModelPage>
```

A page of the models in a collection, newest first.

| Parameter | What it is           |
| --------- | -------------------- |
| `id`      | The collection's id. |
| `options` | Which page.          |

See [`SdkPage`](#sdkpage), [`SdkModelPage`](#sdkmodelpage).

```js
const { models } = await thingport.collections.models(id, { limit: 10 });
```

#### `collections.add(id, modelIds)`

```ts
thingport.collections.add(id: string, modelIds: string[]): Promise<void>
```

Puts models from the library into a collection.

| Parameter  | What it is            |
| ---------- | --------------------- |
| `id`       | The collection's id.  |
| `modelIds` | The models to put in. |

#### `collections.remove(id, modelIds)`

```ts
thingport.collections.remove(id: string, modelIds: string[]): Promise<void>
```

Takes models out of a collection. They stay in the library.

| Parameter  | What it is              |
| ---------- | ----------------------- |
| `id`       | The collection's id.    |
| `modelIds` | The models to take out. |

#### `collections.pick(options?)`

_Tools only_

```ts
thingport.collections.pick(options?: { title?: string }): Promise<SdkCollection | null>
```

Asks the user which collection, or for a new one, as a Save dialog would. A dashboard has no such dialog, so a widget saves into a collection its settings name instead.

| Parameter | What it is                     |
| --------- | ------------------------------ |
| `options` | `title`: what the dialog asks. |

**Returns:** The collection, or `null` when the user cancels.

See [`SdkCollection`](#sdkcollection).

```js
const collection = await thingport.collections.pick({ title: t("save.where") });
if (!collection) return;
```

## Network

### `fetch(url, init?)`

_Widgets and tools_

```ts
thingport.fetch(url: string, init?: RequestInit): Promise<Response>
```

A request to one of the hosts the metadata's `hosts` lists, made by the Thingport server, so CORS and the local network aren't in the way. Answers as `fetch` does, with the body as text (a binary answer doesn't survive) and `Content-Type` its only header. Any other host throws, as does a cloud metadata address. Redirects aren't followed, the `Cookie` header isn't sent, a string is the only body it carries, and it gives up after 15 seconds and cuts an answer off at 5 MB. The editor's preview of a widget or a tool that hasn't been saved yet can't reach any host.

| Parameter | What it is                                                               |
| --------- | ------------------------------------------------------------------------ |
| `url`     | An `http` or `https` address on a declared host.                         |
| `init`    | The method (GET, POST, PUT, PATCH or DELETE), headers and a string body. |

```js
const res = await thingport.fetch("http://octopi.local/api/job", { headers: { "X-Api-Key": key } });
const job = await res.json();
```

### `api(path, init?)`

_Widgets and tools_

```ts
thingport.api(path: string, init?: RequestInit): Promise<Response>
```

Thingport's own REST API, as the user, signed in as the page is.

| Parameter | What it is                                         |
| --------- | -------------------------------------------------- |
| `path`    | A path under `/api`, such as `/dashboard/summary`. |
| `init`    | As `fetch` takes it.                               |

```js
const summary = await (await thingport.api("/dashboard/summary")).json();
```

## Interface

### `download(file)`

_Widgets and tools_

```ts
thingport.download(file: SdkFileInput): void
```

Hands the user a file to keep, as a browser download.

| Parameter | What it is            |
| --------- | --------------------- |
| `file`    | Its name and content. |

See [`SdkFileInput`](#sdkfileinput).

```js
thingport.download({ name: "label.stl", data: stl });
```

### `ui`

**In a widget:**

```ts
thingport.ui: SdkUi
```

Thingport's own toast and confirmation.

**In a tool:**

```ts
thingport.ui: ToolUi
```

Thingport's own toast and confirmation, the collection picker, and closing the window.

#### `ui.toast(message, severity?)`

```ts
thingport.ui.toast(message: string, severity?: SdkSeverity): void
```

Shows a short message in Thingport's own toast.

| Parameter  | What it is                            |
| ---------- | ------------------------------------- |
| `message`  | What to say.                          |
| `severity` | How it looks: `"info"` when left out. |

See [`SdkSeverity`](#sdkseverity).

```js
thingport.ui.toast(t("save.done"), "success");
```

#### `ui.confirm(options)`

```ts
thingport.ui.confirm(options: SdkConfirmOptions): Promise<boolean>
```

Asks the user to confirm, in Thingport's own dialog.

| Parameter | What it is            |
| --------- | --------------------- |
| `options` | What to ask, and how. |

**Returns:** Whether they confirmed.

See [`SdkConfirmOptions`](#sdkconfirmoptions).

```js
if (!(await thingport.ui.confirm({ message: t("clear.ask"), destructive: true }))) return;
```

#### `ui.openModel(id)`

```ts
thingport.ui.openModel(id: string): void
```

Leaves for a model's page, as `models.open` does. A tool's window closes first.

| Parameter | What it is      |
| --------- | --------------- |
| `id`      | The model's id. |

#### `ui.pickCollection(options?)`

_Tools only_

```ts
thingport.ui.pickCollection(options?: { title?: string }): Promise<SdkCollection | null>
```

The same dialog as `collections.pick`.

| Parameter | What it is                     |
| --------- | ------------------------------ |
| `options` | `title`: what the dialog asks. |

**Returns:** The collection, or `null` when the user cancels.

See [`SdkCollection`](#sdkcollection).

#### `ui.close()`

_Tools only_

```ts
thingport.ui.close(): void
```

Closes the tool's window, as `close()` does.

### `close()`

_Tools only_

```ts
thingport.close(): void
```

Closes the tool's window.

## Libraries

### `library(name)`

_Widgets and tools_

```ts
thingport.library<K extends SdkLibraryName>(name: K): Promise<SdkLibraries[K]>
```

A library Thingport carries, for a job a script can't fit inside itself. Fetched the first time anything asks and shared with every widget and tool after that, so ask only when the script needs it: a panel drawn in HTML shouldn't wait on a WebAssembly download.

| Parameter | What it is     |
| --------- | -------------- |
| `name`    | Which library. |

See [`SdkLibraryName`](#sdklibraryname).

```js
const [{ Manifold }, fonts] = await Promise.all([thingport.library("manifold"), thingport.library("fonts")]);
```

#### `library("three")`

[Three.js](https://threejs.org/docs/), the copy Thingport draws models with, plus `mergeGeometries` and `mergeVertices` from its `BufferGeometryUtils`.

```js
const THREE = await thingport.library("three");
const box = new THREE.BoxGeometry(20, 20, 20);
```

#### `library("opentype")`

[opentype.js](https://opentype.js.org/): reads a TTF or OTF and gives a glyph's real outline, counters and all.

```js
const opentype = await thingport.library("opentype");
const font = opentype.parse(await file.arrayBuffer());
```

#### `library("manifold")`

[Manifold](https://manifoldcad.org/docs/jsapi/), started and ready: solid modelling whose results stay watertight, with the 2D cross-sections and offsetting that go with it.

```js
const { Manifold } = await thingport.library("manifold");
const ring = Manifold.cylinder(4, 20, 20, 64).subtract(Manifold.cylinder(4, 16, 16, 64));
const mesh = ring.getMesh();
```

#### `library("fonts")`

The typefaces Thingport carries, under the Open Font License. They are all static faces: a variable font's outlines are only right once its deltas are applied, which opentype.js doesn't do.

##### `fonts.list`

```ts
fonts.list: readonly SdkFont[]
```

Every typeface, in the order a picker should show them.

See [`SdkFont`](#sdkfont).

```js
const fonts = await thingport.library("fonts");
select.append(...fonts.list.map((font) => new Option(font.name, font.id)));
```

##### `fonts.bytes(id)`

```ts
fonts.bytes(id: string): Promise<ArrayBuffer>
```

The font file itself.

| Parameter | What it is           |
| --------- | -------------------- |
| `id`      | One of `list`'s ids. |

**Returns:** The TTF's bytes.

```js
const ttf = await fonts.bytes("pt-sans");
```

##### `fonts.load(id)`

```ts
fonts.load(id: string): Promise<ExternalLibrary>
```

The font parsed by opentype.js, the same `Font` every widget and tool asking for it gets.

| Parameter | What it is           |
| --------- | -------------------- |
| `id`      | One of `list`'s ids. |

**Returns:** An opentype.js `Font`.

See [`ExternalLibrary`](#externallibrary).

```js
const font = await fonts.load("bebas-neue");
const path = font.getPath("HELLO", 0, 0, 72);
```

#### `library("openscad")`

OpenSCAD itself, built for the browser, for the models that came with the script they were generated from. A render runs in a worker, so the page keeps drawing, and nothing leaves the browser: the script, the parameters and the result stay in the tab until something saves them. A script may `include` the libraries in `libraries`.

##### `openscad.parameters(source)`

```ts
openscad.parameters(source: string): Promise<ScadParameters>
```

What parameters a script offers, read by OpenSCAD itself, so it's the list the script's author saw.

| Parameter | What it is         |
| --------- | ------------------ |
| `source`  | The script's text. |

See [`ScadParameters`](#scadparameters).

```js
const openscad = await thingport.library("openscad");
const { parameters } = await openscad.parameters(source);
```

##### `openscad.render(source, options?)`

```ts
openscad.render(source: string, options?: ScadRenderOptions): Promise<ScadRender>
```

The model a script makes of a given set of parameters.

| Parameter | What it is                                            |
| --------- | ----------------------------------------------------- |
| `source`  | The script's text.                                    |
| `options` | The parameters, the format and a signal to cancel it. |

**Returns:** The file, the engine's log and the time it took. A 3MF unless `format` says otherwise.

See [`ScadRenderOptions`](#scadrenderoptions), [`ScadRender`](#scadrender).

```js
const { bytes, log } = await openscad.render(source, { parameters: { width: 60 }, name: "Box" });
thingport.download({ name: "box.3mf", data: bytes });
```

##### `openscad.libraries`

```ts
openscad.libraries: string[]
```

The OpenSCAD libraries a script may include, by folder name.

##### `openscad.concurrency`

```ts
openscad.concurrency: number
```

How many renders to have in flight at once: one fewer than the machine has cores, from one to four.

##### `openscad.writeThreeMf(input, options?)`

```ts
openscad.writeThreeMf(input: SdkMesh | ThreeMfPart[], options?: { name?: string }): Uint8Array
```

One mesh, or several named parts, as the bytes of one 3MF file.

| Parameter | What it is                                                          |
| --------- | ------------------------------------------------------------------- |
| `input`   | A mesh, or a list of parts to place side by side (see `layoutRow`). |
| `options` | The model's name, which slicers show.                               |

See [`SdkMesh`](#sdkmesh), [`ThreeMfPart`](#threemfpart).

```js
const file = openscad.writeThreeMf(
  openscad.layoutRow([
    { mesh: a, name: "Lid" },
    { mesh: b, name: "Box" },
  ]),
);
```

##### `openscad.layoutRow(parts, options?)`

```ts
openscad.layoutRow(parts: ThreeMfPart[], options?: { gap?: number }): ThreeMfPart[]
```

Lays parts out in a row, in the order given, each standing on z = 0, so a 3MF of them doesn't have them inside one another.

| Parameter | What it is                                        |
| --------- | ------------------------------------------------- |
| `parts`   | The parts to place.                               |
| `options` | `gap`: millimetres between them, 5 when left out. |

**Returns:** The same parts, each with an `at`.

See [`ThreeMfPart`](#threemfpart).

##### `openscad.meshBounds(mesh)`

```ts
openscad.meshBounds(mesh: SdkMesh): { min: [number, number, number]; max: [number, number, number] }
```

A mesh's bounding box, in millimetres.

See [`SdkMesh`](#sdkmesh).

```js
const { min, max } = openscad.meshBounds(mesh);
const width = max[0] - min[0];
```

### `libraries`

_Widgets and tools_

```ts
thingport.libraries: SdkLibraryName[]
```

The names `library()` takes.

See [`SdkLibraryName`](#sdklibraryname).

## Tool only

### `tool`

_Tools only_

```ts
thingport.tool: { id: string | null; slug: string; name: string; version: string; source: "repo" | "own" }
```

The tool itself. `id` is null in the editor's preview of a tool not saved yet; `source` is `"repo"` for one installed from the repository and `"own"` for the user's own.

### `context`

_Tools only_

```ts
thingport.context: { modelId?: string }
```

What the tool was opened on: `{ modelId }` when it's opened on a model, and empty when it's opened from the Tools page.

### `storage`

_Tools only_

```ts
thingport.storage: SdkStorage
```

JSON kept for this user and this tool, so the window opens where they left it. In the editor's preview of a tool not saved yet, it lasts only as long as the preview.

#### `storage.get(key)`

```ts
thingport.storage.get(key: string): Promise<any>
```

What's kept under a key.

| Parameter | What it is                                       |
| --------- | ------------------------------------------------ |
| `key`     | 1 to 200 letters, digits, `.`, `-`, `:` and `_`. |

**Returns:** The value as it was kept, or `undefined` when nothing is.

```js
const last = (await thingport.storage.get("last")) ?? { width: 40 };
```

#### `storage.set(key, value)`

```ts
thingport.storage.set(key: string, value: unknown): Promise<void>
```

Keeps a value under a key, replacing what was there. At most 1 MB a value as JSON, 20 MB and 2,000 keys a tool.

| Parameter | What it is                                       |
| --------- | ------------------------------------------------ |
| `key`     | 1 to 200 letters, digits, `.`, `-`, `:` and `_`. |
| `value`   | Anything JSON can hold.                          |

```js
await thingport.storage.set("last", { width: 60 });
```

#### `storage.remove(key)`

```ts
thingport.storage.remove(key: string): Promise<void>
```

Forgets a key.

| Parameter | What it is |
| --------- | ---------- |
| `key`     | The key.   |

#### `storage.keys()`

```ts
thingport.storage.keys(): Promise<string[]>
```

Every key kept.

```js
const drafts = (await thingport.storage.keys()).filter((key) => key.startsWith("draft:"));
```

### `toolModels()`

_Tools only_

```ts
thingport.toolModels(): Promise<SdkToolModel[]>
```

The models a tool from the repository brings, by the keys its metadata gives them. An admin may install a tool without them, which is usual where they're large, so `printId` is null for one that isn't here yet. A user's own tool brings none.

See [`SdkToolModel`](#sdktoolmodel).

```js
const joint = (await thingport.toolModels()).find((model) => model.key === "joint");
```

### `fetchToolModels(keys)`

_Tools only_

```ts
thingport.fetchToolModels(keys: string[]): Promise<SdkToolModelsFetched>
```

Fetches the tool's models that aren't here yet and gives the user their copies. Ask for the few a piece of work needs, and only once the user has agreed to wait for them.

| Parameter | What it is        |
| --------- | ----------------- |
| `keys`    | The models' keys. |

**Returns:** What came, and why the rest didn't, in the provider's own words.

See [`SdkToolModelsFetched`](#sdktoolmodelsfetched).

```js
const { failed } = await thingport.fetchToolModels(["tile-8x8"]);
if (failed.length) thingport.ui.toast(failed[0].reason, "warning");
```

## Types

### `SdkTheme`

Thingport's colours and font, as the theme the user has on shows them.

| Field             | Type                | CSS variable      | What it is                                                                                                                                                                               |
| ----------------- | ------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`            | `"light" \| "dark"` |                   | Which theme is on.                                                                                                                                                                       |
| `primary`         | `string`            | `--tp-accent`     | The accent colour the user picked.                                                                                                                                                       |
| `primaryContrast` | `string`            | `--tp-accent-ink` | What reads on `primary`: white for most accents, dark for light ones such as amber. Text and icons on an accent-filled button take this, never `paper`, which is dark in the dark theme. |
| `background`      | `string`            | `--tp-background` | The page behind the panels and windows.                                                                                                                                                  |
| `paper`           | `string`            | `--tp-paper`      | The surface of a panel, a window or a card.                                                                                                                                              |
| `text`            | `string`            | `--tp-text`       | Body text.                                                                                                                                                                               |
| `textSecondary`   | `string`            | `--tp-text-muted` | Quieter text: hints, captions, counts.                                                                                                                                                   |
| `divider`         | `string`            | `--tp-divider`    | Lines and borders.                                                                                                                                                                       |
| `error`           | `string`            | `--tp-error`      | Something failed.                                                                                                                                                                        |
| `warning`         | `string`            | `--tp-warning`    | Something needs a look.                                                                                                                                                                  |
| `success`         | `string`            | `--tp-success`    | Something worked.                                                                                                                                                                        |
| `fontFamily`      | `string`            | `--tp-font`       | The font stack Thingport's own text is set in.                                                                                                                                           |

### `SdkSize`

A size in pixels.

| Field    | Type     | What it is |
| -------- | -------- | ---------- |
| `width`  | `number` |            |
| `height` | `number` |            |

### `WidgetSize`

A dashboard panel's size: pixels, and the grid cells it covers.

| Field    | Type     | What it is                                                          |
| -------- | -------- | ------------------------------------------------------------------- |
| `width`  | `number` |                                                                     |
| `height` | `number` |                                                                     |
| `cols`   | `number` | Columns of the dashboard's grid, which is 12 wide on a wide screen. |
| `rows`   | `number` | Rows of the grid, each 64 px tall with 16 px between them.          |

### `SdkLanguage`

A language Thingport has.

| Field         | Type     | What it is                                                   |
| ------------- | -------- | ------------------------------------------------------------ |
| `code`        | `string` | Its code, as `language` gives it: `"en"`, `"lt"`.            |
| `label`       | `string` | Named in itself ("Lietuvių"), so it reads from any language. |
| `englishName` | `string` | Named in English.                                            |

### `SdkModel`

A model in the user's library.

| Field          | Type             | What it is                                                                                               |
| -------------- | ---------------- | -------------------------------------------------------------------------------------------------------- |
| `id`           | `string`         |                                                                                                          |
| `name`         | `string`         |                                                                                                          |
| `description`  | `string \| null` |                                                                                                          |
| `tags`         | `string[]`       |                                                                                                          |
| `thumbnail`    | `string \| null` | A picture of it, an address an `<img>` can show.                                                         |
| `files`        | `SdkModelFile[]` | Its 3D files (plates), in order.                                                                         |
| `relatedCount` | `number`         | How many files are kept beside it that aren't plates, so a list can be narrowed without asking for each. |
| `toolOwned`    | `boolean`        | Brought by a tool from the repository: it can be read, not changed.                                      |
| `createdAt`    | `string \| null` | When it was added, as an ISO 8601 date.                                                                  |

### `SdkModelFile`

One of a model's 3D files.

| Field  | Type     | What it is                                                   |
| ------ | -------- | ------------------------------------------------------------ |
| `id`   | `string` |                                                              |
| `name` | `string` | Its file name, with the extension.                           |
| `size` | `number` | In bytes.                                                    |
| `url`  | `string` | An address it can be read from as the user, e.g. by `fetch`. |

### `SdkRelatedFile`

A file kept beside a model rather than being one of its plates: a generator script, a readme, a diagram.

| Field  | Type     | What it is     |
| ------ | -------- | -------------- |
| `id`   | `string` |                |
| `name` | `string` |                |
| `type` | `string` | Its MIME type. |
| `size` | `number` | In bytes.      |
| `url`  | `string` |                |

### `SdkModelPage`

A page of models.

| Field     | Type             | What it is                                                                |
| --------- | ---------------- | ------------------------------------------------------------------------- |
| `models`  | `SdkModel[]`     |                                                                           |
| `hasMore` | `boolean`        | More models match than this page holds: ask again with a larger `offset`. |
| `total`   | `number \| null` | How many match in all, where the server counted them.                     |

### `SdkSearchResult`

What `models.search` finds, as the search box shows it.

| Field         | Type                                                 | What it is |
| ------------- | ---------------------------------------------------- | ---------- |
| `models`      | `SdkModel[]`                                         |            |
| `collections` | `{ id: string; name: string; modelCount: number }[]` |            |
| `tags`        | `{ tag: string; count: number }[]`                   |            |

### `SdkCollection`

One of the user's collections.

| Field         | Type             | What it is                                          |
| ------------- | ---------------- | --------------------------------------------------- |
| `id`          | `string`         |                                                     |
| `name`        | `string`         |                                                     |
| `description` | `string \| null` |                                                     |
| `tags`        | `string[]`       |                                                     |
| `modelCount`  | `number`         |                                                     |
| `toolOwned`   | `boolean`        | A tool's own collection, which can't be saved into. |

### `SdkFileInput`

A file to save or hand over: its name, with the extension, and its content.

| Field   | Type                                               | What it is                                                                             |
| ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `name`  | `string`                                           | E.g. `"bin-2x3.stl"`.                                                                  |
| `data`  | `Blob \| ArrayBuffer \| ArrayBufferView \| string` | The content. A string is saved as UTF-8 text.                                          |
| `type?` | `string`                                           | Its MIME type. Left out, a `Blob`'s own type is used, else `application/octet-stream`. |

### `SdkModelQuery`

Which models a list holds, and which page of them.

| Field           | Type       | What it is                                        |
| --------------- | ---------- | ------------------------------------------------- |
| `q?`            | `string`   | Words to search for, as the models page searches. |
| `tags?`         | `string[]` | Only models with every one of these tags.         |
| `collectionId?` | `string`   | Only the models in this collection.               |
| `limit?`        | `number`   | How many to return: 1 to 200, 50 when left out.   |
| `offset?`       | `number`   | How many to skip, for the next page.              |

### `SdkPage`

A page of a collection's models.

| Field     | Type     | What it is                                      |
| --------- | -------- | ----------------------------------------------- |
| `limit?`  | `number` | How many to return: 1 to 200, 50 when left out. |
| `offset?` | `number` | How many to skip, for the next page.            |

### `SdkNewModel`

A model to make.

| Field           | Type             | What it is                             |
| --------------- | ---------------- | -------------------------------------- |
| `name`          | `string`         |                                        |
| `description?`  | `string`         |                                        |
| `tags?`         | `string[]`       |                                        |
| `collectionId?` | `string`         | A collection to save it into.          |
| `files`         | `SdkFileInput[]` | Its files, each a plate. At least one. |

### `SdkNewCollection`

A collection to make.

| Field          | Type       | What it is |
| -------------- | ---------- | ---------- |
| `name`         | `string`   |            |
| `description?` | `string`   |            |
| `tags?`        | `string[]` |            |

### `SdkConfirmOptions`

What a confirmation asks.

| Field           | Type      | What it is                                                                                 |
| --------------- | --------- | ------------------------------------------------------------------------------------------ |
| `title?`        | `string`  |                                                                                            |
| `message`       | `string`  |                                                                                            |
| `confirmLabel?` | `string`  | The confirming button's label: "Confirm" when left out, or "Delete" for a destructive one. |
| `destructive?`  | `boolean` | Shows the confirming button in the error colour, for something that can't be undone.       |

### `SdkSeverity`

How a toast looks.

```ts
type SdkSeverity = "success" | "info" | "warning" | "error";
```

### `SdkToolModel`

A model a tool from the repository brings, as `toolModels()` lists it.

| Field     | Type             | What it is                                                                   |
| --------- | ---------------- | ---------------------------------------------------------------------------- |
| `key`     | `string`         | What the tool's metadata calls it.                                           |
| `name`    | `string`         |                                                                              |
| `source`  | `string \| null` | The page it's imported from, for one that isn't a file in the tool's folder. |
| `printId` | `string \| null` | The user's copy, to read with `models`; null while it isn't here.            |

### `SdkToolModelsFetched`

What `fetchToolModels` brought, and what it couldn't.

| Field    | Type                                | What it is                                                                      |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| `ready`  | `string[]`                          | The keys that are here now.                                                     |
| `failed` | `{ key: string; reason: string }[]` | The rest, each with the provider's own reason, a daily download limit included. |

### `ExternalLibrary`

A library with types of its own, which this file doesn't repeat: see its own documentation.

```ts
type ExternalLibrary = any;
```

### `SdkLibraryName`

A library's name, as `library()` takes it.

```ts
type SdkLibraryName = keyof SdkLibraries;
```

### `SdkFont`

A typeface `library("fonts")` offers.

| Field   | Type     | What it is                                                                   |
| ------- | -------- | ---------------------------------------------------------------------------- |
| `id`    | `string` | What `bytes` and `load` take.                                                |
| `name`  | `string` | Its name, to show.                                                           |
| `group` | `string` | The kind of face it is, for a picker to group by: "Sans", "Serif", "Script"… |

### `ScadParameter`

A parameter an OpenSCAD script offers, as OpenSCAD's own customizer describes it.

| Field      | Type                                                      | What it is                                                                                       |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `name`     | `string`                                                  |                                                                                                  |
| `group`    | `string`                                                  | The `/* [Group] */` heading it was declared under; "Parameters" for the ones before any heading. |
| `type`     | `"number" \| "string" \| "boolean" \| "vector" \| string` |                                                                                                  |
| `initial`  | `unknown`                                                 | The value the script gives it.                                                                   |
| `caption?` | `string`                                                  | The comment above the declaration, which explains it.                                            |
| `min?`     | `number`                                                  |                                                                                                  |
| `max?`     | `number`                                                  |                                                                                                  |
| `step?`    | `number`                                                  |                                                                                                  |
| `options?` | `{ name: string; value: unknown }[]`                      | Where the declaration ends in `// [a, b, c]`: a choice rather than free entry.                   |

### `ScadParameters`

What an OpenSCAD script offers.

| Field        | Type              | What it is |
| ------------ | ----------------- | ---------- |
| `title`      | `string`          |            |
| `parameters` | `ScadParameter[]` |            |

### `ScadFormat`

The formats a render can come back as. `"mesh"` is the geometry alone, with no file built from it.

```ts
type ScadFormat = "3mf" | "mesh" | "stl" | "obj" | "off" | "amf";
```

### `ScadRenderOptions`

How to render a script.

| Field         | Type                      | What it is                                                                                       |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `parameters?` | `Record<string, unknown>` | By parameter name, as `parameters()` gives them. Anything left out keeps the script's own value. |
| `format?`     | `ScadFormat`              | `"3mf"` when left out.                                                                           |
| `name?`       | `string`                  | The title written into a 3MF, which slicers show. Ignored by the other formats.                  |
| `signal?`     | `AbortSignal`             | Cancels the render: the worker running it is let go there and then.                              |

### `ScadRender`

What a render produced: the file, and everything the engine said while making it.

| Field     | Type         | What it is                                                                                       |
| --------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `bytes`   | `Uint8Array` |                                                                                                  |
| `log`     | `string[]`   | Warnings and errors, in the order they were printed. A missing font is in here and nowhere else. |
| `seconds` | `number`     | Seconds the engine spent.                                                                        |
| `mesh?`   | `SdkMesh`    | The geometry behind the bytes, for the formats Thingport builds itself (3MF and mesh).           |

### `SdkMesh`

A triangle mesh, in millimetres.

| Field        | Type           | What it is                                                                                         |
| ------------ | -------------- | -------------------------------------------------------------------------------------------------- |
| `vertices`   | `Float64Array` | Flat x, y, z triples.                                                                              |
| `triangles`  | `Uint32Array`  | Flat vertex-index triples.                                                                         |
| `palette?`   | `string[]`     | The distinct colours the script gave the model, as `"#rrggbb"`; absent where it never coloured it. |
| `colors?`    | `Uint16Array`  | One entry per triangle, indexing `palette`. Present whenever `palette` is.                         |
| `uncolored?` | `number`       | The `palette` entry standing in for the faces the script never coloured, where it coloured some.   |

### `ThreeMfPart`

One of the things a 3MF holds.

| Field   | Type                                   | What it is                                                                                                                                     |
| ------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `mesh`  | `SdkMesh`                              |                                                                                                                                                |
| `name?` | `string`                               | What a slicer's object list calls it. A count belongs here, "8x8 Core Tile x4", since a 3MF holds one copy of a shape however many are wanted. |
| `at?`   | `{ x: number; y: number; z?: number }` | Millimetres from the origin. Left out, the part stays where its mesh is, so several land on top of each other: see `layoutRow`.                |

<!-- /sdk:reference -->
