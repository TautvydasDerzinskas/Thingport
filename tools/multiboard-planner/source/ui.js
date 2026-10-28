// The planner's window: the original planner's page, run as a Thingport tool. Its settings are kept with
// thingport.storage, and each part opens from the user's "Tool: Multiboard models" collection once Thingport has
// fetched it, or on Thangs until then.
//
// Its words come from locales/<code>.json, which Thingport reads and hands over as `t()`; `labels()` fills in the
// markup's own `data-t` attributes. The part and mount names ("Dual Clip", "Offset Snap") are not among them:
// they are the official catalogue's names, which the planner compares against and which match the real parts.

const SVGNS = "http://www.w3.org/2000/svg";

// Board colours follow the original planner: core red, edge green, corner yellow; snaps yellow (single), orange
// (dual), red (quad). Fixed so exports look the same.
// What a tile's kind and its snaps are drawn in. These stay the same in both themes on purpose: they are the
// legend's identity, read against the legend rather than against the page, and a core plate that changed colour
// with the theme would be harder to learn, not easier.
const TINTS = {
  core: "#d8574a",
  edge: "#57a85a",
  corner: "#e0c341",
  strip: "#9b6bd8",
};

/** What a plate is in the wall. A strip fills what a whole tile won't; a plain plate stands on its own. */
const TILE_KIND = {
  C1: "core",
  S1: "edge",
  S2: "edge",
  S3: "edge",
  S4: "edge",
  CR1: "corner",
  CR2: "corner",
  CR3: "corner",
  CR4: "corner",
  "Beginning Horizontal": "strip",
  "Middle Horizontal": "strip",
  "End Horizontal": "strip",
  "Beginning Vertical": "strip",
  "Middle Vertical": "strip",
  "End Vertical": "strip",
};
export const tileKind = (type) => TILE_KIND[type] ?? "plain";

/**
 * The joints each mounting puts at a corner, by how many plates meet there.
 *
 * A quad offset snap is printed as two bars that cross, so it comes back as two outlines laid at right angles;
 * that crossing is what holds the four plates to each other.
 */
const JOINT_FOR = {
  "Offset Snap": {
    4: [
      ["thangs-993369", "6.25 mm - Quad Offset Snaps DS Part A - Part 1"],
      ["thangs-993369", "6.25 mm - Quad Offset Snaps DS Part A - Part 2"],
    ],
    2: [["thangs-974338", "6.25 mm - Dual Offset Snaps DS Part A"]],
    1: [["thangs-974340", "6.25 mm - Offset Snap DS Part A"]],
  },
  "Free Standing": {
    4: [["thangs-974388", "Raised Quad Snap DS Part A"]],
    2: [["thangs-974320", "Raised Dual Snap DS Part A"]],
    1: [["thangs-974052", "Raised Double-Sided Snap DS Part A"]],
  },
};
/** The outlines for one corner, or an empty list where the mounting has no model (a screw is just a screw). */
export function jointOutlines(mount, plates) {
  return (JOINT_FOR[mount]?.[plates] ?? []).map(([key, name]) => JOINT_OUTLINES[key]?.[name]).filter(Boolean);
}

/**
 * The piece of a mounting you actually see, where that isn't the one holding the plates together.
 *
 * An offset snap is two pieces: part A reaches behind the board and holds the plates to each other, and part B
 * drops into a multihole from the front. So a board mounted that way shows part B -- one in every plate at
 * every corner, which is what the parts list counts -- and part A not at all. The raised snaps are the other
 * way round, with the piece on this side being the one in JOINT_FOR.
 */
const FRONT_PIECE = {
  "Offset Snap": ["thangs-1323061", "Snap DS Part B - Standard"],
};
export function frontOutline(mount) {
  const pick = FRONT_PIECE[mount];
  return pick ? (JOINT_OUTLINES[pick[0]]?.[pick[1]] ?? null) : null;
}
/** A plate takes its kind's colour where it has one; a lone tile is Thingport's own accent. */
export const plateColour = (type, colours) => colours[tileKind(type)] ?? colours.plate;

/**
 * The board's own colours, which do follow the theme: the wall behind it, the plate material, and the holes.
 *
 * A plate is drawn as material with holes cut in it, not as a tinted panel behind a dark screen, so the
 * octagons and pegboard holes stay crisp at any size and a light theme gets a light board instead of a dark
 * slab laid across the page.
 */
function board(mode, accent) {
  const dark = mode === "dark";
  const room = dark ? "#141a30" : "#f7f7f7";
  return {
    room, // the wall the board is planned on
    plate: accent, // the plate itself, in Thingport's own accent
    // A hole is an opening, so it is painted the wall behind it rather than a colour of its own. A plate is far
    // more hole than material -- 23.4 mm octagons on a 25 mm pitch -- so this is most of what a plate looks like.
    hole: room,
    outline: dark ? "#8891ad" : "#555b63", // the line round a plate, which has to read against the wall
    metal: dark ? "#aab3c6" : "#8d949c", // screws, snaps and clips: hardware, not plate
    metalEdge: dark ? "#1a2038" : "#3f444b",
    // A snap is drawn as an outline with nothing filled, so unlike a screw it has only its line to be seen by.
    // On the dark theme that line has to carry itself against a dark board, hence the orange.
    fitting: dark ? "#ff8a1f" : "#3f444b",
  };
}
const MOUNT_TYPES = ["Simple Flush", "Offset Pillar", "Offset Snap", "Free Standing"];
const TILE_SIZES = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4];
const MAX_TILES = 10000; // ~10 x 10 m of 4x4 tiles; beyond that the input is almost surely a typo
const DETAIL_LIMIT = 1500; // above this, no labels or snap markers in the preview
const LATTICE_ID = "mbp-lattice"; // the one cell every plate is drawn with
const SPREAD_ROOT = "mbp-spread-root"; // everything the spread slider moves
const ANIMATE_LIMIT = 300; // above this, tiles appear without the entrance animation
const TYPING_DELAY = 200; // ms to wait after the last keystroke before recalculating

/** A part's model key in tool.json, from its Thangs link: "https://than.gs/m/974214" is "thangs-974214". */
export function modelKey(link) {
  const match = /^https?:\/\/(?:than\.gs|(?:www\.)?thangs\.com)\/m\/(\d+)\/?$/i.exec(link || "");
  return match ? `thangs-${match[1]}` : null;
}

// A pad reaches this far over the edge, and a corner without one is cut back this far along both its edges:
// plate.scad makes PAD and CORNER_CHAMFER the same 25 - 12.5*sqrt(2).
const REACH = 1 - Math.sqrt(2) / 2;

/** Where the pads sit along one edge, as plate.scad's pad_steps does: always to the far corner, from the
 *  near one only when no neighbour on that side would supply it. Corner pads are left to the corner. */
function padSteps(cells, nearNeighbour, cell) {
  const out = [];
  for (let i = nearNeighbour ? 1 : 0; i <= cells; i++) {
    const t = i * cell;
    if (t - cell * REACH >= 0 && t + cell * REACH <= cells * cell) out.push(t);
  }
  return out;
}

/**
 * What one corner of a plate looks like, walked clockwise.
 *
 * A corner either carries a pad or is chamfered, and plate.scad decides which: `padded` there is
 * [+X+Y: px||py, -X+Y: py&&!mx, -X-Y: never, +X-Y: px&&!my]. A pad is a diamond centred on the corner, so
 * it reaches out along whichever sides have a neighbour and is cut flush on the sides that don't -- and the
 * one at a four-plate junction is exactly what fills the chamfers of the three plates around it.
 */
function cornerPoints(corner, x, y, X, Y, reach, sides) {
  if (corner === "tl") {
    if (sides.py && !sides.mx)
      return [
        [x, y],
        [x, y - reach],
        [x + reach, y],
      ];
    return [
      [x, y + reach],
      [x + reach, y],
    ];
  }
  if (corner === "tr") {
    if (sides.px || sides.py) {
      const pts = [sides.py ? [X - reach, y] : [X, y]];
      if (sides.py) pts.push([X, y - reach]);
      if (sides.px) pts.push([X + reach, y]);
      pts.push(sides.px ? [X, y + reach] : [X, y]);
      return pts;
    }
    return [
      [X - reach, y],
      [X, y + reach],
    ];
  }
  if (corner === "br") {
    if (sides.px && !sides.my)
      return [
        [X, Y - reach],
        [X + reach, Y],
        [X, Y],
      ];
    return [
      [X, Y - reach],
      [X - reach, Y],
    ];
  }
  return [
    [x + reach, Y],
    [x, Y - reach],
  ];
}

/**
 * The outline of one plate, as plate.scad cuts it.
 *
 * A side with a neighbour carries diamond pads that reach over it, one at every cell boundary; the facing
 * side of that neighbour has the matching notches cut out of it. A side with nothing beyond is straight,
 * which is what the relief channel runs along. Corners are the cornerPoints above. So a lone plate is
 * straight-sided with all four corners cut off, and only a join shows the sawtooth.
 */
export function plateOutline(x, y, w, h, sides, cell) {
  const reach = cell * REACH;
  const X = x + w,
    Y = y + h;
  const nx = Math.round(w / cell),
    ny = Math.round(h / cell);
  const pts = [];
  const run = (steps, at, out) => {
    for (const t of steps) pts.push(at(t - reach, 0), at(t, out * reach), at(t + reach, 0));
  };
  // Clockwise from the top edge. The top left corner is walked last, so the path closes onto its own start.
  const tl = cornerPoints("tl", x, y, X, Y, reach, sides);
  pts.push(tl[tl.length - 1]);
  if (sides.py) run(padSteps(nx, sides.mx, cell), (t, o) => [x + t, y + o], -1);
  pts.push(...cornerPoints("tr", x, y, X, Y, reach, sides));
  if (sides.px) run(padSteps(ny, sides.py, cell), (t, o) => [X - o, y + t], -1);
  pts.push(...cornerPoints("br", x, y, X, Y, reach, sides));
  if (sides.my) run(padSteps(nx, false, cell), (t, o) => [X - t, Y + o], -1);
  pts.push(...cornerPoints("bl", x, y, X, Y, reach, sides));
  if (sides.mx) run(padSteps(ny, false, cell), (t, o) => [x - o, Y - t], -1);
  pts.push(...tl.slice(0, -1));
  return `M${pts.map(([px, py]) => `${px.toFixed(2)} ${py.toFixed(2)}`).join("L")}Z`;
}

export function el(name, attrs, parent) {
  const node = document.createElementNS(SVGNS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  if (parent) parent.appendChild(node);
  return node;
}
/**
 * The plate's own face, as a pattern: one 25 mm cell drawn once and tiled over every plate.
 *
 * It is the real thing rather than a sketch of one -- an octagon 23.4 mm across its flats with a 7.9 mm
 * hole at each corner, which is what a plate looks like from above. Done as a pattern because a 16x16
 * plate is 256 octagons and 225 holes, and a wall is dozens of plates: drawn out, a large board would be
 * a hundred thousand nodes, and this is one node a plate however big the board.
 */
export function latticePattern(svg, colours) {
  const defs = el("defs", {}, svg);
  const pattern = el(
    "pattern",
    {
      id: LATTICE_ID,
      width: PlannerCore.TILE_CELL_OFFSET,
      height: PlannerCore.TILE_CELL_OFFSET,
      patternUnits: "userSpaceOnUse",
    },
    defs,
  );
  const cell = PlannerCore.TILE_CELL_OFFSET;
  const flats = 23.4;
  const edge = (cell - flats) / 2;
  const far = cell - edge;
  // An octagon's corner cut, for a given distance across its flats.
  const cut = (flats - flats / (1 + 2 * Math.cos(Math.PI / 4))) / 2;
  el(
    "polygon",
    {
      points: [
        [edge + cut, edge],
        [far - cut, edge],
        [far, edge + cut],
        [far, far - cut],
        [far - cut, far],
        [edge + cut, far],
        [edge, far - cut],
        [edge, edge + cut],
      ]
        .map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`)
        .join(" "),
      fill: colours.hole,
    },
    pattern,
  );
  // The pegboard hole sits on a cell's corner, so each cell carries a quarter of four of them.
  for (const [cx, cy] of [
    [0, 0],
    [cell, 0],
    [0, cell],
    [cell, cell],
  ])
    el("circle", { cx, cy, r: 3.95, fill: colours.hole }, pattern);
}

/**
 * One plate: its face with the holes through it, cut to the outline above.
 *
 * Nothing is laid over the face and nothing is tinted: the plate is Thingport's accent, the holes are the
 * wall behind it, and the shape of the edge is what tells the kinds apart. `simple` is for a board of
 * thousands, where a chamfer is a fraction of a pixel and the clip would cost more than it shows.
 */
export function tileGlyph(g, x, y, w, h, type, cell, id, simple, colours) {
  const sides = PLATE_SIDES[type] ?? { px: false, py: false, mx: false, my: false };
  const lw = cell * 0.05;
  const box = { x, y, width: w, height: h };
  const X = x + w,
    Y = y + h;
  if (simple) {
    el("rect", { ...box, fill: plateColour(type, colours) }, g);
    el("rect", { ...box, fill: `url(#${LATTICE_ID})` }, g);
    return;
  }
  const d = plateOutline(x, y, w, h, sides, cell);
  el("path", { d }, el("clipPath", { id }, g));
  el("path", { d, fill: plateColour(type, colours) }, g);
  const cut = el("g", { "clip-path": `url(#${id})` }, g);
  el("rect", { ...box, fill: `url(#${LATTICE_ID})` }, cut);
  // The pegboard hole through every pad, which the lattice stops short of. The ones on corner pads are what
  // bite the round notch out of the plate's own outline, so leaving them off is what made a corner look solid
  // where the real plate is open.
  const nx = Math.round(w / cell),
    ny = Math.round(h / cell);
  const r = cell * 0.158;
  const hole = (cx, cy) => el("circle", { cx, cy, r, fill: colours.hole }, cut);
  if (sides.py) for (const t of padSteps(nx, sides.mx, cell)) hole(x + t, y);
  if (sides.px) for (const t of padSteps(ny, sides.py, cell)) hole(X, y + t);
  if (sides.px || sides.py) hole(X, y);
  if (sides.py && !sides.mx) hole(x, y);
  if (sides.px && !sides.my) hole(X, Y);
  el("path", { d, fill: "none", stroke: colours.outline, "stroke-width": lw }, g);
}

/** A screw seen from above: a head with a cross slot, which reads as a screw at any size. */
export function screwGlyph(g, cx, cy, r, colours) {
  el("circle", { cx, cy, r, fill: colours.metal, stroke: colours.metalEdge, "stroke-width": r * 0.18 }, g);
  const w = r * 0.26,
    a = r * 0.6;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ])
    el(
      "line",
      {
        x1: cx - dx * a,
        y1: cy - dy * a,
        x2: cx + dx * a,
        y2: cy + dy * a,
        stroke: colours.metalEdge,
        "stroke-width": w,
        "stroke-linecap": "round",
      },
      g,
    );
}

/** A standoff pillar from above: a ring, so it doesn't read as a screw. */
export function pillarGlyph(g, cx, cy, r, colours) {
  el("circle", { cx, cy, r, fill: colours.metal, stroke: colours.metalEdge, "stroke-width": r * 0.18 }, g);
  el("circle", { cx, cy, r: r * 0.42, fill: colours.room, stroke: colours.metalEdge, "stroke-width": r * 0.12 }, g);
}

/**
 * A snap from above, with one arm reaching into each plate it holds.
 *
 * The arms come from which plates actually meet there, so a snap in the middle of the wall comes out as the X
 * over four plates, one on an edge reaches into two, and one on a corner into one -- no table needed.
 */
export function snapGlyph(g, cx, cy, r, dirs, colours, outlines, cell) {
  if (!outlines?.length) {
    // No model for this one: fall back to an arm per plate it holds.
    for (const [dx, dy] of dirs)
      el(
        "line",
        {
          x1: cx,
          y1: cy,
          x2: cx + dx * r * 1.55,
          y2: cy + dy * r * 1.55,
          stroke: colours.fitting,
          "stroke-width": r * 0.74,
          "stroke-linecap": "round",
        },
        g,
      );
    el("circle", { cx, cy, r: r * 0.62, fill: colours.metal, stroke: colours.metalEdge, "stroke-width": r * 0.18 }, g);
    return;
  }
  // Where the fitting goes, from the grid rather than from its own size: its holes have to land on multiholes,
  // and those sit at cell centres, half a cell in from a plate's corner. So a corner with plates on one side
  // only moves the fitting half a cell that way, and one with plates all round leaves it where it is.
  const mx = dirs.reduce((a, d) => a + d[0], 0);
  const my = dirs.reduce((a, d) => a + d[1], 0);
  const ox = Math.sign(Math.abs(mx) < 1e-6 ? 0 : mx) * (cell / 2);
  const oy = Math.sign(Math.abs(my) < 1e-6 ? 0 : my) * (cell / 2);
  // Where it has to point. Two plates: along the line joining them, so the bar crosses the seam. One plate:
  // into it. Four: the bars cross the corner diagonally, and a cluster needs no turning at all.
  const deg = (angle) => (angle * 180) / Math.PI;
  outlines.forEach((outline, i) => {
    let turn = 0;
    if (outline.axis !== null && dirs.length) {
      const aim =
        dirs.length === 4
          ? 45 + i * 90
          : dirs.length === 2
            ? deg(Math.atan2(dirs[0][1] - dirs[1][1], dirs[0][0] - dirs[1][0]))
            : deg(Math.atan2(dirs[0][1], dirs[0][0]));
      turn = aim - outline.axis;
    }
    el(
      "path",
      {
        d: outline.d,
        transform: `translate(${(cx + ox).toFixed(2)} ${(cy + oy).toFixed(2)}) rotate(${turn.toFixed(1)})`,
        fill: "none",
        stroke: colours.fitting,
        "stroke-width": 1.2,
        "stroke-linejoin": "round",
      },
      g,
    );
  });
}

/**
 * One plate on its own, as a standalone SVG: what the outline check measures against the real projection, and
 * what the saved plan's picture and the per-tile pictures in the instructions are drawn from.
 */
export function plateSvg(type, cells, colours) {
  const cell = PlannerCore.TILE_CELL_OFFSET;
  const side = cells * cell;
  const pad = cell * 0.4;
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `${-pad} ${-pad} ${side + 2 * pad} ${side + 2 * pad}`);
  svg.setAttribute("xmlns", SVGNS);
  latticePattern(svg, colours);
  el("rect", { x: -pad, y: -pad, width: side + 2 * pad, height: side + 2 * pad, fill: colours.room }, svg);
  tileGlyph(svg, 0, 0, side, side, type, cell, `mbp-plate-${type}`.replace(/[^\w-]+/g, "-"), false, colours);
  return svg;
}

export default async function mount(thingport) {
  const { root, theme, storage, ui, models, collections, t, labels } = thingport;
  const C = PlannerCore;
  const PAL = { ...TINTS, ...board(theme.mode, theme.primary) };
  // A size label sits on the plate, so it takes plain ink with the wall colour as its halo: black on the light
  // theme, white on the dark one.
  PAL.ink = theme.mode === "dark" ? "#ffffff" : "#000000";
  PAL.inkHalo = theme.mode === "dark" ? "#000000" : "#ffffff";
  const parts = new C.PartDataLinks(PLANNER_DATA);
  const $ = (id) => root.querySelector(`#mbp-${id}`);
  const shell = root.querySelector(".mbp");

  // Thingport's theme, for tool.html's styles.
  const colours = {
    bg: theme.background,
    panel: theme.paper,
    divider: theme.divider,
    text: theme.text,
    muted: theme.textSecondary,
    accent: theme.primary,
    // What reads on the accent, which Thingport picks per accent colour: white for most, dark for the light ones
    // like amber. The fallback keeps an older Thingport, which didn't hand it over, close to right.
    "accent-ink": theme.primaryContrast ?? "#ffffff",
    danger: theme.error,
    font: theme.fontFamily,
  };
  for (const [name, value] of Object.entries(colours)) shell.style.setProperty(`--${name}`, value);

  const state = { units: 0, width: "1000", height: "1000", tileSize: 8, setup: 0, mount: "Simple Flush" };
  try {
    const saved = await storage.get("state");
    if (saved && typeof saved === "object") Object.assign(state, saved);
  } catch {
    // Starts from the defaults.
  }
  if (!MOUNT_TYPES.includes(state.mount)) state.mount = MOUNT_TYPES[0];
  if (!TILE_SIZES.includes(state.tileSize)) state.tileSize = 8;
  let persistTimer = 0;
  const persist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => void storage.set("state", { ...state }).catch(() => undefined), 500);
  };

  // The user's copies of the parts, by model key; filled in once they've loaded.
  let local = new Map();
  const loadLocal = async () => {
    try {
      const copies = await thingport.toolModels();
      local = new Map(copies.filter((copy) => copy.printId).map((copy) => [copy.key, copy]));
      const note = $("modelsNote");
      const missing = copies.length - local.size;
      note.hidden = missing === 0;
      note.textContent = local.size === 0 ? t("models.none") : t("models.some", { missing, total: copies.length });
    } catch {
      local = new Map();
    }
  };

  // ---- controls -------------------------------------------------------------
  const tileSel = $("tileSize");
  for (const size of TILE_SIZES) {
    const option = document.createElement("option");
    option.value = String(size);
    option.textContent = `${size} × ${size}`;
    tileSel.appendChild(option);
  }
  const mountSeg = $("mount");
  for (const type of MOUNT_TYPES) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.value = type;
    button.textContent = type;
    mountSeg.appendChild(button);
  }
  function bindSeg(el, key, parse) {
    el.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-value]");
      if (!button) return;
      state[key] = parse(button.dataset.value);
      update();
    });
  }
  bindSeg($("units"), "units", Number);
  bindSeg($("setup"), "setup", Number);
  bindSeg(mountSeg, "mount", String);
  tileSel.addEventListener("change", () => {
    state.tileSize = Number(tileSel.value);
    update();
  });
  let typingTimer = 0;
  for (const key of ["width", "height"]) {
    const input = $(key);
    input.addEventListener("input", () => {
      const clean = C.sanitizeNumber(input.value);
      if (clean !== input.value) {
        const pos = input.selectionStart - (input.value.length - clean.length);
        input.value = clean;
        input.setSelectionRange(Math.max(0, pos), Math.max(0, pos));
      }
      state[key] = clean;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(update, TYPING_DELAY);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        clearTimeout(typingTimer);
        update();
      }
    });
  }
  const aboutToggle = $("aboutToggle");
  aboutToggle.addEventListener("click", () => {
    const about = $("about");
    about.hidden = !about.hidden;
    aboutToggle.setAttribute("aria-expanded", String(!about.hidden));
  });

  function syncControls() {
    for (const [id, key] of [
      ["units", "units"],
      ["setup", "setup"],
      ["mount", "mount"],
    ]) {
      for (const button of $(id).querySelectorAll("button")) {
        button.setAttribute("aria-pressed", String(button.dataset.value === String(state[key])));
      }
    }
    tileSel.value = String(state.tileSize);
    if (root.ownerDocument.activeElement !== $("width")) $("width").value = state.width;
    if (root.ownerDocument.activeElement !== $("height")) $("height").value = state.height;
    const unit = state.units === C.MM ? "mm" : "in";
    root.querySelectorAll("[data-unit]").forEach((suffix) => {
      suffix.textContent = unit;
    });
    const req = state.tileSize * C.TILE_CELL_OFFSET;
    $("required").textContent =
      state.units === C.MM
        ? `${Math.round(req)} × ${Math.round(req)} mm`
        : `${(req / C.MM_TO_INCH).toFixed(2)} × ${(req / C.MM_TO_INCH).toFixed(2)} in`;
    $("recommend").hidden = state.tileSize === 8;
  }

  // ---- helpers ----------------------------------------------------------------
  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  function tileName(t) {
    const size = `${t.sizeX}x${t.sizeY}`;
    return parts.tileNames.has(t.type) ? `${size} ${parts.tileNames.get(t.type)} Tile` : `${size}  Tile`;
  }

  // ---- layout preview -----------------------------------------------------------
  function buildSvg(result) {
    const { data, mountRows } = result;
    const W = data.widthMm(),
      H = data.heightMm();
    const pad = Math.max(W, H) * 0.02;
    const svg = el("svg", {
      viewBox: `${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`,
      role: "img",
      "aria-label": `Layout of ${data.tiles.map.size} tiles`,
    });
    latticePattern(svg, PAL);
    el("rect", { x: 0, y: 0, width: W, height: H, fill: PAL.room, rx: Math.min(W, H) * 0.004 }, svg);
    const tiles = data.tiles.values();
    const def = data.tileSize * C.TILE_CELL_OFFSET;
    // Big boards: no entrance animation and no hover names (a wall of them is unreadable at that scale anyway),
    // so the browser only draws a few nodes per plate.
    const animate = tiles.length <= ANIMATE_LIMIT;
    const detailed = tiles.length <= DETAIL_LIMIT;
    const colored = mountRows[0].length > 1;
    // The wall's outline stays put as a backdrop; everything on it moves when the parts are spread.
    const root = el("g", { id: SPREAD_ROOT }, svg);
    root.dataset.cx = String(W / 2);
    root.dataset.cy = String(H / 2);
    const tileLayer = el("g", {}, root);
    // Sizes sit over the plates, hardware over everything: a snap bridging two plates is drawn across both.
    const labelLayer = el("g", {}, root);
    const partLayer = el("g", {}, root);
    const corners = new Map();
    const cell = C.TILE_CELL_OFFSET;
    const r = cell * 0.34;
    /** One piece of hardware, which the spread slider lifts and enlarges rather than just moving. */
    const hardware = (cx, cy, draw) => {
      if (!detailed) return;
      const grp = el(
        "g",
        {
          class: "mbp-fitting",
          "data-ox": (cx - W / 2).toFixed(2),
          "data-oy": (cy - H / 2).toFixed(2),
          "data-cx": cx.toFixed(2),
          "data-cy": cy.toFixed(2),
          "data-lift": (cell * 0.5).toFixed(2),
        },
        partLayer,
      );
      draw(grp);
    };
    const gap = Math.max(W, H) * 0.0015;
    tiles.forEach((t, i) => {
      const w = t.sizeX * C.TILE_CELL_OFFSET,
        h = t.sizeY * C.TILE_CELL_OFFSET;
      const x = t.x * def,
        y = H - t.y * def - h;
      const name = tileName(t);
      // Which way this piece moves when the parts are spread: out from the middle, by how far off it is.
      const ox = (x + w / 2 - W / 2).toFixed(2),
        oy = (y + h / 2 - H / 2).toFixed(2);
      // Two groups rather than one. The entrance animation ends on `transform: none`, and a CSS transform beats
      // a transform attribute on the same element, so a plate that had been animated would ignore the spread
      // and sit still while its labels and snaps moved off it. The outer group spreads, the inner animates.
      const slot = el("g", { "data-ox": ox, "data-oy": oy }, tileLayer);
      const g = el(
        "g",
        animate
          ? {
              class: "tile enter",
              "data-name": name,
              style: `animation-delay:${Math.min(i * 12, 300)}ms;transform-origin:${x + w / 2}px ${y + h / 2}px`,
            }
          : { class: "tile", "data-name": name },
        slot,
      );
      tileGlyph(
        g,
        x + gap,
        y + gap,
        w - 2 * gap,
        h - 2 * gap,
        t.type,
        C.TILE_CELL_OFFSET,
        `mbp-cut-${i}`,
        !detailed,
        PAL,
      );
      // Not drawn on the plate: its size and where its snaps go. Both are in the parts list, and over a wall of
      // plates they hid the thing they were labelling.
      if (detailed) el("title", {}, g).textContent = name;
      if (detailed) {
        const fs = Math.min(w, h) / 7.5;
        const label = el(
          "text",
          {
            x: x + w / 2,
            y: y + h / 2,
            "font-size": fs,
            "text-anchor": "middle",
            "dominant-baseline": "central",
            fill: PAL.ink,
            stroke: PAL.inkHalo,
            "stroke-width": fs / 7,
            "paint-order": "stroke",
            "font-weight": 800,
            "font-family": "system-ui, sans-serif",
            "data-ox": ox,
            "data-oy": oy,
            "pointer-events": "none",
          },
          labelLayer,
        );
        label.textContent = `${t.sizeX}x${t.sizeY}`;
      }
      for (const [sx, sy] of [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ]) {
        const at = `${sx.toFixed(1)},${sy.toFixed(1)}`;
        const met = corners.get(at) ?? { x: sx, y: sy, dirs: [] };
        // Which way this plate lies from the corner, so a snap there knows where to reach.
        const dx = Math.sign(x + w / 2 - sx),
          dy = Math.sign(y + h / 2 - sy);
        met.dirs.push([dx / Math.SQRT2, dy / Math.SQRT2]);
        corners.set(at, met);
      }
      // Screws and pillars are per plate, not per corner: a wall of 25 plates takes 100 of them, four each,
      // through the peg hole a cell in from every corner.
      if (!colored)
        for (const [sx, sy] of [
          [x + cell, y + cell],
          [x + w - cell, y + cell],
          [x + cell, y + h - cell],
          [x + w - cell, y + h - cell],
        ])
          hardware(sx, sy, (grp) => (state.mount === "Offset Pillar" ? pillarGlyph : screwGlyph)(grp, sx, sy, r, PAL));
    });
    // Snaps are per corner, shared: the 36 junctions of a 5x5 wall take 16 quad, 16 dual and 4 single snaps,
    // which is what the parts list asks for, and the arms follow the plates that actually meet there.
    const front = frontOutline(state.mount);
    if (colored && front)
      // One in each plate that meets here, sitting in the multihole half a cell into it.
      for (const met of corners.values())
        for (const [dx, dy] of met.dirs) {
          const fx = met.x + Math.sign(dx) * (cell / 2);
          const fy = met.y + Math.sign(dy) * (cell / 2);
          hardware(fx, fy, (grp) => snapGlyph(grp, fx, fy, r, [], PAL, [front], cell));
        }
    else if (colored)
      for (const met of corners.values())
        hardware(met.x, met.y, (grp) =>
          snapGlyph(grp, met.x, met.y, r, met.dirs, PAL, jointOutlines(state.mount, met.dirs.length), cell),
        );
    return { svg, colored };
  }

  /**
   * What the colours and the fittings on the board mean.
   *
   * Only what is actually on the board is listed: the plate kinds the wall happens to use, and the fittings the
   * chosen mounting brings. A lone tile has no kind of its own, so a wall of those shows no plate colours.
   */
  function renderLegend(result) {
    const kinds = new Set(result.data.tiles.values().map((tile) => tileKind(tile.type)));
    const parts = [];
    for (const kind of ["core", "edge", "corner", "strip"])
      if (kinds.has(kind))
        parts.push(`<span><i style="background:${PAL[kind]}"></i>${esc(t(`legend.${kind}`))}</span>`);
    const snapped = result.mountRows[0].length > 1;
    const key = (inner, box) => `<svg class="mbp-key" viewBox="${box}" aria-hidden="true">${inner}</svg>`;
    /** The joint drawn from its own outline, so the key is the same part the board shows. */
    const joint = (plates, label) => {
      const [outline] = jointOutlines(state.mount, plates);
      if (!outline) return "";
      const side = Math.max(outline.w, outline.h) * 1.12;
      const art = `<path d="${outline.d}" fill="none" stroke="${PAL.fitting}" stroke-width="${(side / 18).toFixed(2)}" stroke-linejoin="round"/>`;
      return `<span>${key(art, `${-side / 2} ${-side / 2} ${side} ${side}`)}${esc(t(`legend.${label}`))}</span>`;
    };
    const front = frontOutline(state.mount);
    if (snapped && front) {
      const side = Math.max(front.w, front.h) * 1.12;
      const art = `<path d="${front.d}" fill="none" stroke="${PAL.fitting}" stroke-width="${(side / 18).toFixed(2)}" stroke-linejoin="round"/>`;
      parts.push(`<span>${key(art, `${-side / 2} ${-side / 2} ${side} ${side}`)}${esc(t("legend.snap"))}</span>`);
    } else if (snapped) {
      parts.push(joint(4, "quad"), joint(2, "dual"), joint(1, "single"));
    } else {
      const head =
        `<circle r="7" fill="${PAL.metal}" stroke="${PAL.metalEdge}" stroke-width="1.3"/>` +
        `<line x1="-4.2" y1="0" x2="4.2" y2="0" stroke="${PAL.metalEdge}" stroke-width="1.8" stroke-linecap="round"/>` +
        `<line x1="0" y1="-4.2" x2="0" y2="4.2" stroke="${PAL.metalEdge}" stroke-width="1.8" stroke-linecap="round"/>`;
      const ring =
        `<circle r="7" fill="${PAL.metal}" stroke="${PAL.metalEdge}" stroke-width="1.3"/>` +
        `<circle r="3" fill="${PAL.room}" stroke="${PAL.metalEdge}" stroke-width="1"/>`;
      const pillar = state.mount === "Offset Pillar";
      parts.push(
        `<span>${key(pillar ? ring : head, "-10 -10 20 20")}${esc(t(`legend.${pillar ? "pillar" : "screw"}`))}</span>`,
      );
    }
    $("legend").innerHTML = parts.join("");
  }

  // ---- parts list ---------------------------------------------------------------
  function partIcon(row, isTile) {
    const svg = el("svg", { viewBox: "0 0 34 34", class: "mbp-ico", "aria-hidden": "true" });
    if (isTile) {
      el("rect", { x: 1, y: 1, width: 32, height: 32, rx: 5, fill: PAL.tileBg }, svg);
      tileGlyph(svg, 3, 3, 28, 28, row[3], 7, `mbp-ico-cut-${row[0]}`.replace(/[^\w-]+/g, "-"), false, PAL);
      return svg;
    }
    const name = row[0];
    if (name.includes("Foot") || name === "Snap (DS Part B)" || name === "Dual Clip") {
      el(
        "rect",
        {
          x: 5,
          y: 12,
          width: 24,
          height: 10,
          rx: 5,
          fill: "none",
          stroke: "currentColor",
          "stroke-width": 2,
          opacity: 0.7,
        },
        svg,
      );
      return svg;
    }
    const color = name.includes("Dual") ? PAL.dual : name.includes("Quad") ? PAL.quad : PAL.single;
    const small = state.mount === "Simple Flush" || state.mount === "Offset Pillar";
    el("circle", { cx: 17, cy: 17, r: small ? 6 : 11, fill: color, stroke: "#000", "stroke-width": 2 }, svg);
    return svg;
  }

  /** The user's copy of a part, or null while Thingport doesn't have it. */
  const localCopy = (link) => local.get(modelKey(link)) ?? null;

  /** A download icon, so the button says what it does without a word of explanation. */
  function downloadIcon() {
    const svg = el("svg", { viewBox: "0 0 16 16", class: "mbp-ico-dl", "aria-hidden": "true" });
    el(
      "path",
      {
        d: "M8 1.8v7.4M4.6 6.1 8 9.4l3.4-3.3M2.4 11.1v1.6a1.5 1.5 0 0 0 1.5 1.5h8.2a1.5 1.5 0 0 0 1.5-1.5v-1.6",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 1.6,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
      svg,
    );
    return svg;
  }

  /** A download button for one part, with the icon and the name read out for anyone not seeing it. */
  function downloadButton(label, run) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mbp-link";
    button.appendChild(downloadIcon());
    button.title = t("part.download");
    button.setAttribute("aria-label", t("part.downloadAria", { name: label }));
    button.addEventListener("click", () => void run());
    return button;
  }

  /**
   * What can be done with one part.
   *
   * Only what Thingport itself can do: a plate is drawn on the spot, a part it keeps is opened or downloaded,
   * and one it doesn't have yet says so. Nothing links out any more.
   */
  function partLinks(row) {
    const wrap = document.createElement("span");
    wrap.className = "mbp-links";
    const label = row[0].replace(/\n/g, " ");
    const links = (Array.isArray(row[2]) ? row[2] : [row[2]]).filter(Boolean);
    for (const href of links) {
      const tile = PLATE_BY_LINK.get(href);
      if (tile) {
        // A plate is not kept anywhere: it is drawn when asked for.
        const draw = downloadButton(label, () => downloadPlate(tile, label));
        draw.title = t("part.draw");
        draw.setAttribute("aria-label", t("part.drawAria", { name: label }));
        wrap.append(draw);
        continue;
      }
      const copy = localCopy(href);
      if (copy) {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "mbp-link";
        open.textContent = t("part.open");
        open.setAttribute("aria-label", t("part.openAria", { name: label }));
        open.addEventListener("click", () => models.open(copy.printId));
        wrap.append(
          open,
          downloadButton(label, () => downloadModel(copy.printId)),
        );
      } else {
        const missing = downloadButton(label, () => {});
        missing.disabled = true;
        missing.title = t("part.missing");
        missing.setAttribute("aria-label", t("part.missing"));
        wrap.appendChild(missing);
      }
    }
    return wrap;
  }

  /** One plate, drawn and handed over. It takes a second or three, so the button says so while it works. */
  /**
   * Holds the "Loading…" popup up while `run` works, whatever happens to it.
   *
   * Drawing a plate runs OpenSCAD, which holds the main thread for seconds: without waiting for a frame first
   * the popup is only marked visible and never painted, so the window simply locks up with nothing on it. Two
   * frames is what it takes to be sure the paint has landed before the thread goes away. The spinner itself is
   * a transform, which keeps turning off the main thread while the work runs.
   */
  const painted = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

  async function whileLoading(run) {
    $("loadCover").hidden = false;
    await painted();
    try {
      await run();
    } catch (err) {
      ui.toast(err.message || String(err), "error");
    } finally {
      $("loadCover").hidden = true;
    }
  }

  async function downloadPlate(tile, label) {
    await whileLoading(async () => {
      const scad = await openscad();
      const mesh = await renderPlate(scad, PLATE_SCAD, tile);
      const stem =
        label
          .replace(/[\\/:*?"<>|]+/g, "-")
          .replace(/\s+/g, " ")
          .trim() || "multiboard-plate";
      thingport.download({
        name: `${stem}.stl`,
        data: writeBinaryStl(mesh, { name: label }),
        type: "model/stl",
      });
    });
  }

  async function downloadModel(id) {
    await whileLoading(async () => {
      const model = await models.get(id);
      for (const file of model.files) thingport.download({ name: file.name, data: await models.file(id, file.id) });
    });
  }

  function renderParts(result) {
    const host = $("results");
    host.innerHTML = "";
    const sections = [
      ["Tiles", result.tileRows[0], true],
      ["Mounting", result.mountRows[0].concat(result.mountRows[2] || []), false],
    ];
    let tileCount = 0;
    let delay = 0;
    for (const [title, rows, isTile] of sections) {
      if (!rows.length) continue;
      const heading = document.createElement("div");
      heading.className = "mbp-section-title";
      heading.textContent = title;
      host.appendChild(heading);
      const list = document.createElement("ul");
      list.className = "mbp-parts";
      for (const row of rows) {
        const item = document.createElement("li");
        item.className = "mbp-part";
        item.style.animationDelay = `${Math.min(delay++ * 25, 300)}ms`;
        item.appendChild(partIcon(row, isTile));
        const name = document.createElement("span");
        name.className = "mbp-name";
        name.textContent = row[0];
        item.appendChild(name);
        const qty = document.createElement("span");
        qty.className = "mbp-qty";
        qty.innerHTML = row[1] === "-" ? "<small>optional</small>" : `${Number(row[1])}<small>×</small>`;
        item.appendChild(qty);
        item.appendChild(partLinks(row));
        if (isTile) {
          tileCount += Number(row[1]);
          item.tabIndex = 0;
          const on = () => highlight(row[0]);
          item.addEventListener("mouseenter", on);
          item.addEventListener("focus", on);
          item.addEventListener("mouseleave", () => highlight(null));
          item.addEventListener("blur", () => highlight(null));
        }
        list.appendChild(item);
      }
      host.appendChild(list);
    }
    $("count").textContent = `${tileCount} tile${tileCount === 1 ? "" : "s"}`;
  }

  function highlight(name) {
    const stage = $("stage");
    stage.classList.toggle("mbp-dim", Boolean(name));
    stage.querySelectorAll(".tile").forEach((tile) => tile.classList.toggle("hl", tile.dataset.name === name));
  }

  function showEmpty(title, text, isError) {
    const stage = $("stage");
    stage.replaceChildren();
    const box = document.createElement("div");
    box.className = `mbp-empty${isError ? " mbp-error" : ""}`;
    const strong = document.createElement("strong");
    strong.textContent = title;
    box.append(strong, text);
    stage.appendChild(box);
    $("results").innerHTML = '<p class="mbp-empty" style="margin:24px auto">No parts yet.</p>';
    $("count").textContent = "";
    $("legend").innerHTML = "";
    $("unused").classList.remove("mbp-show");
    $("saveBtn").disabled = $("filesBtn").disabled = true;
  }

  /**
   * Spreading the parts apart, to see what a board is made of.
   *
   * Each piece moves out from the middle by how far off it already is, so the board comes apart evenly, and
   * the whole lot is scaled back by the same amount so it stays in frame rather than growing off the edge.
   */
  function applySpread(amount) {
    const root = document.getElementById(SPREAD_ROOT);
    if (!root) return;
    const k = amount / 100;
    const cx = Number(root.dataset.cx || 0),
      cy = Number(root.dataset.cy || 0);
    const shrink = 1 / (1 + k);
    root.setAttribute("transform", k ? `translate(${cx} ${cy}) scale(${shrink}) translate(${-cx} ${-cy})` : "");
    for (const piece of root.querySelectorAll("[data-ox]")) {
      const ox = Number(piece.dataset.ox) * k,
        oy = Number(piece.dataset.oy) * k;
      const lift = Number(piece.dataset.lift || 0);
      if (!k) {
        piece.removeAttribute("transform");
        piece.style.filter = "";
        continue;
      }
      if (!lift) {
        piece.setAttribute("transform", `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`);
        continue;
      }
      // A fitting doesn't just move with its plates: it comes up off the wall towards you, so it grows, climbs
      // and casts a shadow that opens up as it rises. At rest it sits exactly where it joins them.
      const cx = Number(piece.dataset.cx),
        cy = Number(piece.dataset.cy);
      const grow = (1 + 1.2 * k).toFixed(3);
      const up = (lift * k).toFixed(2);
      piece.setAttribute(
        "transform",
        `translate(${ox.toFixed(2)} ${(oy - lift * k).toFixed(2)}) ` +
          `translate(${cx} ${cy}) scale(${grow}) translate(${-cx} ${-cy})`,
      );
      piece.style.filter = `drop-shadow(0 ${up}px ${(lift * k * 1.3).toFixed(2)}px rgba(0,0,0,.35))`;
    }
  }

  // A drag fires faster than a board can be redrawn, so only the last one in a frame is acted on.
  let spreadFrame = 0;
  $("spread").addEventListener("input", () => {
    if (spreadFrame) return;
    spreadFrame = requestAnimationFrame(() => {
      spreadFrame = 0;
      applySpread(Number($("spread").value) || 0);
    });
  });

  // ---- main update ----------------------------------------------------------------
  let current = null;
  function update() {
    persist();
    syncControls();
    const input = {
      width: parseFloat(state.width) || 0,
      height: parseFloat(state.height) || 0,
      tileSize: state.tileSize,
      units: state.units,
      setup: state.setup,
      mountingType: state.mount,
    };
    const unit = state.units === C.MM ? "mm" : "in";
    $("dims").textContent = `${fmt(input.width)} × ${fmt(input.height)} ${unit}`;
    current = null;
    const estimate = C.estimateTileCount(input);
    if (estimate > MAX_TILES) {
      return showEmpty(
        "Wall too large",
        `That would take about ${estimate.toLocaleString()} tiles. Check the size and units, or pick a bigger tile (limit ${MAX_TILES.toLocaleString()} tiles).`,
        true,
      );
    }
    const result = C.calculate(input, parts);
    if (result.error === "dimensions")
      return showEmpty("Dimensions are incorrect", "Enter a width and height above zero.", true);
    if (result.error === "minSize")
      return showEmpty(
        "Tile too small",
        `This mount needs tiles bigger than ${result.minSize - 1}×${result.minSize - 1}.`,
        true,
      );
    if (result.error === "noTiles") {
      const req = state.tileSize * C.TILE_CELL_OFFSET;
      const reqText = state.units === C.MM ? `${req} mm` : `${(req / C.MM_TO_INCH).toFixed(2)} in`;
      return showEmpty(
        "No tile fits",
        `The wall must be at least ${reqText} wide and high for ${state.tileSize}×${state.tileSize} tiles. Pick a smaller tile size.`,
      );
    }
    current = result;
    const { svg } = buildSvg(result);
    renderLegend(result);
    $("stage").replaceChildren(svg);
    applySpread(Number($("spread").value) || 0);
    renderParts(result);
    $("saveBtn").disabled = $("filesBtn").disabled = !wallKeys(result).length;
    const [uw, uh] = C.unusedSpace(result.data);
    const show = uw > 1e-9 || uh > 1e-9;
    $("unused").classList.toggle("mbp-show", show);
    $("unusedW").textContent = `${uw.toFixed(2)} ${result.data.unitsLabel()}`;
    $("unusedH").textContent = `${uh.toFixed(2)} ${result.data.unitsLabel()}`;
  }

  // ---- export ---------------------------------------------------------------------
  function saveRows(result) {
    return result.tileRows[1]
      .map((r) => [r[0], String(r[1]), [r[2]]])
      .concat(
        result.mountRows[1],
        (result.mountRows[2] || []).map((r) => [r[0].replace(/\n/g, ""), r[1], r[2]]),
      );
  }
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /** Every link in a wall, as model keys: what it is made of, whether or not any of it is kept. */
  function wallKeys(result) {
    const keys = new Set();
    for (const row of saveRows(result))
      for (const link of row[2] || []) {
        const key = modelKey(link);
        if (key) keys.add(key);
      }
    return [...keys];
  }

  // ---- saving the wall as a model of its own -------------------------------------
  /** Every part of the wall Thingport has a copy of, with how many are needed. */
  /** What to print and in what order, for the saved model's description. */
  // --- drawing a wall -----------------------------------------------------------------------------
  //
  // A wall is plates and joints, and they arrive differently: a plate is drawn here from plate.scad, a
  // joint is read from the files the tool carries. Both end up as geometry so the whole wall can be one
  // 3MF, each piece named with how many to print -- a 3MF holds one copy of a shape however many are
  // wanted, so the name is where a person reads the count.

  const PLATE_BY_LINK = plateIndex(PLANNER_DATA.tiles);
  let scadLibrary = null;
  const openscad = async () => (scadLibrary ??= await thingport.library("openscad"));

  /** What a wall is made of, each distinct piece once with how many of it are wanted. */
  function wallPlan(result) {
    const plates = new Map();
    const joints = new Map();
    for (const row of saveRows(result)) {
      const quantity = Number(row[1]) || 0;
      const name = String(row[0]).replace(/\n/g, " ").trim();
      for (const link of row[2] || []) {
        const tile = PLATE_BY_LINK.get(link);
        if (tile) {
          const id = `${tile.type}:${tile.size}`;
          const seen = plates.get(id);
          if (seen) seen.quantity += quantity;
          else plates.set(id, { type: tile.type, size: tile.size, name, quantity });
          continue;
        }
        const key = modelKey(link);
        if (!key) continue;
        const seen = joints.get(key);
        if (seen) seen.quantity += quantity;
        else joints.set(key, { key, link, name, quantity });
      }
    }
    return { plates: [...plates.values()], joints: [...joints.values()] };
  }

  /** A joint's pieces, read from the files the tool carries. */
  // Multiboard ships its snaps in four fits of the same part. You print one of them, not all four, so only one
  // goes in the wall -- the standard fit, which is what the planner's counts assume.
  const FITS = ["Standard", "Permanent", "Tight", "Loose"];
  /** What tells one of a model's files from another: "Part 2", "Tight", or nothing where there is only one. */
  const fileSuffix = (file) => (/ - ([^-]+)$/.exec(file.name.replace(/\.[^.]+$/, "")) ?? ["", ""])[1].trim();

  /**
   * One joint's files, exactly as the tool packed them: nothing is parsed, so nothing can be lost.
   *
   * A model of several files is either one part in several fits, of which one is printed, or a part that comes
   * in pieces, all of which are. The first is cut down to the standard fit; the second keeps every piece, with
   * what tells them apart left in the name.
   */
  async function readJoint(joint) {
    const copy = localCopy(joint.link);
    if (!copy) throw new Error(t("build.missing", { part: joint.name }));
    const model = await models.get(copy.printId);
    const fits = model.files.filter((file) => FITS.includes(fileSuffix(file)));
    const wanted =
      fits.length === model.files.length && fits.length > 1
        ? [FITS.map((fit) => fits.find((file) => fileSuffix(file) === fit)).find(Boolean)]
        : model.files;
    const label = partName(joint);
    const pieces = [];
    for (const file of wanted) {
      const data = await models.file(copy.printId, file.id);
      const suffix = model.files.length > 1 ? fileSuffix(file) : "";
      const dot = file.name.lastIndexOf(".");
      pieces.push({
        name: suffix ? `${label} - ${suffix}` : label,
        data,
        extension: dot > 0 ? file.name.slice(dot) : ".stl",
      });
    }
    return pieces;
  }

  /** Every piece of the wall as its own file, in print order. */
  async function wallFiles(result, options) {
    const scad = await openscad();
    const files = await buildWall(scad, PLATE_SCAD, wallPlan(result), { readJoint, ...options });
    if (!files.length) throw new Error(t("build.nothing"));
    return files;
  }

  /**
   * The plan as a picture, for the saved model's cover.
   *
   * Drawn afresh rather than taken off the page, so the slider's position doesn't end up in it, and painted
   * onto the wall's own colour first: the holes are drawn in that colour because that is what you see through
   * them, and on a transparent background they would not read as holes at all.
   */
  async function wallImage(result, title) {
    const svg = buildSvg(result).svg;
    const [, , boxWidth, boxHeight] = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    const scale = 1400 / Math.max(boxWidth, boxHeight);
    const width = Math.max(1, Math.round(boxWidth * scale));
    const height = Math.max(1, Math.round(boxHeight * scale));
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    // Standalone, so it can be loaded as an image: on the page it inherited this from the document.
    svg.setAttribute("xmlns", SVGNS);
    const markup = new XMLSerializer().serializeToString(svg);
    const drawn = await new Promise((done, fail) => {
      const image = new Image();
      image.onload = () => done(image);
      image.onerror = () => fail(new Error(t("toast.noPicture")));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = PAL.room;
    context.fillRect(0, 0, width, height);
    context.drawImage(drawn, 0, 0, width, height);
    const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
    if (!blob) throw new Error(t("toast.noPicture"));
    const stem =
      title
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, " ")
        .trim() || "multiboard-wall";
    return { name: `${stem}.png`, data: new Uint8Array(await blob.arrayBuffer()), type: "image/png" };
  }

  /** The same set as one download, since a browser will only hand over a single file. */
  function wallZip(title, files) {
    const stem =
      title
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, " ")
        .trim() || "multiboard-wall";
    return {
      name: `${stem}.zip`,
      data: zipStore(files.map((file) => [file.name, file.data])),
      type: "application/zip",
    };
  }

  // Drawing a wall takes a while, so it is shown rather than guessed at: a bar that really does count the
  // pieces, and a phrase that changes while it works, the way Thingport's own progress bars do.
  const BUILD_PHRASES = 6;
  let buildTimer = 0;
  let building = null;

  function showBuilding(on) {
    $("buildBox").hidden = !on;
    if (buildTimer) clearInterval(buildTimer);
    buildTimer = 0;
    if (!on) return;
    let n = Math.floor(Math.random() * BUILD_PHRASES);
    const say = () => {
      $("buildPhrase").textContent = t(`build.phrase${(n++ % BUILD_PHRASES) + 1}`);
    };
    say();
    buildTimer = setInterval(say, 3000);
  }

  /** Returns once the bar has actually been painted: the next plate holds the thread for seconds, and a bar
   *  that is only set and never drawn leaves the window looking stuck. */
  function buildProgress({ done, total }) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    $("buildFill").style.width = `${percent}%`;
    $("buildBar").setAttribute("aria-valuenow", String(percent));
    $("buildCount").textContent = t("build.count", { done, total });
    return painted();
  }

  function printNotes(result, title, parts) {
    const d = result.data;
    const total = parts.reduce((sum, part) => sum + part.quantity, 0);
    const lines = [
      title,
      "",
      t("notes.wall", { width: fmt(d.width), height: fmt(d.height), units: d.unitsLabel() }),
      t("notes.tiles", { size: `${state.tileSize} × ${state.tileSize}` }),
      t("notes.setup", { setup: state.setup === 1 ? t("setup.grid") : t("setup.single") }),
      t("notes.mount", { mount: d.mountingType }),
      "",
      t("notes.whatToPrint", { total }),
    ];
    // Left in the order the planner lists them, which is the boards and then the mounting hardware — the same
    // order the note below gives, and the order you want to print in.
    for (const part of parts) lines.push(`  ${part.quantity} × ${part.name}`);
    lines.push("", t("notes.order"), `  1. ${t("notes.orderTiles")}`, `  2. ${t("notes.orderMounts")}`);
    lines.push("", t("notes.howTitle"));
    for (const key of ["howLayer", "howWalls", "howInfill", "howSupports", "howTolerance"])
      lines.push(`  ${t(`notes.${key}`)}`);
    lines.push("", t("notes.files"));
    lines.push("", t("notes.madeWith", { version: thingport.tool.version }));
    return lines.join("\n");
  }

  /**
   * The wall's parts, in Thingport, ready to be put in the saved model.
   *
   * The tool may have been installed without its parts -- there are hundreds, and they are gigabytes -- so the
   * ones this wall uses are offered now rather than all of them. Saying no is an answer: the wall is a list of
   * parts, and without the parts there is nothing to save. What didn't come says why, which is how a daily
   * download limit at the other end reaches the person waiting for it.
   */
  /**
   * The user's own copies of the joints a wall is made of, made if they aren't there yet.
   *
   * Nothing is asked and nothing is downloaded: the joints are files the tool itself brings, already on this
   * server, so a copy is immediate. The dialog that used to ask first is from when every part came over the
   * network from Thangs, and asking to fetch what is already here only ever puzzled people.
   *
   * The keys are always said outright, because the plates in a wall have no model to copy: a default taken
   * from every link in it would ask for things that were never there.
   */
  async function ensureParts(result, keys) {
    const missing = keys.filter((key) => !local.has(key));
    if (!missing.length) return true;
    let got;
    try {
      got = await thingport.fetchToolModels(missing);
    } catch (err) {
      ui.toast(t("fetch.failed", { reason: err.message || String(err) }), "error");
      return false;
    }
    await loadLocal();
    renderParts(result);
    if (got.failed.length) {
      ui.toast(t("fetch.someFailed", { count: got.failed.length, reason: got.failed[0].reason }), "error");
      return false;
    }
    return true;
  }

  const saveCover = $("saveCover");
  const closeSave = () => {
    // Closing while it draws stops it, at the next plate: the engine cannot be interrupted part way
    // through one, so this is not quite instant.
    building?.abort();
    showBuilding(false);
    saveCover.hidden = true;
  };
  $("saveCancel").addEventListener("click", closeSave);
  saveCover.addEventListener("pointerdown", (event) => {
    if (event.target === saveCover) closeSave();
  });
  saveCover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSave();
    if (event.key === "Enter" && event.target === $("saveName")) $("saveGo").click();
  });

  // Keeping the wall and saving it ask the same two things -- what to call it, and a moment to draw it --
  // so they are the one dialog with two endings rather than two dialogs that drift apart.
  let wallMode = "save";

  /** What a downloaded wall is called: everything that decides what is in it, in the order it is chosen. */
  function wallName(result) {
    const d = result.data;
    return t("download.filename", {
      width: fmt(d.width),
      height: fmt(d.height),
      units: d.unitsLabel(),
      tiles: `${state.tileSize}x${state.tileSize}`,
      setup: t(state.setup === 1 ? "setup.grid" : "setup.single"),
      mount: state.mount,
    });
  }

  function openWallDialog(mode) {
    if (!current) return;
    const plan = wallPlan(current);
    const pieces = [...plan.plates, ...plan.joints];
    if (!pieces.length) {
      ui.toast(t("toast.nothingToSave"), "error");
      return;
    }
    wallMode = mode;
    const d = current.data;
    $("saveTitle").textContent = t(mode === "save" ? "save.title" : "download.title");
    $("saveGo").textContent = t(mode === "save" ? "save.go" : "download.go");
    $("saveNote").textContent = t("save.note", {
      parts: pieces.length,
      files: pieces.reduce((sum, piece) => sum + piece.quantity, 0),
    });
    const naming = mode === "save";
    $("saveNameBox").hidden = !naming;
    $("saveGo").hidden = !naming;
    if (naming)
      $("saveName").value = t("save.suggested", {
        width: fmt(d.width),
        height: fmt(d.height),
        units: d.unitsLabel(),
      });
    else $("saveNote").textContent = t("download.note");
    saveCover.hidden = false;
    if (naming) {
      $("saveName").focus();
      $("saveName").select();
    } else {
      // Nothing to decide, so it starts at once: the dialog is there to show it happening, not to ask.
      void runWall(wallName(current));
    }
  }

  $("saveBtn").addEventListener("click", () => openWallDialog("save"));
  $("filesBtn").addEventListener("click", () => openWallDialog("download"));

  $("saveGo").addEventListener("click", () => void runWall($("saveName").value.trim() || t("save.untitled")));

  async function runWall(title) {
    if (!current) return;
    const go = $("saveGo");
    const plan = wallPlan(current);
    const pieces = [...plan.plates, ...plan.joints];
    go.disabled = true;
    go.textContent = t(wallMode === "save" ? "save.saving" : "download.working");
    building = new AbortController();
    try {
      // Only the joints come from files; the plates are drawn here and need nothing fetched.
      if (
        plan.joints.length &&
        !(await ensureParts(
          current,
          plan.joints.map((joint) => joint.key),
        ))
      )
        return;
      // Where it is going is asked before it is drawn, so a change of mind costs nothing.
      const collection = wallMode === "save" ? await collections.pick({ title: t("save.pickCollection") }) : null;
      if (wallMode === "save" && !collection) return;
      showBuilding(true);
      const files = await wallFiles(current, {
        onProgress: buildProgress,
        signal: building.signal,
      });
      if (wallMode === "save") {
        // Each piece is its own file, so the model's page lists one plate per thing to print.
        const model = await models.create({
          name: title,
          description: printNotes(current, title, pieces),
          tags: ["multiboard", "generated"],
          collectionId: collection.id,
          files,
        });
        // The plan becomes the model's cover. The parts are already saved by here, so a picture that won't
        // draw is worth saying out loud but not worth losing the wall over.
        try {
          await models.addImages(model.id, [await wallImage(current, title)]);
        } catch (err) {
          ui.toast(err.message || t("toast.noPicture"), "warning");
        }
        closeSave();
        ui.toast(t("toast.saved", { name: title, collection: collection.name }), "success");
      } else {
        const zip = wallZip(title, files);
        thingport.download(zip);
        closeSave();
        ui.toast(t("toast.downloaded", { name: zip.name }), "success");
      }
    } catch (err) {
      const stopped = building?.signal.aborted;
      ui.toast(stopped ? t("build.cancelled") : err.message || t("toast.saveFailed"), stopped ? "info" : "error");
    } finally {
      showBuilding(false);
      building = null;
      go.disabled = false;
      go.textContent = t(wallMode === "save" ? "save.go" : "download.go");
    }
  }

  labels();
  update();
  // The parts' local copies, then the list again with them.
  await loadLocal();
  if (current) update();

  return () => {
    clearTimeout(typingTimer);
    clearTimeout(persistTimer);
    // Whatever was typed last is kept.
    void storage.set("state", { ...state }).catch(() => undefined);
  };
}
