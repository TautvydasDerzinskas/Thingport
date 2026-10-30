// GENERATED from frontend/src/sdk/types.ts by scripts/sync-sdk-docs.mjs. Don't edit it here:
// change that file and run npm run sdk:sync.
//
// The `thingport` object a Thingport widget's or tool's script is called with. Check a script against it with
// `// @ts-check` and `/** @param {import("./thingport").WidgetSdk} thingport */` (or ToolSdk) on its default export.

// --- What the SDK hands over -----------------------------------------------------------------------------------------

/** Thingport's colours and font, as the theme the user has on shows them. */
export interface SdkTheme {
  /** Which theme is on. */
  mode: "light" | "dark";
  /** The accent colour the user picked. */
  primary: string;
  /** What reads on `primary`: white for most accents, dark for light ones such as amber. Text and icons on an
   *  accent-filled button take this, never `paper`, which is dark in the dark theme. */
  primaryContrast: string;
  /** The page behind the panels and windows. */
  background: string;
  /** The surface of a panel, a window or a card. */
  paper: string;
  /** Body text. */
  text: string;
  /** Quieter text: hints, captions, counts. */
  textSecondary: string;
  /** Lines and borders. */
  divider: string;
  /** Something failed. */
  error: string;
  /** Something needs a look. */
  warning: string;
  /** Something worked. */
  success: string;
  /** The font stack Thingport's own text is set in. */
  fontFamily: string;
}

/** A size in pixels. */
export interface SdkSize {
  width: number;
  height: number;
}

/** A dashboard panel's size: pixels, and the grid cells it covers. */
export interface WidgetSize extends SdkSize {
  /** Columns of the dashboard's grid, which is 12 wide on a wide screen. */
  cols: number;
  /** Rows of the grid, each 64 px tall with 16 px between them. */
  rows: number;
}

/** A language Thingport has. */
export interface SdkLanguage {
  /** Its code, as `language` gives it: `"en"`, `"lt"`. */
  code: string;
  /** Named in itself ("Lietuvių"), so it reads from any language. */
  label: string;
  /** Named in English. */
  englishName: string;
}

/** A model in the user's library. */
export interface SdkModel {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  /** A picture of it, an address an `<img>` can show. */
  thumbnail: string | null;
  /** Its 3D files (plates), in order. */
  files: SdkModelFile[];
  /** How many files are kept beside it that aren't plates, so a list can be narrowed without asking for each. */
  relatedCount: number;
  /** Brought by a tool from the repository: it can be read, not changed. */
  toolOwned: boolean;
  /** When it was added, as an ISO 8601 date. */
  createdAt: string | null;
}

/** One of a model's 3D files. */
export interface SdkModelFile {
  id: string;
  /** Its file name, with the extension. */
  name: string;
  /** In bytes. */
  size: number;
  /** An address it can be read from as the user, e.g. by `fetch`. */
  url: string;
}

/** A file kept beside a model rather than being one of its plates: a generator script, a readme, a diagram. */
export interface SdkRelatedFile {
  id: string;
  name: string;
  /** Its MIME type. */
  type: string;
  /** In bytes. */
  size: number;
  url: string;
}

/** A page of models. */
export interface SdkModelPage {
  models: SdkModel[];
  /** More models match than this page holds: ask again with a larger `offset`. */
  hasMore: boolean;
  /** How many match in all, where the server counted them. */
  total: number | null;
}

/** What `models.search` finds, as the search box shows it. */
export interface SdkSearchResult {
  models: SdkModel[];
  collections: { id: string; name: string; modelCount: number }[];
  tags: { tag: string; count: number }[];
}

/** One of the user's collections. */
export interface SdkCollection {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  modelCount: number;
  /** A tool's own collection, which can't be saved into. */
  toolOwned: boolean;
}

/** A file to save or hand over: its name, with the extension, and its content. */
export interface SdkFileInput {
  /** E.g. `"bin-2x3.stl"`. */
  name: string;
  /** The content. A string is saved as UTF-8 text. */
  data: Blob | ArrayBuffer | ArrayBufferView | string;
  /** Its MIME type. Left out, a `Blob`'s own type is used, else `application/octet-stream`. */
  type?: string;
}

/** Which models a list holds, and which page of them. */
export interface SdkModelQuery {
  /** Words to search for, as the models page searches. */
  q?: string;
  /** Only models with every one of these tags. */
  tags?: string[];
  /** Only the models in this collection. */
  collectionId?: string;
  /** How many to return: 1 to 200, 50 when left out. */
  limit?: number;
  /** How many to skip, for the next page. */
  offset?: number;
}

/** A page of a collection's models. */
export interface SdkPage {
  /** How many to return: 1 to 200, 50 when left out. */
  limit?: number;
  /** How many to skip, for the next page. */
  offset?: number;
}

/** A model to make. */
export interface SdkNewModel {
  name: string;
  description?: string;
  tags?: string[];
  /** A collection to save it into. */
  collectionId?: string;
  /** Its files, each a plate. At least one. */
  files: SdkFileInput[];
}

/** A collection to make. */
export interface SdkNewCollection {
  name: string;
  description?: string;
  tags?: string[];
}

/** What a confirmation asks. */
export interface SdkConfirmOptions {
  title?: string;
  message: string;
  /** The confirming button's label: "Confirm" when left out, or "Delete" for a destructive one. */
  confirmLabel?: string;
  /** Shows the confirming button in the error colour, for something that can't be undone. */
  destructive?: boolean;
}

/** How a toast looks. */
export type SdkSeverity = "success" | "info" | "warning" | "error";

/** A model a tool from the repository brings, as `toolModels()` lists it. */
export interface SdkToolModel {
  /** What the tool's metadata calls it. */
  key: string;
  name: string;
  /** The page it's imported from, for one that isn't a file in the tool's folder. */
  source: string | null;
  /** The user's copy, to read with `models`; null while it isn't here. */
  printId: string | null;
}

/** What `fetchToolModels` brought, and what it couldn't. */
export interface SdkToolModelsFetched {
  /** The keys that are here now. */
  ready: string[];
  /** The rest, each with the provider's own reason, a daily download limit included. */
  failed: { key: string; reason: string }[];
}

// --- The libraries ---------------------------------------------------------------------------------------------------

/** A library with types of its own, which this file doesn't repeat: see its own documentation. */
export type ExternalLibrary = any;

/** What `library(name)` hands over, by name. */
export interface SdkLibraries {
  /**
   * [Three.js](https://threejs.org/docs/), the copy Thingport draws models with, plus `mergeGeometries` and
   * `mergeVertices` from its `BufferGeometryUtils`.
   *
   * @example
   * const THREE = await thingport.library("three");
   * const box = new THREE.BoxGeometry(20, 20, 20);
   */
  three: ExternalLibrary;
  /**
   * [opentype.js](https://opentype.js.org/): reads a TTF or OTF and gives a glyph's real outline, counters and all.
   *
   * @example
   * const opentype = await thingport.library("opentype");
   * const font = opentype.parse(await file.arrayBuffer());
   */
  opentype: ExternalLibrary;
  /**
   * [Manifold](https://manifoldcad.org/docs/jsapi/), started and ready: solid modelling whose results stay
   * watertight, with the 2D cross-sections and offsetting that go with it.
   *
   * @example
   * const { Manifold } = await thingport.library("manifold");
   * const ring = Manifold.cylinder(4, 20, 20, 64).subtract(Manifold.cylinder(4, 16, 16, 64));
   * const mesh = ring.getMesh();
   */
  manifold: ExternalLibrary;
  /** The typefaces Thingport carries, each fetched the first time anything asks for it. */
  fonts: SdkFonts;
  /** OpenSCAD, built for the browser, and the 3MF writer that goes with it. */
  openscad: SdkOpenscad;
}

/** A library's name, as `library()` takes it. */
export type SdkLibraryName = keyof SdkLibraries;

/** A typeface `library("fonts")` offers. */
export interface SdkFont {
  /** What `bytes` and `load` take. */
  id: string;
  /** Its name, to show. */
  name: string;
  /** The kind of face it is, for a picker to group by: "Sans", "Serif", "Script"… */
  group: string;
}

/**
 * The typefaces Thingport carries, under the Open Font License. They are all static faces: a variable font's outlines
 * are only right once its deltas are applied, which opentype.js doesn't do.
 */
export interface SdkFonts {
  /**
   * Every typeface, in the order a picker should show them.
   *
   * @example
   * const fonts = await thingport.library("fonts");
   * select.append(...fonts.list.map((font) => new Option(font.name, font.id)));
   */
  list: readonly SdkFont[];
  /**
   * The font file itself.
   *
   * @param id One of `list`'s ids.
   * @returns The TTF's bytes.
   * @example
   * const ttf = await fonts.bytes("pt-sans");
   */
  bytes(id: string): Promise<ArrayBuffer>;
  /**
   * The font parsed by opentype.js, the same `Font` every widget and tool asking for it gets.
   *
   * @param id One of `list`'s ids.
   * @returns An opentype.js `Font`.
   * @example
   * const font = await fonts.load("bebas-neue");
   * const path = font.getPath("HELLO", 0, 0, 72);
   */
  load(id: string): Promise<ExternalLibrary>;
}

/** A parameter an OpenSCAD script offers, as OpenSCAD's own customizer describes it. */
export interface ScadParameter {
  name: string;
  /** The `/* [Group] *\/` heading it was declared under; "Parameters" for the ones before any heading. */
  group: string;
  type: "number" | "string" | "boolean" | "vector" | string;
  /** The value the script gives it. */
  initial: unknown;
  /** The comment above the declaration, which explains it. */
  caption?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Where the declaration ends in `// [a, b, c]`: a choice rather than free entry. */
  options?: { name: string; value: unknown }[];
}

/** What an OpenSCAD script offers. */
export interface ScadParameters {
  title: string;
  parameters: ScadParameter[];
}

/** The formats a render can come back as. `"mesh"` is the geometry alone, with no file built from it. */
export type ScadFormat = "3mf" | "mesh" | "stl" | "obj" | "off" | "amf";

/** How to render a script. */
export interface ScadRenderOptions {
  /** By parameter name, as `parameters()` gives them. Anything left out keeps the script's own value. */
  parameters?: Record<string, unknown>;
  /** `"3mf"` when left out. */
  format?: ScadFormat;
  /** The title written into a 3MF, which slicers show. Ignored by the other formats. */
  name?: string;
  /** Cancels the render: the worker running it is let go there and then. */
  signal?: AbortSignal;
}

/** What a render produced: the file, and everything the engine said while making it. */
export interface ScadRender {
  bytes: Uint8Array;
  /** Warnings and errors, in the order they were printed. A missing font is in here and nowhere else. */
  log: string[];
  /** Seconds the engine spent. */
  seconds: number;
  /** The geometry behind the bytes, for the formats Thingport builds itself (3MF and mesh). */
  mesh?: SdkMesh;
}

/** A triangle mesh, in millimetres. */
export interface SdkMesh {
  /** Flat x, y, z triples. */
  vertices: Float64Array;
  /** Flat vertex-index triples. */
  triangles: Uint32Array;
  /** The distinct colours the script gave the model, as `"#rrggbb"`; absent where it never coloured it. */
  palette?: string[];
  /** One entry per triangle, indexing `palette`. Present whenever `palette` is. */
  colors?: Uint16Array;
  /** The `palette` entry standing in for the faces the script never coloured, where it coloured some. */
  uncolored?: number;
}

/** One of the things a 3MF holds. */
export interface ThreeMfPart {
  mesh: SdkMesh;
  /** What a slicer's object list calls it. A count belongs here, "8x8 Core Tile x4", since a 3MF holds one copy of a
   *  shape however many are wanted. */
  name?: string;
  /** Millimetres from the origin. Left out, the part stays where its mesh is, so several land on top of each other:
   *  see `layoutRow`. */
  at?: { x: number; y: number; z?: number };
}

/**
 * OpenSCAD itself, built for the browser, for the models that came with the script they were generated from. A render
 * runs in a worker, so the page keeps drawing, and nothing leaves the browser: the script, the parameters and the
 * result stay in the tab until something saves them. A script may `include` the libraries in `libraries`.
 */
export interface SdkOpenscad {
  /**
   * What parameters a script offers, read by OpenSCAD itself, so it's the list the script's author saw.
   *
   * @param source The script's text.
   * @example
   * const openscad = await thingport.library("openscad");
   * const { parameters } = await openscad.parameters(source);
   */
  parameters(source: string): Promise<ScadParameters>;
  /**
   * The model a script makes of a given set of parameters.
   *
   * @param source The script's text.
   * @param options The parameters, the format and a signal to cancel it.
   * @returns The file, the engine's log and the time it took. A 3MF unless `format` says otherwise.
   * @example
   * const { bytes, log } = await openscad.render(source, { parameters: { width: 60 }, name: "Box" });
   * thingport.download({ name: "box.3mf", data: bytes });
   */
  render(source: string, options?: ScadRenderOptions): Promise<ScadRender>;
  /** The OpenSCAD libraries a script may include, by folder name. */
  libraries: string[];
  /** How many renders to have in flight at once: one fewer than the machine has cores, from one to four. */
  concurrency: number;
  /**
   * One mesh, or several named parts, as the bytes of one 3MF file.
   *
   * @param input A mesh, or a list of parts to place side by side (see `layoutRow`).
   * @param options The model's name, which slicers show.
   * @example
   * const file = openscad.writeThreeMf(openscad.layoutRow([{ mesh: a, name: "Lid" }, { mesh: b, name: "Box" }]));
   */
  writeThreeMf(input: SdkMesh | ThreeMfPart[], options?: { name?: string }): Uint8Array;
  /**
   * Lays parts out in a row, in the order given, each standing on z = 0, so a 3MF of them doesn't have them inside
   * one another.
   *
   * @param parts The parts to place.
   * @param options `gap`: millimetres between them, 5 when left out.
   * @returns The same parts, each with an `at`.
   */
  layoutRow(parts: ThreeMfPart[], options?: { gap?: number }): ThreeMfPart[];
  /**
   * A mesh's bounding box, in millimetres.
   *
   * @example
   * const { min, max } = openscad.meshBounds(mesh);
   * const width = max[0] - min[0];
   */
  meshBounds(mesh: SdkMesh): { min: [number, number, number]; max: [number, number, number] };
}

// --- The parts the object is made of ---------------------------------------------------------------------------------

/** The user's library, as the app itself reaches it: as the user, through Thingport's own API. */
export interface SdkModels {
  /**
   * A page of the library's models, newest first.
   *
   * @param options What to narrow it to, and which page.
   * @example
   * const { models, hasMore } = await thingport.models.list({ tags: ["gridfinity"], limit: 20 });
   */
  list(options?: SdkModelQuery): Promise<SdkModelPage>;
  /**
   * The best matches for a search, as the search box finds them: models, collections and tags.
   *
   * @param q The words to look for.
   * @example
   * const { models, tags } = await thingport.models.search("benchy");
   */
  search(q: string): Promise<SdkSearchResult>;
  /**
   * One model.
   *
   * @param id The model's id.
   * @example
   * const model = await thingport.models.get(id);
   */
  get(id: string): Promise<SdkModel>;
  /**
   * One of a model's 3D files.
   *
   * @param id The model's id.
   * @param fileId One of its `files`; the first when left out.
   * @returns The file's bytes. Throws when the model has no such file, or when the file is missing from storage.
   * @example
   * const stl = await thingport.models.file(model.id);
   */
  file(id: string, fileId?: string): Promise<ArrayBuffer>;
  /**
   * The files kept beside a model that aren't plates: the script it was generated from, a readme, a diagram.
   *
   * @param id The model's id.
   * @example
   * const scad = (await thingport.models.relatedFiles(id)).find((file) => file.name.endsWith(".scad"));
   */
  relatedFiles(id: string): Promise<SdkRelatedFile[]>;
  /**
   * One of those files, as text.
   *
   * @param id The model's id.
   * @param fileId One of its `relatedFiles`.
   * @example
   * const source = await thingport.models.relatedText(id, scad.id);
   */
  relatedText(id: string, fileId: string): Promise<string>;
  /**
   * Makes a model of the files given, each one a plate, in a collection when one is given.
   *
   * @param input Its name, description, tags, collection and files.
   * @returns The new model.
   * @example
   * const model = await thingport.models.create({
   *   name: "Cube 20 mm",
   *   tags: ["generated"],
   *   files: [{ name: "cube-20.stl", data: stl }],
   * });
   */
  create(input: SdkNewModel): Promise<SdkModel>;
  /**
   * Adds files to a model, each a plate.
   *
   * @param id The model's id.
   * @param files The files to add.
   * @returns The model as it is now.
   */
  addFiles(id: string, files: SdkFileInput[]): Promise<SdkModel>;
  /**
   * Adds pictures (PNG, JPEG, WebP) to a model's gallery. The first becomes its cover in place of the render.
   *
   * @param id The model's id.
   * @param images The pictures.
   * @returns The model as it is now.
   * @example
   * const png = await new Promise((done) => canvas.toBlob(done));
   * await thingport.models.addImages(model.id, [{ name: "cover.png", data: png }]);
   */
  addImages(id: string, images: SdkFileInput[]): Promise<SdkModel>;
  /**
   * Replaces one of a model's files with a new one, in the same place in its order.
   *
   * @param id The model's id.
   * @param fileId The file to replace, one of its `files`.
   * @param file The new file.
   * @returns The model as it is now.
   */
  replaceFile(id: string, fileId: string, file: SdkFileInput): Promise<SdkModel>;
  /**
   * Changes a model's name, description or tags. Only what's given changes; `tags` replaces the list.
   *
   * @param id The model's id.
   * @param patch What to change.
   * @returns The model as it is now.
   * @example
   * await thingport.models.update(model.id, { tags: [...model.tags, "printed"] });
   */
  update(id: string, patch: { name?: string; description?: string; tags?: string[] }): Promise<SdkModel>;
  /**
   * Leaves for the model's page. A tool's window closes first.
   *
   * @param id The model's id.
   */
  open(id: string): void;
}

/** The user's collections. */
export interface SdkCollections {
  /**
   * The user's collections, without the built-in Favourites and Browsing History.
   *
   * @example
   * const collections = await thingport.collections.list();
   */
  list(): Promise<SdkCollection[]>;
  /**
   * One collection.
   *
   * @param id The collection's id.
   */
  get(id: string): Promise<SdkCollection>;
  /**
   * Makes a collection.
   *
   * @param input Its name, description and tags.
   * @returns The new collection.
   * @example
   * const shelf = await thingport.collections.create({ name: "Labels" });
   */
  create(input: SdkNewCollection): Promise<SdkCollection>;
  /**
   * A page of the models in a collection, newest first.
   *
   * @param id The collection's id.
   * @param options Which page.
   * @example
   * const { models } = await thingport.collections.models(id, { limit: 10 });
   */
  models(id: string, options?: SdkPage): Promise<SdkModelPage>;
  /**
   * Puts models from the library into a collection.
   *
   * @param id The collection's id.
   * @param modelIds The models to put in.
   */
  add(id: string, modelIds: string[]): Promise<void>;
  /**
   * Takes models out of a collection. They stay in the library.
   *
   * @param id The collection's id.
   * @param modelIds The models to take out.
   */
  remove(id: string, modelIds: string[]): Promise<void>;
}

/** A tool's collections, which can also ask the user to pick one. */
export interface ToolCollections extends SdkCollections {
  /**
   * Asks the user which collection, or for a new one, as a Save dialog would. A dashboard has no such dialog, so a
   * widget saves into a collection its settings name instead.
   *
   * @param options `title`: what the dialog asks.
   * @returns The collection, or `null` when the user cancels.
   * @example
   * const collection = await thingport.collections.pick({ title: t("save.where") });
   * if (!collection) return;
   */
  pick(options?: { title?: string }): Promise<SdkCollection | null>;
}

/** Thingport's own toast and confirmation, in place of `alert` and `window.confirm`. */
export interface SdkUi {
  /**
   * Shows a short message in Thingport's own toast.
   *
   * @param message What to say.
   * @param severity How it looks: `"info"` when left out.
   * @example
   * thingport.ui.toast(t("save.done"), "success");
   */
  toast(message: string, severity?: SdkSeverity): void;
  /**
   * Asks the user to confirm, in Thingport's own dialog.
   *
   * @param options What to ask, and how.
   * @returns Whether they confirmed.
   * @example
   * if (!(await thingport.ui.confirm({ message: t("clear.ask"), destructive: true }))) return;
   */
  confirm(options: SdkConfirmOptions): Promise<boolean>;
  /**
   * Leaves for a model's page, as `models.open` does. A tool's window closes first.
   *
   * @param id The model's id.
   */
  openModel(id: string): void;
}

/** A tool's `ui`, which can also pick a collection and close the window. */
export interface ToolUi extends SdkUi {
  /**
   * The same dialog as `collections.pick`.
   *
   * @param options `title`: what the dialog asks.
   * @returns The collection, or `null` when the user cancels.
   */
  pickCollection(options?: { title?: string }): Promise<SdkCollection | null>;
  /** Closes the tool's window, as `close()` does. */
  close(): void;
}

/** JSON kept for this user and this tool. */
export interface SdkStorage {
  /**
   * What's kept under a key.
   *
   * @param key 1 to 200 letters, digits, `.`, `-`, `:` and `_`.
   * @returns The value as it was kept, or `undefined` when nothing is.
   * @example
   * const last = (await thingport.storage.get("last")) ?? { width: 40 };
   */
  get(key: string): Promise<any>;
  /**
   * Keeps a value under a key, replacing what was there. At most 1 MB a value as JSON, 20 MB and 2,000 keys a tool.
   *
   * @param key 1 to 200 letters, digits, `.`, `-`, `:` and `_`.
   * @param value Anything JSON can hold.
   * @example
   * await thingport.storage.set("last", { width: 60 });
   */
  set(key: string, value: unknown): Promise<void>;
  /**
   * Forgets a key.
   *
   * @param key The key.
   */
  remove(key: string): Promise<void>;
  /**
   * Every key kept.
   *
   * @example
   * const drafts = (await thingport.storage.keys()).filter((key) => key.startsWith("draft:"));
   */
  keys(): Promise<string[]>;
}

// --- The object itself -----------------------------------------------------------------------------------------------

/** What a widget's and a tool's `thingport` both have. */
export interface SdkBase {
  /**
   * The element to draw into: the panel or the window, with the HTML already in it. The theme is on it as CSS
   * variables (see `theme`). Draw only inside it; it's emptied when the script stops.
   *
   * @group Basics
   * @example
   * thingport.root.querySelector("h2").textContent = "Hello";
   */
  root: HTMLElement;
  /**
   * A CSS selector for `root`, unique on the page, to scope styles to it.
   *
   * @group Basics
   * @example
   * style.textContent = `${thingport.selector} .row { display: flex; }`;
   */
  selector: string;
  /**
   * The size of `root` in pixels, kept current as it's resized.
   *
   * @group Basics
   */
  readonly size: SdkSize;
  /**
   * Hears when `root` is resized.
   *
   * @group Basics
   * @param listener Called with the new size.
   * @returns A function that stops it, for the cleanup.
   * @example
   * const stop = thingport.onResize(({ width }) => root.classList.toggle("narrow", width < 400));
   */
  onResize(listener: (size: SdkSize) => void): () => void;
  /**
   * Thingport's colours and font, light or dark. The same values are on `root` as CSS variables, so a stylesheet can
   * use them without the script copying anything across. The script runs again when the user changes theme.
   *
   * @group Basics
   * @example
   * canvas.style.background = thingport.theme.paper;
   */
  theme: SdkTheme;
  /**
   * The language Thingport is in, as a code like `"en"` or `"lt"`, already matched to one it has (`"pt-BR"` gets
   * `"pt"` where that exists, else `"en"`). The script runs again when the user changes language, so this is read
   * once rather than watched.
   *
   * @group Words
   */
  language: string;
  /**
   * Every language Thingport has, English first.
   *
   * @group Words
   */
  languages: SdkLanguage[];
  /**
   * The script's own words, from its `locales/<code>.json` labels, in the user's language. A missing word falls back
   * to English key by key, and a key with no words anywhere comes back as itself, so the gap shows.
   *
   * @group Words
   * @param key The label's key.
   * @param vars Values for the `{name}` placeholders in it.
   * @returns The sentence.
   * @example
   * t("rings.ring", { n: 2 }); // "Ring 2", or "Žiedas 2" in Lithuanian
   */
  t(key: string, vars?: Record<string, unknown>): string;
  /**
   * Fills in the script's words in its markup: `data-t` sets an element's text, and `data-t-title`, `data-t-aria`
   * and `data-t-placeholder` fill those attributes. Running it again after adding markup is harmless.
   *
   * @group Words
   * @param where The element to fill in under: `root` when left out.
   * @example
   * // <h2 data-t="wall.title">Wall size</h2>
   * thingport.labels();
   */
  labels(where?: ParentNode): void;
  /**
   * The user's models, as the user. A widget usually only reads.
   *
   * @group Your library
   */
  models: SdkModels;
  /**
   * The user's collections.
   *
   * @group Your library
   */
  collections: SdkCollections;
  /**
   * A request to one of the hosts the metadata's `hosts` lists, made by the Thingport server, so CORS and the local
   * network aren't in the way. Answers as `fetch` does, with the body as text (a binary answer doesn't survive) and
   * `Content-Type` its only header. Any other host throws, as does a cloud metadata address. Redirects aren't
   * followed, the `Cookie` header isn't sent, a string is the only body it carries, and it gives up after 15 seconds
   * and cuts an answer off at 5 MB. The editor's preview of a widget or a tool that hasn't been saved yet can't reach
   * any host.
   *
   * @group Network
   * @param url An `http` or `https` address on a declared host.
   * @param init The method (GET, POST, PUT, PATCH or DELETE), headers and a string body.
   * @example
   * const res = await thingport.fetch("http://octopi.local/api/job", { headers: { "X-Api-Key": key } });
   * const job = await res.json();
   */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /**
   * Thingport's own REST API, as the user, signed in as the page is.
   *
   * @group Network
   * @param path A path under `/api`, such as `/dashboard/summary`.
   * @param init As `fetch` takes it.
   * @example
   * const summary = await (await thingport.api("/dashboard/summary")).json();
   */
  api(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Hands the user a file to keep, as a browser download.
   *
   * @group Interface
   * @param file Its name and content.
   * @example
   * thingport.download({ name: "label.stl", data: stl });
   */
  download(file: SdkFileInput): void;
  /**
   * Thingport's own toast and confirmation.
   *
   * @group Interface
   */
  ui: SdkUi;
  /**
   * A library Thingport carries, for a job a script can't fit inside itself. Fetched the first time anything asks
   * and shared with every widget and tool after that, so ask only when the script needs it: a panel drawn in HTML
   * shouldn't wait on a WebAssembly download.
   *
   * @group Libraries
   * @param name Which library.
   * @example
   * const [{ Manifold }, fonts] = await Promise.all([thingport.library("manifold"), thingport.library("fonts")]);
   */
  library<K extends SdkLibraryName>(name: K): Promise<SdkLibraries[K]>;
  /**
   * The names `library()` takes.
   *
   * @group Libraries
   */
  libraries: SdkLibraryName[];
}

/** The `thingport` object a dashboard widget's default export is called with. */
export interface WidgetSdk extends SdkBase {
  /**
   * The size of the panel in pixels and in grid cells, kept current as the user resizes it.
   *
   * @group Basics
   */
  readonly size: WidgetSize;
  /**
   * Hears when the panel is resized.
   *
   * @group Basics
   * @param listener Called with the new size.
   * @returns A function that stops it, for the cleanup.
   * @example
   * const stop = thingport.onResize(({ cols }) => list.classList.toggle("wide", cols >= 6));
   */
  onResize(listener: (size: WidgetSize) => void): () => void;
  /**
   * The panel's settings, as the metadata's `settings` declares them, with their defaults filled in. A toggle is a
   * boolean; text, number and choice settings are strings, numbers included. The widget runs again when they change.
   *
   * @group Basics
   * @example
   * const every = Number(thingport.settings.refresh) * 1000;
   */
  settings: Record<string, any>;
  /**
   * The widget itself. `source` is `"own"` for one the user made, `"community"` for one installed from the
   * repository.
   *
   * @group Basics
   */
  widget: { id: string; slug: string; name: string; version: string; source: "own" | "community" };
  /**
   * The widget's id, as `widget.id`.
   *
   * @group Basics
   */
  widgetId: string;
  /**
   * This panel's id, for a widget that's on the dashboard more than once and keeps something per panel.
   *
   * @group Basics
   */
  instanceId: string;
}

/** The `thingport` object a tool's default export is called with. */
export interface ToolSdk extends SdkBase {
  /**
   * The user's collections, and a dialog asking them for one.
   *
   * @group Your library
   */
  collections: ToolCollections;
  /**
   * Thingport's own toast and confirmation, the collection picker, and closing the window.
   *
   * @group Interface
   */
  ui: ToolUi;
  /**
   * Closes the tool's window.
   *
   * @group Interface
   */
  close(): void;
  /**
   * The tool itself. `id` is null in the editor's preview of a tool not saved yet; `source` is `"repo"` for one
   * installed from the repository and `"own"` for the user's own.
   *
   * @group Tool only
   */
  tool: { id: string | null; slug: string; name: string; version: string; source: "repo" | "own" };
  /**
   * What the tool was opened on: `{ modelId }` when it's opened on a model, and empty when it's opened from the Tools
   * page.
   *
   * @group Tool only
   */
  context: { modelId?: string };
  /**
   * JSON kept for this user and this tool, so the window opens where they left it. In the editor's preview of a tool
   * not saved yet, it lasts only as long as the preview.
   *
   * @group Tool only
   */
  storage: SdkStorage;
  /**
   * The models a tool from the repository brings, by the keys its metadata gives them. An admin may install a tool
   * without them, which is usual where they're large, so `printId` is null for one that isn't here yet. A user's own
   * tool brings none.
   *
   * @group Tool only
   * @example
   * const joint = (await thingport.toolModels()).find((model) => model.key === "joint");
   */
  toolModels(): Promise<SdkToolModel[]>;
  /**
   * Fetches the tool's models that aren't here yet and gives the user their copies. Ask for the few a piece of work
   * needs, and only once the user has agreed to wait for them.
   *
   * @group Tool only
   * @param keys The models' keys.
   * @returns What came, and why the rest didn't, in the provider's own words.
   * @example
   * const { failed } = await thingport.fetchToolModels(["tile-8x8"]);
   * if (failed.length) thingport.ui.toast(failed[0].reason, "warning");
   */
  fetchToolModels(keys: string[]): Promise<SdkToolModelsFetched>;
}
