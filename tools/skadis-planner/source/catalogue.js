// What there is to print: the boards, the mounts and the printers the planner knows about.
//
// The boards and mounts are AU3D's designs on MakerWorld. Nothing of theirs is carried here — their licence doesn't
// allow it — so this is a catalogue of what to fetch and what each file contains: which board sizes a print profile
// holds, and which profile goes with which distance from the wall. Thingport imports them into the tool's own
// collection, as the user, when an admin installs the tool, and the window then links each planned part to the model
// in the library.
//
// The profile ids were read from MakerWorld's own listing; a profile's title says the sizes it holds, e.g.
// "11 Columns (11x3 to 11x11)". Keep `rows` here matching the title, because a board the planner asks for that isn't
// in any profile can't be printed.

/** mm between hole centres, and the rule that turns a hole count into a board's size. */
export const PITCH_MM = 20;
export const sizeMm = (holes) => PITCH_MM * (holes + 1);
export const holesFor = (mm) => Math.floor(mm / PITCH_MM) - 1;

export const BOARD_DESIGN = {
  id: "1309689",
  name: "IKEA Skadis Infinity",
  url: "https://makerworld.com/en/models/1309689-ikea-skadis-infinity",
  author: { name: "AU3D", url: "https://makerworld.com/en/@AU3D" },
};

export const MOUNT_DESIGNS = {
  multi: { id: "861073", name: "Skadis Multi Board Wall Mount", url: "https://makerworld.com/en/models/861073" },
  single: { id: "420877", name: "IKEA Skadis Wall Mount", url: "https://makerworld.com/en/models/420877" },
  spacers: { id: "418874", name: "Standoff / Spacers for IKEA Skadis", url: "https://makerworld.com/en/models/418874" },
};

/** The board profiles: one per column count, each holding that column count against a range of row counts. */
export const BOARD_PROFILES = [
  { cols: 2, rows: [3, 11], profileId: "1420014", title: "2 Columns (2x3 to 2x11)" },
  { cols: 3, rows: [3, 11], profileId: "1343801", title: "3 Columns (3x3 to 3x11)" },
  { cols: 4, rows: [3, 11], profileId: "1343795", title: "4 Columns (4x3 to 4x11)" },
  { cols: 5, rows: [3, 11], profileId: "1343793", title: "5 Columns (5x3 to 5x11)" },
  { cols: 6, rows: [3, 11], profileId: "1343788", title: "6 Columns (6x3 to 6x11)" },
  { cols: 7, rows: [2, 11], profileId: "1343770", title: "7 Columns (7x2 to 7x11)" },
  { cols: 8, rows: [3, 11], profileId: "1343769", title: "8 Columns (8x3 to 8x11)" },
  { cols: 9, rows: [3, 11], profileId: "1343767", title: "9 Columns (9x3 to 9x11)" },
  { cols: 10, rows: [3, 11], profileId: "1343766", title: "10 Columns (10x3 to 10x11)" },
  { cols: 11, rows: [3, 11], profileId: "1343747", title: "11 Columns (11x3 to 11x11)" },
  // The four largest need a bed deeper than 256 mm, which is what their titles mean by "for H2D".
  { cols: 12, rows: [3, 15], profileId: "1343738", title: "12 Columns (12x3 to 12x15)" },
  { cols: 13, rows: [3, 15], profileId: "1343737", title: "13 Columns (13x3 to 13x15)" },
  { cols: 14, rows: [3, 15], profileId: "1343728", title: "14 Columns (14x3 to 14x15)" },
  { cols: 15, rows: [3, 15], profileId: "1343715", title: "15 Columns (15x3 to 15x15)" },
];

/** The smallest and largest hole counts anything is published in. */
export const MIN_HOLES = 2;
export const MAX_HOLES = 15;

/** A board with these hole counts needs mirroring along that axis: an even count's slots sit off-centre. */
export const needsMirror = (holes) => holes % 2 === 0;

/**
 * Where a board of `cols` × `rows` holes comes from: the profile that holds it, and whether the file in it is the
 * board turned a quarter turn. Null when nobody publishes that size.
 */
export function boardSource(cols, rows) {
  const direct = BOARD_PROFILES.find((p) => p.cols === cols && rows >= p.rows[0] && rows <= p.rows[1]);
  if (direct) return { profile: direct, file: `${cols} x ${rows}.stl`, turned: false };
  // The same board the other way round: a 5 × 14 is a 14 × 5 on its side, and that one is published.
  const turned = BOARD_PROFILES.find((p) => p.cols === rows && cols >= p.rows[0] && cols <= p.rows[1]);
  if (turned) return { profile: turned, file: `${rows} x ${cols}.stl`, turned: true };
  return null;
}

/** Whether anyone publishes a board this size, either way round. */
export const boardExists = (cols, rows) => boardSource(cols, rows) !== null;

/**
 * How the boards are held to the wall. `per` counts an item against the lattice the boards make: a junction is a
 * point where four boards meet, an edge node where two meet along the outside, an outer corner where one sits alone.
 */
export const MOUNT_SYSTEMS = [
  {
    id: "wall-mounts",
    name: "Wall mounts",
    summary: "One printed mount wherever board corners meet.",
    design: MOUNT_DESIGNS.multi,
    markers: "nodes",
    insetMm: 9,
    // 15 mm is left out although the multi mount has it: the single mount for the outer corners doesn't, and
    // corners standing 10 mm off a wall the rest stands 15 mm off would not sit flat.
    distances: [10, 20],
    profiles: { 10: "1609221", 20: "811358" },
    items: [
      { name: "Quad wall mount", per: { junction: 1 }, print: true, from: "multi" },
      { name: "Double wall mount", per: { edgeNode: 1 }, print: true, from: "multi" },
      { name: "Single wall mount", per: { outerCorner: 1 }, print: true, from: "single" },
      { name: "M4 × 40–60 wall screw", per: { junction: 1, edgeNode: 1, outerCorner: 1 }, print: false },
      { name: "M4 × 20 board screw", per: { board: 4 }, print: false },
      { name: "Wall plug", per: { junction: 1, edgeNode: 1, outerCorner: 1 }, print: false },
    ],
  },
  {
    id: "spacers",
    name: "Screw spacers",
    summary: "A spacer and a screw at each board corner.",
    design: MOUNT_DESIGNS.spacers,
    markers: "boardCorners",
    insetMm: 10,
    distances: [10, 15, 20],
    profiles: { 10: "321444", 15: "321441", 20: "321437" },
    items: [
      { name: "Screw spacer", per: { board: 4 }, print: true, from: "spacers" },
      { name: "M4 wall screw, 30 mm or longer", per: { board: 4 }, print: false },
      { name: "Wall plug", per: { board: 4 }, print: false },
    ],
  },
];

/** The single wall mount, for the four outer corners, in the two distances it is published in. */
export const SINGLE_MOUNT_PROFILES = { 10: "323619", 20: "323616" };

export const getMountSystem = (id) => MOUNT_SYSTEMS.find((system) => system.id === id) ?? MOUNT_SYSTEMS[0];

/** Beds, in mm. A bed decides the largest board that can be printed: holes = bed / 20 − 1. */
export const PRINTERS = [
  { id: "a1", name: "Bambu Lab A1", x: 256, y: 256 },
  { id: "p1s", name: "Bambu Lab P1S", x: 256, y: 256 },
  { id: "x1c", name: "Bambu Lab X1 Carbon", x: 256, y: 256 },
  { id: "a1-mini", name: "Bambu Lab A1 mini", x: 180, y: 180 },
  { id: "h2d", name: "Bambu Lab H2D", x: 350, y: 320 },
  { id: "mk4", name: "Prusa MK4 / MK3.9", x: 250, y: 210 },
  { id: "core-one", name: "Prusa Core One", x: 250, y: 220 },
  { id: "xl", name: "Prusa XL", x: 360, y: 360 },
  { id: "ender3", name: "Creality Ender 3", x: 220, y: 220 },
  { id: "k1", name: "Creality K1 / K1C", x: 220, y: 220 },
  { id: "neptune4", name: "Elegoo Neptune 4", x: 225, y: 225 },
  { id: "custom", name: "A bed of my own", x: 256, y: 256 },
];

export const getPrinter = (id, own) => {
  if (id === "custom") return { id, name: "A bed of my own", x: own.x, y: own.y };
  return PRINTERS.find((printer) => printer.id === id) ?? PRINTERS[0];
};

/** The MakerWorld address of one print profile, as the site's own links write it. */
export const profileUrl = (designId, profileId) =>
  `https://makerworld.com/en/models/${designId}#profileId-${profileId}`;

/* ------------------------------------------------------- the tool's own models */

// The keys Thingport files the tool's models under. They are stored per user once the tool is installed, so a key
// that has been released must keep meaning the same model.

export const boardKey = (cols) => `board-${cols}`;
export const mountKey = (which, mm) => `${which}-${mm}`;

/**
 * The models the tool brings, for its metadata: every board profile, and the mounts in each distance they come in.
 * Thingport fetches these into the "Tool: Skadis planner" collection when an admin installs the tool, as the admin,
 * through their own MakerWorld sign-in — AU3D's licence doesn't allow this repository to carry the files itself.
 */
export function collectionModels() {
  const models = BOARD_PROFILES.map((profile) => ({
    key: boardKey(profile.cols),
    name: `Skadis Infinity — ${profile.title}`,
    tags: ["skadis", "board"],
    source: profileUrl(BOARD_DESIGN.id, profile.profileId),
  }));
  for (const [mm, profileId] of Object.entries(getMountSystem("wall-mounts").profiles)) {
    models.push({
      key: mountKey("mount", mm),
      name: `Skadis wall mount, quad and double — ${mm} mm`,
      tags: ["skadis", "mount"],
      source: profileUrl(MOUNT_DESIGNS.multi.id, profileId),
    });
  }
  for (const [mm, profileId] of Object.entries(SINGLE_MOUNT_PROFILES)) {
    models.push({
      key: mountKey("single", mm),
      name: `Skadis single wall mount — ${mm} mm`,
      tags: ["skadis", "mount"],
      source: profileUrl(MOUNT_DESIGNS.single.id, profileId),
    });
  }
  for (const [mm, profileId] of Object.entries(getMountSystem("spacers").profiles)) {
    models.push({
      key: mountKey("spacer", mm),
      name: `Skadis screw spacer — M4 ${mm} mm`,
      tags: ["skadis", "mount"],
      source: profileUrl(MOUNT_DESIGNS.spacers.id, profileId),
    });
  }
  return models;
}

/** Which of the tool's models a printed item comes from, by the keys above. */
export function keyForItem(item, mm) {
  if (item.from === "multi") return mountKey("mount", mm);
  if (item.from === "single") return mountKey("single", mm);
  if (item.from === "spacers") return mountKey("spacer", mm);
  return null;
}
