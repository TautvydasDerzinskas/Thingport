// The tool's window: parts dropped on it, chosen, or taken from the library are measured one after another, each one
// priced from the printer, filament and rates kept in Setup. A part measured from its shape is marked as an estimate;
// one read from a sliced file carries the slicer's own figures and is marked as exact.

import { measure, scaled, fits } from "./geometry.js";
import { MeshError, extensionOf, isMeshFile, readMesh } from "./mesh.js";
import { SlicerError, isSlicedName, platesToValues, readSliced } from "./slicer.js";
import { DENSITIES, MATERIAL, PRINTER, estimate } from "./estimate.js";
import { BUSINESS, LAYERS, price } from "./cost.js";
import { createViewer } from "./viewer.js";

const SECONDS_PER_HOUR = 3600;
/** Saved estimates are kept per user in the tool's own storage, which holds a megabyte a key. */
const SAVED_LIMIT = 200;

const escapeHtml = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

const icon = (path, width = 14) =>
  `<svg width="${width}" height="${width}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const ICONS = {
  open: icon('<path d="M14 3h7v7m0-7L10 14M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>'),
  save: icon('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>'),
  note: icon('<path d="M12 20h9M4 20h3l11-11a2.1 2.1 0 0 0-3-3L4 17Z"/>'),
  copy: icon('<path d="M9 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Zm6-6H5a2 2 0 0 0-2 2v10"/>'),
  undo: icon('<path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4"/>'),
  remove: icon('<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6"/>'),
};

const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const clean = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** "3 h 24 min", "48 min", "35 s": short enough for a table, exact enough to compare. */
function timeText(hours) {
  const seconds = Math.max(0, hours) * SECONDS_PER_HOUR;
  if (!seconds) return "0 min";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const whole = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.round((seconds - whole * SECONDS_PER_HOUR) / 60);
  if (!whole) return `${minutes} min`;
  return minutes ? `${whole} h ${minutes} min` : `${whole} h`;
}

/** "2nd", "3rd", "11th": only ever seen on a mesh too big to draw whole. */
const ordinal = (n) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${suffix}`;
};

const sizeText = (bytes) => {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

export default async function mount(thingport) {
  const { root, theme, models, storage, ui, download } = thingport;
  const shell = root.querySelector(".pce");
  const $ = (id) => root.querySelector(`#pce-${id}`);

  const dark = theme.mode === "dark";
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
    warning: theme.warning,
    success: theme.success,
    font: theme.fontFamily,
  };
  for (const [name, value] of Object.entries(colours)) shell.style.setProperty(`--${name}`, value);
  const layerColour = (layer) => (dark ? layer.dark : layer.light);

  /* ---------------------------------------------------------------- state */

  /** A part in the queue: a file dropped, chosen or taken from the library. */
  let items = [];
  let selectedId = null;
  let nextId = 1;
  let working = false;
  let closed = false;
  let menu = null;
  let viewer = null;
  let shownKey = null;

  /** Setup: the printers and filaments the person keeps, and their rates. Saved under one key. */
  let setup = {
    printers: [{ ...PRINTER }],
    printer: 0,
    materials: [{ ...MATERIAL }],
    material: 0,
    business: { ...BUSINESS },
  };
  let saved = [];

  const selected = () => items.find((item) => item.id === selectedId) ?? null;
  const printer = () => setup.printers[setup.printer] ?? setup.printers[0] ?? { ...PRINTER };
  const material = () => setup.materials[setup.material] ?? setup.materials[0] ?? { ...MATERIAL };
  const business = () => setup.business;
  const money = (value) => `${business().currency}${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
  const bedOf = () => {
    const p = printer();
    return { x: clean(p.bedX, 256), y: clean(p.bedY, 256), z: clean(p.bedZ, 256) };
  };

  const safely =
    (fn) =>
    async (...args) => {
      try {
        await fn(...args);
      } catch (error) {
        if (!closed) ui.toast(error?.message || String(error), "error");
      }
    };

  /* -------------------------------------------------------------- storage */

  try {
    const kept = await storage.get("setup");
    if (kept && typeof kept === "object") {
      setup = {
        printers:
          Array.isArray(kept.printers) && kept.printers.length
            ? kept.printers.map((p) => ({ ...PRINTER, ...p }))
            : setup.printers,
        printer: clean(kept.printer, 0),
        materials:
          Array.isArray(kept.materials) && kept.materials.length
            ? kept.materials.map((m) => ({ ...MATERIAL, ...m }))
            : setup.materials,
        material: clean(kept.material, 0),
        business: { ...BUSINESS, ...(kept.business ?? {}) },
      };
    }
    const keptSaved = await storage.get("saved");
    if (Array.isArray(keptSaved)) saved = keptSaved;
  } catch {
    // A tool previewed before it's saved has nowhere to keep anything; the defaults do.
  }

  let saveTimer = 0;
  const keepSetup = () => {
    clearTimeout(saveTimer);
    // The setup changes on every keystroke in a field; one write when the typing stops is plenty.
    saveTimer = setTimeout(() => {
      storage.set("setup", setup).catch(() => {});
    }, 600);
  };
  const keepSaved = () => storage.set("saved", saved.slice(0, SAVED_LIMIT)).catch(() => {});

  /* ------------------------------------------------------------ the parts */

  function add(entries) {
    const fresh = entries.map((entry) => ({
      id: nextId++,
      status: "queued",
      scale: 100,
      quantity: 1,
      parts: 1,
      plate: "all",
      manual: {},
      currentPrice: 0,
      postMinutes: business().postMinutes,
      ...entry,
    }));
    if (!fresh.length) return;
    items.push(...fresh);
    selectedId = fresh[0].id;
    renderAll();
    void pump();
  }

  function addFiles(fileList) {
    const files = [...fileList];
    const known = files.filter((file) => isMeshFile(file.name) || isSlicedName(file.name));
    const rest = files.length - known.length;
    if (rest) {
      ui.toast(
        rest === 1
          ? `${files.find((file) => !isMeshFile(file.name) && !isSlicedName(file.name)).name} isn't a model or a sliced file`
          : `${rest} files aren't models or sliced files and were left out`,
        "warning",
      );
    }
    add(
      known.map((file) => ({
        name: file.name,
        size: file.size,
        read: async () => new Uint8Array(await file.arrayBuffer()),
        blob: file,
      })),
    );
  }

  /** Measures the queued parts one after another, so a big mesh doesn't block the next one from showing up. */
  async function pump() {
    if (working) return;
    working = true;
    try {
      for (;;) {
        const next = items.find((item) => item.status === "queued");
        if (!next || closed) break;
        next.status = "reading";
        renderList();
        if (next.id === selectedId) renderPart();
        await run(next);
        if (closed) break;
        renderAll();
      }
    } finally {
      working = false;
    }
  }

  async function run(item) {
    try {
      const bytes = await item.read();
      item.size = item.size ?? bytes.length;
      const extension = extensionOf(item.name);

      // A sliced file knows its own time and weight, which beats anything measured from the shape. A plain .3mf may
      // be either a project or a sliced plate, so it's asked first and measured if the answer is no.
      let sliced = null;
      if (isSlicedName(item.name)) {
        sliced = await readSliced(
          extension === ".3mf" || extension === ".gcode.3mf" ? bytes : (item.blob ?? bytes),
          item.name,
        );
      } else if (extension === ".3mf") {
        sliced = await readSliced(bytes, item.name).catch(() => null);
      }

      // The mesh is read as well whenever there is one: it draws the view and says whether the part fits the bed,
      // even when the figures come from the slicer.
      let mesh = null;
      if (isMeshFile(item.name)) {
        try {
          item.status = "measuring";
          renderList();
          // A yield, so the row's spinner paints before a million triangles are added up.
          await new Promise((resolve) => setTimeout(resolve, 0));
          mesh = await readMesh(bytes, item.name);
        } catch (error) {
          if (!sliced) throw error;
          // A sliced 3MF whose mesh can't be read is still perfectly priceable.
          mesh = null;
        }
      }

      item.sliced = sliced;
      item.mesh = mesh;
      item.measurement = mesh ? measure(mesh.triangles, { overhang: clean(printer().overhang, 45) }) : null;
      if (!sliced && !item.measurement) throw new MeshError("Nothing in this file could be measured.");
      item.kind = sliced ? "sliced" : "mesh";
      if (sliced && sliced.plates.length === 1) item.plate = sliced.plates[0].index;
      item.status = "done";
      item.error = null;
    } catch (error) {
      item.status = "failed";
      item.error =
        error instanceof MeshError || error instanceof SlicerError
          ? error.message
          : `Couldn't read it: ${error?.message || error}`;
    }
  }

  function remove(item) {
    const row = $("list")?.querySelector(`[data-id="${item.id}"]`);
    const finish = () => {
      items = items.filter((other) => other.id !== item.id);
      if (selectedId === item.id) selectedId = items[0]?.id ?? null;
      renderAll();
    };
    if (!row || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return finish();
    row.classList.add("pce-going");
    row.addEventListener("animationend", finish, { once: true });
  }

  /* --------------------------------------------------------- the figures */

  /**
   * Everything about one part: its measurement at the scale asked for, what the print needs, and what it costs.
   * Recomputed whenever anything changes, which is cheap — the triangles were measured once.
   */
  function figuresOf(item) {
    if (!item || item.status !== "done") return null;
    const p = printer();
    const m = material();
    const b = business();

    const measurement = item.measurement ? scaled(item.measurement, item.scale) : null;
    const guess = measurement ? estimate(measurement, { ...p, density: m.density }) : null;

    let base;
    if (item.kind === "sliced") {
      const values = platesToValues(item.sliced.plates, item.plate, item.parts);
      base = {
        hours: values.hours ?? 0,
        grams: values.grams ?? 0,
        purgeGrams: values.purgeGrams ?? 0,
        exact: values.hours != null && values.grams != null,
      };
    } else {
      base = {
        hours: guess.seconds / SECONDS_PER_HOUR,
        grams: guess.totalGrams,
        purgeGrams: 0,
        exact: false,
      };
    }

    // Anything the person typed over the top wins, and is marked in the field so they can see it did.
    const hours = item.manual.hours ?? base.hours;
    const grams = item.manual.grams ?? base.grams;
    const purgeGrams = item.manual.purgeGrams ?? base.purgeGrams;

    const priced = price({
      grams,
      purgeGrams,
      hours,
      quantity: item.quantity,
      currentPrice: item.currentPrice,
      postMinutes: item.postMinutes ?? b.postMinutes,
      ...p,
      ...m,
      ...b,
    });
    return { measurement, guess, base, hours, grams, purgeGrams, priced };
  }

  const batchOf = () =>
    items.reduce(
      (totals, item) => {
        const figures = figuresOf(item);
        if (!figures) return totals;
        const { priced, hours } = figures;
        return {
          parts: totals.parts + 1,
          units: totals.units + priced.quantity,
          hours: totals.hours + hours * priced.quantity,
          grams: totals.grams + (figures.grams + figures.purgeGrams) * priced.quantity,
          cost: totals.cost + priced.orderCost,
          price: totals.price + priced.orderPrice,
        };
      },
      { parts: 0, units: 0, hours: 0, grams: 0, cost: 0, price: 0 },
    );

  /* ----------------------------------------------------------- the queue */

  function renderList() {
    const list = $("list");
    if (!items.length) {
      list.innerHTML = '<li class="pce-empty">Nothing yet. Drop a model, or take one from your library.</li>';
      return;
    }
    list.replaceChildren(
      ...items.map((item) => {
        const row = document.createElement("li");
        row.className = "pce-item";
        row.dataset.id = String(item.id);
        row.tabIndex = 0;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(item.id === selectedId));
        const figures = figuresOf(item);
        let summary = "";
        if (item.status === "failed") summary = `<span style="color:var(--danger)">${escapeHtml(item.error)}</span>`;
        else if (item.status !== "done")
          summary = `<span>${item.status === "measuring" ? "Measuring…" : "Reading…"}</span>`;
        else if (figures) {
          summary = `<b>${money(figures.priced.recommended)}</b><span>${timeText(figures.hours)}</span><span>${figures.grams.toFixed(1)} g</span>`;
        }
        row.innerHTML = `
          <div class="pce-item-name">${escapeHtml(item.name)}</div>
          ${
            item.status === "done"
              ? `<span class="pce-tag ${item.kind === "sliced" ? "pce-tag-exact" : "pce-tag-guess"}">${item.kind === "sliced" ? "Sliced" : "Estimate"}</span>`
              : item.status === "failed"
                ? '<span class="pce-tag">Failed</span>'
                : '<span class="pce-spin" role="presentation"></span>'
          }
          <div class="pce-item-sum">${summary}</div>`;
        row.addEventListener("click", () => select(item.id));
        row.addEventListener("dblclick", () => {
          if (item.source) models.open(item.source.modelId);
        });
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          select(item.id);
          openMenu(event.clientX, event.clientY, item);
        });
        row.addEventListener("keydown", (event) => onRowKey(event, item));
        return row;
      }),
    );
  }

  function onRowKey(event, item) {
    const at = items.indexOf(item);
    if (event.key === "Enter" || event.key === " ") select(item.id);
    else if (event.key === "ArrowDown" && at + 1 < items.length) select(items[at + 1].id, true);
    else if (event.key === "ArrowUp" && at > 0) select(items[at - 1].id, true);
    else if (event.key === "Delete" || event.key === "Backspace") remove(item);
    else if (event.key === "ContextMenu") {
      const box = event.currentTarget.getBoundingClientRect();
      openMenu(box.left + 20, box.bottom - 6, item);
    } else return;
    event.preventDefault();
  }

  function select(id, focus = false) {
    selectedId = id;
    renderList();
    renderPart();
    renderMoney();
    if (focus) $("list").querySelector(`[data-id="${id}"]`)?.focus();
  }

  function renderBatch() {
    const batch = $("batch");
    const totals = $("totals");
    const done = items.filter((item) => item.status === "done").length;
    if (done < 2) {
      batch.hidden = true;
      totals.hidden = true;
      return;
    }
    const b = batchOf();
    batch.hidden = false;
    batch.innerHTML = `
      <div><span>${b.parts} parts${b.units !== b.parts ? `, ${b.units} to print` : ""}</span><b>${timeText(b.hours)}</b></div>
      <div><span>Filament</span><b>${b.grams.toFixed(0)} g</b></div>
      <div><span>Cost</span><b>${money(b.cost)}</b></div>
      <div><span>Recommended</span><b>${money(b.price)}</b></div>`;
    totals.hidden = false;
    totals.innerHTML = `<span>${b.units} to print</span><b>${timeText(b.hours)}</b><span>·</span><b>${money(b.price)}</b>`;
  }

  /* ------------------------------------------------------------ the part */

  /** The fields under the view: what changes from part to part. */
  const partFields = (item, figures) => {
    const fields = [];
    if (item.kind === "mesh") {
      fields.push({
        key: "scale",
        label: "Scale",
        unit: "%",
        step: 1,
        value: item.scale,
        help: "Printing it larger or smaller. Everything is measured again at this size.",
        set: (value) => {
          item.scale = Math.min(1000, Math.max(1, value || 100));
        },
      });
    }
    if (item.kind === "sliced" && item.sliced.plates.length > 1) {
      fields.push({
        key: "plate",
        label: "Plate",
        choices: [
          { value: "all", text: "All plates" },
          ...item.sliced.plates.map((plate) => ({ value: String(plate.index), text: `Plate ${plate.index}` })),
        ],
        value: String(item.plate),
        help: "Which sliced plate to price. All of them adds the plates up.",
        set: (value) => {
          item.plate = value === "all" ? "all" : parseInt(value, 10);
        },
      });
    }
    if (item.kind === "sliced") {
      fields.push({
        key: "parts",
        label: "Parts on it",
        unit: "pcs",
        step: 1,
        value: item.parts,
        help: "How many copies were on the plate. The time and the filament are divided by this to price one part.",
        set: (value) => {
          item.parts = Math.max(1, Math.floor(value) || 1);
        },
      });
    }
    fields.push(
      {
        key: "hours",
        label: "Print time",
        unit: "h",
        step: 0.1,
        value: round(figures.hours, 2),
        manual: item.manual.hours != null,
        help:
          item.kind === "sliced"
            ? "What the slicer worked out. Type over it to try another figure."
            : "Estimated from the volume and the speed in Setup. Type your slicer's figure in to be exact.",
        set: (value) => {
          item.manual.hours = Math.max(0, value);
        },
      },
      {
        key: "grams",
        label: "Filament",
        unit: "g",
        step: 0.1,
        value: round(figures.grams, 1),
        manual: item.manual.grams != null,
        help: "The weight of the part itself, supports included. The purge below is counted on top.",
        set: (value) => {
          item.manual.grams = Math.max(0, value);
        },
      },
      {
        key: "purgeGrams",
        label: "Purge",
        unit: "g",
        step: 0.1,
        value: round(figures.purgeGrams, 1),
        manual: item.manual.purgeGrams != null,
        help: "Filament that goes in the bin: purge towers and colour changes. On a multicolour print it can outweigh the part.",
        set: (value) => {
          item.manual.purgeGrams = Math.max(0, value);
        },
      },
      {
        key: "postMinutes",
        label: "Your work",
        unit: "min",
        step: 1,
        value: item.postMinutes ?? business().postMinutes,
        help: "Minutes spent taking off supports, sanding, assembling and packing it. The part of the job almost everyone gives away.",
        set: (value) => {
          item.postMinutes = Math.max(0, value);
        },
      },
      {
        key: "quantity",
        label: "Order",
        unit: "pcs",
        step: 1,
        value: item.quantity,
        help: "How many of it are being sold. It changes the order total, not what one costs.",
        set: (value) => {
          item.quantity = Math.max(1, Math.floor(value) || 1);
        },
      },
      {
        key: "currentPrice",
        label: "Your price",
        unit: business().currency,
        step: 0.5,
        value: item.currentPrice,
        help: "What you charge for it today, to compare against the recommendation. Leave it at zero to skip the comparison.",
        set: (value) => {
          item.currentPrice = Math.max(0, value);
        },
      },
    );
    return fields;
  };

  function renderPart() {
    const item = selected();
    const title = $("part-title");
    const kind = $("kind");
    const facts = $("facts");
    const fields = $("fields");
    const messages = $("messages");
    const note = $("view-note");
    const size = $("size");
    $("more").disabled = !item || item.status !== "done";

    if (!item) {
      title.textContent = "The part";
      kind.hidden = true;
      facts.replaceChildren();
      fields.replaceChildren();
      messages.replaceChildren();
      size.textContent = "";
      note.hidden = false;
      note.textContent = "Nothing to show yet.";
      viewer?.clear();
      shownKey = null;
      return;
    }

    title.textContent = item.name;
    title.title = item.name;
    if (item.status !== "done") {
      kind.hidden = true;
      facts.replaceChildren();
      fields.replaceChildren();
      messages.innerHTML =
        item.status === "failed"
          ? `<div class="pce-note pce-note-bad">${escapeHtml(item.error)}</div>`
          : '<div class="pce-note">Reading it…</div>';
      size.textContent = "";
      note.hidden = false;
      note.textContent = item.status === "failed" ? "Nothing to show." : "Reading it…";
      viewer?.clear();
      shownKey = null;
      return;
    }

    const figures = figuresOf(item);
    kind.hidden = false;
    kind.className = `pce-tag ${item.kind === "sliced" ? "pce-tag-exact" : "pce-tag-guess"}`;
    kind.textContent =
      item.kind === "sliced" ? `From ${item.sliced.slicer ?? "the slicer"}` : `Estimated · ${item.mesh.format}`;

    renderView(item, figures);
    renderFacts(item, figures, facts);
    renderMessages(item, figures, messages);
    renderFields(item, figures, fields);
  }

  function renderView(item, figures) {
    const note = $("view-note");
    const size = $("size");
    const view = $("view");
    if (!item.measurement) {
      // Nothing to draw: the view shrinks to a line of explanation and the figures take the room.
      view.classList.add("pce-view-flat");
      note.hidden = false;
      note.textContent = "This file holds the sliced plate, not the shape, so there's nothing to draw.";
      size.textContent = "";
      viewer?.clear();
      shownKey = null;
      return;
    }
    view.classList.remove("pce-view-flat");
    if (!viewer) {
      note.hidden = false;
      note.textContent = "This browser has no WebGL, so the part can't be drawn. The figures are all there.";
    } else {
      note.hidden = true;
      const highlight = $("overhangs").getAttribute("aria-pressed") === "true";
      const bed = bedOf();
      const key = `${item.id}|${item.scale}|${highlight}|${bed.x}x${bed.y}`;
      if (key !== shownKey) {
        const stride = viewer.show(
          { triangles: item.mesh.triangles, faces: item.measurement.faces, box: item.measurement.box },
          { scale: item.scale, highlight, bed },
        );
        shownKey = key;
        item.drawnEvery = stride;
      }
    }
    const [x, y, z] = figures.measurement.box.size;
    size.textContent = `${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm${item.drawnEvery > 1 ? ` · every ${ordinal(item.drawnEvery)} triangle drawn` : ""}`;
  }

  function renderFacts(item, figures, into) {
    const cells = [];
    const cell = (label, value, tone = "") => cells.push({ label, value, tone });
    if (figures.measurement) {
      const m = figures.measurement;
      cell("Volume", `${(m.volume / 1000).toFixed(1)} cm³`);
      cell("Surface", `${(m.area / 100).toFixed(0)} cm²`);
      cell("Triangles", m.count.toLocaleString());
      cell("Mesh", m.closed === null ? "Not checked" : m.closed ? "Closed" : "Open", m.closed === false ? "warn" : "");
      const bed = bedOf();
      const room = fits(m.box.size, bed);
      cell("Bed", room.fits ? (room.turned ? "Fits turned" : "Fits") : "Too big", room.fits ? "" : "bad");
    }
    if (item.kind === "mesh" && figures.guess) {
      cell("Layers", figures.guess.layers.toLocaleString());
      if (figures.guess.supportGrams > 0.05) cell("Supports", `${figures.guess.supportGrams.toFixed(1)} g`, "warn");
      cell(
        "Infill goes in",
        `${((figures.guess.infillVolume / Math.max(1, figures.guess.partVolume)) * 100).toFixed(0)}%`,
      );
    }
    if (item.kind === "sliced") {
      const plates = item.sliced.plates;
      cell("Plates", String(plates.length));
      const filaments = plates.flatMap((plate) => plate.filaments);
      if (filaments.length) cell("Filaments", String(new Set(filaments.map((f) => f.type || "?")).size));
      cell("File", sizeText(item.size));
    }
    into.replaceChildren(
      ...cells.map(({ label, value, tone }) => {
        const box = document.createElement("div");
        box.className = `pce-fact${tone ? ` pce-fact-${tone}` : ""}`;
        box.innerHTML = `<span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>`;
        return box;
      }),
    );
  }

  function renderMessages(item, figures, into) {
    const notes = [];
    const m = figures.measurement;
    if (item.kind === "mesh") {
      notes.push({
        tone: "",
        html: `Estimated from the shape at <b>${clean(printer().infill, 15)}% infill</b>, ${clean(printer().walls, 2)} walls and ${clean(printer().layerHeight, 0.2)} mm layers. Slice it and type the two figures in for an exact price.`,
      });
    }
    if (m && m.closed === false) {
      notes.push({
        tone: "bad",
        html: "This mesh isn't closed, so its volume — and everything worked out from it — may be wrong. Repairing it in your slicer first is worth the minute.",
      });
    }
    if (m && m.inverted) {
      notes.push({
        tone: "warn",
        html: "The faces are wound inside out. The volume is right, but a slicer may complain.",
      });
    }
    if (m) {
      const bed = bedOf();
      const room = fits(m.box.size, bed);
      if (!room.fits) {
        notes.push({
          tone: "bad",
          html: `It doesn't fit the bed (${bed.x} × ${bed.y} × ${bed.z} mm). It would at <b>${Math.floor(room.room * item.scale * 0.995)}%</b>, or cut into parts.`,
        });
      }
    }
    if (item.kind === "mesh" && figures.guess?.solid) {
      notes.push({
        tone: "warn",
        html: "The walls meet in the middle: at these settings it prints solid, so the infill makes no difference to it.",
      });
    }
    if (item.kind === "sliced" && !figures.base.exact) {
      notes.push({
        tone: "warn",
        html: "This sliced file gives one figure but not the other. Type the missing one in.",
      });
    }
    if (item.kind === "sliced" && item.sliced.plates.some((plate) => plate.estimated)) {
      notes.push({
        tone: "warn",
        html: "The slicer gave a length rather than a weight, so the grams were worked out from PLA's density here.",
      });
    }
    into.replaceChildren(
      ...notes.map(({ tone, html }) => {
        const box = document.createElement("div");
        box.className = `pce-note${tone ? ` pce-note-${tone}` : ""}`;
        box.innerHTML = html;
        return box;
      }),
    );
  }

  function renderFields(item, figures, into) {
    into.replaceChildren(
      ...partFields(item, figures).map((field) => {
        const wrap = document.createElement("div");
        wrap.className = "pce-field";
        const id = `pce-f-${field.key}`;
        const control = field.choices
          ? `<select id="${id}">${field.choices.map((choice) => `<option value="${escapeHtml(choice.value)}"${choice.value === field.value ? " selected" : ""}>${escapeHtml(choice.text)}</option>`).join("")}</select>`
          : `<input id="${id}" type="number" step="${field.step}" min="0" value="${field.value}" />${field.unit ? `<i>${escapeHtml(field.unit)}</i>` : ""}`;
        wrap.innerHTML = `
          <label for="${id}">${escapeHtml(field.label)}${field.manual ? " ·" : ""}
            <button type="button" class="pce-help" tabindex="0" aria-label="${escapeHtml(`${field.label}: ${field.help}`)}" title="${escapeHtml(field.help)}">?</button>
          </label>
          <div class="pce-in${field.manual ? " pce-in-set" : ""}">${control}</div>`;
        const input = wrap.querySelector("input, select");
        input.addEventListener("change", () => {
          field.set(field.choices ? input.value : clean(input.value, 0));
          // The scale and the plate change what's drawn and what's measured; the rest only change the money.
          if (field.key === "scale" || field.key === "plate") renderAll();
          else {
            renderList();
            renderBatch();
            renderMoney();
            renderFields(item, figuresOf(item), into);
            renderFacts(item, figuresOf(item), $("facts"));
          }
        });
        return wrap;
      }),
    );
  }

  /* ----------------------------------------------------------- the money */

  function renderMoney() {
    const into = $("money");
    const hint = $("money-hint");
    const item = selected();
    const figures = figuresOf(item);
    if (!figures) {
      hint.textContent = "";
      into.innerHTML = '<p class="pce-empty">Add a part and its price shows up here.</p>';
      return;
    }
    const { priced } = figures;
    hint.textContent = item.kind === "sliced" ? "From the slicer" : "An estimate";

    const total = Math.max(priced.cost, 0.0001);
    const segments = LAYERS.map((layer) => ({ ...layer, value: priced.parts[layer.key] ?? 0 }));
    const bar = segments
      .map((segment) => {
        const share = (segment.value / total) * 100;
        return share > 0.01
          ? `<div class="pce-seg" style="width:${share.toFixed(2)}%;background:${layerColour(segment)}" title="${escapeHtml(segment.name)} ${money(segment.value)}"></div>`
          : "";
      })
      .join("");
    const legend = segments
      .map(
        (segment) => `<li>
          <i style="background:${layerColour(segment)}"></i>
          <span class="pce-legend-name">${escapeHtml(segment.name)}</span>
          <b>${money(segment.value)}</b>
          <em>${((segment.value / total) * 100).toFixed(0)}%</em>
        </li>`,
      )
      .join("");

    const profitable = priced.profit >= 0;
    into.innerHTML = `
      <div class="pce-hero">
        <span>Charge, for a ${clean(business().margin, 40)}% margin</span>
        <strong>${money(priced.recommended)}</strong>
        <em>${money(priced.cost)} to make · you keep ${money(priced.kept)}</em>
      </div>
      <h3 class="pce-hint" style="margin-top:10px">What the ${money(priced.cost)} is</h3>
      <div class="pce-bar-chart" role="img" aria-label="${escapeHtml(`The cost: ${segments.map((segment) => `${segment.name} ${money(segment.value)}`).join(", ")}`)}">${bar}</div>
      <ul class="pce-legend">${legend}</ul>
      <div class="pce-rows">
        <div><span>Filament is</span><b>${priced.materialShare.toFixed(0)}% of it</b></div>
        <div><span>Time on the printer</span><b>${timeText(figures.hours)}</b></div>
        ${
          priced.charged > 0
            ? `<div><span>At ${money(priced.charged)} you make</span><b class="${profitable ? "pce-good" : "pce-bad"}">${money(priced.profit)}</b></div>
               <div><span>Which is</span><b class="${profitable ? "pce-good" : "pce-bad"}">${priced.margin.toFixed(0)}% · ${money(priced.perHour)}/h</b></div>`
            : ""
        }
        ${
          priced.quantity > 1
            ? `<div><span>${priced.quantity} of them</span><b>${money(priced.orderPrice)}</b></div>
               <div><span>Costing</span><b>${money(priced.orderCost)}</b></div>`
            : ""
        }
      </div>`;
  }

  function renderAll() {
    renderList();
    renderBatch();
    renderPart();
    renderMoney();
  }

  /* --------------------------------------------------- the menu on a part */

  function closeMenu({ restore = false } = {}) {
    if (!menu) return;
    const { element, opener } = menu;
    menu = null;
    element.remove();
    document.removeEventListener("pointerdown", onOutside, true);
    if (restore) opener?.focus();
  }
  const onOutside = (event) => {
    if (menu && !menu.element.contains(event.target)) closeMenu();
  };

  function openMenu(x, y, item) {
    closeMenu();
    const figures = figuresOf(item);
    const actions = [
      item.source && { label: "Open it in Thingport", icon: ICONS.open, run: () => models.open(item.source.modelId) },
      figures && { label: "Save this estimate", icon: ICONS.save, run: () => saveEstimate(item) },
      figures &&
        item.source && { label: "Add it to the model's notes", icon: ICONS.note, run: () => noteOnModel(item) },
      figures && { label: "Copy the figures", icon: ICONS.copy, run: () => copyFigures(item) },
      Object.keys(item.manual).length > 0 && {
        label: "Back to the measured figures",
        icon: ICONS.undo,
        run: () => {
          item.manual = {};
          renderAll();
        },
      },
      { divider: true },
      { label: "Remove it", icon: ICONS.remove, danger: true, run: () => remove(item) },
    ].filter(Boolean);

    const element = document.createElement("div");
    element.className = "pce-menu";
    element.setAttribute("role", "menu");
    for (const action of actions) {
      if (action.divider) {
        element.append(document.createElement("hr"));
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.className = action.danger ? "pce-danger" : "";
      button.innerHTML = `${action.icon}<span>${escapeHtml(action.label)}</span>`;
      button.addEventListener("click", () => {
        closeMenu();
        void safely(action.run)();
      });
      element.append(button);
    }
    shell.append(element);
    // Kept inside the window, which is what the tool is given to draw in.
    const box = shell.getBoundingClientRect();
    const own = element.getBoundingClientRect();
    element.style.left = `${Math.min(Math.max(8, x - box.left), box.width - own.width - 8)}px`;
    element.style.top = `${Math.min(Math.max(8, y - box.top), Math.max(8, box.height - own.height - 8))}px`;
    menu = { element, opener: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    element.querySelector("button")?.focus();
    setTimeout(() => document.addEventListener("pointerdown", onOutside, true));
  }

  /* -------------------------------------------------- what a part can do */

  async function copyFigures(item) {
    const figures = figuresOf(item);
    const text = [
      item.name,
      `Print time: ${timeText(figures.hours)}`,
      `Filament: ${figures.grams.toFixed(1)} g${figures.purgeGrams ? ` + ${figures.purgeGrams.toFixed(1)} g purge` : ""}`,
      `Cost: ${money(figures.priced.cost)}`,
      `Price: ${money(figures.priced.recommended)} (${clean(business().margin, 40)}% margin)`,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    ui.toast("The figures are on the clipboard", "success");
  }

  function saveEstimate(item) {
    const figures = figuresOf(item);
    saved.unshift({
      id: `${Date.now()}-${item.id}`,
      at: new Date().toISOString(),
      name: item.name,
      modelId: item.source?.modelId ?? null,
      modelName: item.source?.modelName ?? null,
      kind: item.kind,
      hours: round(figures.hours, 3),
      grams: round(figures.grams, 2),
      purgeGrams: round(figures.purgeGrams, 2),
      quantity: figures.priced.quantity,
      cost: round(figures.priced.cost, 2),
      recommended: round(figures.priced.recommended, 2),
      currency: business().currency,
      printer: printer().name,
      material: material().name,
    });
    saved = saved.slice(0, SAVED_LIMIT);
    void keepSaved();
    ui.toast("Saved", "success");
  }

  /** Writes the estimate into the model's notes, under a line of its own, leaving what's there alone. */
  async function noteOnModel(item) {
    const figures = figuresOf(item);
    const text = `Print cost estimate (${new Date().toLocaleDateString()}): ${timeText(figures.hours)}, ${figures.grams.toFixed(1)} g, ${money(figures.priced.cost)} to make, ${money(figures.priced.recommended)} to charge — ${printer().name}, ${material().name}, ${item.kind === "sliced" ? "from the sliced file" : "estimated from the shape"}.`;
    const yes = await ui.confirm({
      title: "Add it to the model's notes?",
      message: `This is added to the end of “${item.source.modelName}”'s notes:\n\n${text}`,
      confirmLabel: "Add it",
    });
    if (!yes) return;
    const model = await models.get(item.source.modelId);
    const description = model.description?.trim() ? `${model.description.trim()}\n\n${text}` : text;
    await models.update(item.source.modelId, { description });
    ui.toast("Added to the model's notes", "success");
  }

  const csvCell = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = (rows) => rows.map((row) => row.map(csvCell).join(",")).join("\r\n");

  function exportQueue() {
    const done = items.filter((item) => item.status === "done");
    if (!done.length) return ui.toast("Nothing to export yet", "warning");
    const b = business();
    const rows = [
      [
        "Part",
        "From",
        "Source",
        "Print time (h)",
        "Filament (g)",
        "Purge (g)",
        `Cost (${b.currency})`,
        `Price (${b.currency})`,
        "Quantity",
        `Order (${b.currency})`,
        "Printer",
        "Filament",
        "Margin (%)",
      ],
      ...done.map((item) => {
        const figures = figuresOf(item);
        return [
          item.name,
          item.kind === "sliced" ? (item.sliced.slicer ?? "a slicer") : "its shape",
          item.source?.modelName ?? "a file",
          round(figures.hours, 3),
          round(figures.grams, 2),
          round(figures.purgeGrams, 2),
          round(figures.priced.cost, 2),
          round(figures.priced.recommended, 2),
          figures.priced.quantity,
          round(figures.priced.orderPrice, 2),
          printer().name,
          material().name,
          clean(b.margin, 40),
        ];
      }),
    ];
    download({ name: `print-costs-${new Date().toISOString().slice(0, 10)}.csv`, data: csv(rows), type: "text/csv" });
  }

  function exportSaved() {
    if (!saved.length) return ui.toast("Nothing saved yet", "warning");
    const rows = [
      [
        "Saved",
        "Part",
        "Model",
        "From",
        "Print time (h)",
        "Filament (g)",
        "Cost",
        "Price",
        "Currency",
        "Printer",
        "Filament",
      ],
      ...saved.map((entry) => [
        entry.at.slice(0, 16).replace("T", " "),
        entry.name,
        entry.modelName ?? "",
        entry.kind === "sliced" ? "a slicer" : "its shape",
        entry.hours,
        entry.grams,
        entry.cost,
        entry.recommended,
        entry.currency,
        entry.printer,
        entry.material,
      ]),
    ];
    download({
      name: `saved-estimates-${new Date().toISOString().slice(0, 10)}.csv`,
      data: csv(rows),
      type: "text/csv",
    });
  }

  /* ----------------------------------------------------------- the sheets */

  /** Opening and closing a sheet, with the focus put back where it came from. */
  const sheets = {};
  function sheet(name, onOpen) {
    const element = $(name);
    sheets[name] = {
      element,
      opener: null,
      open() {
        this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        element.hidden = false;
        onOpen?.();
      },
      close() {
        element.hidden = true;
        this.opener?.focus();
      },
    };
    element.addEventListener("click", (event) => {
      if (event.target === element) sheets[name].close();
    });
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // Escape closes the sheet, not the tool's window around it.
      event.stopPropagation();
      sheets[name].close();
    });
    return sheets[name];
  }

  /* ---- setup ---- */

  const SETUP = {
    printer: {
      title: "Printer",
      groups: [
        {
          title: "What it costs to own",
          fields: [
            {
              key: "price",
              label: "What it cost",
              unit: business().currency,
              help: "What the machine cost, upgrades and spare parts included.",
            },
            {
              key: "lifespan",
              label: "Hours it will last",
              unit: "h",
              help: "How many printing hours you expect out of it before retiring it. Its cost is spread over those hours, the way a shop writes a machine off.",
            },
            {
              key: "watts",
              label: "Power",
              unit: "W",
              help: "Average watts while printing. PLA on an enclosed printer sits around 100–120 W; a hot bed pushes it higher.",
            },
            {
              key: "kwhPrice",
              label: "Electricity",
              unit: "/kWh",
              step: 0.01,
              help: "What a kilowatt-hour costs you. It's on your bill.",
            },
            {
              key: "failRate",
              label: "Prints that fail",
              unit: "%",
              help: "Out of a hundred prints, how many go in the bin. Leaving it at zero claims you never fail, which is exactly the assumption that quietly loses money.",
            },
          ],
        },
        {
          title: "The bed",
          fields: [
            { key: "bedX", label: "Width", unit: "mm" },
            { key: "bedY", label: "Depth", unit: "mm" },
            { key: "bedZ", label: "Height", unit: "mm" },
          ],
        },
        {
          title: "How it prints",
          hint: "What the estimate from a shape is built on. A sliced file's own figures are used instead whenever there are any.",
          fields: [
            { key: "layerHeight", label: "Layer height", unit: "mm", step: 0.02 },
            {
              key: "lineWidth",
              label: "Line width",
              unit: "mm",
              step: 0.02,
              help: "The width of one extruded line, usually a little over the nozzle's size.",
            },
            { key: "walls", label: "Walls", unit: "lines", help: "How many lines thick the outside is." },
            {
              key: "solidLayers",
              label: "Solid layers",
              unit: "each",
              help: "Solid layers on the top and on the bottom, each.",
            },
            { key: "infill", label: "Infill", unit: "%" },
            { key: "speed", label: "Speed", unit: "mm/s", help: "The printing speed your profile asks for." },
            {
              key: "efficiency",
              label: "Speed reached",
              unit: "%",
              help: "The share of that speed actually reached: the printer is forever accelerating into a corner, so it never holds the full figure. This is the dial to turn if the estimated time comes out wrong — raise it if the estimate is long, lower it if it's short.",
            },
            {
              key: "perLayer",
              label: "Lost a layer",
              unit: "s",
              help: "Seconds a layer that aren't extruding: travel, the Z move, the seam, retractions.",
            },
          ],
        },
        {
          title: "Supports",
          fields: [
            {
              key: "supports",
              label: "Count supports",
              toggle: true,
              help: "Whether to add what supports would weigh to the estimate.",
            },
            {
              key: "overhang",
              label: "Overhang from",
              unit: "°",
              help: "A face shallower than this needs holding up. Slicers call it the support threshold; 45° is the usual.",
            },
            { key: "supportDensity", label: "Support density", unit: "%" },
          ],
        },
      ],
    },
    material: {
      title: "Filament",
      groups: [
        {
          title: "The spool",
          fields: [
            {
              key: "density",
              label: "Density",
              unit: "g/cm³",
              step: 0.01,
              help: "What a cubic centimetre of it weighs. PLA is 1.24, PETG 1.27, ABS 1.04 — the spool's label says.",
            },
            {
              key: "spoolPrice",
              label: "Spool price",
              unit: business().currency,
              help: "What you paid for the whole spool, postage included.",
            },
            {
              key: "spoolWeight",
              label: "Spool holds",
              unit: "g",
              help: "Grams of filament on it, not counting the reel. 1 kg is standard; 750 g and 250 g spools exist.",
            },
          ],
        },
      ],
    },
    business: {
      title: "You",
      groups: [
        {
          title: "Your rates",
          fields: [
            {
              key: "hourlyRate",
              label: "Your hour",
              unit: business().currency,
              help: "What you want to be paid an hour. If you're unsure, start with what your day job pays you.",
            },
            {
              key: "postMinutes",
              label: "Work a part",
              unit: "min",
              help: "The default minutes of your own work on a part. Each part can be given its own.",
            },
            {
              key: "packaging",
              label: "Packaging",
              unit: business().currency,
              help: "Bag, box, label and filler for one.",
            },
            {
              key: "fee",
              label: "Platform fee",
              unit: "%",
              help: "What the platform keeps, commission and card charges together. It's taken off the selling price, as the platform takes it. Selling in person, it's zero.",
            },
            {
              key: "margin",
              label: "Margin you want",
              unit: "%",
              help: "What you want on top of the cost. Below 20% there's nothing left to reinvest or to absorb a surprise.",
            },
            {
              key: "currency",
              label: "Currency",
              text: true,
              help: "The sign to put in front of the money. Nothing is converted: type the figures in whatever you sell in.",
            },
          ],
        },
      ],
    },
  };

  let setupTab = "printer";

  function renderSetup() {
    const tabs = $("setup-tabs");
    tabs.replaceChildren(
      ...Object.entries(SETUP).map(([key, section]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(key === setupTab));
        button.textContent = section.title;
        button.addEventListener("click", () => {
          setupTab = key;
          renderSetup();
        });
        return button;
      }),
    );

    const body = $("setup-body");
    body.replaceChildren();
    const section = SETUP[setupTab];
    const target = setupTab === "printer" ? printer() : setupTab === "material" ? material() : business();

    // The printer and the filament can be several, and which one is in use is a choice above their fields.
    if (setupTab !== "business") {
      const list = setupTab === "printer" ? setup.printers : setup.materials;
      const chooser = document.createElement("div");
      chooser.className = "pce-group";
      chooser.innerHTML = `
        <h3>${setupTab === "printer" ? "Which printer" : "Which filament"}</h3>
        <div class="pce-actions">
          <div class="pce-in" style="flex:1 1 140px"><select id="pce-which" aria-label="${setupTab === "printer" ? "Which printer" : "Which filament"}">
            ${list.map((entry, index) => `<option value="${index}"${index === (setupTab === "printer" ? setup.printer : setup.material) ? " selected" : ""}>${escapeHtml(entry.name || "Unnamed")}</option>`).join("")}
          </select></div>
          <div class="pce-in" style="flex:1 1 140px"><input id="pce-which-name" value="${escapeHtml(target.name ?? "")}" aria-label="Its name" placeholder="Its name" /></div>
          <button type="button" class="pce-btn" id="pce-which-add">Add another</button>
          <button type="button" class="pce-btn" id="pce-which-drop"${list.length < 2 ? " disabled" : ""}>Remove</button>
        </div>`;
      body.append(chooser);
      chooser.querySelector("#pce-which").addEventListener("change", (event) => {
        const index = clean(event.target.value, 0);
        if (setupTab === "printer") setup.printer = index;
        else setup.material = index;
        keepSetup();
        shownKey = null;
        renderSetup();
        renderAll();
      });
      chooser.querySelector("#pce-which-name").addEventListener("input", (event) => {
        target.name = event.target.value;
        keepSetup();
      });
      chooser.querySelector("#pce-which-name").addEventListener("change", () => renderSetup());
      chooser.querySelector("#pce-which-add").addEventListener("click", () => {
        if (setupTab === "printer") {
          setup.printers.push({ ...target, name: `${target.name || "Printer"} copy` });
          setup.printer = setup.printers.length - 1;
        } else {
          setup.materials.push({ ...target, name: `${target.name || "Filament"} copy` });
          setup.material = setup.materials.length - 1;
        }
        keepSetup();
        renderSetup();
        renderAll();
      });
      chooser.querySelector("#pce-which-drop").addEventListener("click", () => {
        if (setupTab === "printer") {
          setup.printers.splice(setup.printer, 1);
          setup.printer = Math.max(0, setup.printer - 1);
        } else {
          setup.materials.splice(setup.material, 1);
          setup.material = Math.max(0, setup.material - 1);
        }
        keepSetup();
        shownKey = null;
        renderSetup();
        renderAll();
      });
    }

    // A filament's density is worth offering as a list: most people know the name, not the figure.
    if (setupTab === "material") {
      const presets = document.createElement("div");
      presets.className = "pce-group";
      presets.innerHTML = `<h3>From the common ones</h3><div class="pce-actions" id="pce-presets"></div>`;
      const row = presets.querySelector("#pce-presets");
      for (const [name, density] of Object.entries(DENSITIES)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pce-btn";
        button.textContent = name;
        button.addEventListener("click", () => {
          target.name = name;
          target.density = density;
          keepSetup();
          renderSetup();
          renderAll();
        });
        row.append(button);
      }
      body.append(presets);
    }

    for (const group of section.groups) {
      const box = document.createElement("div");
      box.className = "pce-group";
      box.innerHTML = `<h3>${escapeHtml(group.title)}</h3>${group.hint ? `<p class="pce-hint" style="margin:0">${escapeHtml(group.hint)}</p>` : ""}<div class="pce-fields"></div>`;
      const into = box.querySelector(".pce-fields");
      for (const field of group.fields) {
        const wrap = document.createElement("div");
        wrap.className = "pce-field";
        const id = `pce-s-${setupTab}-${field.key}`;
        const value = target[field.key];
        const control = field.text
          ? `<input id="${id}" type="text" value="${escapeHtml(value ?? "")}" maxlength="4" />`
          : `<input id="${id}" type="number" step="${field.step ?? 1}" min="0" value="${clean(value, 0)}" />${field.unit ? `<i>${escapeHtml(field.unit)}</i>` : ""}`;
        wrap.innerHTML = `
          <label for="${id}">${escapeHtml(field.label)}
            ${field.help ? `<button type="button" class="pce-help" aria-label="${escapeHtml(`${field.label}: ${field.help}`)}" title="${escapeHtml(field.help)}">?</button>` : ""}
          </label>
          ${
            field.toggle
              ? `<label class="pce-switch"><input id="${id}" type="checkbox"${value ? " checked" : ""} /><span></span></label>`
              : `<div class="pce-in">${control}</div>`
          }`;
        const input = wrap.querySelector("input");
        input.addEventListener("change", () => {
          target[field.key] = field.toggle
            ? input.checked
            : field.text
              ? input.value.trim() || "€"
              : clean(input.value, 0);
          keepSetup();
          // The bed, the overhang angle and the printing settings change what's drawn and measured.
          shownKey = null;
          if (field.key === "overhang") remeasure();
          renderAll();
        });
        into.append(wrap);
      }
      body.append(box);
    }
  }

  /** The overhang threshold is the one setting baked into the measurement, so changing it measures again. */
  function remeasure() {
    for (const item of items) {
      if (item.mesh) item.measurement = measure(item.mesh.triangles, { overhang: clean(printer().overhang, 45) });
    }
  }

  /* ---- the library ---- */

  let searchTimer = 0;
  let searchToken = 0;

  async function listLibrary(q) {
    const token = ++searchToken;
    const found = $("found");
    found.innerHTML = '<li class="pce-skeleton" style="height:54px"></li>'.repeat(4);
    try {
      const { models: page } = await models.list({ q: q || undefined, limit: 60 });
      if (token !== searchToken || closed) return;
      const usable = page
        .map((model) => ({
          model,
          files: model.files.filter((file) => isMeshFile(file.name) || isSlicedName(file.name)),
        }))
        .filter((entry) => entry.files.length);
      $("picker-hint").textContent = usable.length
        ? "Pick a file to measure it. A sliced file brings the slicer's own time and weight."
        : "";
      if (!usable.length) {
        found.innerHTML = `<li class="pce-empty">${q ? `Nothing matching “${escapeHtml(q)}” has a file this can read.` : "No models with an STL, OBJ, 3MF or sliced file yet."}</li>`;
        return;
      }
      found.replaceChildren(
        ...usable.map(({ model, files }) => {
          const row = document.createElement("li");
          row.className = "pce-model";
          row.innerHTML = `
            ${model.thumbnail ? `<img src="${escapeHtml(model.thumbnail)}" alt="" loading="lazy">` : '<span class="pce-thumb"></span>'}
            <div><b>${escapeHtml(model.name)}</b><div class="pce-files"></div></div>`;
          const buttons = row.querySelector(".pce-files");
          for (const file of files) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `${file.name}${file.size ? ` · ${sizeText(file.size)}` : ""}`;
            button.setAttribute("aria-label", `Measure ${file.name} from ${model.name}`);
            button.addEventListener("click", () => {
              sheets.picker.close();
              add([
                {
                  name: file.name,
                  size: file.size,
                  read: async () => new Uint8Array(await models.file(model.id, file.id)),
                  source: { modelId: model.id, modelName: model.name, fileId: file.id },
                },
              ]);
            });
            buttons.append(button);
          }
          return row;
        }),
      );
    } catch (error) {
      if (token === searchToken)
        $("found").innerHTML = `<li class="pce-empty">${escapeHtml(error?.message || error)}</li>`;
    }
  }

  /* ---- saved estimates ---- */

  function renderSaved() {
    const list = $("saved-list");
    if (!saved.length) {
      list.innerHTML = '<li class="pce-empty">Nothing saved yet. A part\'s ⋮ menu has “Save this estimate”.</li>';
      return;
    }
    list.replaceChildren(
      ...saved.map((entry) => {
        const row = document.createElement("li");
        row.innerHTML = `
          <b>${escapeHtml(entry.name)}</b>
          <div class="pce-actions"></div>
          <div class="pce-item-sum">
            <b>${escapeHtml(entry.currency)}${entry.recommended.toFixed(2)}</b>
            <span>${timeText(entry.hours)}</span>
            <span>${entry.grams.toFixed(1)} g</span>
            <span>${escapeHtml(entry.printer)} · ${escapeHtml(entry.material)}</span>
            <span>${escapeHtml(entry.at.slice(0, 10))}</span>
          </div>`;
        const actions = row.querySelector(".pce-actions");
        if (entry.modelId) {
          const open = document.createElement("button");
          open.type = "button";
          open.className = "pce-btn pce-icon";
          open.title = `Open ${entry.modelName ?? "the model"}`;
          open.setAttribute("aria-label", `Open ${entry.modelName ?? "the model"} in Thingport`);
          open.innerHTML = ICONS.open;
          open.addEventListener("click", () => models.open(entry.modelId));
          actions.append(open);
        }
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "pce-btn pce-icon pce-danger";
        drop.title = "Forget it";
        drop.setAttribute("aria-label", `Forget the estimate for ${entry.name}`);
        drop.innerHTML = ICONS.remove;
        drop.addEventListener(
          "click",
          safely(async () => {
            saved = saved.filter((other) => other.id !== entry.id);
            await keepSaved();
            renderSaved();
          }),
        );
        actions.append(drop);
        return row;
      }),
    );
  }

  /* ------------------------------------------------------------- wiring */

  const canvas = $("canvas");
  viewer = createViewer(canvas, {
    model: dark ? "#cbd5e1" : "#b9c2cf",
    warning: theme.warning,
    grid: theme.divider,
    gridEdge: theme.textSecondary,
  });

  const input = $("file");
  const drop = $("drop");
  drop.addEventListener("click", () => input.click());
  $("add").addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files?.length) addFiles(input.files);
    input.value = "";
  });

  // Files dropped anywhere on the window, not only on the zone.
  let dragDepth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");
  const onDragEnter = (event) => {
    if (!hasFiles(event)) return;
    dragDepth++;
    shell.classList.add("pce-dragging");
  };
  const onDragOver = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) shell.classList.remove("pce-dragging");
  };
  const onDrop = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    shell.classList.remove("pce-dragging");
    if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
  };
  shell.addEventListener("dragenter", onDragEnter);
  shell.addEventListener("dragover", onDragOver);
  shell.addEventListener("dragleave", onDragLeave);
  shell.addEventListener("drop", onDrop);

  $("more").addEventListener("click", (event) => {
    const item = selected();
    if (!item) return;
    const box = event.currentTarget.getBoundingClientRect();
    openMenu(box.left, box.bottom + 4, item);
  });
  $("overhangs").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const on = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(on));
    button.classList.toggle("pce-btn-on", on);
    shownKey = null;
    renderPart();
    // The faces that need holding up are underneath, so the view goes round to where they can be seen.
    viewer?.look(on ? "under" : "start");
  });
  $("recentre").addEventListener("click", () => viewer?.reset());
  $("export").addEventListener("click", () => exportQueue());
  $("clear").addEventListener(
    "click",
    safely(async () => {
      if (!items.length) return;
      const yes = await ui.confirm({
        title: "Remove every part?",
        message: `${items.length} ${items.length === 1 ? "part goes" : "parts go"} from the list. Saved estimates stay.`,
        confirmLabel: "Remove them",
        destructive: true,
      });
      if (!yes) return;
      items = [];
      selectedId = null;
      shownKey = null;
      renderAll();
    }),
  );

  const setupSheet = sheet("setup", renderSetup);
  $("setup-open").addEventListener("click", () => setupSheet.open());
  $("setup-close").addEventListener("click", () => setupSheet.close());
  $("setup-done").addEventListener("click", () => setupSheet.close());
  $("setup-reset").addEventListener(
    "click",
    safely(async () => {
      const yes = await ui.confirm({
        title: "Back to the defaults?",
        message: "Your printers, filaments and rates go back to how they started.",
        confirmLabel: "Reset them",
        destructive: true,
      });
      if (!yes) return;
      setup = {
        printers: [{ ...PRINTER }],
        printer: 0,
        materials: [{ ...MATERIAL }],
        material: 0,
        business: { ...BUSINESS },
      };
      await storage.set("setup", setup).catch(() => {});
      remeasure();
      shownKey = null;
      renderSetup();
      renderAll();
    }),
  );

  const picker = sheet("picker", () => {
    $("search").value = "";
    void listLibrary("");
    $("search").focus();
  });
  $("library").addEventListener("click", () => picker.open());
  $("picker-close").addEventListener("click", () => picker.close());
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void listLibrary($("search").value.trim()), 250);
  });

  const savedSheet = sheet("saved", renderSaved);
  $("saved-open").addEventListener("click", () => savedSheet.open());
  $("saved-close").addEventListener("click", () => savedSheet.close());
  $("saved-export").addEventListener("click", () => exportSaved());

  const onKey = (event) => {
    if (event.key === "Escape" && menu) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ restore: true });
    }
  };
  shell.addEventListener("keydown", onKey);

  const stopResize = thingport.onResize(() => viewer?.redraw());

  renderAll();

  return () => {
    closed = true;
    closeMenu();
    clearTimeout(searchTimer);
    clearTimeout(saveTimer);
    stopResize?.();
    viewer?.dispose();
    shell.removeEventListener("dragenter", onDragEnter);
    shell.removeEventListener("dragover", onDragOver);
    shell.removeEventListener("dragleave", onDragLeave);
    shell.removeEventListener("drop", onDrop);
    shell.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onOutside, true);
  };
}
