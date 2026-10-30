// The tool's window: the settings on the left, the code on the right.
//
// Every change takes a snapshot for undo, then queues a build. A build is the symbol, the plan and the meshes —
// quick, but not free on a big code — so it is debounced, and the last good picture stays on screen while the
// next one is worked out. A build that can't be done says what to change rather than clearing the view.
//
// Three views share the stage: the tile in three dimensions, the same thing flat, and the code as a reader sees
// it, which is the one to point a phone at before printing anything.
//
// Nothing is fetched and nothing leaves the browser except what you ask to be saved. The words come from
// locales/<code>.json, which Thingport reads and hands over as `t()`.

import { LEVELS, LEVEL_RECOVERY, MAX_VERSION, capacity, smallestVersion } from "./qr.js";
import { DEFAULT_CONTENT, FIELDS, KINDS, carriesSecret, missing, nameFor } from "./content.js";
import { DEFAULTS, QUIET, TAB_SIDES } from "./layout.js";
import {
  BODIES,
  EYE_CENTRES,
  EYE_FRAMES,
  RELIEFS,
  eyeRings,
  moduleAngles,
  moduleRing,
  reliefHeight,
  reliefLevels,
} from "./shapes.js";
import { NOZZLE_MM, buildModel, contrastRatio } from "./model.js";
import { drawPlan, scanImage } from "./scan.js";
import { projectFile, readProject, stl, threeMf } from "./files.js";
import { shapeBounds, shapesFromSvg } from "./outline.js";
import { createViewer } from "./viewer.js";

/** What each number control runs between, and what one notch of its slider is. Millimetres unless said. */
const RANGES = {
  moduleMm: [0.4, 10, 0.05],
  plateMm: [20, 300, 1],
  baseMm: [0.4, 10, 0.1],
  codeMm: [0.2, 6, 0.1],
  inlayMm: [0.2, 3, 0.1],
  cornerMm: [0, 20, 0.5],
  borderMm: [0.6, 20, 0.5],
  borderHeightMm: [0.2, 8, 0.1],
  borderCornerMm: [0, 20, 0.5],
  tabMm: [5, 60, 0.5],
  holeMm: [1.6, 20, 0.5],
  tabOffset: [-100, 100, 1],
  fill: [60, 115, 1],
  captionSize: [2, 20, 0.5],
  captionRaise: [0.2, 4, 0.1],
  patchAcross: [3, 25, 1],
  patchScale: [20, 100, 1],
  patchRaise: [0.2, 4, 0.1],
};

/** A build quicker than this needs no spinner: showing one would be a flash, not a wait. */
const QUICK_MS = 120;

/** The reliefs that stand the modules at different heights, where the height asked for is the tallest of them. */
const ACROSS_THE_CODE = new Set(["ripple", "ramp", "terraces", "saddle"]);

/** The settings panels, in the order the chooser lists them. */
const SECTIONS = ["content", "shape", "style", "colour", "extras", "check"];

/** Which warnings are worth stopping for, and which are only worth knowing. */
const BAD = new Set(["moduleTiny", "noQuietZone", "sameColourFlush", "patchTooBig", "biggerThanBed", "captionNoFont"]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value, places = 2) => Number(value.toFixed(places));
const escapeHtml = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

export default async function mount(thingport) {
  const { root, theme, t, labels, size, onResize, storage, models, collections, ui, download, library, tool } =
    thingport;
  const shell = root.querySelector("#qrg-shell");
  const $ = (id) => root.querySelector(`#qrg-${id}`);

  for (const [name, value] of Object.entries({
    bg: theme.background,
    panel: theme.paper,
    divider: theme.divider,
    text: theme.text,
    muted: theme.textSecondary,
    accent: theme.primary,
    // What reads on the accent, which Thingport picks per accent colour: white for most, dark for the light ones.
    "accent-ink": theme.primaryContrast ?? "#ffffff",
    danger: theme.error,
    warning: theme.warning,
    success: theme.success,
    font: theme.fontFamily,
  })) {
    shell.style.setProperty(`--${name}`, value);
  }
  labels();

  // ---- what the window is showing ------------------------------------------------------------------------------

  let state = { ...clone(DEFAULTS), content: clone(DEFAULT_CONTENT) };
  let model = null; // the last build that worked
  let lastBuild = Infinity; // how long the last one took, which says whether this one needs a spinner
  let fresh = false;
  let failure = null;
  let busy = false;
  let section = "content";
  let stage = "solid";
  let fonts = null;
  let font = null;
  let logo = null; // { shapes, bounds, name, svg }
  let picked = null;
  let revision = 0;
  let timer = 0;
  let dead = false;
  let onBuilt = null;
  const past = [];
  const future = [];

  const viewer = createViewer(await library("three"), $("canvas"), {
    onPick: (pick) => {
      picked = pick;
      showReadout();
    },
  });
  if (!viewer) stage = "flat";

  // ---- keeping and undoing -------------------------------------------------------------------------------------

  const KEY = "qr";
  const persist = () => {
    // The uploaded logo goes with the settings where it is small enough to be worth keeping.
    const keep = {
      state,
      section,
      stage,
      logo: logo?.svg && logo.svg.length < 150000 ? { name: logo.name, svg: logo.svg } : null,
    };
    storage.set(KEY, keep).catch(() => {}); // a full store shouldn't stop the tool
  };
  const checkpoint = () => {
    past.push(clone(state));
    if (past.length > 40) past.shift();
    future.length = 0;
    syncHistory();
  };
  const syncHistory = () => {
    $("undo").disabled = !past.length;
    $("redo").disabled = !future.length;
  };
  const step = (from, to) => {
    const snapshot = from.pop();
    if (!snapshot) return;
    to.push(clone(state));
    state = snapshot;
    syncHistory();
    renderAll();
    queue(0);
  };

  // ---- the build -----------------------------------------------------------------------------------------------

  const setState = (name, text) => {
    const pill = $("state");
    pill.dataset.state = name;
    pill.textContent = text;
  };
  const showBusy = (on, text = t("state.working")) => {
    busy = on;
    $("busy").hidden = !on;
    $("busy-text").textContent = text;
  };

  const queue = (delay = 200) => {
    fresh = false;
    persist();
    clearTimeout(timer);
    timer = setTimeout(build, delay);
  };

  /** A refusal in the user's own language, falling back to the English it came with. */
  const reason = (error) => (error?.code ? t(`error.${error.code}`, error.vars) : error?.message || String(error));

  function stop(text) {
    failure = text;
    fresh = false;
    $("stop-text").textContent = text;
    $("stop").hidden = false;
    setState("error", t("state.checkSettings"));
  }

  async function build() {
    if (dead) return;
    const mine = ++revision;
    const gap = missing(state.content);
    if (gap) {
      model = null;
      viewer?.clear();
      stop(t(`content.${gap}`));
      showChips(null);
      onBuilt?.();
      return;
    }
    if (state.caption.text.trim() && !font) await useFont(state.caption.fontId);
    if (mine !== revision || dead) return;

    const doing = model ? t("state.working") : t("state.buildingFirst");
    setState("working", doing);
    // A code that built quickly last time builds quickly this time: showing a spinner for it would be a flash of
    // one, which reads as the window reloading rather than the tile changing.
    const slow = !model || lastBuild > QUICK_MS;
    if (slow) {
      showBusy(true, doing);
      await new Promise((resolve) => requestAnimationFrame(resolve)); // let the spinner paint
      if (mine !== revision || dead) return;
    }
    try {
      const began = performance.now();
      const built = buildModel(state, { font, logo });
      lastBuild = performance.now() - began;
      if (mine !== revision || dead) return;
      model = built;
      failure = null;
      fresh = true;
      $("stop").hidden = true;
      show();
      const bad = built.warnings.some((warning) => BAD.has(warning.code));
      setState(bad ? "error" : "ready", bad ? t("state.readyButCheck") : t("state.ready"));
      persist();
      onBuilt?.();
    } catch (error) {
      if (mine !== revision || dead) return;
      model = null;
      viewer?.clear();
      stop(reason(error));
      showChips(null);
      onBuilt?.();
    } finally {
      if (mine === revision && !dead && slow) showBusy(false);
    }
  }

  // ---- drawing it ----------------------------------------------------------------------------------------------

  function show(fit = true) {
    if (!model) return;
    if (stage === "solid") viewer?.show(model.parts, { fit });
    drawStage();
    showChips(model);
    showReadout();
    if (section === "check") renderSheet();
  }

  function showChips(current) {
    if (!current) {
      $("dims").innerHTML = "<b>—</b>";
      $("code").innerHTML = "<b>—</b>";
      $("filaments").innerHTML = "<b>—</b>";
      return;
    }
    const { width, height, thickness, cell } = current.size;
    $("dims").innerHTML = `<b>${width.toFixed(1)} × ${height.toFixed(1)} × ${thickness.toFixed(1)}</b> mm`;
    $("code").innerHTML = `<b>v${current.code.version}</b> · ${current.code.level} · ${cell.toFixed(2)} mm`;
    const count = current.filaments.length;
    $("filaments").innerHTML = `<b>${count}</b> ${count === 1 ? t("bar.filament") : t("bar.filaments")}`;
  }

  /** What the chosen part is, and anything worth saying, over the picture. */
  function showReadout() {
    const host = $("readout");
    const bits = [];
    if (model) {
      if (picked && stage === "solid") {
        bits.push(
          `<span class="qrg-chip">${escapeHtml(t(`part.${picked.kind}`))} · <b>${escapeHtml(t("bar.slot", { n: picked.slot + 1 }))}</b></span>`,
        );
      }
      for (const warning of model.warnings.slice(0, 2)) {
        bits.push(
          `<span class="qrg-chip">${BAD.has(warning.code) ? "⚠" : "·"} ${escapeHtml(t(`check.${warning.code}`, warning.vars))}</span>`,
        );
      }
    }
    host.innerHTML = bits.join("");
    host.hidden = !bits.length;
  }

  function drawStage() {
    $("canvas").hidden = stage !== "solid";
    $("turn").hidden = stage !== "solid";
    $("flat-wrap").hidden = stage !== "flat";
    $("scan-wrap").hidden = stage !== "scan";
    if (!model) return;
    if (stage === "flat") {
      const canvas = $("flat");
      const box = $("flat-wrap").getBoundingClientRect();
      const side = Math.max(160, Math.min(box.width, box.height) - 16);
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(side * ratio);
      canvas.height = Math.round(side * ratio);
      canvas.style.width = `${side}px`;
      canvas.style.height = `${side}px`;
      drawPlan(
        canvas.getContext("2d"),
        model.plan,
        { ...state, captionFontFamily: theme.fontFamily },
        {
          colours: state.colours,
          background: theme.background,
        },
      );
    } else if (stage === "scan") {
      const source = scanImage(model.plan, state, { pixels: 640 });
      const canvas = $("scan");
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.getContext("2d").drawImage(source, 0, 0);
    }
  }

  // ---- little bits of form -------------------------------------------------------------------------------------

  const help = (text) =>
    `<button class="qrg-help" type="button" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}">?</button>`;

  const group = (host, title, hint) => {
    const box = document.createElement("div");
    box.className = "qrg-group";
    if (title) box.innerHTML = `<h3>${escapeHtml(title)}${hint ? help(hint) : ""}</h3>`;
    host.append(box);
    return box;
  };
  const fields = (host) => {
    const box = document.createElement("div");
    box.className = "qrg-fields";
    host.append(box);
    return box;
  };
  const note = (host, text, kind = "note") => {
    const line = document.createElement("p");
    line.className = `qrg-${kind}`;
    line.innerHTML = text;
    host.append(line);
    return line;
  };

  /** A number box with a slider under it, wired to one setting. */
  function control(host, key, label, options = {}) {
    const { get = () => state[key], set = (value) => (state[key] = value), unit = "mm", hint, after } = options;
    const [min, max, stepSize] = [
      options.min ?? RANGES[key]?.[0] ?? 0,
      options.max ?? RANGES[key]?.[1] ?? 100,
      options.step ?? RANGES[key]?.[2] ?? 0.1,
    ];
    const value = get();
    const box = document.createElement("div");
    box.className = "qrg-field qrg-slider";
    box.innerHTML = `
      <span class="qrg-label">${escapeHtml(label)}${hint ? help(hint) : ""}</span>
      <span class="qrg-in">
        <input type="number" min="${min}" max="${max}" step="${stepSize}" value="${value}" aria-label="${escapeHtml(label)}">
        <i>${escapeHtml(unit)}</i>
      </span>
      <input type="range" min="${min}" max="${max}" step="${stepSize}" value="${value}" aria-label="${escapeHtml(label)}" tabindex="-1">
      ${after ? `<p class="qrg-note">${escapeHtml(after)}</p>` : ""}`;
    const number = box.querySelector('input[type="number"]');
    const slider = box.querySelector('input[type="range"]');
    let started = false;
    const begin = () => {
      if (!started) {
        checkpoint();
        started = true;
      }
    };
    const end = () => (started = false);
    const apply = (raw, from) => {
      const next = Number(raw);
      if (!Number.isFinite(next) || next < min || next > max) return;
      begin();
      set(round(next));
      if (from !== number) number.value = raw;
      if (from !== slider) slider.value = raw;
      queue();
    };
    slider.addEventListener("pointerdown", begin);
    slider.addEventListener("input", () => apply(slider.value, slider));
    slider.addEventListener("change", end);
    slider.addEventListener("blur", end);
    number.addEventListener("input", () => apply(number.value, number));
    number.addEventListener("change", () => {
      const next = Math.max(min, Math.min(max, Number(number.value)));
      if (Number.isFinite(next)) apply(next, null);
      else number.value = get();
      end();
    });
    host.append(box);
    return box;
  }

  /** A choice between a few things. */
  function segmented(host, label, options, current, choose, hint) {
    const box = document.createElement("div");
    box.className = "qrg-field";
    box.innerHTML = `
      <span class="qrg-label">${escapeHtml(label)}${hint ? help(hint) : ""}</span>
      <div class="qrg-seg" role="group" aria-label="${escapeHtml(label)}">
        ${options
          .map(
            (option) =>
              `<button type="button" data-value="${escapeHtml(option.value)}" aria-pressed="${option.value === current}"${
                option.hint ? ` title="${escapeHtml(option.hint)}"` : ""
              }>${escapeHtml(option.label)}</button>`,
          )
          .join("")}
      </div>`;
    box.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.value === String(current)) return;
        checkpoint();
        choose(button.dataset.value);
        renderSheet();
        queue();
      });
    });
    host.append(box);
    return box;
  }

  /** On or off. */
  function toggle(host, label, on, change, hint) {
    const row = document.createElement("label");
    row.className = "qrg-switch";
    row.innerHTML = `<input type="checkbox" ${on ? "checked" : ""}><span>${escapeHtml(label)}</span>${hint ? help(hint) : ""}`;
    const input = row.querySelector("input");
    input.addEventListener("change", () => {
      checkpoint();
      change(input.checked);
      renderSheet();
      queue();
    });
    host.append(row);
    return row;
  }

  /** A line of text, or a few. */
  function textField(host, label, value, change, { area = false, hint, placeholder = "" } = {}) {
    const box = document.createElement("div");
    box.className = "qrg-field";
    box.innerHTML = `<span class="qrg-label">${escapeHtml(label)}${hint ? help(hint) : ""}</span>`;
    const input = document.createElement(area ? "textarea" : "input");
    if (area) {
      input.className = "qrg-text";
      input.rows = 3;
    } else {
      const wrap = document.createElement("span");
      wrap.className = "qrg-in";
      input.type = "text";
      wrap.append(input);
      box.append(wrap);
    }
    input.value = value ?? "";
    input.spellcheck = false;
    input.placeholder = placeholder;
    input.setAttribute("aria-label", label);
    if (area) box.append(input);
    let typing = 0;
    input.addEventListener("input", () => {
      clearTimeout(typing);
      if (!typing) checkpoint();
      typing = setTimeout(() => (typing = 0), 700);
      change(input.value);
      queue(360);
    });
    host.append(box);
    return input;
  }

  /** A colour, as the browser's own picker. */
  function swatch(host, label, value, change, hint) {
    const box = document.createElement("div");
    box.className = "qrg-field";
    box.innerHTML = `<span class="qrg-label">${escapeHtml(label)}${hint ? help(hint) : ""}</span>`;
    const input = document.createElement("input");
    input.type = "color";
    input.className = "qrg-swatch";
    input.value = value;
    input.setAttribute("aria-label", label);
    box.append(input);
    let started = false;
    input.addEventListener("input", () => {
      if (!started) {
        checkpoint();
        started = true;
      }
      change(input.value);
      queue(120);
    });
    input.addEventListener("change", () => {
      started = false;
      renderSheet();
    });
    host.append(box);
    return input;
  }

  // ---- the little pictures on the shape pickers ----------------------------------------------------------------

  /** A sample of modules, so a shape is chosen by looking at it rather than by its name. */
  const SAMPLE = ["01100", "11110", "01011", "11110", "00110"];

  function drawBodySample(canvas, body) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const side = 44;
    canvas.width = side * ratio;
    canvas.height = side * ratio;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, side, side);
    ctx.fillStyle = state.colours.base;
    ctx.fillRect(0, 0, side, side);
    const cell = side / SAMPLE.length;
    const dark = (column, row) => SAMPLE[row]?.[column] === "1";
    ctx.fillStyle = state.colours.code;
    ctx.beginPath();
    for (let row = 0; row < SAMPLE.length; row++) {
      for (let column = 0; column < SAMPLE.length; column++) {
        if (!dark(column, row)) continue;
        const mask =
          (dark(column, row - 1) ? 1 : 0) |
          (dark(column + 1, row) ? 2 : 0) |
          (dark(column, row + 1) ? 4 : 0) |
          (dark(column - 1, row) ? 8 : 0);
        const ring = moduleRing(
          body,
          (column + 0.5) * cell,
          (row + 0.5) * cell,
          cell,
          mask,
          moduleAngles(body, cell, mask, 24),
          state.fill,
        );
        ring.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
      }
    }
    ctx.fill();
  }

  function drawEyeSample(canvas, { frame, centre }) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const side = 44;
    canvas.width = side * ratio;
    canvas.height = side * ratio;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, side, side);
    ctx.fillStyle = state.colours.base;
    ctx.fillRect(0, 0, side, side);
    const cell = side / 8;
    const rings = eyeRings(frame, centre, side / 2, side / 2, cell, state.body, 48);
    ctx.fillStyle = state.colours.code;
    ctx.beginPath();
    rings.frameOuter.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    rings.frameInner.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.beginPath();
    rings.pupilOuter.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }

  /** A relief seen edge-on, which is the only way to tell a dome from a pyramid. */
  function drawReliefSample(canvas, relief) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const side = 44;
    canvas.width = side * ratio;
    canvas.height = side * ratio;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, side, side);
    ctx.fillStyle = state.colours.base;
    ctx.fillRect(0, 0, side, side);
    const cells = 4;
    const cell = side / (cells + 1);
    const baseY = side - cell * 0.9;
    ctx.fillStyle = state.colours.base;
    ctx.fillRect(0, baseY, side, side - baseY);
    ctx.strokeStyle = theme.divider;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(side, baseY);
    ctx.stroke();
    ctx.fillStyle = state.colours.code;
    for (let i = 0; i < cells; i++) {
      const tall = reliefHeight(relief, cell * 1.5, i, cells, cells * 2);
      const { levels, apex } = reliefLevels(relief, tall, cell);
      const x = cell * 0.6 + i * cell;
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      for (const level of levels) ctx.lineTo(x + (cell * 0.8 * (1 - level.scale)) / 2, baseY - level.z);
      const last = levels[levels.length - 1];
      if (apex) ctx.lineTo(x + cell * 0.4, baseY - apex.z);
      else ctx.lineTo(x + cell * 0.8 - (cell * 0.8 * (1 - last.scale)) / 2, baseY - last.z);
      for (const level of [...levels].reverse())
        ctx.lineTo(x + cell * 0.8 - (cell * 0.8 * (1 - level.scale)) / 2, baseY - level.z);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** The reliefs that stand the modules at different heights, where the height set is the tallest of them. */
  /** A row of pickers, each with its own little picture. */
  function pickers(host, options, current, choose, paint) {
    const grid = document.createElement("div");
    grid.className = "qrg-patterns";
    for (const option of options) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "qrg-pattern";
      card.setAttribute("aria-pressed", String(option.value === current));
      const canvas = document.createElement("canvas");
      card.append(canvas);
      const name = document.createElement("span");
      name.textContent = option.label;
      card.append(name);
      card.addEventListener("click", () => {
        if (option.value === current) return;
        checkpoint();
        choose(option.value);
        renderSheet();
        queue();
      });
      grid.append(card);
      paint(canvas, option.value);
    }
    host.append(grid);
    return grid;
  }

  // ---- which settings are showing ------------------------------------------------------------------------------

  function renderNav() {
    const select = $("nav");
    const bad = model?.warnings.filter((warning) => BAD.has(warning.code)).length ?? 0;
    select.innerHTML = SECTIONS.map((id) => {
      const count = id === "check" && model ? model.warnings.length : 0;
      const mark = id === "check" && bad ? " ⚠" : "";
      return `<option value="${id}" ${id === section ? "selected" : ""}>${escapeHtml(t(`nav.${id}`))}${count ? ` (${count})` : ""}${mark}</option>`;
    }).join("");
  }

  const renderAll = () => {
    renderNav();
    renderSheet();
    syncStage();
  };

  function renderSheet() {
    const host = $("sheet");
    host.replaceChildren();
    const panels = {
      content: panelContent,
      shape: panelShape,
      style: panelStyle,
      colour: panelColour,
      extras: panelExtras,
      check: panelCheck,
    };
    (panels[section] ?? panelContent)(host);
    renderNav();
  }

  // ---- Content -------------------------------------------------------------------------------------------------

  function panelContent(host) {
    const what = group(host, t("content.what"));
    segmented(
      what,
      t("content.kind"),
      KINDS.map((kind) => ({ value: kind, label: t(`content.kind.${kind}`) })),
      state.content.kind,
      (value) => (state.content.kind = value),
    );

    const box = fields(what);
    const set = (field) => (value) => (state.content[field] = value);
    for (const field of FIELDS[state.content.kind]) {
      const key = field.name === "url" && state.content.kind === "contact" ? "contactUrl" : field.name;
      const label = t(`content.field.${state.content.kind}.${field.name}`);
      if (field.type === "choice") {
        segmented(
          box,
          label,
          field.options.map((option) => ({ value: option, label: t(`content.option.${field.name}.${option}`) })),
          state.content[key],
          set(key),
        );
      } else if (field.type === "switch") {
        toggle(box, label, Boolean(state.content[key]), set(key));
      } else {
        textField(box, label, state.content[key], set(key), { area: field.type === "area" });
      }
    }
    if (state.content.kind === "link") {
      toggle(
        what,
        t("content.shorten"),
        state.content.shortenLink,
        (on) => (state.content.shortenLink = on),
        t("content.shortenHint"),
      );
    }
    if (carriesSecret(state.content)) note(what, escapeHtml(t("content.secret")), "warn");

    const correction = group(host, t("content.correction"), t("content.correctionHint"));
    segmented(
      correction,
      t("content.level"),
      LEVELS.map((level) => ({
        value: level,
        label: `${level} · ${LEVEL_RECOVERY[level]}%`,
        hint: t(`content.level.${level}`),
      })),
      state.level,
      (value) => (state.level = value),
    );

    const grid = group(host, t("content.grid"));
    const versions = document.createElement("div");
    versions.className = "qrg-field";
    const smallest = model ? smallestVersion(model.text, state.level, model.code.mode) : null;
    versions.innerHTML = `<span class="qrg-label">${escapeHtml(t("content.version"))}${help(t("content.versionHint"))}</span>
      <span class="qrg-in"><select aria-label="${escapeHtml(t("content.version"))}">
        <option value="auto" ${state.version === "auto" ? "selected" : ""}>${escapeHtml(t("content.versionAuto"))}</option>
        ${Array.from({ length: MAX_VERSION }, (_, i) => i + 1)
          .map(
            (version) =>
              `<option value="${version}" ${String(state.version) === String(version) ? "selected" : ""}>${escapeHtml(
                t("content.versionOne", { version, modules: version * 4 + 17 }),
              )}</option>`,
          )
          .join("")}
      </select></span>`;
    const select = versions.querySelector("select");
    select.addEventListener("change", () => {
      checkpoint();
      state.version = select.value === "auto" ? "auto" : Number(select.value);
      queue(0);
    });
    grid.append(versions);

    if (model) {
      const used = model.code.mode === "byte" ? new TextEncoder().encode(model.text).length : model.text.length;
      note(
        grid,
        escapeHtml(
          t("content.holds", {
            used,
            capacity: capacity(model.code.version, state.level, model.code.mode),
            mode: t(`content.mode.${model.code.mode}`),
            version: model.code.version,
            modules: model.code.size,
          }),
        ),
      );
      if (smallest && smallest < model.code.version)
        note(grid, escapeHtml(t("content.couldBeSmaller", { version: smallest })));
    }
  }

  // ---- Shape ---------------------------------------------------------------------------------------------------

  function panelShape(host) {
    const outline = group(host, t("shape.outline"));
    segmented(
      outline,
      t("shape.kind"),
      [
        { value: "tile", label: t("shape.tile") },
        { value: "keychain", label: t("shape.keychain") },
      ],
      state.shape,
      (value) => (state.shape = value),
    );
    const sizes = fields(outline);
    segmented(
      sizes,
      t("shape.sizeBy"),
      [
        { value: "module", label: t("shape.sizeByModule") },
        { value: "plate", label: t("shape.sizeByPlate") },
      ],
      state.sizeBy,
      (value) => (state.sizeBy = value),
      t("shape.sizeByHint"),
    );
    if (state.sizeBy === "plate") control(sizes, "plateMm", t("shape.plate"), { hint: t("shape.plateHint") });
    else control(sizes, "moduleMm", t("shape.module"), { hint: t("shape.moduleHint") });
    control(sizes, "baseMm", t("shape.base"));
    control(sizes, "cornerMm", t("shape.corner"));
    if (model) {
      note(
        outline,
        escapeHtml(
          t("shape.measures", {
            plate: `${model.size.width.toFixed(1)} × ${model.size.height.toFixed(1)}`,
            module: model.size.cell.toFixed(2),
            modules: model.code.size,
          }),
        ),
      );
    }

    const quiet = group(host, t("shape.quiet"), t("shape.quietHint"));
    segmented(
      quiet,
      t("shape.quietZone"),
      Object.keys(QUIET).map((key) => ({
        value: key,
        label: t(`shape.quiet.${key}`),
        hint: t("shape.quietModules", { modules: QUIET[key] }),
      })),
      state.quiet,
      (value) => (state.quiet = value),
    );

    const border = group(host, t("shape.border"));
    toggle(border, t("shape.borderOn"), state.border, (on) => (state.border = on), t("shape.borderHint"));
    if (state.border) {
      const row = fields(border);
      control(row, "borderMm", t("shape.borderWidth"));
      control(row, "borderHeightMm", t("shape.borderHeight"));
      control(row, "borderCornerMm", t("shape.borderCorner"));
    }

    if (state.shape === "keychain") {
      const tab = group(host, t("shape.tab"));
      segmented(
        tab,
        t("shape.tabSide"),
        TAB_SIDES.map((value) => ({ value, label: t(`shape.tabSide.${value}`) })),
        TAB_SIDES.includes(state.tabSide) ? state.tabSide : "top",
        (value) => (state.tabSide = value),
      );
      const row = fields(tab);
      control(row, "tabMm", t("shape.tabWidth"));
      control(row, "holeMm", t("shape.hole"));
      control(row, "tabOffset", t("shape.tabPosition"), { unit: "%", hint: t("shape.tabPositionHint") });
      note(tab, escapeHtml(t("shape.tabNote")));
    }
  }

  // ---- Style ---------------------------------------------------------------------------------------------------

  function panelStyle(host) {
    const how = group(host, t("style.how"));
    segmented(
      how,
      t("style.modules"),
      [
        { value: "raised", label: t("style.raised"), hint: t("style.raisedHint") },
        { value: "flush", label: t("style.flush"), hint: t("style.flushHint") },
      ],
      state.modules,
      (value) => (state.modules = value),
    );
    const row = fields(how);
    if (state.modules === "flush") control(row, "inlayMm", t("style.inlay"), { hint: t("style.inlayHint") });
    control(row, "fill", t("style.fill"), {
      unit: "%",
      get: () => Math.round(state.fill * 100),
      set: (value) => (state.fill = value / 100),
      hint: t("style.fillHint"),
    });
    note(how, escapeHtml(state.modules === "flush" ? t("style.flushNote") : t("style.raisedNote")));

    const relief = group(host, t("style.relief"), t("style.reliefHint"));
    if (state.modules === "flush") {
      note(relief, escapeHtml(t("style.reliefFlush")), "warn");
    } else {
      pickers(
        relief,
        RELIEFS.map((value) => ({ value, label: t(`style.relief.${value}`) })),
        state.relief,
        (value) => (state.relief = value),
        drawReliefSample,
      );
      // Where the relief stands the modules at different heights, this is the tallest of them, not all of them.
      control(
        fields(relief),
        "codeMm",
        t(ACROSS_THE_CODE.has(state.relief) ? "style.codeTallest" : "style.codeHeight"),
      );
    }

    const body = group(host, t("style.body"), t("style.bodyHint"));
    pickers(
      body,
      BODIES.map((value) => ({ value, label: t(`style.body.${value}`) })),
      state.body,
      (value) => (state.body = value),
      drawBodySample,
    );

    const eyes = group(host, t("style.eyes"), t("style.eyesHint"));
    note(eyes, escapeHtml(t("style.eyeFrame")));
    pickers(
      eyes,
      EYE_FRAMES.map((value) => ({ value, label: t(`style.eyeFrame.${value}`) })),
      state.eyeFrame,
      (value) => (state.eyeFrame = value),
      (canvas, value) => drawEyeSample(canvas, { frame: value, centre: state.eyeCentre }),
    );
    note(eyes, escapeHtml(t("style.eyeCentre")));
    pickers(
      eyes,
      EYE_CENTRES.map((value) => ({ value, label: t(`style.eyeCentre.${value}`) })),
      state.eyeCentre,
      (value) => (state.eyeCentre = value),
      (canvas, value) => drawEyeSample(canvas, { frame: state.eyeFrame, centre: value }),
    );
  }

  // ---- Colours -------------------------------------------------------------------------------------------------

  function panelColour(host) {
    const which = group(host, t("colour.filaments"), t("colour.filamentsHint"));
    const row = fields(which);
    swatch(row, t("colour.code"), state.colours.code, (value) => (state.colours.code = value));
    swatch(row, t("colour.base"), state.colours.base, (value) => (state.colours.base = value));
    if (state.border) swatch(row, t("colour.border"), state.colours.border, (value) => (state.colours.border = value));
    if (state.caption.text.trim())
      swatch(row, t("colour.caption"), state.colours.caption, (value) => (state.colours.caption = value));
    if (state.patch.shape !== "none")
      swatch(row, t("colour.patch"), state.colours.patch, (value) => (state.colours.patch = value));

    const ratio = contrastRatio(state.colours.code, state.colours.base);
    const contrast = group(host, t("colour.contrast"), t("colour.contrastHint"));
    const meter = document.createElement("div");
    meter.className = "qrg-meter";
    const marker = document.createElement("i");
    marker.style.left = `${Math.max(0, Math.min(100, ((ratio - 1) / 20) * 100))}%`;
    meter.append(marker);
    contrast.append(meter);
    note(
      contrast,
      escapeHtml(t("colour.ratio", { ratio: ratio.toFixed(1) })) +
        " — " +
        escapeHtml(ratio >= 7 ? t("colour.ratioGreat") : ratio >= 3 ? t("colour.ratioOk") : t("colour.ratioPoor")),
      ratio >= 3 ? "note" : "warn",
    );

    if (model) {
      const dl = document.createElement("dl");
      dl.className = "qrg-review";
      for (const [index, colour] of model.filaments.entries()) {
        const parts = model.parts.filter((part) => part.slot === index).map((part) => t(`part.${part.kind}`));
        dl.innerHTML += `<dt>${escapeHtml(t("bar.slot", { n: index + 1 }))}</dt><dd><span class="qrg-colour" style="background:${escapeHtml(
          colour,
        )}"></span> ${escapeHtml(parts.join(", "))}</dd>`;
      }
      group(host, t("colour.whatPrints")).append(dl);
    }
  }

  // ---- Caption, logo -------------------------------------------------------------------------------------------

  function panelExtras(host) {
    const words = group(host, t("extras.caption"), t("extras.captionHint"));
    textField(words, t("extras.captionText"), state.caption.text, (value) => (state.caption.text = value), {
      placeholder: t("extras.captionPlaceholder"),
    });
    if (state.caption.text.trim()) {
      segmented(
        words,
        t("extras.where"),
        [
          { value: "bottom", label: t("extras.bottom") },
          { value: "top", label: t("extras.top") },
        ],
        state.caption.where,
        (value) => (state.caption.where = value),
      );
      const row = fields(words);
      control(row, "captionSize", t("extras.captionSize"), {
        get: () => state.caption.sizeMm,
        set: (value) => (state.caption.sizeMm = value),
      });
      control(row, "captionRaise", t("extras.captionRaise"), {
        get: () => state.caption.raiseMm,
        set: (value) => (state.caption.raiseMm = value),
      });
      const face = document.createElement("div");
      face.className = "qrg-field";
      face.innerHTML = `<span class="qrg-label">${escapeHtml(t("extras.font"))}</span>
        <span class="qrg-in"><select aria-label="${escapeHtml(t("extras.font"))}">${(fonts?.list ?? [])
          .map(
            (item) =>
              `<option value="${escapeHtml(item.id)}" ${item.id === state.caption.fontId ? "selected" : ""}>${escapeHtml(item.name)}</option>`,
          )
          .join("")}</select></span>`;
      const select = face.querySelector("select");
      select.addEventListener("change", async () => {
        checkpoint();
        state.caption.fontId = select.value;
        font = null;
        await useFont(select.value);
        queue(0);
      });
      words.append(face);
    }

    const middle = group(host, t("extras.patch"), t("extras.patchHint"));
    segmented(
      middle,
      t("extras.patchShape"),
      [
        { value: "none", label: t("extras.patchNone") },
        { value: "square", label: t("extras.patchSquare") },
        { value: "circle", label: t("extras.patchCircle") },
      ],
      state.patch.shape,
      (value) => (state.patch.shape = value),
    );
    if (state.patch.shape !== "none") {
      const row = fields(middle);
      control(row, "patchAcross", t("extras.patchAcross"), {
        unit: t("extras.modules"),
        get: () => state.patch.across,
        set: (value) => (state.patch.across = Math.round(value)),
        hint: t("extras.patchAcrossHint"),
      });
      control(row, "patchRaise", t("extras.patchRaise"), {
        get: () => state.patch.raiseMm ?? 0.6,
        set: (value) => (state.patch.raiseMm = value),
      });

      const picture = document.createElement("div");
      picture.className = "qrg-logo";
      const preview = document.createElement("canvas");
      preview.width = 92;
      preview.height = 92;
      picture.append(preview);
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "qrg-btn";
      pick.textContent = logo ? t("extras.logoChange") : t("extras.logoAdd");
      pick.addEventListener("click", pickLogo);
      picture.append(pick);
      if (logo) {
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "qrg-btn";
        clear.textContent = t("extras.logoRemove");
        clear.addEventListener("click", () => {
          checkpoint();
          logo = null;
          renderSheet();
          queue(0);
        });
        picture.append(clear);
      }
      middle.append(picture);
      drawLogoPreview(preview);
      if (logo) {
        control(fields(middle), "patchScale", t("extras.logoSize"), {
          unit: "%",
          get: () => Math.round((state.patch.scale ?? 0.8) * 100),
          set: (value) => (state.patch.scale = value / 100),
        });
        note(middle, escapeHtml(t("extras.logoFrom", { name: logo.name })));
      } else {
        note(middle, escapeHtml(t("extras.logoNote")));
      }
    }
  }

  function drawLogoPreview(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = state.colours.patch;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!logo) return;
    const box = logo.bounds;
    const scale = (canvas.width * 0.72) / Math.max(box.maxX - box.minX, box.maxY - box.minY || 1);
    const dx = canvas.width / 2 - ((box.minX + box.maxX) / 2) * scale;
    const dy = canvas.height / 2 + ((box.minY + box.maxY) / 2) * scale;
    ctx.fillStyle = state.colours.code;
    ctx.beginPath();
    for (const shape of logo.shapes) {
      for (const ring of [shape.outer, ...shape.holes]) {
        ring.forEach(([x, y], index) => {
          const px = x * scale + dx;
          const py = dy - y * scale;
          if (index) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        });
        ctx.closePath();
      }
    }
    ctx.fill("evenodd");
  }

  function pickLogo() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        ui.toast(t("toast.logoTooBig"), "error");
        return;
      }
      try {
        const svg = await file.text();
        const { shapes, skipped } = shapesFromSvg(svg);
        checkpoint();
        logo = { shapes, bounds: shapeBounds(shapes), name: file.name.replace(/\.svg$/i, ""), svg };
        if (state.patch.shape === "none") state.patch.shape = "circle";
        if (skipped) ui.toast(t("toast.logoPartly", { count: skipped }), "info");
        renderSheet();
        queue(0);
      } catch (error) {
        ui.toast(error.message || t("toast.logoFailed"), "error");
      }
    });
    input.click();
  }

  // ---- Before you print ----------------------------------------------------------------------------------------

  function panelCheck(host) {
    const box = group(host, t("check.title"), t("check.hint"));
    const list = document.createElement("ul");
    list.className = "qrg-checks";
    const add = (tone, title, detail) => {
      const item = document.createElement("li");
      item.className = "qrg-check";
      item.dataset.tone = tone;
      item.innerHTML = `<div><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div>`;
      list.append(item);
    };

    if (!model) {
      add("warn", t("check.nothing"), failure ?? t("check.nothingHint"));
    } else {
      for (const warning of model.warnings) {
        add(
          BAD.has(warning.code) ? "bad" : "warn",
          t(`check.${warning.code}`, warning.vars),
          t(`check.${warning.code}Fix`, warning.vars),
        );
      }
      const cell = model.size.cell;
      if (cell >= 1.2)
        add("good", t("check.moduleFine", { mm: cell.toFixed(2) }), t("check.moduleFineWhy", { nozzle: NOZZLE_MM }));
      if (model.plan.quiet >= 4) add("good", t("check.quietFine"), t("check.quietFineWhy"));
      if (model.contrast >= 3)
        add("good", t("check.contrastFine", { ratio: model.contrast.toFixed(1) }), t("check.contrastFineWhy"));
      if (!model.plan.patch)
        add(
          "good",
          t("check.wholeCode"),
          t("check.wholeCodeWhy", { level: model.code.level, recovery: LEVEL_RECOVERY[model.code.level] }),
        );
    }
    box.append(list);

    if (model) {
      const facts = group(host, t("check.facts"));
      const dl = document.createElement("dl");
      dl.className = "qrg-review";
      const rows = [
        [t("check.factVersion"), `${model.code.version} · ${model.code.size} × ${model.code.size}`],
        [t("check.factLevel"), `${model.code.level} · ${LEVEL_RECOVERY[model.code.level]}%`],
        [t("check.factMask"), String(model.code.mask)],
        [t("check.factMode"), t(`content.mode.${model.code.mode}`)],
        [t("check.factModule"), `${model.size.cell.toFixed(2)} mm`],
        [
          t("check.factSize"),
          `${model.size.width.toFixed(1)} × ${model.size.height.toFixed(1)} × ${model.size.thickness.toFixed(1)} mm`,
        ],
        [t("check.factTriangles"), model.triangles.toLocaleString()],
        [t("check.factParts"), `${model.parts.length} · ${model.filaments.length}`],
      ];
      dl.innerHTML = rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("");
      facts.append(dl);
      note(facts, escapeHtml(t("check.scanIt")));
    }
  }

  // ---- what to print, in words ---------------------------------------------------------------------------------

  function printNotes(name) {
    if (!model) return "";
    const lines = [name || t("save.untitled"), ""];
    lines.push(t("notes.what", { text: model.text.length > 300 ? `${model.text.slice(0, 300)}…` : model.text }));
    lines.push(
      t("notes.code", {
        version: model.code.version,
        modules: model.code.size,
        level: model.code.level,
        recovery: LEVEL_RECOVERY[model.code.level],
        mask: model.code.mask,
      }),
    );
    lines.push(
      t("notes.size", {
        width: model.size.width.toFixed(1),
        height: model.size.height.toFixed(1),
        thickness: model.size.thickness.toFixed(1),
        module: model.size.cell.toFixed(2),
      }),
    );
    lines.push("", t("notes.filaments"));
    for (const [index, colour] of model.filaments.entries()) {
      const parts = model.parts.filter((part) => part.slot === index).map((part) => t(`part.${part.kind}`));
      lines.push(`  ${index + 1}. ${colour} — ${parts.join(", ")}`);
    }
    lines.push(
      "",
      t("notes.printing"),
      `  ${t(state.modules === "flush" ? "notes.flush" : "notes.raised")}`,
      `  ${t("notes.noSupports")}`,
    );
    if (model.warnings.length) {
      lines.push("", t("notes.worthKnowing"));
      for (const warning of model.warnings) lines.push(`  - ${t(`check.${warning.code}`, warning.vars)}`);
    }
    lines.push("", t("notes.madeWith", { version: tool.version }));
    return lines.join("\n");
  }

  // ---- the files -----------------------------------------------------------------------------------------------

  const fileBase = (from) =>
    (
      String(from ?? nameFor(state.content) ?? "")
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "qr-code"
    ).slice(0, 48);

  const titleFor = () => {
    const name = nameFor(state.content);
    return name ? t("save.name", { name }) : t("save.untitled");
  };

  async function fileFor(kind, named) {
    const base = fileBase(named ?? nameFor(state.content));
    const title = named?.trim() || titleFor();
    if (kind === "3mf") return { name: `${base}.3mf`, data: await threeMf(model, { title }) };
    if (kind === "stl") {
      const single = buildModel(state, { font, logo, singleColour: true });
      return { name: `${base}.stl`, data: stl(single, { title }) };
    }
    if (kind === "png") {
      const canvas = scanImage(model.plan, state, { pixels: 1024 });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      return { name: `${base}.png`, data: blob };
    }
    if (kind === "project") return { name: `${base}.qrproject.json`, data: projectFile(state, tool.version) };
    return { name: `${base}-print-notes.txt`, data: printNotes(title) };
  }

  async function ensureFresh() {
    if (fresh && model) return true;
    if (busy) {
      ui.toast(t("toast.stillWorking"), "info");
      return false;
    }
    clearTimeout(timer);
    await build();
    if (!fresh || !model) {
      ui.toast(failure || t("toast.wontBuildYet"), "error");
      return false;
    }
    return true;
  }

  // ---- menus and dialogs ---------------------------------------------------------------------------------------

  let menu = null;
  const shutMenu = () => {
    menu?.remove();
    menu = null;
    $("download").setAttribute("aria-expanded", "false");
    $("more").setAttribute("aria-expanded", "false");
  };

  function openMenu(button, items) {
    shutMenu();
    menu = document.createElement("div");
    menu.className = "qrg-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = items
      .map((item) =>
        item
          ? `<button type="button" role="menuitem" data-pick="${escapeHtml(item.id)}"><span>${escapeHtml(item.label)}${
              item.note ? `<small>${escapeHtml(item.note)}</small>` : ""
            }</span></button>`
          : "<hr>",
      )
      .join("");
    const box = button.getBoundingClientRect();
    const shellBox = shell.getBoundingClientRect();
    menu.style.top = `${box.bottom - shellBox.top + 5}px`;
    menu.style.right = `${shellBox.right - box.right}px`;
    shell.append(menu);
    button.setAttribute("aria-expanded", "true");
    menu.querySelectorAll("button").forEach((entry) => {
      entry.addEventListener("click", () => {
        const chosen = items.find((item) => item && item.id === entry.dataset.pick);
        shutMenu();
        chosen?.go();
      });
    });
    menu.querySelector("button")?.focus();
  }

  function openDialog(title, fill) {
    const cover = document.createElement("div");
    cover.className = "qrg-cover";
    cover.innerHTML = `<div class="qrg-dialog" role="dialog" aria-modal="true" aria-labelledby="qrg-dialog-title">
        <div class="qrg-dialog-top">
          <h2 id="qrg-dialog-title">${escapeHtml(title)}</h2>
          <button class="qrg-x" type="button" data-shut aria-label="${escapeHtml(t("save.close"))}">✕</button>
        </div>
        <div class="qrg-dialog-body"></div>
        <div class="qrg-dialog-foot"></div>
      </div>`;
    shell.append(cover);
    const close = () => {
      onBuilt = null;
      cover.remove();
    };
    cover.querySelectorAll("[data-shut]").forEach((button) => button.addEventListener("click", close));
    cover.addEventListener("pointerdown", (event) => {
      if (event.target === cover) close();
    });
    cover.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    fill(cover.querySelector(".qrg-dialog-body"), cover.querySelector(".qrg-dialog-foot"), close);
    return cover;
  }

  const footButton = (foot, label, main = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `qrg-btn${main ? " qrg-btn-main" : ""}`;
    button.textContent = label;
    foot.append(button);
    return button;
  };

  // ---- downloading ---------------------------------------------------------------------------------------------

  const FORMATS = [
    { id: "3mf", label: () => t("file.3mf"), note: () => t("file.3mfNote") },
    { id: "stl", label: () => t("file.stl"), note: () => t("file.stlNote") },
    { id: "png", label: () => t("file.png"), note: () => t("file.pngNote") },
    null,
    { id: "project", label: () => t("file.project"), note: () => t("file.projectNote") },
    { id: "notes", label: () => t("file.notes"), note: () => t("file.notesNote") },
  ];

  $("download").addEventListener("click", () => {
    if (menu) {
      shutMenu();
      return;
    }
    openMenu(
      $("download"),
      FORMATS.map((format) =>
        format
          ? { id: format.id, label: format.label(), note: format.note(), go: () => void handDown(format.id) }
          : null,
      ),
    );
  });

  async function handDown(kind) {
    if (kind !== "project" && !(await ensureFresh())) return;
    try {
      download(await fileFor(kind));
    } catch (error) {
      ui.toast(error.message || t("toast.fileFailed"), "error");
    }
  }

  // ---- saving it to the library -------------------------------------------------------------------------------

  $("save").addEventListener("click", async () => {
    shutMenu();
    if (!(await ensureFresh())) return;
    const suggested = titleFor();
    openDialog(t("save.title"), (body, foot, close) => {
      const name = document.createElement("div");
      name.className = "qrg-field";
      name.innerHTML = `<span class="qrg-label">${escapeHtml(t("save.nameLabel"))}</span>
        <span class="qrg-in"><input type="text" value="${escapeHtml(suggested)}" aria-label="${escapeHtml(t("save.nameLabel"))}"></span>`;
      body.append(name);
      note(body, escapeHtml(t("save.where")));
      if (carriesSecret(state.content)) note(body, escapeHtml(t("save.secret")), "warn");

      footButton(foot, t("save.cancel")).addEventListener("click", close);
      const go = footButton(foot, t("save.go"), true);
      const nameBox = name.querySelector("input");
      nameBox.focus();
      nameBox.select();
      nameBox.addEventListener("keydown", (event) => {
        if (event.key === "Enter") go.click();
      });

      go.addEventListener("click", async () => {
        const chosen = nameBox.value.trim() || suggested;
        go.disabled = true;
        go.textContent = t("save.saving");
        try {
          if (!(await ensureFresh())) throw new Error(failure || t("toast.wontBuildYet"));
          const collection = await collections.pick({ title: t("save.pickCollection") });
          if (!collection) {
            go.disabled = false;
            go.textContent = t("save.go");
            return;
          }
          const saved = await models.create({
            name: chosen,
            description: printNotes(chosen),
            tags: ["qr-code", "generated"],
            collectionId: collection.id,
            files: [await fileFor("3mf", chosen)],
          });
          const pictures = [];
          const picture = stage === "solid" ? await viewer?.toBlob("image/png") : null;
          if (picture) pictures.push({ name: `${fileBase(chosen)}.png`, data: picture });
          const flat = await new Promise((resolve) =>
            scanImage(model.plan, state, { pixels: 1024 }).toBlob(resolve, "image/png"),
          );
          if (flat) pictures.push({ name: `${fileBase(chosen)}-scan.png`, data: flat });
          if (pictures.length) await models.addImages(saved.id, pictures);
          close();
          ui.toast(t("save.done", { name: chosen, collection: collection.name }), "success");
        } catch (error) {
          go.disabled = false;
          go.textContent = t("save.go");
          ui.toast(error.message || t("toast.saveFailed"), "error");
        }
      });
    });
  });

  // ---- the rest of the window ----------------------------------------------------------------------------------

  $("more").addEventListener("click", () => {
    if (menu) {
      shutMenu();
      return;
    }
    openMenu($("more"), [
      { id: "open", label: t("bar.openProject"), note: t("bar.openProjectNote"), go: openProject },
      null,
      {
        id: "reset",
        label: t("bar.startAgain"),
        go: async () => {
          if (!(await ui.confirm({ title: t("bar.startAgainTitle"), message: t("bar.startAgainBody") }))) return;
          checkpoint();
          state = { ...clone(DEFAULTS), content: clone(DEFAULT_CONTENT) };
          logo = null;
          renderAll();
          queue(0);
        },
      },
    ]);
  });

  function openProject() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const loaded = readProject(await file.text());
        checkpoint();
        state = { ...clone(DEFAULTS), ...loaded, content: { ...clone(DEFAULT_CONTENT), ...(loaded.content ?? {}) } };
        state.caption = { ...clone(DEFAULTS.caption), ...(loaded.caption ?? {}) };
        state.patch = { ...clone(DEFAULTS.patch), ...(loaded.patch ?? {}) };
        state.colours = { ...clone(DEFAULTS.colours), ...(loaded.colours ?? {}) };
        font = null;
        renderAll();
        queue(0);
        ui.toast(t("toast.projectOpened"), "success");
      } catch (error) {
        ui.toast(error.message || t("toast.projectFailed"), "error");
      }
    });
    input.click();
  }

  shell.addEventListener("pointerdown", (event) => {
    if (menu && !menu.contains(event.target) && !event.target.closest("#qrg-download, #qrg-more")) shutMenu();
  });

  $("nav").addEventListener("change", () => {
    section = $("nav").value;
    persist();
    renderSheet();
  });
  $("undo").addEventListener("click", () => step(past, future));
  $("redo").addEventListener("click", () => step(future, past));
  $("fit").addEventListener("click", () => viewer?.look("home"));
  $("stop-retry").addEventListener("click", () => queue(0));
  $("looks")
    .querySelectorAll("button")
    .forEach((button) => {
      button.addEventListener("click", () => {
        $("looks")
          .querySelectorAll("button")
          .forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
        viewer?.look(button.dataset.view);
      });
    });

  function syncStage() {
    $("stage-views")
      .querySelectorAll("button")
      .forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.stage === stage)));
    if (stage === "solid" && model) viewer?.show(model.parts, { fit: false });
    drawStage();
    showReadout();
  }

  $("stage-views")
    .querySelectorAll("button")
    .forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.stage === "solid" && !viewer) {
          ui.toast(t("toast.noWebgl"), "info");
          return;
        }
        stage = button.dataset.stage;
        persist();
        syncStage();
      });
    });

  const keys = (event) => {
    if (!shell.contains(event.target) && event.target !== document.body) return;
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      step(event.shiftKey ? future : past, event.shiftKey ? past : future);
    } else if (event.key === "Escape" && menu) shutMenu();
  };
  window.addEventListener("keydown", keys);

  let last = size;
  onResize((next) => {
    if (next.width !== last.width || next.height !== last.height) {
      viewer?.redraw();
      if (stage !== "solid") drawStage();
    }
    last = next;
    if (menu) shutMenu();
  });

  // ---- the caption's typeface ----------------------------------------------------------------------------------

  async function useFont(id) {
    try {
      fonts = fonts ?? (await library("fonts"));
      const wanted = fonts.list.some((item) => item.id === id) ? id : fonts.list[0]?.id;
      if (!wanted) return false;
      font = await fonts.load(wanted);
      state.caption.fontId = wanted;
      return true;
    } catch (error) {
      ui.toast(t("toast.fontFailed", { error: error.message }), "error");
      return false;
    }
  }

  // ---- getting going -------------------------------------------------------------------------------------------

  setState("idle", t("state.starting"));
  renderNav();
  renderSheet();

  try {
    const kept = await storage.get(KEY);
    if (kept?.state) {
      state = {
        ...clone(DEFAULTS),
        ...kept.state,
        content: { ...clone(DEFAULT_CONTENT), ...(kept.state.content ?? {}) },
        caption: { ...clone(DEFAULTS.caption), ...(kept.state.caption ?? {}) },
        patch: { ...clone(DEFAULTS.patch), ...(kept.state.patch ?? {}) },
        colours: { ...clone(DEFAULTS.colours), ...(kept.state.colours ?? {}) },
      };
      if (SECTIONS.includes(kept.section)) section = kept.section;
      if (["solid", "flat", "scan"].includes(kept.stage) && (viewer || kept.stage !== "solid")) stage = kept.stage;
      if (kept.logo?.svg) {
        try {
          const { shapes } = shapesFromSvg(kept.logo.svg);
          logo = { shapes, bounds: shapeBounds(shapes), name: kept.logo.name, svg: kept.logo.svg };
        } catch {
          // A logo that no longer reads is simply dropped; the patch stays.
        }
      }
    }
  } catch {
    // Nothing kept, or it wouldn't read: the first settings do.
  }

  // The typefaces are only wanted for a caption, so a plain code costs nothing to open.
  if (state.caption.text.trim()) await useFont(state.caption.fontId);

  renderAll();
  syncHistory();
  await build();

  return () => {
    dead = true;
    revision++;
    clearTimeout(timer);
    window.removeEventListener("keydown", keys);
    shutMenu();
    viewer?.dispose();
  };
}
