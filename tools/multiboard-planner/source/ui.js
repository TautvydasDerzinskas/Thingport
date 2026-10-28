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
const PAL = {
  room: "#525252",
  tileBg: "#111111",
  line: "#5b616b",
  label: "#ffffff",
  C: "#d8574a",
  S: "#57a85a",
  CR: "#e0c341",
  single: "#f6ff00",
  dual: "#ff8800",
  quad: "#f02f28",
};
const MOUNT_TYPES = ["Simple Flush", "Offset Pillar", "Offset Snap", "Free Standing"];
const TILE_SIZES = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4];
const MAX_TILES = 10000; // ~10 x 10 m of 4x4 tiles; beyond that the input is almost surely a typo
const DETAIL_LIMIT = 1500; // above this, no labels or snap markers in the preview
const ANIMATE_LIMIT = 300; // above this, tiles appear without the entrance animation
const TYPING_DELAY = 200; // ms to wait after the last keystroke before recalculating

/** A part's model key in tool.json, from its Thangs link: "https://than.gs/m/974214" is "thangs-974214". */
export function modelKey(link) {
  const match = /^https?:\/\/(?:than\.gs|(?:www\.)?thangs\.com)\/m\/(\d+)\/?$/i.exec(link || "");
  return match ? `thangs-${match[1]}` : null;
}

export default async function mount(thingport) {
  const { root, theme, storage, ui, models, collections, t, labels } = thingport;
  const C = PlannerCore;
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
  function tileCategory(type) {
    if (type.includes("C1") || type.includes("E")) return "C";
    if (type.includes("CR") || type.includes("B")) return "CR";
    return "S";
  }
  // Which sides of a tile carry the Multiboard border (top, right, bottom, left).
  function borderEdges(type) {
    const edges =
      {
        CR1: "tl",
        CR2: "tr",
        CR3: "bl",
        CR4: "br",
        S1: "t",
        S2: "l",
        S3: "r",
        S4: "b",
        C1: "",
        SpecialRounded: "trbl",
        "Beginning Horizontal": "tbl",
        "Middle Horizontal": "tb",
        "End Horizontal": "trb",
        "Beginning Vertical": "lrb",
        "Middle Vertical": "lr",
        "End Vertical": "lrt",
      }[type] ?? "";
    return { t: edges.includes("t"), r: edges.includes("r"), b: edges.includes("b"), l: edges.includes("l") };
  }
  function el(name, attrs, parent) {
    const node = document.createElementNS(SVGNS, name);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(node);
    return node;
  }
  function tileGlyph(g, x, y, w, h, type, inset) {
    el("rect", { x, y, width: w, height: h, fill: PAL[tileCategory(type)], rx: Math.min(w, h) * 0.04 }, g);
    const ed = borderEdges(type);
    const x0 = x + inset,
      y0 = y + inset,
      x1 = x + w - inset,
      y1 = y + h - inset;
    const segs = [];
    if (ed.t) segs.push(`M${x0} ${y0}H${x1}`);
    if (ed.r) segs.push(`M${x1} ${y0}V${y1}`);
    if (ed.b) segs.push(`M${x0} ${y1}H${x1}`);
    if (ed.l) segs.push(`M${x0} ${y0}V${y1}`);
    if (segs.length)
      el(
        "path",
        {
          d: segs.join(""),
          stroke: "rgba(0,0,0,.55)",
          "stroke-width": Math.min(w, h) * 0.035,
          fill: "none",
          "stroke-linecap": "round",
        },
        g,
      );
  }
  function tileName(t) {
    const size = `${t.sizeX}x${t.sizeY}`;
    return parts.tileNames.has(t.type) ? `${size} ${parts.tileNames.get(t.type)} Tile` : `${size}  Tile`;
  }

  // LayoutDrawer.apply_color: snap colour at each corner from the tile's grid position.
  function cornerColors(x, y, bx, by, colored) {
    const S = PAL.single,
      D = PAL.dual,
      Q = PAL.quad;
    if (!colored) return [S, S, S, S];
    // [bottomLeft, bottomRight, topLeft, topRight]
    if (x === 0 && x === bx && y === 0 && y === by) return [S, S, S, S];
    if (x === 0 && x === bx) return y === 0 ? [S, S, D, D] : y === by ? [D, D, S, S] : [D, D, D, D];
    if (y === 0 && y === by) return x === 0 ? [S, D, S, D] : x === bx ? [D, S, D, S] : [D, D, D, D];
    if (x === 0 && y === 0) return [S, D, D, Q];
    if (x === bx && y === 0) return [D, S, Q, D];
    if (x === 0 && y === by) return [D, Q, S, D];
    if (x === bx && y === by) return [Q, D, D, S];
    if (y === 0) return [D, D, Q, Q];
    if (y === by) return [Q, Q, D, D];
    if (x === 0) return [D, Q, D, Q];
    if (x === bx) return [Q, D, Q, D];
    return [Q, Q, Q, Q];
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
    el("rect", { x: 0, y: 0, width: W, height: H, fill: PAL.room, rx: Math.min(W, H) * 0.004 }, svg);
    const tiles = data.tiles.values();
    const def = data.tileSize * C.TILE_CELL_OFFSET;
    const { maxX: bx, maxY: by } = C.gridBounds(tiles);
    // Big boards: no animation, labels or snap markers (unreadable at that scale anyway), so the browser only draws a
    // few nodes per tile.
    const animate = tiles.length <= ANIMATE_LIMIT;
    const detailed = tiles.length <= DETAIL_LIMIT;
    let minCell = data.tileSize;
    for (const t of tiles) minCell = Math.min(minCell, t.sizeX, t.sizeY);
    const minVis = minCell * C.TILE_CELL_OFFSET;
    const colored = mountRows[0].length > 1;
    const first = tiles[0];
    const snapBox = (Math.min(first.sizeX, first.sizeY) * C.TILE_CELL_OFFSET) / 10;
    const tileLayer = el("g", {}, svg),
      snapLayer = el("g", {}, svg),
      labelLayer = el("g", {}, svg);
    const gap = Math.max(W, H) * 0.0015;
    tiles.forEach((t, i) => {
      const w = t.sizeX * C.TILE_CELL_OFFSET,
        h = t.sizeY * C.TILE_CELL_OFFSET;
      const x = t.x * def,
        y = H - t.y * def - h;
      const name = tileName(t);
      const g = el(
        "g",
        animate
          ? {
              class: "tile enter",
              "data-name": name,
              style: `animation-delay:${Math.min(i * 12, 300)}ms;transform-origin:${x + w / 2}px ${y + h / 2}px`,
            }
          : { class: "tile", "data-name": name },
        tileLayer,
      );
      el("rect", { x, y, width: w, height: h, fill: PAL.tileBg }, g);
      tileGlyph(g, x + gap, y + gap, w - 2 * gap, h - 2 * gap, t.type, Math.min(w, h) * 0.07);
      if (!detailed) return;
      el("title", {}, g).textContent = name;
      const fs = Math.min(Math.min(w, h) / 5, w / 3.6, Math.max(minVis, def * 0.6) / 4);
      const label = el(
        "text",
        {
          x: x + w / 2,
          y: y + h / 2,
          "font-size": fs,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          fill: PAL.label,
          stroke: "#000",
          "stroke-width": fs / 6,
          "paint-order": "stroke",
          "font-weight": 700,
          "font-family": "system-ui, sans-serif",
          "pointer-events": "none",
        },
        labelLayer,
      );
      label.textContent = `${t.sizeX} x ${t.sizeY}`;
      const [bl, br, tl, tr] = cornerColors(t.x, t.y, bx, by, colored);
      const r = colored ? snapBox * 0.42 : snapBox * 0.26;
      const spots = [
        [x, y + h - snapBox, bl],
        [x + w - snapBox, y + h - snapBox, br],
        [x, y, tl],
        [x + w - snapBox, y, tr],
      ];
      for (const [sx, sy, color] of spots) {
        el(
          "circle",
          {
            class: animate ? "snap enter" : "snap",
            cx: sx + snapBox / 2,
            cy: sy + snapBox / 2,
            r,
            fill: color,
            stroke: "#000",
            "stroke-width": r * 0.25,
            style: animate ? "animation-delay:300ms" : "",
            "pointer-events": "none",
          },
          snapLayer,
        );
      }
    });
    return { svg, colored };
  }

  function renderLegend(colored, tiles) {
    const present = new Set(tiles.map((t) => tileCategory(t.type)));
    const items = [
      ["Corner", PAL.CR, "CR"],
      ["Edge", PAL.S, "S"],
      ["Core", PAL.C, "C"],
    ].filter((item) => present.has(item[2]));
    const snaps = colored
      ? [
          ["Single", PAL.single],
          ["Dual", PAL.dual],
          ["Quad", PAL.quad],
        ]
      : [["Mount", PAL.single]];
    $("legend").innerHTML =
      items.map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join("") +
      snaps.map(([n, c]) => `<span><i class="mbp-dot" style="background:${c}"></i>${n}</span>`).join("");
  }

  // ---- parts list ---------------------------------------------------------------
  function partIcon(row, isTile) {
    const svg = el("svg", { viewBox: "0 0 34 34", class: "mbp-ico", "aria-hidden": "true" });
    if (isTile) {
      el("rect", { x: 1, y: 1, width: 32, height: 32, rx: 5, fill: PAL.tileBg }, svg);
      tileGlyph(svg, 3, 3, 28, 28, row[3], 3);
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

  function partLinks(row) {
    const wrap = document.createElement("span");
    wrap.className = "mbp-links";
    const label = row[0].replace(/\n/g, " ");
    const links = (Array.isArray(row[2]) ? row[2] : [row[2]]).filter(Boolean);
    for (const href of links) {
      const copy = localCopy(href);
      if (copy) {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "mbp-link";
        open.textContent = t("part.open");
        open.setAttribute("aria-label", t("part.openAria", { name: label }));
        open.addEventListener("click", () => models.open(copy.printId));
        const save = document.createElement("button");
        save.type = "button";
        save.className = "mbp-link";
        save.textContent = "↓";
        save.title = t("part.download");
        save.setAttribute("aria-label", t("part.downloadAria", { name: label }));
        save.addEventListener("click", () => void downloadModel(copy.printId));
        wrap.append(open, save);
      } else {
        const a = document.createElement("a");
        a.className = "mbp-link";
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = t("part.thangs");
        a.setAttribute("aria-label", t("part.thangsAria", { name: label }));
        wrap.appendChild(a);
      }
    }
    return wrap;
  }

  async function downloadModel(id) {
    try {
      const model = await models.get(id);
      for (const file of model.files) thingport.download({ name: file.name, data: await models.file(id, file.id) });
    } catch (err) {
      ui.toast(err.message, "error");
    }
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
    $("copyBtn").disabled = $("downloadBtn").disabled = $("saveBtn").disabled = true;
  }

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
    const { svg, colored } = buildSvg(result);
    $("stage").replaceChildren(svg);
    renderLegend(colored, result.data.tiles.values());
    renderParts(result);
    $("copyBtn").disabled = $("downloadBtn").disabled = false;
    $("saveBtn").disabled = !wallKeys(result).length;
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

  /** The wall's parts Thingport has, once each. */
  function partsInThingport(result) {
    const ids = new Set();
    for (const row of saveRows(result))
      for (const link of row[2] || []) {
        const copy = localCopy(link);
        if (copy) ids.add(copy.printId);
      }
    return [...ids];
  }

  /** Every part the wall is made of, by the key the tool's metadata gives it. */
  function wallKeys(result) {
    const keys = new Set();
    for (const row of saveRows(result))
      for (const link of row[2] || []) {
        const key = modelKey(link);
        if (key) keys.add(key);
      }
    return [...keys];
  }

  $("downloadBtn").addEventListener("click", () => {
    if (!current) return;
    const d = current.data;
    const svg = buildSvg(current).svg;
    svg.setAttribute("width", "100%");
    svg.querySelectorAll(".enter").forEach((node) => node.classList.remove("enter"));
    const rows = saveRows(current)
      .map(
        (r) =>
          `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${(r[2] || [])
            .filter(Boolean)
            .map((l) => `<a class="link" href="${esc(l)}" target="_blank">Link</a>`)
            .join(" / ")}</td></tr>`,
      )
      .join("\n");
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Parts List</title>
<style>body{font-family:Arial,sans-serif;background:#2c2c2c;color:#fff;margin:0;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #444}th{background:#1c1c1c}.link{color:#ff6600;text-decoration:none}.link:hover{text-decoration:underline}.layout{max-width:900px;margin:20px 0}</style></head><body>
<h1>Results:</h1>
<div class="info-section"><p><strong>Wall size:</strong> ${esc(fmt(d.width))} x ${esc(fmt(d.height))} ${d.unitsLabel()}</p><p><strong>Tile Size:</strong> ${d.tileSize} x ${d.tileSize}</p><p><strong>Tile Setup:</strong> ${state.setup === 1 ? "Grid Tiles (Advanced)" : "Single Tiles (Simple)"}</p><p><strong>Mount Type:</strong> ${esc(d.mountingType)}</p></div>
<table><thead><tr><th>Part Name</th><th>Quantity</th><th>Link</th></tr></thead><tbody>
${rows}
</tbody></table>
<div class="layout">${new XMLSerializer().serializeToString(svg)}</div>
</body></html>`;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "_");
    thingport.download({ name: `Multiboard-Design-${stamp}.html`, data: html, type: "text/html" });
    ui.toast(t("toast.listDownloaded"), "success");
  });

  $("copyBtn").addEventListener("click", async () => {
    if (!current) return;
    const text = [`${t("list.part")}\t${t("list.quantity")}\t${t("list.link")}`]
      .concat(saveRows(current).map((r) => `${r[0]}\t${r[1]}\t${(r[2] || []).filter(Boolean).join(" ")}`))
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      ui.toast(t("toast.copied"), "success");
    } catch {
      ui.toast(t("toast.copyFailed"), "error");
    }
  });

  // ---- saving the wall as a model of its own -------------------------------------
  /** Every part of the wall Thingport has a copy of, with how many are needed. */
  function wallParts(result) {
    const parts = new Map();
    for (const row of saveRows(result)) {
      const quantity = Number(row[1]) || 0;
      for (const link of row[2] || []) {
        const copy = localCopy(link);
        if (!copy) continue;
        const already = parts.get(copy.printId);
        if (already) already.quantity += quantity;
        else parts.set(copy.printId, { copy, name: row[0].replace(/\n/g, " "), quantity });
      }
    }
    return [...parts.values()];
  }

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
  async function readJoint(joint) {
    const copy = localCopy(joint.link);
    if (!copy) throw new Error(t("build.missing", { part: joint.name }));
    const model = await models.get(copy.printId);
    const pieces = [];
    for (const [index, file] of model.files.entries()) {
      const bytes = await models.file(copy.printId, file.id);
      // A joint of several files keeps them apart rather than losing all but one.
      const name = model.files.length > 1 ? `${partName(joint)} (${index + 1})` : partName(joint);
      pieces.push({ mesh: readBinaryStl(bytes), name });
    }
    return pieces;
  }

  /** The whole wall as one 3MF, laid out so it opens ready rather than piled on the origin. */
  async function wallFile(result, title, options) {
    const scad = await openscad();
    const parts = await buildWall(scad, PLATE_SCAD, wallPlan(result), { readJoint, ...options });
    if (!parts.length) throw new Error(t("build.nothing"));
    const bytes = scad.writeThreeMf(scad.layoutRow(parts), { name: title });
    const stem = title.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "multiboard-wall";
    return { name: `${stem}.3mf`, data: bytes, type: "model/3mf" };
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

  function buildProgress({ done, total }) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    $("buildFill").style.width = `${percent}%`;
    $("buildBar").setAttribute("aria-valuenow", String(percent));
    $("buildCount").textContent = t("build.count", { done, total });
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
  async function haveTheParts(result, keys = wallKeys(result)) {
    const missing = keys.filter((key) => !local.has(key));
    if (!missing.length) return true;
    const ok = await ui.confirm({
      title: t("fetch.title"),
      message: t("fetch.message", { count: missing.length }),
      confirmLabel: t("fetch.go"),
    });
    if (!ok) {
      ui.toast(t("fetch.refused"), "warning");
      return false;
    }
    ui.toast(t("fetch.working", { count: missing.length }), "info");
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

  $("saveBtn").addEventListener("click", () => {
    if (!current) return;
    const parts = wallParts(current);
    if (!parts.length) {
      ui.toast(t("toast.nothingToSave"), "error");
      return;
    }
    const d = current.data;
    $("saveNote").textContent = t("save.note", {
      parts: parts.length,
      files: parts.reduce((sum, part) => sum + part.quantity, 0),
    });
    $("saveName").value = t("save.suggested", {
      width: fmt(d.width),
      height: fmt(d.height),
      units: d.unitsLabel(),
    });
    saveCover.hidden = false;
    $("saveName").focus();
    $("saveName").select();
  });

  $("saveGo").addEventListener("click", async () => {
    if (!current) return;
    const go = $("saveGo");
    const title = $("saveName").value.trim() || t("save.untitled");
    const plan = wallPlan(current);
    const pieces = [...plan.plates, ...plan.joints];
    go.disabled = true;
    go.textContent = t("save.saving");
    building = new AbortController();
    try {
      // Only the joints come from files; the plates are drawn here and need nothing fetched.
      if (
        plan.joints.length &&
        !(await haveTheParts(
          current,
          plan.joints.map((joint) => joint.key),
        ))
      )
        return;
      const collection = await collections.pick({ title: t("save.pickCollection") });
      if (!collection) return;
      showBuilding(true);
      const file = await wallFile(current, title, {
        onProgress: buildProgress,
        signal: building.signal,
      });
      await models.create({
        name: title,
        description: printNotes(current, title, pieces),
        tags: ["multiboard", "generated"],
        collectionId: collection.id,
        files: [file],
      });
      closeSave();
      ui.toast(t("toast.saved", { name: title, collection: collection.name }), "success");
    } catch (err) {
      const stopped = building?.signal.aborted;
      ui.toast(stopped ? t("build.cancelled") : err.message || t("toast.saveFailed"), stopped ? "info" : "error");
    } finally {
      showBuilding(false);
      building = null;
      go.disabled = false;
      go.textContent = t("save.go");
    }
  });

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
