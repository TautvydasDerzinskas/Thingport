// The tool's window: the settings on the left, the keyring on the right.
//
// Every change takes a snapshot for undo, then queues a build. The build is the slow part — real outlines and real
// booleans — so it is debounced, the last good picture stays on screen while the next one is worked out, and a
// failed build says what to change rather than clearing the view. Nothing is fetched and nothing leaves the
// browser except what you ask to be saved.
//
// The font parser and the solid modeller come from Thingport through `library()`, shared with any other tool that
// wants them; the words come from `locales/<code>.json`, which Thingport reads and hands over as `t()`, so nothing
// the window says is buried in here.

import { DEFAULTS, buildModel } from "./engine.js";
import { flattenPath } from "./curves.js";
import { MAX_CHARACTERS, MAX_LINES, limitText, normalizeText, textStats } from "./text.js";
import { DEFAULT_COLOURS, colourIssues, colourSlot, normalizeColours, palette, targetLetters } from "./colours.js";
import { MAGNET_SIZES, effectiveBase, magnetMinimum, normalizeMagnets } from "./magnets.js";
import { edgeSizes } from "./finishing.js";
import { obj, stl, threeMf } from "./files.js";
import { createViewer } from "./viewer.js";

/** What each number control runs between, and what one notch of its slider is. Millimetres unless said. */
const RANGES = {
  width: [15, 400, 0.5],
  gap: [0, 10, 0.1],
  lineGap: [0, 50, 0.5],
  stroke: [-1, 3, 0.05],
  infill: [0, 15, 0.25],
  smoothRadius: [0.1, 2, 0.1],
  letterDepth: [0.4, 15, 0.1],
  borderDepth: [0.4, 15, 0.1],
  borderWidth: [0.4, 6, 0.1],
  base: [0.4, 30, 0.1],
  bridge: [0.6, 8, 0.1],
  clearance: [0, 0.8, 0.05],
  letterTopSize: [0, 3, 0.1],
  borderTopSize: [0, 3, 0.1],
  bottomBevelSize: [0, 3, 0.1],
  magnetDiameterGap: [0, 0.8, 0.05],
  magnetDepthGap: [0, 0.8, 0.05],
  magnetRibSize: [0, 0.4, 0.01],
};

/** The settings panels, in the order the chooser lists them. */
const SECTIONS = ["letters", "shape", "colours", "rings", "magnets"];

const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value, places = 1) => Number(value.toFixed(places));
const escapeHtml = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

export default async function mount(thingport) {
  const { root, theme, t, size, onResize, storage, models, collections, ui, download, library, tool } = thingport;
  const shell = root.querySelector("#krg-shell");
  const $ = (id) => root.querySelector(`#krg-${id}`);

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

  /** A keyring's name from what it says, so a saved model isn't called the same thing every time. */
  const titleFor = (text) => {
    const line = normalizeText(text).split("\n").join(" ").trim();
    if (!line) return t("notes.untitled");
    // "Keyring" on a keyring shouldn't come out as "Keyring keyring".
    return line.toLowerCase() === t("notes.untitled").toLowerCase() ? line : t("notes.name", { text: line });
  };

  /** An engine refusal in the user's own language, falling back to the English it came with. */
  const reason = (error) => (error?.code ? t(`error.${error.code}`, error.vars) : error?.message || String(error));

  // ---- what the window is showing ------------------------------------------------------------------------------

  let state = { ...clone(DEFAULTS), colours: clone(DEFAULT_COLOURS), fontId: "pt-sans", guide: "none" };
  let fonts = null;
  let font = null;
  let fontLabel = "";
  let manifold = null;
  let result = null; // the last build that worked
  let fresh = false; // whether that build matches the settings
  let section = "letters";
  let activeHole = 0;
  let activeMagnet = 0;
  let editing = null; // "holes" | "magnets" while something is being dragged about
  let picked = null;
  let failure = null;
  let busy = false;
  let revision = 0;
  let onBuilt = null; // an open dialog waiting to refresh itself
  const past = [];
  const future = [];
  const ownFonts = new Map();
  let timer = 0;
  let dead = false;

  const viewer = createViewer(await library("three"), $("canvas"), {
    onPick: (pick) => {
      picked = pick;
      viewer?.select(pick && pick.kind !== "handle" ? pick.index : null);
      if (pick?.kind === "handle") {
        if (pick.of === "holes") activeHole = pick.index;
        else activeMagnet = pick.index;
        if (section === (pick.of === "holes" ? "rings" : "magnets")) renderSheet();
      }
      showReadout();
    },
    onDrag: (pick, point, finished) => {
      if (pick.kind !== "handle" || !result) return;
      if (finished) {
        queue();
        return;
      }
      if (!point) return;
      const frame = result.placement;
      const halfWidth = Math.max(0.001, (frame.max[0] - frame.min[0]) / 2);
      const halfHeight = Math.max(0.001, (frame.max[1] - frame.min[1]) / 2);
      const cx = (frame.min[0] + frame.max[0]) / 2;
      const cy = (frame.min[1] + frame.max[1]) / 2;
      const target = pick.of === "holes" ? state.holes[pick.index] : state.magnets[pick.index];
      if (!target) return;
      target.x = Math.max(-1.6, Math.min(1.6, (point.x - cx) / halfWidth));
      target.y = Math.max(-1.6, Math.min(1.6, (point.y - cy) / halfHeight));
    },
  });

  // ---- keeping and undoing -------------------------------------------------------------------------------------

  const KEY = "keyring";
  const persist = () => {
    storage.set(KEY, { state, section }).catch(() => {}); // a full store shouldn't stop the tool
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
    queue();
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

  const queue = (delay = 220) => {
    fresh = false;
    persist();
    clearTimeout(timer);
    timer = setTimeout(build, delay);
  };

  async function build() {
    if (dead || !font || !manifold) return;
    const mine = ++revision;
    const doing = result ? t("state.working") : t("state.buildingFirst");
    setState("working", doing);
    showBusy(true, doing);
    // One turn of the event loop, so the spinner is actually painted before the modeller takes the thread.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (mine !== revision || dead) return;
    try {
      const built = buildModel(font, manifold, state, flattenPath);
      if (mine !== revision || dead) return;
      result = built;
      failure = null;
      fresh = true;
      state.textScale = built.textScale;
      // The engine slides a magnet that fell outside the piece back in; keep where it put it.
      if (state.magnetEnabled) {
        built.magnets.forEach((magnet, i) => {
          if (!state.magnets[i]) return;
          state.magnets[i].x = magnet.normalizedX;
          state.magnets[i].y = magnet.normalizedY;
        });
      }
      if (!state.widthLocked) state.width = round(built.size[0]);
      $("stop").hidden = true;
      showModel();
      setState("ready", built.connected ? t("state.ready") : t("state.readyInPieces"));
      persist();
      onBuilt?.();
    } catch (error) {
      if (mine !== revision || dead) return;
      failure = reason(error);
      fresh = false;
      $("stop-text").textContent = failure;
      $("stop").hidden = false;
      setState("error", t("state.checkSettings"));
      onBuilt?.();
    } finally {
      if (mine === revision && !dead) showBusy(false);
    }
  }

  // ---- drawing it ----------------------------------------------------------------------------------------------

  const slotColour = (model) => palette(state.colours)[colourSlot(model, state.colours)];
  // While a ring or magnet is being placed the letters go faint, so the piece underneath can be seen.
  const ghosted = (model) => Boolean(editing) && model.kind === "letter";

  function showModel(fit = true) {
    if (!result || !viewer) return;
    viewer.show(result.models, { colourOf: slotColour, hiddenOf: ghosted, fit });
    viewer.setGuide(state.guide);
    showHandles();
    const [width, height, depth] = result.size;
    $("dims").innerHTML = `<b>${width.toFixed(1)} × ${height.toFixed(1)} × ${depth.toFixed(1)}</b> mm`;
    const count = result.models.length;
    $("parts").innerHTML = `<b>${count}</b> ${count === 1 ? t("bar.piece") : t("bar.pieces")}`;
    showReadout();
  }

  function showHandles() {
    if (!viewer) return;
    if (!result || !editing) {
      viewer.setHandles([]);
      return;
    }
    const top = result.effectiveBase + state.borderDepth + 0.3;
    const list =
      editing === "holes"
        ? result.holes.map((hole, index) => ({
            pick: { kind: "handle", of: "holes", index },
            x: hole.x,
            y: hole.y,
            z: top,
            radius: hole.outer / 2,
            active: index === activeHole,
            colour: theme.primary,
          }))
        : result.magnets.map((magnet, index) => ({
            pick: { kind: "handle", of: "magnets", index },
            x: magnet.x,
            y: magnet.y,
            z: top,
            radius: magnet.diameter / 2,
            active: index === activeMagnet,
            colour: theme.warning,
          }));
    viewer.setHandles(list);
  }

  /** What the chosen piece is, and anything the engine wants to say, over the picture. */
  function showReadout() {
    const host = $("readout");
    const bits = [];
    if (result) {
      if (picked && picked.kind !== "handle") {
        const model = result.models[picked.index];
        if (model) {
          const which = colourName(colourSlot(model, state.colours));
          const what = model.char ? t("view.letter", { char: model.char }) : t("view.borderAndBase");
          bits.push(`<span class="krg-chip">${escapeHtml(what)} · <b>${escapeHtml(which)}</b></span>`);
        }
      }
      if (!result.connected) bits.push(`<span class="krg-chip">⚠ <b>${escapeHtml(t("view.notJoined"))}</b></span>`);
      for (const warning of result.warnings.slice(0, 2))
        bits.push(`<span class="krg-chip">${escapeHtml(warning)}</span>`);
    }
    host.innerHTML = bits.join("");
    host.hidden = !bits.length;
  }

  /** What a filament slot is for, in words. */
  const colourName = (slot) => {
    if (normalizeColours(state.colours).single) return t("notes.colourEverything");
    if (slot === 0) return t("notes.colourBorder");
    if (slot === 1) return t("notes.colourLetters");
    return t("notes.colourExtra", { n: slot - 1 });
  };

  // ---- little bits of form -------------------------------------------------------------------------------------

  const help = (text) =>
    `<button class="krg-help" type="button" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}">?</button>`;

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
    box.className = "krg-field krg-slider";
    box.innerHTML = `
      <span class="krg-label">${escapeHtml(label)}${hint ? help(hint) : ""}</span>
      <span class="krg-in">
        <input type="number" min="${min}" max="${max}" step="${stepSize}" value="${value}" aria-label="${escapeHtml(label)}">
        <i>${escapeHtml(unit)}</i>
      </span>
      <input type="range" min="${min}" max="${max}" step="${stepSize}" value="${value}" aria-label="${escapeHtml(label)}" tabindex="-1">
      ${after ? `<p class="krg-note">${escapeHtml(after)}</p>` : ""}`;
    const number = box.querySelector('input[type="number"]');
    const slider = box.querySelector('input[type="range"]');
    // One checkpoint for a whole drag, not one per pixel.
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
      set(round(next, 2));
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
      // An out-of-range figure typed in gets pulled back rather than ignored.
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
    box.className = "krg-field";
    box.innerHTML = `
      <span class="krg-label">${escapeHtml(label)}${hint ? help(hint) : ""}</span>
      <div class="krg-seg" role="group" aria-label="${escapeHtml(label)}">
        ${options
          .map(
            (option) =>
              `<button type="button" data-value="${escapeHtml(option.value)}" aria-pressed="${option.value === current}">${escapeHtml(option.label)}</button>`,
          )
          .join("")}
      </div>`;
    box.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.value === current) return;
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
    row.className = "krg-switch";
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

  const group = (host, title, hint) => {
    const box = document.createElement("div");
    box.className = "krg-group";
    if (title) box.innerHTML = `<h3>${escapeHtml(title)}${hint ? help(hint) : ""}</h3>`;
    host.append(box);
    return box;
  };
  const fields = (host) => {
    const box = document.createElement("div");
    box.className = "krg-fields";
    host.append(box);
    return box;
  };
  const note = (host, text, kind = "note") => {
    const line = document.createElement("p");
    line.className = `krg-${kind}`;
    line.innerHTML = text;
    host.append(line);
    return line;
  };

  // ---- which settings are showing ------------------------------------------------------------------------------

  function renderNav() {
    const select = $("nav");
    select.innerHTML = SECTIONS.map((id) => {
      const count =
        id === "rings" ? state.holes.length : id === "magnets" && state.magnetEnabled ? state.magnets.length : 0;
      return `<option value="${id}" ${id === section ? "selected" : ""}>${escapeHtml(t(`nav.${id}`))}${count ? ` (${count})` : ""}</option>`;
    }).join("");
  }

  const renderAll = () => {
    renderNav();
    renderSheet();
    $("guide").value = state.guide;
  };

  function renderSheet() {
    const host = $("sheet");
    host.replaceChildren();
    const panels = {
      letters: panelLetters,
      shape: panelShape,
      colours: panelColours,
      rings: panelRings,
      magnets: panelMagnets,
    };
    (panels[section] ?? panelLetters)(host);
    renderNav();
  }

  // ---- Letters -------------------------------------------------------------------------------------------------

  const countText = (stats) =>
    t(stats.lines === 1 ? "letters.countOne" : "letters.countMany", {
      characters: stats.characters,
      maxCharacters: MAX_CHARACTERS,
      lines: stats.lines,
      maxLines: MAX_LINES,
    });

  function panelLetters(host) {
    const text = group(host, t("letters.whatItSays"));
    const box = document.createElement("textarea");
    box.className = "krg-text";
    box.id = "krg-textbox";
    box.value = state.text;
    box.rows = 3;
    box.spellcheck = false;
    box.setAttribute("aria-label", t("letters.textLabel"));
    box.style.textAlign = state.align;
    text.append(box);
    const stats = textStats(state.text);
    const counter = note(text, escapeHtml(countText(stats)));
    let typing = 0;
    box.addEventListener("input", () => {
      const limited = limitText(box.value);
      if (limited !== box.value) {
        const at = box.selectionStart;
        box.value = limited;
        box.setSelectionRange(Math.min(at, limited.length), Math.min(at, limited.length));
      }
      // One checkpoint per burst of typing, so undo goes back a word rather than a letter.
      clearTimeout(typing);
      if (!typing) checkpoint();
      typing = setTimeout(() => (typing = 0), 700);
      state.text = box.value;
      counter.textContent = countText(textStats(state.text));
      queue(360);
    });

    segmented(
      text,
      t("letters.align"),
      [
        { value: "left", label: t("letters.alignLeft") },
        { value: "center", label: t("letters.alignCentre") },
        { value: "right", label: t("letters.alignRight") },
      ],
      state.align,
      (value) => (state.align = value),
    );
    if (stats.lines > 1) control(fields(text), "lineGap", t("letters.lineGap"));

    const face = group(host, t("letters.typeface"));
    note(face, t("letters.inUse", { name: `<b>${escapeHtml(fontLabel || t("letters.loading"))}</b>` }));
    const grid = document.createElement("div");
    grid.className = "krg-fonts";
    face.append(grid);
    const all = [
      ...(fonts?.list ?? []).map((item) => ({ ...item, group: t(`font.${item.group}`) })),
      ...[...ownFonts.values()].map((item) => ({ id: item.id, name: item.name, group: t("letters.yours") })),
    ];
    for (const item of all) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "krg-font";
      card.dataset.font = item.id;
      card.setAttribute("aria-pressed", String(item.id === state.fontId));
      card.innerHTML = `<em>${escapeHtml(item.name)}</em><span>${escapeHtml(item.group)}</span>`;
      card.addEventListener("click", () => {
        if (item.id === state.fontId) return;
        checkpoint();
        state.fontId = item.id;
        useFont(item.id).then(() => queue(0));
        renderSheet();
      });
      grid.append(card);
    }
    showFontSamples(grid);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "krg-btn";
    add.textContent = t("letters.addFont");
    add.addEventListener("click", pickFontFile);
    face.append(add);
    note(face, escapeHtml(t("letters.addFontNote")));

    const sizes = group(host, t("letters.sizeSpacing"));
    toggle(
      sizes,
      t("letters.keepWidth"),
      state.widthLocked,
      (on) => (state.widthLocked = on),
      t("letters.keepWidthHint"),
    );
    const row = fields(sizes);
    control(row, "width", state.widthLocked ? t("letters.width") : t("letters.widthFollows"), {
      set: (value) => {
        state.width = value;
        state.textScale = null; // a width typed in means solve for the letter size again
      },
    });
    control(row, "gap", t("letters.gap"), { hint: t("letters.gapHint") });
    control(row, "stroke", t("letters.stroke"), { hint: t("letters.strokeHint") });
  }

  /** Each typeface's name written in that typeface, once the card is on screen. */
  function showFontSamples(grid) {
    if (!fonts || !("FontFace" in window)) return;
    const seen = new Set();
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = entry.target.dataset.font;
        watcher.unobserve(entry.target);
        if (seen.has(id)) continue;
        seen.add(id);
        const sample = entry.target.querySelector("em");
        const own = ownFonts.get(id);
        const source = own ? Promise.resolve(own.data) : fonts.bytes(id);
        source
          .then(async (data) => {
            const face = new FontFace(`krg-${id}`, data);
            await face.load();
            document.fonts.add(face);
            sample.style.fontFamily = `"krg-${id}", ${theme.fontFamily}`;
          })
          .catch(() => {}); // a sample that won't render just stays in the window's own font
      }
    });
    grid.querySelectorAll(".krg-font").forEach((card) => watcher.observe(card));
  }

  // ---- Shape ---------------------------------------------------------------------------------------------------

  function panelShape(host) {
    const heights = group(host, t("shape.heights"));
    const one = fields(heights);
    control(one, "letterDepth", t("shape.letterDepth"));
    control(one, "borderDepth", t("shape.borderDepth"));
    control(one, "base", t("shape.base"), {
      get: () => effectiveBase(state),
      set: (value) => {
        if (state.magnetEnabled && normalizeMagnets(state).length) {
          state.magnetAutoHeight = false;
          state.magnetBase = value;
        } else state.base = value;
      },
      min: magnetMinimum(state),
      hint: t("shape.baseHint"),
    });

    const border = group(host, t("shape.border"));
    const two = fields(border);
    control(two, "borderWidth", t("shape.borderWidth"), { hint: t("shape.borderWidthHint") });
    control(two, "infill", t("shape.infill"), { hint: t("shape.infillHint") });
    control(two, "bridge", t("shape.bridge"), { hint: t("shape.bridgeHint") });
    toggle(border, t("shape.fillVoids"), state.fillVoids, (on) => (state.fillVoids = on), t("shape.fillVoidsHint"));
    toggle(border, t("shape.smooth"), state.smoothBorder, (on) => (state.smoothBorder = on));
    if (state.smoothBorder) control(fields(border), "smoothRadius", t("shape.smoothRadius"));

    const edges = group(host, t("shape.edges"), t("shape.edgesHint"));
    const applied = edgeSizes(state);
    segmented(
      edges,
      t("shape.bottomEdge"),
      [
        { value: "none", label: t("shape.square") },
        { value: "bevel", label: t("shape.chamfer") },
      ],
      state.borderBevel ? "bevel" : "none",
      (value) => {
        state.borderBevel = value === "bevel";
        if (value === "none") state.bottomBevelSize = 0;
        else if (!state.bottomBevelSize) state.bottomBevelSize = null;
      },
    );
    const three = fields(edges);
    control(three, "letterTopSize", t("shape.letterTop"), {
      get: () => applied.letter,
      set: (value) => (state.letterTopSize = value),
    });
    control(three, "borderTopSize", t("shape.borderTop"), {
      get: () => applied.border,
      set: (value) => (state.borderTopSize = value),
    });
    if (state.borderBevel) {
      control(three, "bottomBevelSize", t("shape.bottomBevel"), {
        get: () => applied.bottom,
        set: (value) => (state.bottomBevelSize = value),
      });
    }
    if (result?.finishing?.edges) {
      const names = { letter: t("shape.edgeLetters"), border: t("shape.edgeBorder"), bottom: t("shape.edgeBottom") };
      const given = Object.entries(result.finishing.edges)
        .filter(([, value]) => value.asked > 0)
        .map(([key, value]) => {
          const name = names[key] ?? key;
          return value.min + 0.001 < value.asked
            ? `${name} ${value.min.toFixed(2)} mm ${t("shape.heldBack", { asked: value.asked.toFixed(2) })}`
            : `${name} ${value.asked.toFixed(2)} mm`;
        });
      if (given.length) note(edges, escapeHtml(t("shape.eased", { list: given.join(" · ") })));
    }
  }

  // ---- Colours -------------------------------------------------------------------------------------------------

  function panelColours(host) {
    const colours = normalizeColours(state.colours);
    state.colours = colours;

    const how = group(host, t("colours.howMany"));
    segmented(
      how,
      t("colours.howMany"),
      [
        { value: "one", label: t("colours.one") },
        { value: "two", label: t("colours.two") },
      ],
      colours.single ? "one" : "two",
      (value) => (state.colours.single = value === "one"),
    );

    if (colours.single) {
      swatch(
        how,
        t("colours.everything"),
        t("colours.everythingHint"),
        colours.border,
        (value) => (state.colours.border = value),
      );
      note(host, escapeHtml(t("colours.oneNote")));
      return;
    }

    const main = group(host, t("colours.theTwo"));
    swatch(
      main,
      t("colours.borderAndBase"),
      t("colours.borderAndBaseHint"),
      colours.border,
      (value) => (state.colours.border = value),
    );
    swatch(
      main,
      t("colours.letters"),
      t("colours.lettersHint"),
      colours.letter,
      (value) => (state.colours.letter = value),
    );

    colours.extras.forEach((extra, i) => {
      const box = group(host, t("colours.extra", { n: i + 1 }));
      toggle(box, t("colours.useIt"), extra.enabled, (on) => (state.colours.extras[i].enabled = on));
      if (!extra.enabled) return;
      swatch(box, t("colours.colour"), "", extra.colour, (value) => (state.colours.extras[i].colour = value));
      segmented(
        box,
        t("colours.whichLetters"),
        [
          { value: "text", label: t("colours.byCharacter") },
          { value: "positions", label: t("colours.byPosition") },
        ],
        extra.mode,
        (value) => (state.colours.extras[i].mode = value),
      );
      if (extra.mode === "text") {
        const field = document.createElement("div");
        field.className = "krg-field";
        field.innerHTML = `<span class="krg-label">${escapeHtml(t("colours.characters"))}${help(t("colours.charactersHint"))}</span>
          <span class="krg-in"><input type="text" value="${escapeHtml(extra.targets)}" placeholder="${escapeHtml(t("colours.charactersPlaceholder"))}" aria-label="${escapeHtml(t("colours.charactersLabel", { n: i + 1 }))}"></span>`;
        const input = field.querySelector("input");
        let typing = 0;
        input.addEventListener("input", () => {
          clearTimeout(typing);
          if (!typing) checkpoint();
          typing = setTimeout(() => (typing = 0), 700);
          state.colours.extras[i].targets = input.value;
          queue(360);
        });
        box.append(field);
        const chosen = targetLetters(extra.targets);
        if (chosen.length) note(box, t("colours.on", { list: `<b>${escapeHtml(chosen.join(" "))}</b>` }));
      } else {
        const letters = [...normalizeText(state.text)]
          .map((character, index) => ({ character, index }))
          .filter((item) => item.character.trim() && item.character !== "\n");
        const row = document.createElement("div");
        row.className = "krg-seg";
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", t("colours.whichLettersLabel", { n: i + 1 }));
        row.style.flexWrap = "wrap";
        row.innerHTML = letters
          .map(
            (item) =>
              `<button type="button" data-index="${item.index}" aria-pressed="${extra.indices.includes(item.index)}" style="flex:0 0 auto;min-width:26px">${escapeHtml(item.character)}</button>`,
          )
          .join("");
        row.querySelectorAll("button").forEach((button) => {
          button.addEventListener("click", () => {
            checkpoint();
            const index = Number(button.dataset.index);
            const held = state.colours.extras[i].indices;
            const at = held.indexOf(index);
            if (at >= 0) held.splice(at, 1);
            else held.push(index);
            renderSheet();
            queue();
          });
        });
        box.append(row);
      }
    });

    const issues = colourIssues(normalizeText(state.text), colours, result?.models);
    if (issues.duplicates.length) {
      note(host, t("colours.bothNamed", { characters: `<b>${escapeHtml(issues.duplicates.join(" "))}</b>` }), "bad");
    }
    if (issues.missing.length) {
      note(host, t("colours.notInText", { characters: `<b>${escapeHtml(issues.missing.join(" "))}</b>` }), "warn");
    }
    note(host, escapeHtml(t("colours.note")));
  }

  function swatch(host, label, hint, value, set) {
    const row = document.createElement("div");
    row.className = "krg-colour";
    row.innerHTML = `<div><strong>${escapeHtml(label)}</strong>${hint ? `<span>${escapeHtml(hint)}</span>` : ""}</div>
      <input class="krg-swatch" type="color" value="${escapeHtml(value)}" aria-label="${escapeHtml(label)}">`;
    const input = row.querySelector("input");
    let started = false;
    input.addEventListener("input", () => {
      if (!started) {
        checkpoint();
        started = true;
      }
      set(input.value);
      if (result) showModel(false);
      persist();
    });
    input.addEventListener("change", () => (started = false));
    host.append(row);
  }

  // ---- Rings ---------------------------------------------------------------------------------------------------

  function panelRings(host) {
    const top = group(host, t("rings.title"), t("rings.hint"));
    const buttons = document.createElement("div");
    buttons.style.display = "flex";
    buttons.style.gap = "6px";
    buttons.innerHTML = `<button class="krg-btn" type="button" id="krg-add-hole">${escapeHtml(t("rings.add"))}</button>`;
    top.append(buttons);
    buttons.querySelector("#krg-add-hole").addEventListener("click", () => {
      checkpoint();
      state.holes.push({
        x: state.holes.length ? 0.94 : -0.94,
        y: 0.2,
        inner: 4,
        outer: 8,
        localJoin: true,
        reinforce: true,
      });
      activeHole = state.holes.length - 1;
      renderSheet();
      queue();
    });
    if (state.holes.length) {
      const place = document.createElement("button");
      place.type = "button";
      place.className = `krg-btn${editing === "holes" ? " krg-btn-on" : ""}`;
      place.textContent = editing === "holes" ? t("rings.stopPlacing") : t("rings.place");
      place.addEventListener("click", () => (editing === "holes" ? stopEditing() : startEditing("holes")));
      buttons.append(place);
    }

    if (!state.holes.length) {
      const empty = document.createElement("div");
      empty.className = "krg-empty";
      empty.innerHTML = `<span>${escapeHtml(t("rings.none"))}</span>`;
      const add = document.createElement("button");
      add.type = "button";
      add.className = "krg-btn krg-btn-main";
      add.textContent = t("rings.addOne");
      add.addEventListener("click", () => buttons.querySelector("#krg-add-hole").click());
      empty.append(add);
      host.append(empty);
      return;
    }

    activeHole = Math.max(0, Math.min(activeHole, state.holes.length - 1));
    state.holes.forEach((hole, i) => {
      const card = document.createElement("div");
      card.className = "krg-card";
      card.dataset.active = String(i === activeHole);
      const spec = t("rings.spec", {
        inner: hole.inner.toFixed(1),
        collar: ((hole.outer - hole.inner) / 2).toFixed(1),
      });
      card.innerHTML = `<div class="krg-card-top">
          <strong>${escapeHtml(t("rings.ring", { n: i + 1 }))}</strong>
          <em>${escapeHtml(spec)}</em>
          <button class="krg-x" type="button" aria-label="${escapeHtml(t("rings.remove", { n: i + 1 }))}">✕</button>
        </div>`;
      card.querySelector(".krg-x").addEventListener("click", (event) => {
        event.stopPropagation();
        checkpoint();
        state.holes.splice(i, 1);
        activeHole = Math.min(activeHole, state.holes.length - 1);
        if (!state.holes.length) stopEditing();
        renderSheet();
        queue();
      });
      card.addEventListener("click", () => {
        if (activeHole === i) return;
        activeHole = i;
        renderSheet();
        showHandles();
      });
      host.append(card);
      if (i !== activeHole) return;
      const row = fields(card);
      control(row, `holeOuter${i}`, t("rings.across"), {
        get: () => hole.outer,
        set: (value) => {
          const ratio = hole.inner / hole.outer;
          hole.outer = value;
          hole.inner = round(value * ratio, 2);
        },
        min: 3,
        max: 25,
        step: 0.5,
      });
      control(row, `holeInner${i}`, t("rings.hole"), {
        get: () => hole.inner,
        set: (value) => (hole.inner = Math.min(value, round(hole.outer * 0.9, 2))),
        min: 1,
        max: 22,
        step: 0.5,
      });
      toggle(
        card,
        t("rings.reinforce"),
        hole.reinforce !== false,
        (on) => (hole.reinforce = on),
        t("rings.reinforceHint"),
      );
    });
    note(host, escapeHtml(t("rings.dragNote")));
  }

  function startEditing(what) {
    editing = what;
    $("editing").hidden = false;
    $("editing-text").textContent = what === "holes" ? t("view.placeRing") : t("view.placeMagnet");
    showModel(false);
    renderSheet();
  }
  function stopEditing() {
    if (!editing) return;
    editing = null;
    $("editing").hidden = true;
    showModel(false);
    renderSheet();
  }

  // ---- Magnets -------------------------------------------------------------------------------------------------

  function panelMagnets(host) {
    const top = group(host, t("magnets.title"), t("magnets.hint"));
    toggle(top, t("magnets.sink"), state.magnetEnabled, (on) => {
      state.magnetEnabled = on;
      if (on && !state.magnets.length) state.magnets = [{ diameter: 6, depth: 2, x: 0, y: 0 }];
    });
    if (!state.magnetEnabled) {
      note(top, escapeHtml(t("magnets.note")));
      return;
    }

    segmented(
      top,
      t("magnets.howItGoesIn"),
      [
        { value: "open", label: t("magnets.fromBack") },
        { value: "embedded", label: t("magnets.midPrint") },
      ],
      state.magnetMode,
      (value) => (state.magnetMode = value),
      t("magnets.howItGoesInHint"),
    );
    note(top, escapeHtml(state.magnetMode === "embedded" ? t("magnets.embeddedNote") : t("magnets.openNote")));

    const list = group(host, t("magnets.which"));
    const add = document.createElement("button");
    add.type = "button";
    add.className = "krg-btn";
    add.textContent = t("magnets.add");
    add.disabled = state.magnets.length >= 6;
    add.addEventListener("click", () => {
      checkpoint();
      const last = state.magnets[state.magnets.length - 1];
      state.magnets.push({ diameter: last?.diameter ?? 6, depth: last?.depth ?? 2, x: 0, y: 0 });
      activeMagnet = state.magnets.length - 1;
      renderSheet();
      queue();
    });
    list.append(add);
    if (state.magnets.length) {
      const place = document.createElement("button");
      place.type = "button";
      place.className = `krg-btn${editing === "magnets" ? " krg-btn-on" : ""}`;
      place.textContent = editing === "magnets" ? t("rings.stopPlacing") : t("rings.place");
      place.addEventListener("click", () => (editing === "magnets" ? stopEditing() : startEditing("magnets")));
      list.append(place);
    }

    activeMagnet = Math.max(0, Math.min(activeMagnet, state.magnets.length - 1));
    normalizeMagnets(state).forEach((magnet, i) => {
      const card = document.createElement("div");
      card.className = "krg-card";
      card.dataset.active = String(i === activeMagnet);
      card.innerHTML = `<div class="krg-card-top">
          <strong>${escapeHtml(t("magnets.magnet", { n: i + 1 }))}</strong>
          <em>${escapeHtml(t("magnets.spec", { diameter: magnet.diameter, depth: magnet.depth }))}</em>
          <button class="krg-x" type="button" aria-label="${escapeHtml(t("magnets.remove", { n: i + 1 }))}">✕</button>
        </div>`;
      card.querySelector(".krg-x").addEventListener("click", (event) => {
        event.stopPropagation();
        checkpoint();
        state.magnets.splice(i, 1);
        activeMagnet = Math.min(activeMagnet, state.magnets.length - 1);
        if (!state.magnets.length) stopEditing();
        renderSheet();
        queue();
      });
      card.addEventListener("click", () => {
        if (activeMagnet === i) return;
        activeMagnet = i;
        renderSheet();
        showHandles();
      });
      host.append(card);
      if (i !== activeMagnet) return;
      const field = document.createElement("div");
      field.className = "krg-field";
      field.innerHTML = `<span class="krg-label">${escapeHtml(t("magnets.yours"))}</span>
        <span class="krg-in"><select aria-label="${escapeHtml(t("magnets.sizeLabel", { n: i + 1 }))}">${MAGNET_SIZES.map(
          ([diameter, depth]) =>
            `<option value="${diameter}x${depth}" ${diameter === magnet.diameter && depth === magnet.depth ? "selected" : ""}>${escapeHtml(t("magnets.spec", { diameter, depth }))}</option>`,
        ).join("")}</select></span>`;
      const select = field.querySelector("select");
      select.addEventListener("change", () => {
        checkpoint();
        const [diameter, depth] = select.value.split("x").map(Number);
        Object.assign(state.magnets[i], { diameter, depth });
        renderSheet();
        queue();
      });
      card.append(field);
      note(
        card,
        t("magnets.pocket", {
          diameter: `<b>${(magnet.diameter + (+state.magnetDiameterGap || 0)).toFixed(2)}</b>`,
          depth: `<b>${(magnet.depth + (+state.magnetDepthGap || 0)).toFixed(2)}</b>`,
        }),
      );
    });

    const fit = group(host, t("magnets.fit"));
    const row = fields(fit);
    control(row, "magnetDiameterGap", t("magnets.extraAcross"), { step: 0.05, hint: t("magnets.extraAcrossHint") });
    control(row, "magnetDepthGap", t("magnets.extraDeep"), { step: 0.05 });
    toggle(fit, t("magnets.ribs"), state.magnetRibs, (on) => (state.magnetRibs = on), t("magnets.ribsHint"));
    if (state.magnetRibs) control(fields(fit), "magnetRibSize", t("magnets.ribSize"), { step: 0.01 });
    toggle(fit, t("magnets.autoBase"), state.magnetAutoHeight !== false, (on) => (state.magnetAutoHeight = on));
    note(
      fit,
      t("magnets.baseNote", {
        min: `<b>${magnetMinimum(state).toFixed(1)}</b>`,
        actual: `<b>${effectiveBase(state).toFixed(1)}</b>`,
      }),
    );
    note(host, escapeHtml(t("magnets.dragNote")));
  }

  // ---- what comes out, asked when a file is wanted -------------------------------------------------------------

  /**
   * The joined/separate choice, as a block a dialog can hold. It changes the model, so a change rebuilds, and
   * `onChange` lets the dialog refresh whatever it shows about the result.
   */
  function outputFields(host, onChange) {
    const box = document.createElement("div");
    box.className = "krg-group";
    box.innerHTML = `<h3>${escapeHtml(t("output.title"))}${help(t("output.hint"))}</h3>`;
    host.append(box);
    const refresh = () => {
      renderSheet();
      queue(0);
      onChange?.();
    };
    const row = (label, on, change, hint) => {
      const line = document.createElement("label");
      line.className = "krg-switch";
      line.innerHTML = `<input type="checkbox" ${on ? "checked" : ""}><span>${escapeHtml(label)}</span>${hint ? help(hint) : ""}`;
      const input = line.querySelector("input");
      input.addEventListener("change", () => {
        checkpoint();
        change(input.checked);
        rebuildOutput();
        refresh();
      });
      box.append(line);
    };
    const rebuildOutput = () => {
      box.replaceChildren();
      box.innerHTML = `<h3>${escapeHtml(t("output.title"))}${help(t("output.hint"))}</h3>`;
      row(t("output.joined"), state.assembled, (on) => (state.assembled = on));
      row(t("output.separate"), state.separate, (on) => (state.separate = on));
      if (state.separate) control(fields(box), "clearance", t("output.clearance"), { hint: t("output.clearanceHint") });
      if (!state.assembled && !state.separate) note(box, escapeHtml(t("output.pickOne")), "bad");
      else if (state.assembled && state.separate) note(box, escapeHtml(t("output.both")));
    };
    rebuildOutput();
    return { valid: () => state.assembled || state.separate };
  }

  // ---- what to print, in words ---------------------------------------------------------------------------------

  /** What to print, as words: the saved model's description, and the text file. `title` is what it's called. */
  function printNotes(title = titleFor(state.text)) {
    const [width, height, depth] = result.size;
    const colours = normalizeColours(state.colours);
    const used = palette(colours);
    const slots = new Map();
    for (const model of result.models) {
      const slot = colourSlot(model, colours);
      if (!slots.has(slot)) slots.set(slot, []);
      slots.get(slot).push(model.char || t("view.borderAndBase"));
    }
    const lines = [
      title,
      "",
      t("notes.says", { text: normalizeText(state.text).replace(/\n/g, " / ") }),
      t("notes.typeface", { name: fontLabel }),
      t("notes.size", { width: width.toFixed(1), height: height.toFixed(1), depth: depth.toFixed(1) }),
      t("notes.build", {
        base: effectiveBase(state).toFixed(1),
        border: state.borderDepth.toFixed(1),
        letters: state.letterDepth.toFixed(1),
      }),
      "",
      t("notes.filaments"),
    ];
    for (const [slot, parts] of [...slots].sort((a, b) => a[0] - b[0])) {
      lines.push(`  ${slot + 1}. ${used[slot]} — ${colourName(slot)}: ${parts.join(" ")}`);
    }
    lines.push(
      "",
      t("notes.printing"),
      `  ${
        state.assembled && !state.separate
          ? t("notes.onePiece")
          : state.separate && !state.assembled
            ? t("notes.apartOnly", { clearance: state.clearance.toFixed(2) })
            : t("notes.bothWays", { clearance: state.clearance.toFixed(2) })
      }`,
      `  ${t("notes.noSupports")}`,
    );
    if (state.magnetEnabled && normalizeMagnets(state).length) {
      const magnets = normalizeMagnets(state);
      lines.push(
        "",
        t("notes.magnets"),
        `  ${t("notes.magnetList", {
          count: magnets.length,
          list: magnets
            .map((magnet) => t("magnets.spec", { diameter: magnet.diameter, depth: magnet.depth }))
            .join(", "),
        })}`,
        `  ${state.magnetMode === "embedded" ? t("notes.magnetEmbedded") : t("notes.magnetOpen")}`,
      );
    }
    if (state.holes.length) {
      lines.push(
        "",
        t("notes.rings"),
        ...state.holes.map(
          (hole, i) =>
            `  ${t("notes.ring", { n: i + 1, inner: hole.inner.toFixed(1), collar: ((hole.outer - hole.inner) / 2).toFixed(1) })}`,
        ),
      );
    }
    if (result.warnings.length)
      lines.push("", t("notes.worthKnowing"), ...result.warnings.map((warning) => `  - ${warning}`));
    if (!result.connected) lines.push("", `  ${t("notes.inPieces")}`);
    lines.push("", t("notes.madeWith", { version: tool.version }));
    return lines.join("\n");
  }

  // ---- the files -----------------------------------------------------------------------------------------------

  /** A file name from what the keyring says, or from whatever it is being saved as. */
  const fileBase = (from = state.text) =>
    (
      normalizeText(from)
        .split("\n")
        .join("-")
        .replace(/[^\w-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "keyring"
    ).slice(0, 40);

  async function fileFor(kind, named) {
    const base = fileBase(named ?? state.text);
    const options = { separate: state.separate && !state.assembled, title: named?.trim() || titleFor(state.text) };
    if (kind === "3mf") return { name: `${base}.3mf`, data: await threeMf(result.models, state.colours, options) };
    if (kind === "obj") return { name: `${base}.obj`, data: obj(result.models, options) };
    if (kind === "stl") return { name: `${base}.stl`, data: stl(result.models, options) };
    return { name: `${base}-print-notes.txt`, data: printNotes() };
  }

  async function ensureFresh() {
    if (fresh && result) return true;
    if (busy) {
      ui.toast(t("toast.stillWorking"), "info");
      return false;
    }
    clearTimeout(timer);
    await build();
    if (!fresh || !result) {
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

  /** A menu hung under a button in the top bar. */
  function openMenu(button, items) {
    shutMenu();
    menu = document.createElement("div");
    menu.className = "krg-menu";
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

  /** A dialog over the window. `build(body, close)` fills it; it returns the element. */
  function openDialog(title, fill) {
    const cover = document.createElement("div");
    cover.className = "krg-cover";
    cover.innerHTML = `<div class="krg-dialog" role="dialog" aria-modal="true" aria-labelledby="krg-dialog-title">
        <div class="krg-dialog-top">
          <h2 id="krg-dialog-title">${escapeHtml(title)}</h2>
          <button class="krg-x" type="button" data-shut aria-label="${escapeHtml(t("save.close"))}">✕</button>
        </div>
        <div class="krg-dialog-body"></div>
        <div class="krg-dialog-foot"></div>
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
    fill(cover.querySelector(".krg-dialog-body"), cover.querySelector(".krg-dialog-foot"), close);
    return cover;
  }

  const footButton = (foot, label, main = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `krg-btn${main ? " krg-btn-main" : ""}`;
    button.textContent = label;
    foot.append(button);
    return button;
  };

  // ---- downloading ---------------------------------------------------------------------------------------------

  const FORMATS = [
    { id: "3mf", label: () => t("file.3mf"), note: () => t("file.3mfNote") },
    { id: "obj", label: () => t("file.obj"), note: () => t("file.objNote") },
    { id: "stl", label: () => t("file.stl"), note: () => t("file.stlNote") },
    null,
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
        format ? { id: format.id, label: format.label(), note: format.note(), go: () => askOutput(format.id) } : null,
      ),
    );
  });

  /** What comes out, then the file. The notes aren't geometry, so they skip the question. */
  function askOutput(kind) {
    if (kind === "notes") {
      void handDown(kind);
      return;
    }
    openDialog(t("output.title"), (body, foot, close) => {
      const output = outputFields(body);
      footButton(foot, t("output.cancel")).addEventListener("click", close);
      const go = footButton(foot, t("output.downloadAs", { format: t(`file.${kind}`) }), true);
      const sync = () => (go.disabled = !output.valid());
      onBuilt = sync;
      sync();
      body.addEventListener("change", sync);
      go.addEventListener("click", async () => {
        if (!output.valid()) return;
        close();
        await handDown(kind);
      });
    });
  }

  async function handDown(kind) {
    if (!(await ensureFresh())) return;
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
    const suggested = titleFor(state.text);
    openDialog(t("save.title"), (body, foot, close) => {
      const output = outputFields(body);

      const name = document.createElement("div");
      name.className = "krg-field";
      name.innerHTML = `<span class="krg-label">${escapeHtml(t("save.name"))}</span>
        <span class="krg-in"><input id="krg-save-name" type="text" value="${escapeHtml(suggested)}" aria-label="${escapeHtml(t("save.nameLabel"))}"></span>`;
      body.append(name);
      note(body, escapeHtml(t("save.where")));

      footButton(foot, t("output.cancel")).addEventListener("click", close);
      const go = footButton(foot, t("save.go"), true);
      const nameBox = name.querySelector("input");
      const sync = () => (go.disabled = !output.valid());
      onBuilt = sync;
      sync();
      nameBox.focus();
      nameBox.select();
      nameBox.addEventListener("keydown", (event) => {
        if (event.key === "Enter") go.click();
      });

      go.addEventListener("click", async () => {
        if (!output.valid()) return;
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
          // What to print goes in the model's own description, where it is read rather than downloaded.
          const model = await models.create({
            name: chosen,
            description: printNotes(chosen),
            tags: ["keyring", "generated"],
            collectionId: collection.id,
            files: [await fileFor("3mf", chosen)],
          });
          const picture = await viewer?.toBlob("image/png");
          if (picture) await models.addImages(model.id, [{ name: `${fileBase(chosen)}.png`, data: picture }]);
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
      {
        id: "reset",
        label: t("bar.startAgain"),
        go: async () => {
          if (!(await ui.confirm({ title: t("bar.startAgainTitle"), message: t("bar.startAgainBody") }))) return;
          checkpoint();
          state = { ...clone(DEFAULTS), colours: clone(DEFAULT_COLOURS), fontId: state.fontId, guide: state.guide };
          renderAll();
          queue(0);
        },
      },
    ]);
  });

  shell.addEventListener("pointerdown", (event) => {
    if (menu && !menu.contains(event.target) && !event.target.closest("#krg-download, #krg-more")) shutMenu();
  });

  $("nav").addEventListener("change", () => {
    section = $("nav").value;
    if (editing && editing !== (section === "rings" ? "holes" : section === "magnets" ? "magnets" : null))
      stopEditing();
    persist();
    renderSheet();
  });
  $("undo").addEventListener("click", () => step(past, future));
  $("redo").addEventListener("click", () => step(future, past));
  $("fit").addEventListener("click", () => viewer?.look("home"));
  $("stop-retry").addEventListener("click", () => queue(0));
  $("editing-done").addEventListener("click", stopEditing);
  $("views")
    .querySelectorAll("button")
    .forEach((button) => {
      button.addEventListener("click", () => {
        $("views")
          .querySelectorAll("button")
          .forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
        viewer?.look(button.dataset.view);
      });
    });
  $("guide").addEventListener("change", () => {
    state.guide = $("guide").value;
    viewer?.setGuide(state.guide);
    persist();
  });

  const keys = (event) => {
    if (!shell.contains(event.target) && event.target !== document.body) return;
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      step(event.shiftKey ? future : past, event.shiftKey ? past : future);
    } else if (event.key === "Escape") {
      if (menu) shutMenu();
      else if (editing) stopEditing();
    }
  };
  window.addEventListener("keydown", keys);

  let last = size;
  onResize((next) => {
    if (next.width !== last.width || next.height !== last.height) viewer?.redraw();
    last = next;
    if (menu) shutMenu();
  });

  // ---- fonts ---------------------------------------------------------------------------------------------------

  async function useFont(id) {
    const own = ownFonts.get(id);
    try {
      if (own) {
        const opentype = await library("opentype");
        font = opentype.parse(own.data.slice(0));
        fontLabel = own.name;
      } else {
        font = await fonts.load(id);
        fontLabel = fonts.list.find((item) => item.id === id)?.name ?? id;
      }
      state.fontId = id;
      if (section === "letters") renderSheet();
      return true;
    } catch (error) {
      ui.toast(t("toast.fontFailed", { error: error.message }), "error");
      return false;
    }
  }

  function pickFontFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ttf,.otf,font/ttf,font/otf";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) {
        ui.toast(t("toast.fontTooBig"), "error");
        return;
      }
      const data = await file.arrayBuffer();
      const id = `own-${ownFonts.size + 1}`;
      try {
        const opentype = await library("opentype");
        opentype.parse(data.slice(0)); // fail here rather than halfway through a build
      } catch (error) {
        ui.toast(t("toast.notAFont", { error: error.message }), "error");
        return;
      }
      ownFonts.set(id, { id, name: file.name.replace(/\.(ttf|otf)$/i, ""), data });
      checkpoint();
      if (await useFont(id)) {
        renderSheet();
        queue(0);
      }
    });
    input.click();
  }

  // ---- getting going -------------------------------------------------------------------------------------------

  // The window's own words, before anything is loaded.
  for (const [id, text] of [
    ["undo", t("bar.undo")],
    ["redo", t("bar.redo")],
    ["more", t("bar.more")],
    ["fit", t("view.fit")],
    ["editing-done", t("view.done")],
    ["stop-retry", t("state.tryAgain")],
  ]) {
    $(id).setAttribute("aria-label", text);
    $(id).title = text;
  }
  $("undo").title = t("bar.undoHint");
  $("redo").title = t("bar.redoHint");
  $("editing-done").textContent = t("view.done");
  $("stop-retry").textContent = t("state.tryAgain");
  $("download").lastChild.textContent = ` ${t("bar.download")}`;
  $("save").lastChild.textContent = ` ${t("bar.save")}`;
  $("dims").title = t("bar.sizeHint");
  $("parts").title = t("bar.piecesHint");
  $("canvas").setAttribute("aria-label", t("view.canvas"));
  $("views").setAttribute("aria-label", t("view.which"));
  $("stop-title").textContent = t("state.wontBuild");
  setState("idle", t("state.starting"));
  $("nav").setAttribute("aria-label", t("nav.which"));
  $("guide").setAttribute("aria-label", t("view.compare"));
  $("guide").previousElementSibling.textContent = t("view.compare");
  $("guide").parentElement.title = t("view.compare");
  $("views")
    .querySelectorAll("button")
    .forEach((button) => (button.textContent = t(`view.${button.dataset.view}`)));
  for (const [value, key] of [
    ["none", "view.compareNone"],
    ["card", "view.compareCard"],
    ["phone", "view.comparePhone"],
  ]) {
    $("guide").querySelector(`option[value="${value}"]`).textContent = t(key);
  }

  renderNav();
  renderSheet();
  setState("working", t("state.gettingReady"));
  showBusy(true, t("state.gettingReady"));

  try {
    const kept = await storage.get(KEY);
    if (kept?.state) {
      state = { ...clone(DEFAULTS), colours: clone(DEFAULT_COLOURS), fontId: "pt-sans", guide: "none", ...kept.state };
      state.colours = normalizeColours(state.colours);
      if (SECTIONS.includes(kept.section)) section = kept.section;
    }
  } catch {
    // Nothing kept, or it wouldn't read: the first settings do.
  }

  try {
    [fonts, manifold] = await Promise.all([library("fonts"), library("manifold")]);
  } catch (error) {
    showBusy(false);
    setState("error", t("state.couldntStart"));
    $("stop-title").textContent = t("state.modellerFailed");
    $("stop-text").textContent = error.message || String(error);
    $("stop").hidden = false;
    return () => {};
  }

  if (!(await useFont(state.fontId))) await useFont("pt-sans");
  $("guide").value = state.guide;
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
