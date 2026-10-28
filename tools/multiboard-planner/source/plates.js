// Turning a part the planner worked out into a plate, by way of plate.scad.
//
// The planner names its tiles the way the original calculator did -- "C1", "S2", "CR4", "Middle Vertical" --
// and plate.scad asks a different question: which of the four sides has another plate against it. The table
// below is the translation, and it was not guessed: each type was followed through the model it used to link
// to on Thangs, and the plate that came back is the one named beside it.
//
// A side with a plate against it on +X or +Y carries the pads that reach into that plate; on -X or -Y it
// carries the notches its neighbour's pads reach into. So a core tile, surrounded, has all four; a single
// standalone tile has none; an edge tile has three.

/** Planner tile type to the sides that have a plate against them, and the plate that confirmed it. */
export const PLATE_SIDES = {
  C1: { px: true, py: true, mx: true, my: true, plate: "Center Grid" },
  SpecialRounded: { px: false, py: false, mx: false, my: false, plate: "plain" },
  S1: { px: true, py: false, mx: true, my: true, plate: "Top Grid" },
  S2: { px: true, py: true, mx: false, my: true, plate: "Left Grid" },
  S3: { px: false, py: true, mx: true, my: true, plate: "Right Grid" },
  S4: { px: true, py: true, mx: true, my: false, plate: "Bottom Grid" },
  CR1: { px: true, py: false, mx: false, my: true, plate: "Top Left Grid" },
  CR2: { px: false, py: false, mx: true, my: true, plate: "Top Right Grid" },
  CR3: { px: true, py: true, mx: false, my: false, plate: "Bottom Left Grid" },
  CR4: { px: false, py: true, mx: true, my: false, plate: "Bottom Right Grid" },
  "Beginning Horizontal": { px: true, py: false, mx: false, my: false, plate: "Left Horizontal Strip" },
  "Middle Horizontal": { px: true, py: false, mx: true, my: false, plate: "Center Horizontal Strip" },
  "End Horizontal": { px: false, py: false, mx: true, my: false, plate: "Right Horizontal Strip" },
  "Beginning Vertical": { px: false, py: true, mx: false, my: false, plate: "Bottom Vertical Strip" },
  "Middle Vertical": { px: false, py: true, mx: false, my: true, plate: "Center Vertical Strip" },
  "End Vertical": { px: false, py: false, mx: false, my: true, plate: "Top Vertical Strip" },
};

/** The cells across in a planner size like "8x8"; null for anything that isn't one. */
export function cellsOf(size) {
  const match = /^(\d+)x(\d+)$/.exec(String(size ?? "").trim());
  if (!match) return null;
  const cells = Number(match[1]);
  // The plates are square and plate.scad only draws square ones, so a "4x6" is not something to guess at.
  return cells === Number(match[2]) && cells >= 2 && cells <= 16 ? cells : null;
}

/** What plate.scad needs to draw one tile, or null where the planner means something it cannot draw. */
export function plateParameters(type, size) {
  const sides = PLATE_SIDES[type];
  const cells = cellsOf(size);
  if (!sides || cells === null) return null;
  return {
    cells,
    neighbour_px: sides.px,
    neighbour_py: sides.py,
    neighbour_mx: sides.mx,
    neighbour_my: sides.my,
  };
}

/** A filename and an object name for a tile, the name carrying how many to print. */
export function plateLabel(type, size, count, tileNames = {}) {
  const what = tileNames[type] ?? type;
  const name = `${size} ${what}`.replace(/\s+/g, " ").trim();
  return { name: count > 1 ? `${name} x${count}` : name, file: `${name.replace(/[^\w.-]+/g, "-")}.3mf` };
}

/**
 * One tile as a mesh, through the OpenSCAD the SDK carries.
 *
 * `scad` is what `thingport.library("openscad")` hands back and `script` the text of plate.scad, which the
 * tool carries rather than fetching: a plate is drawn here, in the tab, and nothing leaves it.
 */
export async function renderPlate(scad, script, { type, size }) {
  const parameters = plateParameters(type, size);
  if (!parameters) throw new Error(`No plate for a ${size} ${type}`);
  const { mesh, log } = await scad.render(script, { parameters, format: "3mf" });
  if (!mesh) throw new Error(`The engine drew no ${size} ${type}${log?.length ? `: ${log.join(" ")}` : ""}`);
  return mesh;
}
