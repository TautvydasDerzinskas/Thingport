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
