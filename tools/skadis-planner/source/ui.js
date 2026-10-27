// The tool's window: the wall on the left, the plan in the middle, what to print on the right.
//
// The plan is worked out again whenever a field changes — it costs microseconds — and the canvas is redrawn from
// it. Nothing is fetched and nothing leaves the browser except what you ask to be saved.

import {
  BOARD_DESIGN,
  MOUNT_SYSTEMS,
  PRINTERS,
  boardKey,
  getMountSystem,
  getPrinter,
  holesFor,
  sizeMm,
} from "./catalogue.js";
import { PlanError, STRATEGIES, getStrategy, planWall } from "./solver.js";
import { hardwareMarkers } from "./mounting.js";
import { describePlan, partListText, planTitle, printOrder, toBuy } from "./printlist.js";
import { partFiles } from "./parts3mf.js";
import { drawMeasurements, drawPlan, fit, planImage } from "./plan2d.js";

const MM_PER_INCH = 25.4;
const PROJECT_LIMIT = 60;

const escapeHtml = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

const icon = (path) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const ICONS = {
  open: icon('<path d="M14 3h7v7m0-7L10 14M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>'),
  remove: icon('<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6"/>'),
  copy: icon('<path d="M9 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Zm6-6H5a2 2 0 0 0-2 2v10"/>'),
};

const clean = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const round1 = (value) => Math.round(value * 10) / 10;

/** The form as it starts: a wall most people would recognise, on the commonest bed. */
const START = {
  widthMm: 820,
  heightMm: 860,
  units: "mm",
  printerId: "a1",
  bedX: 256,
  bedY: 256,
  strategyId: "balanced",
  mountId: "wall-mounts",
  wallMm: 10,
  maxGapMm: 40,
};

export default async function mount(thingport) {
  const { root, theme, models, storage, ui, download, collections, t, labels } = thingport;
  const shell = root.querySelector(".skp");
  const $ = (id) => root.querySelector(`#skp-${id}`);

  const dark = theme.mode === "dark";
  for (const [name, value] of Object.entries({
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
  })) {
    shell.style.setProperty(`--${name}`, value);
  }

  /** The colours the plan is drawn in, from the theme. */
  const paint = {
    background: theme.paper,
    gap: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
    outline: theme.textSecondary,
    board: dark ? "#3f4a74" : "#dbe3f1",
    boardMirrored: dark ? "#4a4270" : "#e6ddf2",
    boardEdge: dark ? "#6b77a6" : "#9fb0cc",
    slot: dark ? "rgba(10,14,28,0.55)" : "rgba(40,55,85,0.22)",
    label: theme.text,
    mount: theme.warning,
    mountStrong: theme.primary,
    mountEdge: dark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.75)",
    dimension: theme.textSecondary,
    font: theme.fontFamily,
  };

  let form = { ...START };
  let projects = [];
  let brought = [];
  let closed = false;
  let plan = null;
  let markers = [];
  let planError = null;
  let view = { scale: 1, x: 0, y: 0 };
  let userView = false;
  let showMounts = true;
  let showMeasurements = true;

  const safely =
    (fn) =>
    async (...args) => {
      try {
        await fn(...args);
      } catch (error) {
        if (!closed) ui.toast(error?.message || String(error), "error");
      }
    };

  /* ------------------------------------------------------------- storage */

  try {
    const kept = await storage.get("form");
    if (kept && typeof kept === "object") form = { ...START, ...kept };
    const keptProjects = await storage.get("projects");
    if (Array.isArray(keptProjects)) projects = keptProjects;
  } catch {
    // A tool being previewed before it's saved keeps nothing; the defaults do.
  }
  try {
    brought = await thingport.toolModels();
  } catch {
    brought = [];
  }

  let formTimer = 0;
  const keepForm = () => {
    clearTimeout(formTimer);
    formTimer = setTimeout(() => storage.set("form", form).catch(() => {}), 600);
  };
  const keepProjects = () => storage.set("projects", projects.slice(0, PROJECT_LIMIT)).catch(() => {});

  /** The model this tool brought under that key, once Thingport has fetched it. */
  const broughtModel = (key) => brought.find((entry) => entry.key === key) ?? null;

  /* ---------------------------------------------------------- the plan */

  const printer = () => getPrinter(form.printerId, { x: clean(form.bedX, 256), y: clean(form.bedY, 256) });
  const system = () => getMountSystem(form.mountId);
  const strategy = () => getStrategy(form.strategyId);
  const context = () => ({ printer: printer(), system: system(), wallMm: form.wallMm, strategy: strategy(), t });

  function replan() {
    planError = null;
    try {
      plan = planWall({
        widthMm: clean(form.widthMm, 0),
        heightMm: clean(form.heightMm, 0),
        printer: printer(),
        strategyId: form.strategyId,
        maxGapMm: clean(form.maxGapMm, 40),
      });
      markers = hardwareMarkers(plan, system());
    } catch (error) {
      plan = null;
      markers = [];
      planError = error instanceof PlanError ? error.message : (error?.message ?? String(error));
    }
  }

  /* ------------------------------------------------------------ the form */

  const toMm = (value) => (form.units === "in" ? value * MM_PER_INCH : value);
  const fromMm = (value) => (form.units === "in" ? round1(value / MM_PER_INCH) : Math.round(value));

  function renderForm() {
    const into = $("form-body");
    const distances = system().distances;
    if (!distances.includes(form.wallMm)) form.wallMm = distances[0];
    const unit = form.units === "in" ? "in" : "mm";
    const custom = form.printerId === "custom";
    const bed = printer();

    into.innerHTML = `
      <div class="skp-group">
        <h3>${escapeHtml(t("form.theWall"))} <button type="button" class="skp-help" title="${escapeHtml(t("form.spaceHelp"))}">?</button></h3>
        <div class="skp-fields">
          <label class="skp-field"><span>${escapeHtml(t("form.width"))}</span><div class="skp-in"><input id="skp-width" type="number" min="1" step="${unit === "in" ? "0.1" : "10"}" value="${fromMm(form.widthMm)}"><i>${unit}</i></div></label>
          <label class="skp-field"><span>${escapeHtml(t("form.height"))}</span><div class="skp-in"><input id="skp-height" type="number" min="1" step="${unit === "in" ? "0.1" : "10"}" value="${fromMm(form.heightMm)}"><i>${unit}</i></div></label>
        </div>
        <div class="skp-seg" role="group" aria-label="${escapeHtml(t("form.units"))}">
          <button type="button" data-units="mm" aria-pressed="${form.units === "mm"}">mm</button>
          <button type="button" data-units="in" aria-pressed="${form.units === "in"}">inches</button>
        </div>
      </div>

      <div class="skp-group">
        <h3>${escapeHtml(t("form.printer"))} <button type="button" class="skp-help" title="${escapeHtml(t("form.printerHelp"))}">?</button></h3>
        <div class="skp-in"><select id="skp-printer" aria-label="${escapeHtml(t("form.printer"))}">
          ${PRINTERS.map((p) => `<option value="${p.id}"${p.id === form.printerId ? " selected" : ""}>${escapeHtml(t(p.name))}${p.id === "custom" ? "" : ` — ${p.x} × ${p.y}`}</option>`).join("")}
        </select></div>
        ${
          custom
            ? `<div class="skp-fields">
                 <label class="skp-field"><span>${escapeHtml(t("form.bedWidth"))}</span><div class="skp-in"><input id="skp-bedx" type="number" min="60" step="5" value="${clean(form.bedX, 256)}"><i>mm</i></div></label>
                 <label class="skp-field"><span>${escapeHtml(t("form.bedDepth"))}</span><div class="skp-in"><input id="skp-bedy" type="number" min="60" step="5" value="${clean(form.bedY, 256)}"><i>mm</i></div></label>
               </div>`
            : ""
        }
        <p class="skp-note">${escapeHtml(t("form.largestBoard"))} <b>${holesFor(Math.min(bed.x, bed.y)) >= 2 ? escapeHtml(t("form.boardSize", { cols: Math.min(15, holesFor(bed.x)), rows: Math.min(15, holesFor(bed.y)), width: sizeMm(Math.min(15, holesFor(bed.x))), height: sizeMm(Math.min(15, holesFor(bed.y))) })) : escapeHtml(t("form.bedTooSmall"))}</b></p>
      </div>

      <div class="skp-group">
        <h3>${escapeHtml(t("form.layout"))}</h3>
        <div class="skp-in"><select id="skp-strategy" aria-label="${escapeHtml(t("form.layout"))}">
          ${STRATEGIES.map((s) => `<option value="${s.id}"${s.id === form.strategyId ? " selected" : ""}>${escapeHtml(t(s.name))}</option>`).join("")}
        </select></div>
        <p class="skp-note">${escapeHtml(t(strategy().summary))}</p>
        ${
          form.strategyId === "gap"
            ? `<label class="skp-field"><span>${escapeHtml(t("form.gapAllowed"))}</span><div class="skp-in"><input id="skp-gap" type="number" min="0" step="20" value="${clean(form.maxGapMm, 40)}"><i>mm</i></div></label>`
            : ""
        }
      </div>

      <div class="skp-group">
        <h3>${escapeHtml(t("form.mounting"))}</h3>
        <div class="skp-seg" role="group" aria-label="${escapeHtml(t("form.heldBy"))}">
          ${MOUNT_SYSTEMS.map((s) => `<button type="button" data-mount="${s.id}" aria-pressed="${s.id === form.mountId}">${escapeHtml(t(s.name))}</button>`).join("")}
        </div>
        <p class="skp-note">${escapeHtml(t(system().summary))}</p>
        <span class="skp-label">${escapeHtml(t("form.offTheWall"))}</span>
        <div class="skp-seg" role="group" aria-label="${escapeHtml(t("form.distance"))}">
          ${distances.map((mm) => `<button type="button" data-wall="${mm}" aria-pressed="${mm === form.wallMm}">${mm} mm</button>`).join("")}
        </div>
      </div>`;

    const number = (id, key, { asMm = false, min = 0 } = {}) => {
      const input = $(id);
      if (!input) return;
      input.addEventListener("change", () => {
        const value = Math.max(min, clean(input.value, 0));
        form[key] = asMm ? toMm(value) : value;
        userView = false;
        update();
      });
    };
    number("width", "widthMm", { asMm: true, min: 1 });
    number("height", "heightMm", { asMm: true, min: 1 });
    number("bedx", "bedX", { min: 60 });
    number("bedy", "bedY", { min: 60 });
    number("gap", "maxGapMm");

    $("printer").addEventListener("change", (event) => {
      form.printerId = event.target.value;
      const picked = PRINTERS.find((p) => p.id === form.printerId);
      if (picked && picked.id !== "custom") {
        form.bedX = picked.x;
        form.bedY = picked.y;
      }
      update();
    });
    $("strategy").addEventListener("change", (event) => {
      form.strategyId = event.target.value;
      update();
    });
    for (const button of into.querySelectorAll("[data-units]")) {
      button.addEventListener("click", () => {
        form.units = button.dataset.units;
        update();
      });
    }
    for (const button of into.querySelectorAll("[data-mount]")) {
      button.addEventListener("click", () => {
        form.mountId = button.dataset.mount;
        update();
      });
    }
    for (const button of into.querySelectorAll("[data-wall]")) {
      button.addEventListener("click", () => {
        form.wallMm = Number(button.dataset.wall);
        update();
      });
    }
  }

  /* ---------------------------------------------------------- the canvas */

  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const box = canvas.parentElement.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width, height };
  }

  function drawCanvas() {
    const { width, height } = resizeCanvas();
    ctx.clearRect(0, 0, width, height);
    if (!plan) return;
    if (!userView) view = fit(plan, width, height, showMeasurements ? 52 : 28);
    drawPlan(ctx, { plan, markers, view, colours: paint, width, height, showMounts });
    if (showMeasurements) drawMeasurements(ctx, { plan, view, colours: paint });
  }

  let dragging = null;
  const onPointerDown = (event) => {
    if (event.button !== 0 || !plan) return;
    canvas.setPointerCapture(event.pointerId);
    dragging = { x: event.clientX, y: event.clientY };
    canvas.style.cursor = "grabbing";
  };
  const onPointerMove = (event) => {
    if (!dragging) return;
    view = { ...view, x: view.x + (event.clientX - dragging.x), y: view.y + (event.clientY - dragging.y) };
    dragging = { x: event.clientX, y: event.clientY };
    userView = true;
    drawCanvas();
  };
  const onPointerUp = () => {
    dragging = null;
    canvas.style.cursor = "";
  };
  const zoomBy = (factor, around) => {
    if (!plan) return;
    const next = Math.max(0.08, Math.min(8, view.scale * factor));
    const box = canvas.getBoundingClientRect();
    const px = around ? around.clientX - box.left : box.width / 2;
    const py = around ? around.clientY - box.top : box.height / 2;
    // Keep whatever is under the pointer where it is.
    view = {
      scale: next,
      x: px - ((px - view.x) * next) / view.scale,
      y: py - ((py - view.y) * next) / view.scale,
    };
    userView = true;
    drawCanvas();
  };
  const onWheel = (event) => {
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? 1 / 1.12 : 1.12, event);
  };
  const onCanvasKey = (event) => {
    const steps = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] };
    if (steps[event.key]) {
      view = { ...view, x: view.x + steps[event.key][0], y: view.y + steps[event.key][1] };
      userView = true;
      drawCanvas();
    } else if (event.key === "+" || event.key === "=") zoomBy(1.12);
    else if (event.key === "-" || event.key === "_") zoomBy(1 / 1.12);
    else if (event.key === "0" || event.key === "Home") {
      userView = false;
      drawCanvas();
    } else return;
    event.preventDefault();
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onCanvasKey);
  canvas.addEventListener("dblclick", () => {
    userView = false;
    drawCanvas();
  });

  /* ------------------------------------------------------- the print list */

  function renderList() {
    const into = $("list-body");
    if (!plan) {
      into.innerHTML = `<div class="skp-note skp-note-bad">${escapeHtml(planError ?? t("ui.nothingToPlan"))}</div>`;
      return;
    }
    const steps = printOrder(plan, system(), form.wallMm, t);
    const buy = toBuy(plan, system());
    const parts = steps.reduce((total, step) => total + step.count, 0);

    const stepRow = (step) => {
      const model = step.modelKey ? broughtModel(step.modelKey) : null;
      const where = model?.printId
        ? `<button type="button" class="skp-link" data-open="${escapeHtml(model.printId)}">${escapeHtml(t("plan.inYourLibrary"))} ${ICONS.open}</button>`
        : step.modelKey
          ? `<span class="skp-dim">${escapeHtml(t("plan.notFetched"))}</span>`
          : "";
      return `<li class="skp-step${step.missing ? " skp-step-bad" : ""}">
        <span class="skp-step-n">${step.step}</span>
        <div>
          <b>${escapeHtml(step.name)}</b>
          <span class="skp-count">× ${step.count}</span>
          ${step.mirror ? `<span class="skp-flag" title="${escapeHtml(t("plan.flipNote"))}">⇄ ${escapeHtml(step.mirror)}</span>` : ""}
          <div class="skp-dim">${escapeHtml(step.detail)}${step.file ? ` · <code>${escapeHtml(step.file)}</code>` : ""}${step.turned ? " · a quarter turn round" : ""}</div>
          ${step.missing ? `<div class="skp-bad">${escapeHtml(t("plan.notPublished"))}</div>` : ""}
          ${where}
        </div>
      </li>`;
    };

    into.innerHTML = `
      <ol class="skp-steps">${steps.map(stepRow).join("")}</ol>
      <div class="skp-total"><span>${escapeHtml(t("plan.partsToPrint", { parts }))}</span><b>${escapeHtml(t("plan.boardsCount", { boards: plan.boards.length }))}</b></div>
      ${
        buy.length
          ? `<h3 class="skp-sub">${escapeHtml(t("plan.buy"))}</h3><ul class="skp-buy">${buy
              .map((item) => `<li><b>${item.count} ×</b> ${escapeHtml(t(item.name))}</li>`)
              .join("")}</ul>`
          : ""
      }
      <p class="skp-credit">${escapeHtml(t("plan.credit", { author: BOARD_DESIGN.author.name }))}</p>`;

    for (const button of into.querySelectorAll("[data-open]")) {
      button.addEventListener("click", () => models.open(button.dataset.open));
    }
  }

  function renderStatus() {
    const status = $("status");
    if (!plan) {
      status.textContent = "";
      $("summary").hidden = true;
      return;
    }
    const left =
      plan.leftoverWidthMm || plan.leftoverHeightMm
        ? ` · ${t("plan.leftOver", { across: Math.round(plan.leftoverWidthMm), down: Math.round(plan.leftoverHeightMm) })}`
        : ` · ${t("plan.wholeWall")}`;
    status.textContent = `${t("plan.covered", { width: Math.round(plan.coveredWidthMm), height: Math.round(plan.coveredHeightMm) })}${left}`;
    const summary = $("summary");
    summary.hidden = false;
    summary.innerHTML = `<b>${plan.boards.length}</b><span>${escapeHtml(t("plan.boardsWord"))}</span><span>·</span><b>${plan.columns.length} × ${plan.rows.length}</b>`;
  }

  function update() {
    replan();
    renderForm();
    renderList();
    renderStatus();
    drawCanvas();
    keepForm();
    const ready = Boolean(plan);
    $("save").disabled = !ready;
    $("parts").disabled = !ready;
    $("stage-note").hidden = ready;
    if (!ready) $("stage-note").textContent = planError ?? "";
  }

  /* ----------------------------------------------------------- the sheets */

  const sheets = {};
  function sheet(name, onOpen) {
    const element = $(name);
    sheets[name] = {
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

  /* ---- projects ---- */

  function renderProjects() {
    const list = $("projects-list");
    if (!projects.length) {
      list.innerHTML = `<li class="skp-empty">${escapeHtml(t("plans.empty"))}</li>`;
      return;
    }
    list.replaceChildren(
      ...projects.map((project) => {
        const row = document.createElement("li");
        row.innerHTML = `<div><b>${escapeHtml(project.name)}</b><div class="skp-dim">${escapeHtml(project.summary)} · ${escapeHtml(project.at.slice(0, 10))}</div></div><div class="skp-row-actions"></div>`;
        const actions = row.querySelector(".skp-row-actions");
        const button = (label, html, run, danger) => {
          const element = document.createElement("button");
          element.type = "button";
          element.className = `skp-btn skp-icon${danger ? " skp-danger" : ""}`;
          element.title = label;
          element.setAttribute("aria-label", `${label}: ${project.name}`);
          element.innerHTML = html;
          element.addEventListener("click", safely(run));
          actions.append(element);
        };
        button(t("plans.open"), ICONS.open, () => {
          form = { ...START, ...project.form };
          userView = false;
          sheets.projects.close();
          update();
          ui.toast(`Opened “${project.name}”`, "success");
        });
        button(t("plans.duplicate"), ICONS.copy, async () => {
          projects.unshift({
            ...project,
            id: `${Date.now()}`,
            name: `${project.name} copy`,
            at: new Date().toISOString(),
          });
          projects = projects.slice(0, PROJECT_LIMIT);
          await keepProjects();
          renderProjects();
        });
        button(
          t("plans.delete"),
          ICONS.remove,
          async () => {
            const yes = await ui.confirm({
              title: t("plans.deleteTitle"),
              message: `“${project.name}” goes from the tool. Anything you saved to your library stays.`,
              confirmLabel: t("plans.delete"),
              destructive: true,
            });
            if (!yes) return;
            projects = projects.filter((other) => other.id !== project.id);
            await keepProjects();
            renderProjects();
          },
          true,
        );
        return row;
      }),
    );
  }

  const saveProject = safely(async () => {
    if (!plan) return;
    const name = $("project-name").value.trim() || planTitle(plan, t);
    projects.unshift({
      id: `${Date.now()}`,
      name,
      at: new Date().toISOString(),
      summary: `${plan.boards.length} boards, ${Math.round(plan.widthMm)} × ${Math.round(plan.heightMm)} mm`,
      form: { ...form },
    });
    projects = projects.slice(0, PROJECT_LIMIT);
    await keepProjects();
    $("project-name").value = "";
    renderProjects();
    ui.toast(t("plans.savedInTool"), "success");
  });

  /* ---- saving to the library ---- */

  const saveToThingport = safely(async () => {
    if (!plan) return;
    const name = $("save-name").value.trim() || planTitle(plan, t);
    const intoCollection = $("save-collect").checked;
    const button = $("save-go");
    button.disabled = true;
    button.textContent = t("save.saving");
    try {
      let collectionId;
      if (intoCollection) {
        const picked = await collections.pick({ title: t("save.pickCollection") });
        if (!picked) return;
        collectionId = picked.id;
      }
      // One plate per part, in print order, rather than the whole wall in one file: the library then holds the
      // plan the way it holds any multi-plate model, a plate for each thing there is to print.
      const parts = partFiles(printOrder(plan, system(), form.wallMm, t), { wallMm: form.wallMm });
      const description = describePlan(plan, context());
      const model = await models.create({
        name,
        description,
        tags: ["skadis", "plan"],
        collectionId,
        files: parts.map((part) => ({ name: part.name, data: part.data.slice().buffer })),
      });
      // The picture of the plan becomes its cover, in place of a render of plain slabs.
      try {
        const picture = await planImage(plan, { markers, colours: paint });
        if (picture) await models.addImages(model.id, [{ name: `${slug(name)}.png`, data: picture }]);
      } catch {
        // A model without its picture is still the plan; the render stands in.
      }
      sheets["save-sheet"].close();
      ui.toast(`Saved “${name}” to your library`, "success");
      const yes = await ui.confirm({
        title: t("plans.openTitle"),
        message: t("plans.openBody"),
        confirmLabel: t("plans.open"),
      });
      if (yes) models.open(model.id);
    } finally {
      button.disabled = false;
      button.textContent = t("plans.save");
    }
  });

  const slug = (text) =>
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "skadis-wall";

  const downloadParts = () => {
    if (!plan) return;
    download({
      name: `${slug(planTitle(plan, t))}-part-list.txt`,
      data: partListText(plan, context()),
      type: "text/plain",
    });
  };

  /* ------------------------------------------------------------- wiring */

  $("save").addEventListener("click", () => {
    if (!plan) return;
    $("save-name").value = planTitle(plan, t);
    sheets["save-sheet"].open();
    $("save-name").focus();
  });
  $("parts").addEventListener("click", downloadParts);
  $("projects-open").addEventListener("click", () => sheets.projects.open());

  sheet("projects", renderProjects);
  sheet("save-sheet");
  $("projects-close").addEventListener("click", () => sheets.projects.close());
  $("save-close").addEventListener("click", () => sheets["save-sheet"].close());
  $("save-go").addEventListener("click", saveToThingport);
  $("project-save").addEventListener("click", saveProject);

  $("fit").addEventListener("click", () => {
    userView = false;
    drawCanvas();
  });
  $("zoom-in").addEventListener("click", () => zoomBy(1.2));
  $("zoom-out").addEventListener("click", () => zoomBy(1 / 1.2));
  const toggle = (id, get, set) => {
    const button = $(id);
    button.setAttribute("aria-pressed", String(get()));
    button.classList.toggle("skp-btn-on", get());
    button.addEventListener("click", () => {
      set(!get());
      button.setAttribute("aria-pressed", String(get()));
      button.classList.toggle("skp-btn-on", get());
      drawCanvas();
    });
  };
  toggle(
    "mounts",
    () => showMounts,
    (value) => {
      showMounts = value;
    },
  );
  toggle(
    "measure",
    () => showMeasurements,
    (value) => {
      showMeasurements = value;
    },
  );

  const stopResize = thingport.onResize(() => drawCanvas());
  // The window's own words, before the first render.
  labels();
  update();

  return () => {
    closed = true;
    clearTimeout(formTimer);
    stopResize?.();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("keydown", onCanvasKey);
  };
}
