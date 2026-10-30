// @ts-check

// The model, as an OpenSCAD script. Its parameters, groups and captions are read by OpenSCAD itself, so the form
// below is built from them rather than written out a second time.
const SCAD = `
/* [Box] */
// Inside width (mm)
width = 60; // [20:200]
// Inside depth (mm)
depth = 40; // [20:200]
// Inside height (mm)
height = 30; // [10:150]
// Wall (mm)
wall = 2; // [1:0.2:5]

/* [Lid] */
// Make a lid
lid = true;
// Gap between the lid's plug and the box (mm)
clearance = 0.3; // [0:0.05:1]

module shell() {
  difference() {
    cube([width + 2 * wall, depth + 2 * wall, height + wall]);
    translate([wall, wall, wall]) cube([width, depth, height + 1]);
  }
}

module cover() {
  cube([width + 2 * wall, depth + 2 * wall, wall]);
  translate([wall + clearance, wall + clearance, wall])
    cube([width - 2 * clearance, depth - 2 * clearance, 3]);
}

shell();
if (lid) translate([0, depth + 2 * wall + 10, 0]) cover();
`;

/** @param {import("../thingport").ToolSdk} thingport */
export default async function mount(thingport) {
  const { root, storage, models, collections, ui, t, labels } = thingport;
  labels();

  const form = root.querySelector("form");
  const fields = root.querySelector(".parameters");
  const cancel = root.querySelector(".cancel");
  const output = root.querySelector("output");
  /** @type {AbortController | null} */
  let running = null;

  const openscad = await thingport.library("openscad");
  const { parameters } = await openscad.parameters(SCAD);
  const last = (await storage.get("parameters")) ?? {};

  // A fieldset per group, a field per parameter: a switch for a boolean, a number for the rest.
  /** @type {Map<string, import("../thingport").ScadParameter[]>} */
  const groups = new Map();
  for (const parameter of parameters) groups.set(parameter.group, [...(groups.get(parameter.group) ?? []), parameter]);
  for (const [group, members] of groups) {
    const set = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = group;
    set.append(legend);
    for (const parameter of members) {
      const input = document.createElement("input");
      input.name = parameter.name;
      const value = last[parameter.name] ?? parameter.initial;
      if (parameter.type === "boolean") {
        input.type = "checkbox";
        input.checked = Boolean(value);
      } else {
        input.type = "number";
        input.value = String(value);
        if (parameter.min !== undefined) input.min = String(parameter.min);
        if (parameter.max !== undefined) input.max = String(parameter.max);
        input.step = String(parameter.step ?? "any");
      }
      const label = document.createElement("label");
      label.append(parameter.caption ?? parameter.name, input);
      set.append(label);
    }
    fields.append(set);
  }
  output.textContent = "";

  cancel.addEventListener("click", () => running?.abort());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    /** @type {Record<string, number | boolean>} */
    const values = {};
    for (const input of form.querySelectorAll("input")) {
      values[input.name] = input.type === "checkbox" ? input.checked : Number(input.value);
    }
    running = new AbortController();
    cancel.toggleAttribute("hidden", false);
    output.textContent = t("making");
    try {
      const { bytes, seconds } = await openscad.render(SCAD, {
        parameters: values,
        name: t("name"),
        signal: running.signal,
      });
      await storage.set("parameters", values);
      output.textContent = t("made", { seconds: seconds.toFixed(1) });
      const collection = await collections.pick({ title: t("saveTo") });
      if (!collection) return;
      const name = t("modelName", { width: values.width, depth: values.depth, height: values.height });
      const model = await models.create({
        name,
        tags: ["box", "openscad"],
        collectionId: collection.id,
        files: [{ name: `${name}.3mf`, data: bytes }],
      });
      ui.toast(t("saved", { name: model.name }), "success");
    } catch (error) {
      // A cancelled render rejects too; the user asked for that, so it needs no explaining.
      output.textContent = running?.signal.aborted ? "" : t("failed", { reason: error.message });
    } finally {
      running = null;
      cancel.toggleAttribute("hidden", true);
    }
  });

  // Closing the window stops a render that's still going, rather than leaving a worker busy for nothing.
  return () => running?.abort();
}
