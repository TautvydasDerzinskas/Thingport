# Your first tool

A tool that makes an open tray to the inside size you give it, and either downloads it as an STL or saves it into a
collection you pick. It borrows Manifold from Thingport to do the solid modelling, remembers the last sizes for next
time, and keeps its words in a labels file. It takes about fifteen minutes.

What a tool is and how it runs is in the [overview](overview.md).

## Before you start

Making your own tools needs two things an admin sets under **Administration → Tools**: tools turned on for you (for
everyone, on a new instance), and **Users' own tools** switched on, which a new instance leaves off. With both, the
Tools page, in the sidebar, has **New tool**.

## 1. Open the editor

On the **Tools** page, choose **New tool**. The editor opens on _Cube maker_, a working tool that uses most of the SDK;
you'll replace it. Its parts are along the top: **Details**, **Script**, **HTML & CSS**, **Labels** and **Preview**.

## 2. Fill in the details

Under **Details**:

- **Name**: `Tray maker`. **Folder name**: `tray-maker`. Saving another tool with the same folder name replaces it.
- **Description**: what it makes, shown in **About**.
- **Category**: **Generators**, the shelf the Tools page starts it on.
- **Window**: 440 by 360. A smaller screen gets what fits, so a tool must still work narrow.
- **Hosts**: leave it empty. This tool reaches nothing outside Thingport.

## 3. The HTML

Replace **HTML & CSS** with this. It's a form with four sizes and two buttons, styled from the theme's CSS variables:
`--tp-accent-ink` is the colour that reads on the accent, which matters on the filled button in the dark theme.

<!-- sdk:example first-tool/tool.html -->

[`first-tool/tool.html`](examples/first-tool/tool.html)

```html
<style>
  .tray {
    display: grid;
    gap: 12px;
    padding: 16px;
    font-family: var(--tp-font);
    color: var(--tp-text);
  }
  .tray h2 {
    margin: 0;
    font-size: 16px;
  }
  .tray .sizes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 8px;
  }
  .tray label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--tp-text-muted);
  }
  .tray input,
  .tray button {
    padding: 6px 10px;
    border: 1px solid var(--tp-divider);
    border-radius: 8px;
    background: var(--tp-paper);
    color: var(--tp-text);
    font: inherit;
  }
  .tray .actions {
    display: flex;
    gap: 8px;
  }
  .tray button {
    cursor: pointer;
  }
  .tray button[data-action="save"] {
    border-color: transparent;
    background: var(--tp-accent);
    color: var(--tp-accent-ink);
  }
  .tray button:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .tray output {
    min-height: 1.4em;
    font-size: 12px;
    color: var(--tp-text-muted);
  }
</style>
<form class="tray">
  <h2 data-t="title">Tray maker</h2>
  <div class="sizes">
    <label>
      <span data-t="width">Width (mm)</span>
      <input name="width" type="number" min="10" max="300" required />
    </label>
    <label>
      <span data-t="depth">Depth (mm)</span>
      <input name="depth" type="number" min="10" max="300" required />
    </label>
    <label>
      <span data-t="height">Height (mm)</span>
      <input name="height" type="number" min="2" max="200" required />
    </label>
    <label>
      <span data-t="wall">Wall (mm)</span>
      <input name="wall" type="number" min="0.8" max="10" step="0.1" required />
    </label>
  </div>
  <div class="actions">
    <button type="submit" data-action="save" data-t="save">Save to a collection…</button>
    <button type="submit" data-action="download" data-t="download">Download STL</button>
  </div>
  <output aria-live="polite"></output>
</form>
```

<!-- /sdk:example -->

## 4. The script

Replace the **Script** with this:

<!-- sdk:example first-tool/tool.js -->

[`first-tool/tool.js`](examples/first-tool/tool.js)

```js
// @ts-check

/** @param {import("../thingport").ToolSdk} thingport */
export default async function mount(thingport) {
  const { root, storage, models, collections, ui, t, labels } = thingport;
  labels();

  const form = root.querySelector("form");
  const output = root.querySelector("output");
  const buttons = form.querySelectorAll("button");

  // The window opens with the sizes the user last made a tray at.
  const sizes = (await storage.get("sizes")) ?? { width: 80, depth: 60, height: 30, wall: 1.6 };
  for (const [name, value] of Object.entries(sizes)) {
    const input = form.querySelector(`[name="${name}"]`);
    if (input instanceof HTMLInputElement) input.value = String(value);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const size = {
      width: Number(data.get("width")),
      depth: Number(data.get("depth")),
      height: Number(data.get("height")),
      wall: Number(data.get("wall")),
    };
    const name = t("name", size);
    buttons.forEach((button) => (button.disabled = true));
    output.textContent = t("making");
    try {
      const stl = await trayStl(size);
      await storage.set("sizes", size);
      if (event.submitter?.dataset.action === "download") {
        thingport.download({ name: `${name}.stl`, data: stl, type: "model/stl" });
        output.textContent = "";
        return;
      }
      const collection = await collections.pick({ title: t("saveTo") });
      if (!collection) {
        output.textContent = "";
        return;
      }
      const model = await models.create({
        name,
        tags: ["tray", "generated"],
        collectionId: collection.id,
        files: [{ name: `${name}.stl`, data: stl }],
      });
      output.textContent = "";
      ui.toast(t("saved", { name: model.name, collection: collection.name }), "success");
    } catch (error) {
      output.textContent = t("failed", { reason: error.message });
    } finally {
      buttons.forEach((button) => (button.disabled = false));
    }
  });

  /**
   * An open tray, its inside the size given, as a binary STL.
   * @param {{ width: number, depth: number, height: number, wall: number }} size
   */
  async function trayStl({ width, depth, height, wall }) {
    const { Manifold } = await thingport.library("manifold");
    const outer = Manifold.cube([width + 2 * wall, depth + 2 * wall, height + wall]);
    // Taller than the tray, so the cut opens the top rather than leaving a skin across it.
    const inside = Manifold.cube([width, depth, height + 1]).translate([wall, wall, wall]);
    const tray = outer.subtract(inside);
    const mesh = tray.getMesh();
    // Manifold's objects live in WebAssembly memory, which isn't collected: free them once done.
    [outer, inside, tray].forEach((solid) => solid.delete());
    return binaryStl(mesh.vertProperties, mesh.triVerts, mesh.numProp);
  }
}

/**
 * Triangles as a binary STL. The normals are left at zero: slicers work them out from the winding.
 * @param {Float32Array} vertices @param {Uint32Array} triangles @param {number} stride
 */
function binaryStl(vertices, triangles, stride) {
  const count = triangles.length / 3;
  const view = new DataView(new ArrayBuffer(84 + count * 50));
  view.setUint32(80, count, true);
  for (let i = 0; i < count; i++) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = triangles[i * 3 + corner] * stride;
      for (let axis = 0; axis < 3; axis++) {
        view.setFloat32(84 + i * 50 + 12 + corner * 12 + axis * 4, vertices[vertex + axis], true);
      }
    }
  }
  return view.buffer;
}
```

<!-- /sdk:example -->

What it does:

- `storage.get("sizes")` reads what this user kept last time, and `storage.set` keeps it again after each tray. It's
  JSON on the server, per user and per tool, so it follows them to another browser.
- `library("manifold")` hands over Thingport's copy of [Manifold](https://manifoldcad.org/docs/jsapi/), loaded the
  first time anything asks for it. The tray is a box with a smaller box taken out of it, which Manifold keeps
  watertight, and `getMesh()` gives its triangles, written out here as a binary STL.
- `download()` hands the file to the browser. `collections.pick()` asks which collection to save into, or for a new
  one, and gives `null` when the user cancels; `models.create()` then makes the model, with the STL as its plate.
- `ui.toast()` says what happened, in Thingport's own toast, and errors are shown in the window rather than lost.

Nothing is returned for a cleanup: the tool starts no timers and adds no listeners outside its own window, whose
content goes when it closes. The first two lines are for an editor of your own: put
[`thingport.d.ts`](examples/thingport.d.ts) beside the script, point the `import()` at it, and your editor completes
`thingport.` and flags what's wrong.

## 5. The labels

Under **Labels**, choose **Start with English** and replace the file with this. `{width}` and the other placeholders
are filled in from what `t()` is given.

<!-- sdk:example first-tool/locales/en.json -->

[`first-tool/locales/en.json`](examples/first-tool/locales/en.json)

```json
{
  "title": "Tray maker",
  "width": "Width (mm)",
  "depth": "Depth (mm)",
  "height": "Height (mm)",
  "wall": "Wall (mm)",
  "save": "Save to a collection…",
  "download": "Download STL",
  "making": "Making the tray…",
  "name": "Tray {width}x{depth}x{height}",
  "saveTo": "Save the tray to",
  "saved": "Saved {name} to {collection}",
  "failed": "Couldn't make the tray: {reason}"
}
```

<!-- /sdk:example -->

## 6. Try it and save it

Open **Preview**: the tool runs as its window will show it. Make a tray and download it. Until the tool is saved, what
it keeps in `storage` lasts only as long as the preview, and `thingport.fetch` can't reach anything. Choose **Save**.

## 7. Open it

The tool is on the Tools page, on the **Generators** shelf. Double-click it, or select it and press <kbd>Enter</kbd>,
and it opens in its window with the sizes you used last. Right-click it for **About**, **Edit** and **Delete**. It's
yours alone: other users don't see it.

## What you made

These are the files it's shared as, and its metadata is:

<!-- sdk:example first-tool/tool.json -->

[`first-tool/tool.json`](examples/first-tool/tool.json)

```json
{
  "name": "Tray maker",
  "description": "An open tray to the inside size you give it, as an STL to download or keep in your library.",
  "version": "1.0.0",
  "window": { "width": 440, "height": 360 },
  "hosts": [],
  "category": "generators",
  "locales": ["en"]
}
```

<!-- /sdk:example -->

`save_tool`, the MCP tool an AI assistant saves a tool with, takes the same metadata, script, HTML and labels.

## Next

- The [SDK reference](sdk-reference.md): everything `thingport` has, from `models.file()` for reading a model's STL to
  `library("openscad")` for generating one from a script.
- [Recipes](recipes.md): a tool for tagging untagged models, and a box generated by OpenSCAD.
- [Publishing](publishing.md), to offer it to every Thingport through the repository.
