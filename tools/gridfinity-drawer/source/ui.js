// The drawer builder's window: the drawer and printer on the left, the drawer seen from above in the middle (drag to
// draw a bin, drag one to move it), and the parts to print on the right, with "Save to Thingport", which keeps the
// whole drawer as one model: every part a file, and how many of each to print in its description.

import { baseplateTile, bin, BASEPLATE_HEIGHT, HEIGHT_UNIT, stl } from "./geometry.js";
import { DEFAULT_PROJECT, description, planDrawer } from "./plan.js";
import { renderMesh } from "./render.js";

const SVGNS = "http://www.w3.org/2000/svg";
const BEDS = [
  ["Bambu Lab A1 mini", 180, 180],
  ["Prusa MINI", 180, 180],
  ["Creality Ender-3", 220, 220],
  ["Prusa MK4 / Core One", 250, 210],
  ["Bambu Lab A1, P1, X1", 256, 256],
  ["Creality K1 Max", 300, 300],
  ["Bambu Lab H2D", 325, 320],
  ["Prusa XL", 360, 360],
];
const MAX_UNITS = 20;
const SAVE_DEBOUNCE_MS = 500;

export default async function mount(thingport) {
  const { root, theme, storage, models, ui } = thingport;
  const $ = (id) => root.querySelector(`#gfd-${id}`);
  const shell = root.querySelector(".gfd");
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
  const binColour = theme.primary;
  const tileColour = theme.mode === "dark" ? "#8a8f98" : "#9aa0a6";

  // ---- the project, kept for the user ------------------------------------------------------------------------
  let project = structuredClone(DEFAULT_PROJECT);
  try {
    const saved = await storage.get("project");
    if (saved && typeof saved === "object") project = { ...project, ...saved };
  } catch {
    // Starts from the defaults.
  }
  let persistTimer = 0;
  const persist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => void storage.set("project", project).catch(() => undefined), SAVE_DEBOUNCE_MS);
  };
  let nextId = project.bins.reduce((max, b) => Math.max(max, Number(String(b.id).replace(/\D/g, "")) || 0), 0) + 1;
  const newId = () => `b${nextId++}`;

  let plan = planDrawer(project);
  let selected = null;
  let viewed = null;
  let view = { azimuth: -35, elevation: 32 };
  let lastSaved = null;

  // ---- settings ----------------------------------------------------------------------------------------------
  const preset = $("bedPreset");
  preset.innerHTML =
    `<option value="">Bed size…</option>` +
    BEDS.map(([name, x, y], i) => `<option value="${i}">${name} (${x} × ${y})</option>`).join("");
  preset.addEventListener("change", () => {
    const bed = BEDS[Number(preset.value)];
    if (bed) {
      project.bed = { x: bed[1], y: bed[2] };
      update();
    }
    preset.value = "";
  });

  const numberField = (id, read, write, { min, max }) => {
    const input = $(id);
    input.value = String(read());
    input.addEventListener("change", () => {
      const value = Number(input.value);
      if (Number.isFinite(value) && value >= min && value <= max) write(value);
      input.value = String(read());
      update();
    });
  };
  numberField(
    "width",
    () => project.drawer.width,
    (v) => (project.drawer.width = v),
    { min: 40, max: 2000 },
  );
  numberField(
    "depth",
    () => project.drawer.depth,
    (v) => (project.drawer.depth = v),
    { min: 40, max: 2000 },
  );
  numberField(
    "height",
    () => project.drawer.height,
    (v) => (project.drawer.height = v),
    { min: 10, max: 500 },
  );
  numberField(
    "bedX",
    () => project.bed.x,
    (v) => (project.bed.x = v),
    { min: 60, max: 1000 },
  );
  numberField(
    "bedY",
    () => project.bed.y,
    (v) => (project.bed.y = v),
    { min: 60, max: 1000 },
  );
  numberField(
    "clearance",
    () => project.clearance,
    (v) => (project.clearance = v),
    { min: 0, max: 10 },
  );
  const name = $("name");
  name.value = project.name;
  name.addEventListener("input", () => {
    project.name = name.value.slice(0, 120);
    persist();
  });
  $("cells").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    project.cells = button.dataset.value;
    update();
  });
  const maxUnits = () => Math.max(1, Math.min(MAX_UNITS, Math.floor(project.drawer.height / HEIGHT_UNIT)));
  $("unitsDown").addEventListener("click", () => {
    project.units = Math.max(1, project.units - 1);
    update();
  });
  $("unitsUp").addEventListener("click", () => {
    project.units = Math.min(maxUnits(), project.units + 1);
    update();
  });

  // ---- the drawer from above ---------------------------------------------------------------------------------
  // In millimetres, the drawer's front left corner at the bottom left, as one looks down into it.
  const geometryOf = () => {
    const { x, y } = plan.grid;
    const left = project.clearance / 2 + x.before;
    const front = project.clearance / 2 + y.before;
    return { x, y, left, front, W: project.drawer.width, D: project.drawer.depth };
  };
  const cellRect = (g, col, row, w = 1, d = 1) => ({
    x: g.left + col * g.x.pitch,
    y: g.D - (g.front + (row + d) * g.y.pitch),
    width: w * g.x.pitch,
    height: d * g.y.pitch,
  });
  const svgEl = (tag, attrs, parent) => {
    const node = document.createElementNS(SVGNS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (parent) parent.appendChild(node);
    return node;
  };

  let svg = null;
  let drag = null;
  const freshBins = new Set();

  function drawLayout() {
    const stage = $("stage");
    const g = geometryOf();
    if (!g.x.count || !g.y.count) {
      stage.innerHTML = `<div class="gfd-empty"><strong>No cell fits</strong>${plan.problems[0]?.text ?? ""}</div>`;
      svg = null;
      return;
    }
    const pad = Math.max(g.W, g.D) * 0.02;
    // Room below for the "Front" mark.
    const below = pad + 18;
    svg = svgEl("svg", {
      viewBox: `${-pad} ${-pad} ${g.W + 2 * pad} ${g.D + pad + below}`,
      role: "application",
      tabindex: 0,
      "aria-label": `Drawer layout, ${g.x.count} by ${g.y.count} cells, ${project.bins.length} bins. Drag to draw a bin, or press N to add one; [ and ] pick a bin, the arrow keys move it, Shift and the arrow keys size it, and Delete removes it.`,
    });
    // The drawer, then the baseplate's tiles and cells.
    svgEl(
      "rect",
      {
        x: 0,
        y: 0,
        width: g.W,
        height: g.D,
        rx: 4,
        fill: "color-mix(in srgb, var(--text) 6%, transparent)",
        stroke: "var(--line)",
      },
      svg,
    );
    const plate = svgEl("g", {}, svg);
    const letters = new Map(plan.parts.filter((p) => p.type === "tile").map((p) => [p.key, p.letter]));
    for (const t of plan.tiles) {
      const rx = plan.tileRuns.x.find((r) => r.start === t.col);
      const ry = plan.tileRuns.y.find((r) => r.start === t.row);
      const outer = cellRect(g, t.col, t.row, t.cols, t.rows);
      const x0 = outer.x - rx.before;
      const y0 = outer.y - ry.after;
      svgEl(
        "rect",
        {
          x: x0,
          y: y0,
          width: outer.width + rx.before + rx.after,
          height: outer.height + ry.before + ry.after,
          rx: 2,
          fill: `color-mix(in srgb, ${tileColour} 22%, transparent)`,
          stroke: tileColour,
          "stroke-dasharray": "4 3",
          "stroke-width": 1,
        },
        plate,
      );
      svgEl(
        "text",
        { x: x0 + 4, y: y0 + 13, "font-size": 11, "font-weight": 700, fill: tileColour },
        plate,
      ).textContent = letters.get(t.key) ?? "";
    }
    for (let col = 0; col < g.x.count; col++)
      for (let row = 0; row < g.y.count; row++) {
        const r = cellRect(g, col, row);
        svgEl(
          "rect",
          { class: "gfd-cell", x: r.x + 1, y: r.y + 1, width: r.width - 2, height: r.height - 2, rx: 4 },
          plate,
        );
      }
    // The bins.
    const layer = svgEl("g", {}, svg);
    for (const b of plan.bins) {
      const r = cellRect(g, b.x, b.y, b.w, b.d);
      const bad = b.issues.length > 0;
      const colour = bad ? "var(--danger)" : binColour;
      const group = svgEl("g", { class: `gfd-bin${freshBins.has(b.id) ? " gfd-enter" : ""}`, "data-id": b.id }, layer);
      svgEl(
        "rect",
        {
          x: r.x + 2.5,
          y: r.y + 2.5,
          width: r.width - 5,
          height: r.height - 5,
          rx: 5,
          fill: `color-mix(in srgb, ${colour} ${b.id === selected ? 42 : 26}%, transparent)`,
          stroke: colour,
          "stroke-width": b.id === selected ? 3 : 1.5,
        },
        group,
      );
      // Its compartments.
      for (let i = 1; i < b.across; i++) {
        const x = r.x + (r.width * i) / b.across;
        svgEl(
          "line",
          { x1: x, y1: r.y + 7, x2: x, y2: r.y + r.height - 7, stroke: colour, "stroke-width": 1, opacity: 0.6 },
          group,
        );
      }
      for (let j = 1; j < b.along; j++) {
        const y = r.y + (r.height * j) / b.along;
        svgEl(
          "line",
          { x1: r.x + 7, y1: y, x2: r.x + r.width - 7, y2: y, stroke: colour, "stroke-width": 1, opacity: 0.6 },
          group,
        );
      }
      const label = svgEl(
        "text",
        {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          "font-size": Math.min(14, r.width / 4),
          "font-weight": 700,
          fill: "var(--text)",
          "pointer-events": "none",
        },
        group,
      );
      // The size where there's room for it; a single cell has room for the height alone.
      label.textContent = r.width > 70 ? `${b.w}×${b.d} · ${b.units}u` : `${b.units}u`;
      svgEl("title", {}, group).textContent = bad ? b.issues.join(", ") : `${b.w}×${b.d} bin, ${b.units}u`;
    }
    freshBins.clear();
    // The bin being drawn or moved.
    svgEl(
      "rect",
      {
        id: "gfd-ghost",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rx: 5,
        fill: "none",
        stroke: "var(--accent)",
        "stroke-width": 2,
        "stroke-dasharray": "6 4",
        visibility: "hidden",
      },
      svg,
    );
    svgEl(
      "text",
      { x: g.W / 2, y: g.D + 14, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" },
      svg,
    ).textContent = "Front";
    stage.replaceChildren(svg);
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("keydown", onKey);
  }

  /** The cell under a pointer, in grid units (fractions included). */
  function cellAt(event) {
    const g = geometryOf();
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const p = point.matrixTransform(svg.getScreenCTM().inverse());
    return { col: (p.x - g.left) / g.x.pitch, row: (g.D - p.y - g.front) / g.y.pitch };
  }
  const clampCell = (value, count) => Math.max(0, Math.min(count - 1, Math.floor(value)));
  const occupied = (except) => {
    const cells = new Set();
    for (const b of project.bins)
      if (b.id !== except)
        for (let i = b.x; i < b.x + b.w; i++) for (let j = b.y; j < b.y + b.d; j++) cells.add(`${i},${j}`);
    return cells;
  };
  const free = (rect, except) => {
    const cells = occupied(except);
    for (let i = rect.x; i < rect.x + rect.w; i++)
      for (let j = rect.y; j < rect.y + rect.d; j++) if (cells.has(`${i},${j}`)) return false;
    return true;
  };
  const showGhost = (rect, ok) => {
    const ghost = svg.querySelector("#gfd-ghost");
    const r = cellRect(geometryOf(), rect.x, rect.y, rect.w, rect.d);
    for (const [key, value] of Object.entries({ x: r.x + 2.5, y: r.y + 2.5, width: r.width - 5, height: r.height - 5 }))
      ghost.setAttribute(key, value);
    ghost.setAttribute("stroke", ok ? "var(--accent)" : "var(--danger)");
    ghost.setAttribute("visibility", "visible");
  };

  function onDown(event) {
    if (event.button !== 0) return;
    const g = geometryOf();
    const at = cellAt(event);
    const binNode = event.target.closest(".gfd-bin");
    svg.setPointerCapture(event.pointerId);
    if (binNode) {
      const b = project.bins.find((candidate) => candidate.id === binNode.dataset.id);
      selected = b.id;
      drag = {
        kind: "move",
        bin: b,
        grab: { col: at.col - b.x, row: at.row - b.y },
        rect: { x: b.x, y: b.y, w: b.w, d: b.d },
        moved: false,
      };
      update();
    } else {
      const start = { col: clampCell(at.col, g.x.count), row: clampCell(at.row, g.y.count) };
      drag = { kind: "draw", start, rect: { x: start.col, y: start.row, w: 1, d: 1 } };
      showGhost(drag.rect, free(drag.rect));
    }
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp, { once: true });
  }

  function onMove(event) {
    if (!drag) return;
    const g = geometryOf();
    const at = cellAt(event);
    if (drag.kind === "draw") {
      const col = clampCell(at.col, g.x.count);
      const row = clampCell(at.row, g.y.count);
      drag.rect = {
        x: Math.min(col, drag.start.col),
        y: Math.min(row, drag.start.row),
        w: Math.abs(col - drag.start.col) + 1,
        d: Math.abs(row - drag.start.row) + 1,
      };
      showGhost(drag.rect, free(drag.rect));
    } else {
      const x = Math.max(0, Math.min(g.x.count - drag.bin.w, Math.round(at.col - drag.grab.col)));
      const y = Math.max(0, Math.min(g.y.count - drag.bin.d, Math.round(at.row - drag.grab.row)));
      if (x !== drag.rect.x || y !== drag.rect.y) drag.moved = true;
      drag.rect = { ...drag.rect, x, y };
      if (drag.moved) showGhost(drag.rect, free(drag.rect, drag.bin.id));
    }
  }

  function onUp() {
    svg?.removeEventListener("pointermove", onMove);
    const done = drag;
    drag = null;
    if (!done) return;
    if (done.kind === "draw") {
      if (!free(done.rect)) {
        ui.toast("That's over another bin", "warning");
        return update();
      }
      const units = Math.min(project.units, maxUnits());
      const b = { id: newId(), ...done.rect, units, across: 1, along: 1 };
      project.bins.push(b);
      freshBins.add(b.id);
      selected = b.id;
      update();
    } else if (done.moved) {
      if (free(done.rect, done.bin.id)) Object.assign(done.bin, { x: done.rect.x, y: done.rect.y });
      else ui.toast("That's over another bin", "warning");
      update();
    }
  }

  // By keyboard: N adds a bin, [ and ] pick one, the arrows move it a cell, Shift and the arrows size it.
  const STEPS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  function onKey(event) {
    const g = geometryOf();
    const current = project.bins.find((b) => b.id === selected);
    const key = event.key;
    let handled = true;
    if ((key === "Delete" || key === "Backspace") && current) removeBin(current.id);
    else if (key === "Escape" && current) selected = null;
    else if (key === "n" || key === "N") {
      const cells = occupied(null);
      let spot = null;
      for (let row = 0; row < g.y.count && !spot; row++)
        for (let col = 0; col < g.x.count && !spot; col++) if (!cells.has(`${col},${row}`)) spot = { x: col, y: row };
      if (!spot) ui.toast("Every cell has a bin", "info");
      else {
        const b = { id: newId(), ...spot, w: 1, d: 1, units: Math.min(project.units, maxUnits()), across: 1, along: 1 };
        project.bins.push(b);
        freshBins.add(b.id);
        selected = b.id;
      }
    } else if ((key === "[" || key === "]") && project.bins.length) {
      const index = project.bins.findIndex((b) => b.id === selected);
      const next = index < 0 ? 0 : (index + (key === "]" ? 1 : -1) + project.bins.length) % project.bins.length;
      selected = project.bins[next].id;
    } else if (STEPS[key] && current) {
      const [dx, dy] = STEPS[key];
      const rect = event.shiftKey
        ? { x: current.x, y: current.y, w: current.w + dx, d: current.d + dy }
        : { x: current.x + dx, y: current.y + dy, w: current.w, d: current.d };
      const inside =
        rect.w >= 1 &&
        rect.d >= 1 &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.w <= g.x.count &&
        rect.y + rect.d <= g.y.count;
      if (inside && free(rect, current.id)) {
        Object.assign(current, rect);
        current.across = Math.min(current.across, current.w * 3);
        current.along = Math.min(current.along, current.d * 3);
      }
    } else handled = false;
    if (!handled) return;
    event.preventDefault();
    update();
    // Drawn afresh, so the keys go on working.
    svg?.focus();
  }

  function removeBin(id) {
    project.bins = project.bins.filter((b) => b.id !== id);
    if (selected === id) selected = null;
    update();
  }

  // ---- the selected bin --------------------------------------------------------------------------------------
  function stepper(label, value, min, max, set) {
    const wrap = document.createElement("span");
    wrap.className = "gfd-pair";
    const name = document.createElement("span");
    name.className = "gfd-label";
    name.textContent = label;
    const box = document.createElement("span");
    box.className = "gfd-stepper";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", label);
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "−";
    down.setAttribute("aria-label", `Fewer: ${label}`);
    down.disabled = value <= min;
    down.addEventListener("click", () => set(value - 1));
    const out = document.createElement("output");
    out.textContent = String(value);
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "+";
    up.setAttribute("aria-label", `More: ${label}`);
    up.disabled = value >= max;
    up.addEventListener("click", () => set(value + 1));
    box.append(down, out, up);
    wrap.append(name, box);
    return wrap;
  }

  function drawSelected() {
    const host = $("selected");
    const b = project.bins.find((candidate) => candidate.id === selected);
    const planned = plan.bins.find((candidate) => candidate.id === selected);
    if (!b || !planned) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.replaceChildren();
    const title = document.createElement("strong");
    const { width, depth, height } = planned.size;
    title.textContent = `Bin ${b.w}×${b.d}`;
    const size = document.createElement("span");
    size.className = "gfd-hint";
    size.textContent = `${width.toFixed(1)} × ${depth.toFixed(1)} × ${height} mm`;
    const set = (key) => (value) => {
      b[key] = value;
      update();
    };
    const remove = document.createElement("button");
    remove.className = "gfd-btn gfd-danger";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => removeBin(b.id));
    const spacer = document.createElement("span");
    spacer.className = "gfd-spacer";
    host.append(
      title,
      size,
      stepper("Height (u)", b.units, 1, maxUnits(), set("units")),
      stepper("Across", b.across, 1, Math.max(1, b.w * 3), set("across")),
      stepper("Along", b.along, 1, Math.max(1, b.d * 3), set("along")),
      spacer,
      remove,
    );
  }

  // ---- parts -------------------------------------------------------------------------------------------------
  const meshes = new Map();
  /** A part's triangles, made once for each shape. */
  function meshOf(part) {
    const { x, y } = plan.grid;
    const key = `${part.type}|${part.key}|${x.pitch.toFixed(3)}|${y.pitch.toFixed(3)}`;
    if (!meshes.has(key)) {
      meshes.set(
        key,
        part.type === "tile"
          ? baseplateTile({ cols: part.cols, rows: part.rows, pitchX: x.pitch, pitchY: y.pitch, pad: part.pad })
          : bin({
              w: part.w,
              d: part.d,
              units: part.units,
              across: part.across,
              along: part.along,
              pitchX: x.pitch,
              pitchY: y.pitch,
            }),
      );
    }
    return meshes.get(key);
  }
  const partColour = (part) => (part.type === "tile" ? tileColour : binColour);
  /** The parts listed last time: only the ones new to the list rise into it. */
  let listed = new Set();

  function drawParts() {
    const list = $("list");
    list.replaceChildren();
    const tiles = plan.parts.filter((p) => p.type === "tile").reduce((n, p) => n + p.count, 0);
    const bins = plan.parts.filter((p) => p.type === "bin").reduce((n, p) => n + p.count, 0);
    $("count").textContent = plan.parts.length
      ? `${tiles} tile${tiles === 1 ? "" : "s"}, ${bins} bin${bins === 1 ? "" : "s"}`
      : "";
    if (!plan.parts.some((p) => p.key === viewed?.key)) viewed = plan.parts[0] ?? null;
    plan.parts.forEach((part, index) => {
      const item = document.createElement("li");
      item.className = listed.has(part.key) ? "gfd-part gfd-still" : "gfd-part";
      item.tabIndex = 0;
      item.style.animationDelay = `${Math.min(index * 30, 240)}ms`;
      item.setAttribute("aria-current", String(part.key === viewed?.key));
      item.setAttribute("aria-label", `${part.name}, print ${part.count}`);
      const thumb = document.createElement("canvas");
      thumb.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "gfd-part-name";
      text.textContent = part.name;
      if (part.detail) {
        const small = document.createElement("small");
        small.textContent = part.detail;
        text.appendChild(small);
      }
      const qty = document.createElement("span");
      qty.className = "gfd-qty";
      qty.innerHTML = `${part.count}<small>×</small>`;
      const save = document.createElement("button");
      save.type = "button";
      save.className = "gfd-icon-btn";
      save.title = `Download ${part.file}`;
      save.setAttribute("aria-label", `Download ${part.file}`);
      save.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';
      save.addEventListener("click", (event) => {
        event.stopPropagation();
        thingport.download({ name: part.file, data: stl(meshOf(part), part.name), type: "model/stl" });
      });
      const look = () => {
        viewed = part;
        list.querySelectorAll(".gfd-part").forEach((node) => node.setAttribute("aria-current", String(node === item)));
        drawView();
      };
      item.addEventListener("click", look);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          look();
        }
      });
      item.append(thumb, text, qty, save);
      list.appendChild(item);
      // Drawn once it's in the page and has a size.
      requestAnimationFrame(() => renderMesh(thumb, meshOf(part), { color: partColour(part), padding: 2 }));
    });
    listed = new Set(plan.parts.map((p) => p.key));
    const problems = $("problems");
    problems.hidden = plan.problems.length === 0;
    problems.innerHTML = plan.problems.map((p) => `<li>${escapeHtml(p.text)}</li>`).join("");
    $("save").disabled = !plan.parts.length;
    drawView();
  }

  function drawView() {
    const canvas = $("viewCanvas");
    $("viewName").textContent = viewed ? `${viewed.name}${viewed.detail ? ` · ${viewed.detail}` : ""}` : "";
    requestAnimationFrame(() =>
      renderMesh(canvas, viewed ? meshOf(viewed) : [], { ...view, color: viewed ? partColour(viewed) : binColour }),
    );
  }

  // Dragging the big view turns the part.
  const viewBox = $("view");
  viewBox.addEventListener("pointerdown", (event) => {
    viewBox.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, ...view };
    const move = (e) => {
      view = {
        azimuth: start.azimuth + (e.clientX - start.x) * 0.6,
        elevation: Math.max(5, Math.min(89, start.elevation + (e.clientY - start.y) * 0.4)),
      };
      drawView();
    };
    viewBox.addEventListener("pointermove", move);
    viewBox.addEventListener("pointerup", () => viewBox.removeEventListener("pointermove", move), { once: true });
  });

  // ---- facts and controls ------------------------------------------------------------------------------------
  function syncControls() {
    for (const button of $("cells").querySelectorAll("button"))
      button.setAttribute("aria-pressed", String(button.dataset.value === project.cells));
    for (const [id, value] of [
      ["width", project.drawer.width],
      ["depth", project.drawer.depth],
      ["height", project.drawer.height],
      ["bedX", project.bed.x],
      ["bedY", project.bed.y],
      ["clearance", project.clearance],
    ])
      if (root.ownerDocument.activeElement !== $(id)) $(id).value = String(value);
    project.units = Math.min(project.units, maxUnits());
    $("units").textContent = `${project.units}u`;
    $("unitsMm").textContent = `${project.units * HEIGHT_UNIT} mm tall`;
    $("unitsDown").disabled = project.units <= 1;
    $("unitsUp").disabled = project.units >= maxUnits();
    $("cellsHint").textContent =
      project.cells === "stretch"
        ? "Cells widen to fill the drawer; bins are made to match, so other Gridfinity bins sit loosely."
        : "Standard cells: any Gridfinity bin fits. A flat border fills what's left.";
    $("dims").textContent = `${project.drawer.width} × ${project.drawer.depth} mm`;
    const { x, y } = plan.grid;
    const fmt = (v) => (Math.round(v * 10) / 10).toString();
    $("facts").innerHTML =
      x.count && y.count
        ? [
            ["Cells", `${x.count} × ${y.count}`],
            ["Cell size", `${fmt(x.pitch)} × ${fmt(y.pitch)} mm`],
            ["Border", x.before || y.before ? `${fmt(x.before)} / ${fmt(y.before)} mm` : "none"],
            ["Tiles", `${plan.tileRuns.x.length} × ${plan.tileRuns.y.length}`],
            ["Baseplate", `${BASEPLATE_HEIGHT} mm high`],
          ]
            .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
            .join("")
        : "";
  }

  // Bins that no longer fit a smaller grid go.
  function dropStrays() {
    const { x, y } = plan.grid;
    const before = project.bins.length;
    project.bins = project.bins.filter((b) => b.x + b.w <= x.count && b.y + b.d <= y.count);
    if (project.bins.length < before) {
      ui.toast(
        `${before - project.bins.length} bin${before - project.bins.length === 1 ? "" : "s"} no longer fit and went`,
        "info",
      );
      plan = planDrawer(project);
    }
  }

  function update() {
    plan = planDrawer(project);
    dropStrays();
    syncControls();
    drawLayout();
    drawSelected();
    drawParts();
    persist();
  }

  $("fill").addEventListener("click", () => {
    const { x, y } = plan.grid;
    const cells = occupied(null);
    const units = Math.min(project.units, maxUnits());
    let added = 0;
    for (let col = 0; col < x.count; col++)
      for (let row = 0; row < y.count; row++)
        if (!cells.has(`${col},${row}`)) {
          const b = { id: newId(), x: col, y: row, w: 1, d: 1, units, across: 1, along: 1 };
          project.bins.push(b);
          freshBins.add(b.id);
          added++;
        }
    if (!added) ui.toast("Every cell has a bin already", "info");
    update();
  });
  $("clear").addEventListener("click", async () => {
    if (!project.bins.length) return;
    const ok = await ui.confirm({
      title: "Clear the bins?",
      message: `All ${project.bins.length} bins go; the drawer and baseplate stay.`,
      confirmLabel: "Clear",
      destructive: true,
    });
    if (!ok) return;
    project.bins = [];
    selected = null;
    update();
  });

  // ---- saving to Thingport -----------------------------------------------------------------------------------
  /** The drawer from above, as the model's picture. */
  async function layoutPicture() {
    const g = geometryOf();
    const scale = Math.min(1600 / g.W, 1200 / g.D, 4);
    const margin = 40;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(g.W * scale + 2 * margin);
    canvas.height = Math.round(g.D * scale + 2 * margin);
    const ctx = canvas.getContext("2d");
    const light = theme.mode !== "dark";
    ctx.fillStyle = light ? "#f4f4f2" : "#1d2024";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const box = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.roundRect(margin + x * scale, margin + y * scale, w * scale, h * scale, r * scale);
    };
    box(0, 0, g.W, g.D, 4);
    ctx.fillStyle = light ? "#e4e4e0" : "#2a2e34";
    ctx.fill();
    ctx.fillStyle = tileColour;
    for (const t of plan.tiles) {
      const rx = plan.tileRuns.x.find((r) => r.start === t.col);
      const ry = plan.tileRuns.y.find((r) => r.start === t.row);
      const outer = cellRect(g, t.col, t.row, t.cols, t.rows);
      box(
        outer.x - rx.before + 0.5,
        outer.y - ry.after + 0.5,
        outer.width + rx.before + rx.after - 1,
        outer.height + ry.before + ry.after - 1,
        2,
      );
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const b of plan.bins) {
      if (b.issues.length) continue;
      const r = cellRect(g, b.x, b.y, b.w, b.d);
      box(r.x + 1.5, r.y + 1.5, r.width - 3, r.height - 3, 4);
      ctx.fillStyle = binColour;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = light ? "#ffffff" : "#0f1114";
      ctx.font = `700 ${Math.round(Math.min(13, r.width / 4) * scale)}px ${theme.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        r.width > 70 ? `${b.w}×${b.d} · ${b.units}u` : `${b.units}u`,
        margin + (r.x + r.width / 2) * scale,
        margin + (r.y + r.height / 2) * scale,
      );
    }
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  const status = $("status");
  function showStatus(text, actions = []) {
    status.hidden = false;
    status.replaceChildren(document.createTextNode(text));
    for (const [label, run] of actions) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "gfd-link";
      link.textContent = label;
      link.addEventListener("click", run);
      status.appendChild(link);
    }
  }

  $("save").addEventListener("click", async () => {
    if (!plan.parts.length) return;
    if (plan.problems.some((p) => p.kind === "bin")) {
      const ok = await ui.confirm({
        title: "Save without some bins?",
        message: "The bins marked in red can't be made as they are, and are left out. Save the rest?",
        confirmLabel: "Save",
      });
      if (!ok) return;
    }
    const button = $("save");
    button.disabled = true;
    showStatus("Making the parts…");
    try {
      const title = project.name.trim() || `Drawer ${project.drawer.width} × ${project.drawer.depth}`;
      const files = plan.parts.map((part) => ({
        name: part.file,
        data: stl(meshOf(part), part.name),
        type: "model/stl",
      }));
      showStatus("Saving…");
      const model = await models.create({
        name: title,
        description: description(project, plan),
        tags: ["gridfinity", "drawer organizer"],
        files,
      });
      const picture = await layoutPicture();
      if (picture)
        await models
          .addImages(model.id, [{ name: "layout.png", data: picture, type: "image/png" }])
          .catch(() => undefined);
      lastSaved = model;
      showStatus(`Saved as ${model.name}.`, [
        ["Open it", () => models.open(lastSaved.id)],
        [
          "Add to a collection",
          async () => {
            const collection = await thingport.collections.pick({ title: "Add the drawer to" });
            if (!collection) return;
            await thingport.collections.add(collection.id, [lastSaved.id]);
            ui.toast(`Added to ${collection.name}`, "success");
          },
        ],
      ]);
      ui.toast(`Saved ${model.name}`, "success");
    } catch (err) {
      showStatus("");
      status.hidden = true;
      ui.toast(err.message, "error");
    } finally {
      button.disabled = !plan.parts.length;
    }
  });

  update();

  return () => {
    clearTimeout(persistTimer);
    void storage.set("project", project).catch(() => undefined);
  };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
