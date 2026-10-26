// The tool's window: files dropped on it, chosen, or taken from the library are normalized one after another; the
// selected one shows before and after, what was kept, and what changed, and goes back to Thingport when asked.

import { MiniZip } from "./zip.js";
import { createPreview } from "./preview.js";

const svg = (paths, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;
const ICONS = {
  queued: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>'),
  done: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  failed: svg(
    '<path d="M12 8v5m0 3.5v.5"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  ),
  download: svg('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  save: svg('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'),
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  more: svg('<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>'),
  remove: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  open: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  retry: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  palette: svg(
    '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/>',
  ),
  cube: svg('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12 4 7.5"/>'),
  sliders: svg(
    '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  ),
};

/** The designer's settings worth showing, by their PrusaSlicer names, as the sanitizer maps them. */
const SETTINGS = [
  ["layer_height", "Layer height", (v) => `${v} mm`],
  ["first_layer_height", "First layer", (v) => `${v} mm`],
  ["perimeters", "Walls", (v) => v],
  ["top_solid_layers", "Top layers", (v) => v],
  ["bottom_solid_layers", "Bottom layers", (v) => v],
  ["fill_density", "Infill", (v) => (String(v).includes("%") ? v : `${Math.round(Number(v) * 100)}%`)],
  ["fill_pattern", "Infill pattern", (v) => String(v).replace(/^\w/, (c) => c.toUpperCase())],
  ["extrusion_width", "Line width", (v) => `${v} mm`],
  ["support_material", "Supports", (v) => (String(v) === "1" ? "On" : "Off")],
  ["brim_width", "Brim", (v) => (Number(v) > 0 ? `${v} mm` : "None")],
  ["temperature", "Nozzle", (v) => `${v} °C`],
  ["bed_temperature", "Bed", (v) => `${v} °C`],
];

const isThreeMf = (name) => /\.3mf$/i.test(name);
const baseName = (name) => name.replace(/\.3mf$/i, "");
const outName = (name) => `${baseName(name).replace(/_normalized$/i, "")}_normalized.3mf`;
const first = (value) => (Array.isArray(value) ? value[0] : value);
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function size(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/** A filament colour as CSS: Bambu writes #RRGGBB or #RRGGBBAA. */
const cssColour = (hex) =>
  /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(hex).trim()) ? String(hex).trim().slice(0, 7) : "#b0b0b0";

export default async function mount(thingport) {
  const { root, theme, models, ui } = thingport;
  // sanitizer.js's, joined into this module by build.mjs.
  const sanitizer = ThreeMFSanitizer;
  const shell = root.querySelector(".mwn");
  const $ = (id) => root.querySelector(`#mwn-${id}`);
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
    success: theme.success,
    font: theme.fontFamily,
  };
  for (const [name, value] of Object.entries(colours)) shell.style.setProperty(`--${name}`, value);

  /** The files, in the order they came: { id, name, size, load, status, bytes, result, log, error, source, saved }. */
  let items = [];
  let selectedId = null;
  let working = false;
  let closed = false;
  let nextId = 1;
  let preview = null;
  let renderToken = 0;
  const selected = () => items.find((item) => item.id === selectedId) ?? null;

  const safely =
    (fn) =>
    async (...args) => {
      try {
        await fn(...args);
      } catch (err) {
        ui.toast(err?.message || String(err), "error");
      }
    };

  // ---- adding files ------------------------------------------------------------------------------------------
  function add(entries) {
    const fresh = entries.map((entry) => ({ id: nextId++, status: "queued", ...entry }));
    if (!fresh.length) return;
    items.push(...fresh);
    // What was just added is what the user wants to see.
    selectedId = fresh[0].id;
    renderList();
    renderDetail();
    void pump();
  }

  function addFiles(fileList) {
    const files = [...fileList];
    const wrong = files.filter((file) => !isThreeMf(file.name));
    if (wrong.length)
      ui.toast(
        wrong.length === 1
          ? `${wrong[0].name} isn't a 3MF file`
          : `${wrong.length} files aren't 3MF files and were left out`,
        "warning",
      );
    add(
      files
        .filter((file) => isThreeMf(file.name))
        .map((file) => ({
          name: file.name,
          size: file.size,
          load: async () => new Uint8Array(await file.arrayBuffer()),
        })),
    );
  }

  const input = $("input");
  const drop = $("drop");
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", () => {
    addFiles(input.files);
    input.value = "";
  });

  // Files dropped anywhere on the window.
  const veil = $("veil");
  let dragDepth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");
  const onDragEnter = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    veil.hidden = false;
  };
  const onDragOver = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) veil.hidden = true;
  };
  const onDrop = (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    veil.hidden = true;
    addFiles(event.dataTransfer.files);
  };
  shell.addEventListener("dragenter", onDragEnter);
  shell.addEventListener("dragover", onDragOver);
  shell.addEventListener("dragleave", onDragLeave);
  shell.addEventListener("drop", onDrop);

  // ---- normalizing, one file at a time -----------------------------------------------------------------------
  async function pump() {
    if (working || closed) return;
    const item = items.find((candidate) => candidate.status === "queued");
    if (!item) return;
    working = true;
    item.status = "working";
    renderList();
    if (item.id === selectedId) renderDetail();
    // Let the spinner show before the work holds the page.
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      const bytes = await item.load();
      const log = [];
      const result = await sanitizer.sanitize3mf(MiniZip, bytes, { log: (line) => log.push(String(line)) });
      Object.assign(item, { status: "done", bytes, result, log, size: item.size ?? bytes.length });
    } catch (err) {
      Object.assign(item, { status: "failed", error: err?.message || String(err) });
    }
    working = false;
    if (closed || !items.includes(item)) return void pump();
    renderList();
    if (item.id === selectedId) renderDetail();
    void pump();
  }

  // ---- the list ----------------------------------------------------------------------------------------------
  const list = $("list");
  function statusIcon(item) {
    if (item.status === "working") return '<span class="mwn-spinner" role="img" aria-label="Normalizing"></span>';
    const labels = { queued: "Waiting", done: "Normalized", failed: "Failed" };
    return `<span role="img" aria-label="${labels[item.status]}">${ICONS[item.status]}</span>`;
  }
  function statusLine(item) {
    if (item.status === "queued") return `Waiting · ${size(item.size)}`;
    if (item.status === "working") return "Normalizing…";
    if (item.status === "failed") return item.error;
    const sizes = `${size(item.size)} → ${size(item.result.bytes.length)}`;
    return item.saved ? `${sizes} · saved` : sizes;
  }

  function renderList() {
    const done = items.filter((item) => item.status === "done");
    $("count").textContent = items.length ? String(items.length) : "";
    $("downloadAll").hidden = done.length < 2;
    $("clear").hidden = !items.length;
    const focused = list.contains(document.activeElement)
      ? document.activeElement.closest(".mwn-file")?.dataset.id
      : null;
    list.replaceChildren(
      ...items.map((item) => {
        const row = document.createElement("li");
        row.className = "mwn-file";
        row.dataset.id = String(item.id);
        row.tabIndex = 0;
        row.setAttribute("aria-current", String(item.id === selectedId));
        row.setAttribute("aria-label", `${item.name}, ${statusLine(item)}`);
        if (item.source) row.title = `From ${item.source.modelName}`;
        row.innerHTML = `<span class="mwn-state mwn-${item.status}">${statusIcon(item)}</span>
          <span class="mwn-file-name"><b>${escapeHtml(item.name)}</b><small class="${item.status === "failed" ? "mwn-error" : ""}">${escapeHtml(statusLine(item))}</small></span>
          <button class="mwn-icon-btn" type="button" title="More" aria-label="More for ${escapeHtml(item.name)}" aria-haspopup="menu">${ICONS.more}</button>`;
        row.addEventListener("click", () => select(item.id));
        row.querySelector("button").addEventListener("click", (event) => {
          event.stopPropagation();
          openMenu(event.currentTarget, fileActions(item));
        });
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          select(item.id);
          openMenu({ x: event.clientX, y: event.clientY }, fileActions(item));
        });
        row.addEventListener("keydown", (event) => onRowKey(event, item));
        return row;
      }),
    );
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "mwn-list-empty";
      empty.textContent = "No files yet";
      list.append(empty);
    }
    if (focused) list.querySelector(`[data-id="${focused}"]`)?.focus();
  }

  function onRowKey(event, item) {
    if (event.target !== event.currentTarget) return;
    const index = items.indexOf(item);
    const go = (to) => {
      const target = items[Math.max(0, Math.min(items.length - 1, to))];
      if (!target) return;
      select(target.id);
      list.querySelector(`[data-id="${target.id}"]`)?.focus();
    };
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(items.length - 1);
    else if (event.key === "Enter" || event.key === " ") select(item.id);
    else if (event.key === "Delete" || event.key === "Backspace") remove(item);
    else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
      openMenu(event.currentTarget.querySelector("button"), fileActions(item));
    else return;
    event.preventDefault();
  }

  function select(id) {
    if (selectedId === id) return;
    selectedId = id;
    for (const row of list.querySelectorAll(".mwn-file"))
      row.setAttribute("aria-current", String(row.dataset.id === String(id)));
    renderDetail();
  }

  function remove(item) {
    if (item.status === "working") return ui.toast("It's being normalized: remove it once it's done", "info");
    const row = list.querySelector(`[data-id="${item.id}"]`);
    const index = items.indexOf(item);
    const finish = () => {
      items = items.filter((candidate) => candidate !== item);
      if (selectedId === item.id) {
        selectedId = (items[index] ?? items[index - 1])?.id ?? null;
        renderDetail();
      }
      renderList();
    };
    if (row && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      row.classList.add("mwn-leaving");
      row.addEventListener("animationend", finish, { once: true });
    } else finish();
  }

  function fileActions(item) {
    const actions = [];
    if (item.status === "done") {
      actions.push({ label: "Download", icon: ICONS.download, run: () => download(item) });
      if (item.source)
        actions.push({ label: `Add to ${item.source.modelName}`, icon: ICONS.add, run: () => save(item, "add") });
      actions.push({ label: "Save as a new model", icon: ICONS.save, run: () => save(item, "new") });
      if (item.saved)
        actions.push({ label: "Open in Thingport", icon: ICONS.open, run: () => models.open(item.saved.modelId) });
    }
    if (item.status === "failed") actions.push({ label: "Try again", icon: ICONS.retry, run: () => retry(item) });
    if (actions.length) actions.push("divider");
    actions.push({
      label: "Remove from the list",
      icon: ICONS.remove,
      danger: true,
      run: () => remove(item),
      disabled: item.status === "working",
    });
    return actions;
  }

  function retry(item) {
    Object.assign(item, { status: "queued", error: null });
    renderList();
    if (item.id === selectedId) renderDetail();
    void pump();
  }

  $("clear").addEventListener(
    "click",
    safely(async () => {
      const unsaved = items.filter((item) => item.status === "done" && !item.saved).length;
      if (unsaved) {
        const ok = await ui.confirm({
          title: "Clear the list?",
          message: `${plural(unsaved, "normalized file")} ${unsaved === 1 ? "hasn't" : "haven't"} been downloaded or saved from here. Clearing lets ${unsaved === 1 ? "it" : "them"} go.`,
        });
        if (!ok) return;
      }
      items = items.filter((item) => item.status === "working");
      selectedId = items[0]?.id ?? null;
      renderList();
      renderDetail();
    }),
  );
  $("downloadAll").addEventListener("click", async () => {
    const done = items.filter((item) => item.status === "done");
    for (const item of done) {
      download(item);
      // Browsers take a run of downloads better spaced out.
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  });

  // ---- sending files on --------------------------------------------------------------------------------------
  function download(item) {
    thingport.download({ name: outName(item.name), data: item.result.bytes, type: "model/3mf" });
  }

  function summary(item) {
    const { report } = item.result;
    const colours = (report.settings?.filament_colour ?? []).length;
    const settings = SETTINGS.filter(([key]) => report.settings?.[key] != null)
      .slice(0, 4)
      .map(([key, label, show]) => `${label.toLowerCase()} ${show(first(report.settings[key]))}`);
    return [
      `Normalized from ${item.name} so it opens in Cura, PrusaSlicer, Anycubic and other slicers as well as Bambu Studio.`,
      "",
      `Keeps ${plural(report.objects, "object")} on ${plural(report.plates || 1, "plate")}, ${plural(report.triangles, "triangle")}` +
        (report.paintColors ? `, ${plural(report.paintColors, "painted face")}` : "") +
        (colours ? ` and ${plural(colours, "filament colour")}` : "") +
        ".",
      settings.length ? `The designer's print settings come with it: ${settings.join(", ")}.` : "",
    ]
      .filter((line, i, lines) => line || lines[i + 1])
      .join("\n");
  }

  const save = safely(async (item, mode) => {
    const file = { name: outName(item.name), data: item.result.bytes, type: "model/3mf" };
    if (mode === "add") {
      await models.addFiles(item.source.modelId, [file]);
      item.saved = { modelId: item.source.modelId, name: item.source.modelName };
      ui.toast(`Added ${file.name} to ${item.source.modelName}`, "success");
    } else {
      const model = await models.create({
        name: baseName(item.name),
        description: summary(item),
        tags: ["3mf"],
        files: [file],
      });
      item.saved = { modelId: model.id, name: model.name };
      ui.toast(`Saved ${model.name}`, "success");
    }
    renderList();
    if (item.id === selectedId) renderDetail();
  });

  const addToCollection = safely(async (item) => {
    const collection = await ui.pickCollection({ title: `Add ${item.saved.name} to` });
    if (!collection) return;
    await thingport.collections.add(collection.id, [item.saved.modelId]);
    ui.toast(`Added to ${collection.name}`, "success");
  });

  // ---- the selected file -------------------------------------------------------------------------------------
  const detail = $("detail");

  function renderDetail() {
    const token = ++renderToken;
    preview?.dispose();
    preview = null;
    const item = selected();
    if (!item) return renderIntro();
    const head = (extra = "") =>
      `<div class="mwn-head"><h2 title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</h2>${extra}</div>`;
    if (item.status === "queued" || item.status === "working") {
      detail.innerHTML = `${head(`<span class="mwn-hint">${item.status === "working" ? "Normalizing…" : "Waiting its turn"}</span>`)}
        <div class="mwn-views" aria-hidden="true"><div class="mwn-skeleton" style="height:290px"></div><div class="mwn-skeleton" style="height:290px"></div></div>
        <div class="mwn-facts" aria-hidden="true"><div class="mwn-skeleton" style="height:150px"></div><div class="mwn-skeleton" style="height:150px"></div><div class="mwn-skeleton" style="height:150px"></div></div>`;
      return;
    }
    if (item.status === "failed") {
      detail.innerHTML = `${head()}
        <div class="mwn-problem" role="alert"><b>This file couldn't be normalized</b>${escapeHtml(item.error)}</div>
        <p class="mwn-hint" style="margin:0">A 3MF from Bambu Studio, Orca Slicer or MakerWorld is a ZIP with a 3D/3dmodel.model inside. A damaged or partly downloaded file won't open: download it again and try once more.</p>
        <div><button class="mwn-btn" type="button" id="mwn-retry">${ICONS.retry} Try again</button></div>`;
      $("retry").addEventListener("click", () => retry(item));
      return;
    }
    renderResult(item, token);
  }

  function renderIntro() {
    detail.innerHTML = `<div class="mwn-intro">
      <h2>Open MakerWorld models in any slicer</h2>
      <p>Bambu Studio's 3MF projects hide their parts in a way Cura, PrusaSlicer and others can't read. Drop one here and get a 3MF they open, with nothing lost.</p>
      <div class="mwn-flow"><span class="mwn-chip">Bambu Studio · MakerWorld</span><span aria-hidden="true">→</span>
        <span class="mwn-chip mwn-to">Cura</span><span class="mwn-chip mwn-to">PrusaSlicer</span><span class="mwn-chip mwn-to">Anycubic</span><span class="mwn-chip mwn-to">Orca</span></div>
      <div class="mwn-keeps">
        <div class="mwn-keep">${ICONS.palette}<b>Colours stay</b><span>Painted faces and every filament</span></div>
        <div class="mwn-keep">${ICONS.cube}<b>Assemblies stay</b><span>One object, plates as they were</span></div>
        <div class="mwn-keep">${ICONS.sliders}<b>Settings stay</b><span>Layers, walls, infill, supports</span></div>
      </div>
    </div>`;
  }

  function renderResult(item, token) {
    const { report } = item.result;
    const settings = report.settings ?? {};
    const filamentColours = settings.filament_colour ?? [];
    const filamentTypes = settings.filament_type ?? [];
    const swatches = (colours) =>
      `<span class="mwn-swatches">${colours.map((c) => `<span class="mwn-swatch" style="background:${cssColour(c)}"></span>`).join("")}</span>`;
    const kept = [
      ["Objects", report.objects.toLocaleString()],
      ["Plates", (report.plates || 1).toLocaleString()],
      ["Triangles", report.triangles.toLocaleString()],
      ["Painted faces", report.paintColors.toLocaleString()],
      ["Part files", report.flattened ? "Joined into one" : "Already one"],
      ["Size", `${size(item.size)} → ${size(item.result.bytes.length)}`],
    ];
    const shownSettings = SETTINGS.filter(([key]) => settings[key] != null && settings[key] !== "");
    const savedLine = item.saved
      ? `<div class="mwn-status" role="status">${ICONS.done} ${
          item.source && item.saved.modelId === item.source.modelId
            ? `Added to ${escapeHtml(item.saved.name)}.`
            : `Saved as ${escapeHtml(item.saved.name)}.`
        } <button class="mwn-link" type="button" id="mwn-open">Open it</button>${
          item.source && item.saved.modelId === item.source.modelId
            ? ""
            : '<button class="mwn-link" type="button" id="mwn-collect">Add to a collection</button>'
        }</div>`
      : "";

    detail.innerHTML = `<div class="mwn-head">
        <h2 title="${escapeHtml(item.name)}">${escapeHtml(outName(item.name))}</h2>
        <span class="mwn-spacer"></span>
        <button class="mwn-btn" type="button" id="mwn-download">${ICONS.download} Download</button>
        <button class="mwn-btn mwn-primary" type="button" id="mwn-save" ${item.source ? 'aria-haspopup="menu"' : ""}>${ICONS.save} Save to Thingport</button>
      </div>
      ${savedLine}
      <div class="mwn-views">
        <figure class="mwn-view"><figcaption>Original <span id="mwn-beforeMeta"></span></figcaption>
          <canvas id="mwn-before" tabindex="0" aria-label="The original file in 3D. Drag or use the arrow keys to turn it, the wheel or + and − to zoom, 0 to start again."></canvas></figure>
        <figure class="mwn-view"><figcaption>Normalized <span id="mwn-afterMeta"></span></figcaption>
          <canvas id="mwn-after" tabindex="0" aria-label="The normalized file in 3D. Drag or use the arrow keys to turn it, the wheel or + and − to zoom, 0 to start again."></canvas></figure>
      </div>
      <div class="mwn-facts">
        <div class="mwn-box"><h3>Kept</h3><dl class="mwn-dl">${kept.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl></div>
        <div class="mwn-box"><h3>Filaments</h3>${
          filamentColours.length
            ? `<div class="mwn-filaments">${filamentColours
                .map(
                  (c, i) =>
                    `<div class="mwn-filament"><span class="mwn-swatch" style="background:${cssColour(c)}"></span>${i + 1} · ${escapeHtml(filamentTypes[i] ?? "Filament")}<code>${escapeHtml(cssColour(c).toUpperCase())}</code></div>`,
                )
                .join("")}</div>`
            : '<p class="mwn-hint" style="margin:0">None named: your slicer\'s own filament applies.</p>'
        }</div>
        <div class="mwn-box"><h3>Print settings</h3>${
          shownSettings.length
            ? `<dl class="mwn-dl">${shownSettings.map(([key, label, show]) => `<dt>${label}</dt><dd>${escapeHtml(show(first(settings[key])))}</dd>`).join("")}</dl>`
            : '<p class="mwn-hint" style="margin:0">None in this file: your slicer\'s own apply.</p>'
        }</div>
      </div>
      <details class="mwn-log"><summary>${ICONS.chevron} What changed <span class="mwn-hint">${plural(item.log.length, "step")}</span></summary>
        <ol>${item.log.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol></details>`;

    $("download").addEventListener("click", () => download(item));
    const saveButton = $("save");
    saveButton.addEventListener("click", () => {
      if (!item.source) return void save(item, "new");
      openMenu(saveButton, [
        { label: `Add to ${item.source.modelName}`, icon: ICONS.add, run: () => save(item, "add") },
        { label: "Save as a new model", icon: ICONS.save, run: () => save(item, "new") },
      ]);
    });
    $("open")?.addEventListener("click", () => models.open(item.saved.modelId));
    $("collect")?.addEventListener("click", () => addToCollection(item));

    // The 3D views, once the page has laid them out.
    const canvases = [$("before"), $("after")];
    preview = createPreview(canvases);
    if (!preview) {
      for (const canvas of canvases)
        canvas.outerHTML =
          '<div class="mwn-view-note">3D preview needs WebGL, which this browser has turned off.</div>';
      return;
    }
    const views = preview;
    requestAnimationFrame(async () => {
      try {
        const shown = await Promise.all([
          sanitizer.extractPreviewMeshes(MiniZip, item.bytes),
          sanitizer.extractPreviewMeshes(MiniZip, item.result.bytes),
        ]);
        if (token !== renderToken) return;
        views.show(shown);
        shown.forEach((one, i) => {
          $(i ? "afterMeta" : "beforeMeta").innerHTML =
            `${plural(one.partCount, "part")} · ${plural(one.triangleCount, "triangle")} ${swatches(one.palette)}`;
        });
      } catch (err) {
        if (token !== renderToken) return;
        $("beforeMeta").textContent = `No preview: ${err?.message || err}`;
      }
    });
  }

  // ---- menus -------------------------------------------------------------------------------------------------
  const menu = $("menu");
  let menuReturn = null;
  function openMenu(anchor, entries) {
    closeMenu();
    menuReturn = anchor instanceof Element ? anchor : document.activeElement;
    menu.replaceChildren(
      ...entries.map((entry) => {
        if (entry === "divider") return document.createElement("hr");
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.tabIndex = -1;
        if (entry.danger) button.className = "mwn-danger";
        button.disabled = Boolean(entry.disabled);
        button.innerHTML = `${entry.icon}<span>${escapeHtml(entry.label)}</span>`;
        button.addEventListener("click", () => {
          closeMenu();
          entry.run();
        });
        return button;
      }),
    );
    menu.hidden = false;
    // Placed under the button that opened it, or where the pointer was, inside the window.
    const box = shell.getBoundingClientRect();
    const point =
      anchor instanceof Element
        ? (() => {
            const r = anchor.getBoundingClientRect();
            return { x: r.right - menu.offsetWidth, y: r.bottom + 4 };
          })()
        : anchor;
    const x = Math.max(8, Math.min(point.x - box.left, box.width - menu.offsetWidth - 8));
    const y = Math.max(8, Math.min(point.y - box.top, box.height - menu.offsetHeight - 8));
    menu.style.left = `${x}px`;
    menu.style.top = `${y + shell.scrollTop}px`;
    menu.querySelector("button:not(:disabled)")?.focus();
    setTimeout(() => document.addEventListener("pointerdown", onOutside, true));
  }
  function closeMenu({ restore = false } = {}) {
    if (menu.hidden) return;
    menu.hidden = true;
    document.removeEventListener("pointerdown", onOutside, true);
    if (restore) menuReturn?.focus?.();
  }
  const onOutside = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };
  menu.addEventListener("keydown", (event) => {
    const buttons = [...menu.querySelectorAll("button:not(:disabled)")];
    const at = buttons.indexOf(document.activeElement);
    const go = (i) => buttons[(i + buttons.length) % buttons.length]?.focus();
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(buttons.length - 1);
    else if (event.key === "Escape") closeMenu({ restore: true });
    else if (event.key === "Tab") closeMenu({ restore: true });
    else return;
    event.preventDefault();
    // Escape closes the menu, not the tool's window around it.
    event.stopPropagation();
  });

  // ---- the library picker ------------------------------------------------------------------------------------
  const picker = $("picker");
  const search = $("pickerSearch");
  const found = $("pickerList");
  let searchTimer = 0;
  let searchToken = 0;

  async function listLibrary(q) {
    const token = ++searchToken;
    found.innerHTML = '<li class="mwn-skeleton" style="height:56px"></li>'.repeat(4);
    try {
      const { models: page } = await models.list({ q: q || undefined, limit: 60 });
      if (token !== searchToken) return;
      const withFiles = page
        .map((model) => ({ model, files: model.files.filter((file) => isThreeMf(file.name)) }))
        .filter((entry) => entry.files.length);
      if (!withFiles.length) {
        found.innerHTML = `<li class="mwn-list-empty">${q ? `No 3MF files match “${escapeHtml(q)}”.` : "No models with a 3MF file yet."}</li>`;
        return;
      }
      found.replaceChildren(
        ...withFiles.map(({ model, files }) => {
          const row = document.createElement("li");
          row.className = "mwn-model";
          row.innerHTML = `${model.thumbnail ? `<img src="${escapeHtml(model.thumbnail)}" alt="" loading="lazy">` : '<span class="mwn-thumb"></span>'}
            <div><b>${escapeHtml(model.name)}</b><div class="mwn-model-files"></div></div>`;
          const buttons = row.querySelector(".mwn-model-files");
          for (const file of files) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `${file.name} · ${size(file.size)}`;
            button.setAttribute("aria-label", `Normalize ${file.name} from ${model.name}`);
            button.addEventListener("click", () => {
              closePicker();
              add([
                {
                  name: file.name,
                  size: file.size,
                  load: async () => new Uint8Array(await models.file(model.id, file.id)),
                  source: { modelId: model.id, modelName: model.name, fileId: file.id },
                },
              ]);
            });
            buttons.append(button);
          }
          return row;
        }),
      );
    } catch (err) {
      if (token === searchToken) found.innerHTML = `<li class="mwn-list-empty">${escapeHtml(err?.message || err)}</li>`;
    }
  }
  function openPicker() {
    picker.hidden = false;
    search.value = "";
    void listLibrary("");
    search.focus();
  }
  function closePicker() {
    picker.hidden = true;
    $("library").focus();
  }
  $("library").addEventListener("click", openPicker);
  $("pickerClose").addEventListener("click", closePicker);
  picker.addEventListener("click", (event) => {
    if (event.target === picker) closePicker();
  });
  picker.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
    }
  });
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void listLibrary(search.value.trim()), 250);
  });

  renderList();
  renderDetail();

  return () => {
    closed = true;
    closeMenu();
    clearTimeout(searchTimer);
    preview?.dispose();
    shell.removeEventListener("dragenter", onDragEnter);
    shell.removeEventListener("dragover", onDragOver);
    shell.removeEventListener("dragleave", onDragLeave);
    shell.removeEventListener("drop", onDrop);
  };
}
