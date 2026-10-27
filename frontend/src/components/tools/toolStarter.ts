import type { ToolManifest } from "../../api/tools";

// What "New tool" starts from: a small tool that works, and shows on the way what a tool's script can reach. Kept in
// English, as code and its comments are.

export const STARTER_MANIFEST: ToolManifest = {
  name: "Cube maker",
  description: "Makes a cube STL, saves it as a model and finds your models.",
  version: "1.0.0",
  window: { width: 720, height: 520 },
  hosts: [],
};

export const STARTER_HTML = `<style>
  /* Scoped to this tool's own class, so nothing here reaches the rest of Thingport. */
  .cube-maker { padding: 20px; display: grid; gap: 14px; font: 14px/1.45 var(--font); color: var(--text); }
  .cube-maker h2 { margin: 0; font-size: 16px; }
  .cube-maker .muted { margin: 0; color: var(--muted); font-size: 12px; }
  .cube-maker .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .cube-maker input, .cube-maker button {
    font: inherit; color: var(--text); background: var(--paper);
    border: 1px solid var(--divider); border-radius: 8px; padding: 6px 10px;
  }
  .cube-maker input[type="number"] { width: 80px; }
  .cube-maker button { cursor: pointer; transition: border-color 150ms; }
  .cube-maker button:hover { border-color: var(--primary); }
  .cube-maker button.primary { background: var(--primary); color: var(--paper); border-color: transparent; }
  .cube-maker ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; }
  .cube-maker li button { width: 100%; text-align: left; }
  @media (prefers-reduced-motion: reduce) { .cube-maker button { transition: none; } }
</style>
<div class="cube-maker">
  <div>
    <h2>Cube maker</h2>
    <p class="muted">A starter tool. Read its script to see what a tool can do, then make it yours.</p>
  </div>
  <div class="row">
    <label>Side <input id="side" type="number" min="1" max="300" step="1"> mm</label>
    <button class="primary" id="save">Save to a collection…</button>
    <button id="download">Download STL</button>
  </div>
  <div class="row">
    <input id="query" placeholder="Find a model" aria-label="Find a model">
    <button id="search">Search</button>
  </div>
  <ul id="results"></ul>
</div>
`;

export const STARTER_SCRIPT = `// A tool is an ES module. When its window opens, Thingport puts tool.html in it and calls the default export with
// \`thingport\`; the function that returns is called when the window closes. Everything below is optional.
//
// thingport.root               the window's element, with tool.html already in it
// thingport.theme              { mode, primary, primaryContrast, background, paper, text, textSecondary, divider,
//                              error, warning, success, fontFamily }
// thingport.library(name)      a library Thingport carries, loaded when first asked for and shared with every
//                              other tool: "three", "opentype", "manifold", "fonts". thingport.libraries lists them
// thingport.t(key, vars)       your tool's own words, from its Labels, in the user's language: t("hello"),
//                              t("rings.ring", { n: 2 }). thingport.language is the code, languages lists them all
// thingport.labels(where?)     fills in every data-t in your HTML from those labels, so the markup can carry the
//                              keys: <h2 data-t="wall.title">Wall size</h2>, and data-t-title/-aria/-placeholder
// thingport.size, onResize(fn) the window's size in pixels, and a way to hear when it changes
// thingport.tool               { id, slug, name, version, source }
// thingport.storage            get(key), set(key, value), remove(key), keys(): JSON kept for this user, up to 20 MB
// thingport.collections        list(), get(id), create({ name, description, tags }), models(id, { limit, offset }),
//                              add(id, modelIds), remove(id, modelIds), pick({ title }): asks the user for one
// thingport.models             list({ q, tags, collectionId, limit, offset }), search(q), get(id), file(id, fileId?),
//                              create({ name, description, tags, collectionId, files: [{ name, data }] }),
//                              addFiles(id, files), addImages(id, images), replaceFile(id, fileId, file),
//                              update(id, { name, description, tags }),
//                              open(id): closes the tool and opens the model's page
// thingport.toolModels()       the models a tool from the repository brings, by key
// thingport.fetch(url, init)   a request through Thingport to a host the tool's details declare
// thingport.api(path, init)    Thingport's own API, as the user
// thingport.download({ name, data })  hands the user a file
// thingport.ui                 toast(message, severity), confirm({ title, message }), pickCollection(), close()

export default async function mount(thingport) {
  const { root, theme, storage, models, ui } = thingport;
  const $ = (id) => root.querySelector("#" + id);

  // The theme is already on the window as CSS variables (--tp-accent, --tp-accent-ink, --tp-text, …), so a
  // stylesheet can use it without this. These are here for drawing, where only script can reach the colours.
  const colours = { text: theme.text, muted: theme.textSecondary, paper: theme.paper, divider: theme.divider,
    primary: theme.primary, font: theme.fontFamily };
  for (const [name, value] of Object.entries(colours)) root.style.setProperty("--" + name, value);

  // Kept per user, so the tool opens as it was left.
  const side = $("side");
  side.value = (await storage.get("side")) ?? 20;
  side.addEventListener("change", () => storage.set("side", Number(side.value)));
  const file = () => ({ name: "cube-" + side.value + "mm.stl", data: cubeStl(Number(side.value) || 20) });

  // A tool's errors are the user's to see: say what went wrong rather than failing quietly.
  const safely = (fn) => async () => {
    try {
      await fn();
    } catch (err) {
      ui.toast(err.message, "error");
    }
  };

  $("download").addEventListener("click", () => thingport.download(file()));

  $("save").addEventListener(
    "click",
    safely(async () => {
      const collection = await ui.pickCollection({ title: "Save the cube to" });
      if (!collection) return;
      const model = await models.create({
        name: "Cube " + side.value + " mm",
        tags: ["cube"],
        collectionId: collection.id,
        files: [file()],
      });
      ui.toast("Saved " + model.name + " to " + collection.name, "success");
    }),
  );

  $("search").addEventListener(
    "click",
    safely(async () => {
      const { models: found } = await models.search($("query").value);
      const list = $("results");
      list.replaceChildren(
        ...found.slice(0, 8).map((model) => {
          const item = document.createElement("li");
          const open = document.createElement("button");
          open.textContent = model.name + " (" + model.files.length + " files)";
          open.addEventListener("click", () => models.open(model.id));
          item.append(open);
          return item;
        }),
      );
    }),
  );

  // Listeners on elements inside root go with them; stop anything else here (timers, window listeners).
  return () => {};
}

// An ASCII STL of a cube with sides of \`s\` mm: two triangles a face.
function cubeStl(s) {
  const v = (x, y, z) => [x * s, y * s, z * s];
  const faces = [
    [[0, 0, -1], [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)]],
    [[0, 0, 1], [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)]],
    [[0, -1, 0], [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)]],
    [[0, 1, 0], [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)]],
    [[-1, 0, 0], [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)]],
    [[1, 0, 0], [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)]],
  ];
  const facet = (n, a, b, c) =>
    "facet normal " + n.join(" ") + "\\n outer loop\\n" +
    [a, b, c].map((p) => "  vertex " + p.join(" ") + "\\n").join("") + " endloop\\nendfacet\\n";
  const body = faces.map(([n, [a, b, c, d]]) => facet(n, a, b, c) + facet(n, a, c, d)).join("");
  return "solid cube\\n" + body + "endsolid cube\\n";
}
`;
