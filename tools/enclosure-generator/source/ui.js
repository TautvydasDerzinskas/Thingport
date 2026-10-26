// The tool's window: the settings in tabs, the enclosure in 3D, rebuilt as they change, and projects kept for the
// user to open again, as well as models saved to Thingport and files downloaded.

import { BOARDS, DEFAULTS, normalize, PORTS, RANGES } from "./data.js";
import { buildEnclosure, lidForPrint } from "./enclosure.js";
import { stl } from "./csg.js";
import { createViewer } from "./viewer.js";

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICONS = {
  more: svg('<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>'),
  open: svg('<path d="M4 5a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>'),
  copy: svg(
    '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  ),
  json: svg(
    '<path d="M8 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1"/>',
  ),
  remove: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  add: svg('<path d="M12 5v14M5 12h14"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  box: svg('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12 4 7.5"/>'),
  stl: svg('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
};

const COLOURS = [
  ["Accent", null],
  ["Graphite", "#3b3f45"],
  ["White", "#e9e7e1"],
  ["Orange", "#f07f19"],
  ["Navy", "#23395b"],
  ["Red", "#cf3f45"],
];
const WALL_NAMES = { front: "Front", back: "Back", left: "Left", right: "Right", lid: "Lid" };
const SHAPES = [
  ["rect", "Rectangle"],
  ["circle", "Circle"],
  ["type-c", "Rounded slot"],
  ["dsub", "D-sub"],
];
const TABS = [
  ["shell", "Shell"],
  ["lid", "Lid"],
  ["pcb", "PCB"],
  ["ports", "Ports"],
  ["vents", "Vents"],
  ["text", "Text"],
];
const UNTITLED = "Untitled enclosure";
const BUILD_DELAY_MS = 180;
const SAVE_DRAFT_MS = 600;

const round = (value, places = 1) => Number(Number(value).toFixed(places));
const fmt = (value) => `${round(value)}`.replace(/\.0$/, "");
const slugOf = (text) =>
  String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "enclosure";

function escapeHtml(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/** Two colours mixed, `t` of the second. */
function mix(a, b, t) {
  const parse = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [128, 128, 128];
  };
  const [x, y] = [parse(a), parse(b)];
  return `#${x
    .map((c, i) =>
      Math.round(c + (y[i] - c) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** "3 h ago" and the like. */
function ago(time) {
  const s = Math.max(0, (Date.now() - new Date(time).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(time).toLocaleDateString();
}

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "html") node.innerHTML = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
};

export default async function mount(thingport) {
  const { root, theme, storage, models, ui } = thingport;
  const shell = root.querySelector(".enc");
  const $ = (id) => root.querySelector(`#enc-${id}`);
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
    warning: theme.warning ?? theme.error,
    font: theme.fontFamily,
  };
  for (const [name, value] of Object.entries(colours)) shell.style.setProperty(`--${name}`, value);

  // ---- state -------------------------------------------------------------------------------------------------
  let params = structuredClone(DEFAULTS);
  let name = UNTITLED;
  let projectId = null;
  let saved = null; // { name, params } as last saved or opened, to tell whether there's anything to save
  // The lid lifted a little to start with, so what's inside shows.
  const view = { show: "both", explode: 24, colour: 0, quality: "normal", tab: "shell" };
  let model = null;
  let closed = false;
  try {
    const draft = await storage.get("draft");
    if (draft && typeof draft === "object" && draft.params) {
      params = normalize(draft.params).params;
      name = String(draft.name || UNTITLED);
      projectId = draft.projectId ?? null;
      // Compared as the settings are once filled in, as they're loaded.
      saved = draft.saved?.params
        ? { name: String(draft.saved.name), params: normalize(draft.saved.params).params }
        : null;
      Object.assign(view, draft.view ?? {});
    }
  } catch {
    // Starts afresh.
  }
  const stateJson = () => JSON.stringify({ name, params });
  // A design not yet touched has nothing to save.
  if (
    !saved &&
    !projectId &&
    JSON.stringify(params) === JSON.stringify(normalize(DEFAULTS).params) &&
    name === UNTITLED
  )
    saved = JSON.parse(stateJson());
  const dirty = () => !saved || JSON.stringify(saved) !== stateJson();

  let draftTimer = 0;
  const persist = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(
      () => void storage.set("draft", { name, params, projectId, saved, view }).catch(() => undefined),
      SAVE_DRAFT_MS,
    );
  };

  // ---- undo --------------------------------------------------------------------------------------------------
  const past = [];
  const future = [];
  let lastMark = 0;
  /** Remembers the settings before a change; changes close together are undone together. */
  const remember = () => {
    const now = Date.now();
    if (now - lastMark > 700) {
      past.push(JSON.stringify(params));
      if (past.length > 100) past.shift();
      future.length = 0;
    }
    lastMark = now;
  };
  const undo = () => {
    if (!past.length) return;
    future.push(JSON.stringify(params));
    params = JSON.parse(past.pop());
    lastMark = 0;
    afterChange(true);
  };
  const redo = () => {
    if (!future.length) return;
    past.push(JSON.stringify(params));
    params = JSON.parse(future.pop());
    lastMark = 0;
    afterChange(true);
  };

  function set(key, value, rerender = false) {
    remember();
    params = { ...params, [key]: value };
    afterChange(rerender);
  }
  function afterChange(rerender) {
    persist();
    updateBar();
    scheduleBuild();
    if (rerender) renderForm();
  }

  // ---- building ----------------------------------------------------------------------------------------------
  let buildTimer = 0;
  let building = null;
  let busyTimer = 0;
  const scheduleBuild = () => {
    clearTimeout(buildTimer);
    buildTimer = setTimeout(() => void build(), BUILD_DELAY_MS);
  };
  /** Builds the enclosure from the settings as they are, and shows it. */
  function build() {
    clearTimeout(buildTimer);
    buildTimer = 0;
    building = new Promise((resolve) => {
      clearTimeout(busyTimer);
      busyTimer = setTimeout(() => ($("building").hidden = false), 120);
      // A frame first, so "Building…" shows before the work holds the page.
      requestAnimationFrame(() =>
        setTimeout(() => {
          if (closed) return resolve();
          try {
            model = buildEnclosure(params, { quality: view.quality });
          } catch (err) {
            model = {
              ...(model ?? { base: [], lid: [], stats: null }),
              warnings: [`It couldn't be built: ${err?.message || err}`],
            };
          }
          clearTimeout(busyTimer);
          $("building").hidden = true;
          showModel();
          resolve();
        }, 0),
      );
    });
    return building;
  }
  const ready = async () => {
    if (buildTimer) {
      clearTimeout(buildTimer);
      buildTimer = 0;
      await build();
    } else if (building) await building;
  };

  // ---- the view ----------------------------------------------------------------------------------------------
  const canvas = $("canvas");
  let viewer = null;
  try {
    viewer = createViewer(canvas, { grid: theme.textSecondary });
  } catch {
    viewer = null;
  }
  if (!viewer)
    $("view").append(el("div", { class: "enc-novw" }, "The 3D view needs WebGL, which this browser has turned off."));

  const baseColour = () => COLOURS[view.colour]?.[1] ?? theme.primary;
  const lidColour = () => mix(baseColour(), theme.mode === "dark" ? "#000000" : "#ffffff", 0.22);
  let firstShow = true;
  function showModel() {
    if (!model) return;
    const hasLid = model.lid.length > 0;
    const lift = hasLid ? view.explode : 0;
    viewer?.show(
      {
        base: { tris: model.base, colour: baseColour(), visible: view.show !== "lid" },
        lid: { tris: model.lid, colour: lidColour(), offset: [0, 0, lift], visible: hasLid && view.show !== "base" },
      },
      { refit: firstShow },
    );
    firstShow = false;
    const s = model.stats;
    if (s) {
      $("size").innerHTML = `<b>${s.outer.map(fmt).join(" × ")}</b><span>mm</span>`;
      $("size").title = `Outside, with the lid. Inside: ${s.inner.map(fmt).join(" × ")} mm.`;
      $("weight").innerHTML = `<b>≈ ${Math.round(s.grams)} g</b><span>PLA</span>`;
      $("weight").title =
        `Base ${fmt(s.baseVolume)} cm³${hasLid ? `, lid ${fmt(s.lidVolume)} cm³` : ""}, printed solid.`;
    }
    updateBar();
    const warnings = model.warnings ?? [];
    const button = $("warnings");
    button.hidden = !warnings.length;
    button.textContent = warnings.length === 1 ? "1 note" : `${warnings.length} notes`;
    const list = $("warningList");
    list.replaceChildren(...warnings.map((w) => el("li", {}, w)));
    if (!warnings.length) {
      list.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  }
  $("warnings").addEventListener("click", () => {
    const list = $("warningList");
    list.hidden = !list.hidden;
    $("warnings").setAttribute("aria-expanded", String(!list.hidden));
  });

  // View controls.
  function renderViewControls() {
    const segment = (container, options, value, onPick) =>
      container.replaceChildren(
        ...options.map(([v, label]) =>
          el("button", { type: "button", "aria-pressed": String(v === value), onclick: () => onPick(v) }, label),
        ),
      );
    segment(
      $("show"),
      [
        ["both", "Both"],
        ["base", "Base"],
        ["lid", "Lid"],
      ],
      view.show,
      (v) => {
        view.show = v;
        renderViewControls();
        showModel();
        persist();
      },
    );
    segment(
      $("quality"),
      [
        ["draft", "Draft"],
        ["normal", "Normal"],
        ["high", "Fine"],
      ],
      view.quality,
      (v) => {
        view.quality = v;
        renderViewControls();
        persist();
        void build();
      },
    );
    $("quality").title = "How finely curves are cut: Fine for the files to print, Draft to work quickly";
    $("swatches").replaceChildren(
      ...COLOURS.map(([label, hex], i) =>
        el("button", {
          type: "button",
          title: label,
          "aria-label": label,
          "aria-pressed": String(i === view.colour),
          style: `background:${hex ?? theme.primary}`,
          onclick: () => {
            view.colour = i;
            renderViewControls();
            showModel();
            persist();
          },
        }),
      ),
    );
    $("explode").value = String(view.explode);
  }
  $("explode").addEventListener("input", (event) => {
    view.explode = Number(event.target.value);
    showModel();
    persist();
  });
  $("resetView").addEventListener("click", () => viewer?.reset());

  // ---- the settings form -------------------------------------------------------------------------------------
  const help = (text) =>
    el("span", { class: "enc-help", title: text, "aria-label": text, role: "img", tabindex: "0" }, "?");

  function numberField(key, label, { unit = "mm", range = key, value, onValue, title } = {}) {
    const [min, max, step] = RANGES[range] ?? [-1000, 1000, 0.1];
    const current = value ?? params[key];
    const input = el("input", {
      type: "number",
      min,
      max,
      step,
      value: String(current),
      "aria-label": label,
      inputmode: "decimal",
    });
    input.addEventListener("input", () => {
      const v = Number(input.value);
      if (input.value === "" || !Number.isFinite(v)) return;
      if (onValue) onValue(v);
      else set(key, v);
    });
    input.addEventListener("change", () => {
      if (input.value === "" || !Number.isFinite(Number(input.value))) input.value = String(current);
    });
    return el(
      "label",
      { class: "enc-field", title },
      el("span", {}, label),
      el("div", { class: "enc-input" }, input, unit ? el("span", { class: "enc-unit" }, unit) : null),
    );
  }
  const grid = (n, ...fields) => el("div", { class: "enc-grid", style: `--n:${n}` }, ...fields);

  function toggle(key, label, { title } = {}) {
    const input = el("input", { type: "checkbox", role: "switch" });
    input.checked = Boolean(params[key]);
    input.addEventListener("change", () => set(key, input.checked, true));
    return el(
      "label",
      { class: "enc-switch", title },
      input,
      el("span", { class: "enc-track", "aria-hidden": "true" }),
      el("b", {}, label),
    );
  }

  function segmented(label, options, value, onPick) {
    return el(
      "div",
      { class: "enc-field" },
      label ? el("span", {}, label) : null,
      el(
        "div",
        { class: "enc-seg", role: "group", "aria-label": label || undefined },
        options.map(([v, text, title]) =>
          el("button", { type: "button", "aria-pressed": String(v === value), title, onclick: () => onPick(v) }, text),
        ),
      ),
    );
  }
  const seg = (key, label, options) => segmented(label, options, params[key], (v) => set(key, v, true));

  function chips(key, label, options) {
    const value = params[key] ?? [];
    return el(
      "div",
      { class: "enc-field" },
      el("span", {}, label),
      el(
        "div",
        { class: "enc-chips", role: "group", "aria-label": label },
        options.map(([v, text]) =>
          el(
            "button",
            {
              type: "button",
              "aria-pressed": String(value.includes(v)),
              onclick: () => set(key, value.includes(v) ? value.filter((x) => x !== v) : [...value, v], true),
            },
            text,
          ),
        ),
      ),
    );
  }

  const section = (title, { tip, toggleKey, action } = {}, ...children) =>
    el(
      "section",
      { class: "enc-section" },
      el(
        "div",
        { class: "enc-section-head" },
        toggleKey ? toggle(toggleKey, title) : el("h3", {}, title),
        tip ? help(tip) : null,
        el("span", { class: "enc-spacer" }),
        action ?? null,
      ),
      ...(toggleKey && !params[toggleKey] ? [] : children),
    );

  const wallOptions = Object.entries(WALL_NAMES).filter(([w]) => w !== "lid");

  const TAB_CONTENT = {
    shell: () => [
      section(
        "Size outside",
        { tip: "The base's outside size. The lid adds its thickness on top." },
        grid(3, numberField("width", "Width"), numberField("length", "Length"), numberField("height", "Height")),
        grid(
          3,
          numberField("thickness", "Walls", { title: "1.6 to 4 mm prints well" }),
          numberField("radius", "Corners"),
          numberField("tolerance", "Lid fit", { title: "Room between the lid and the base: 0.1 to 0.3 mm" }),
        ),
      ),
      section(
        "Mounting flanges",
        {
          toggleKey: "hasFlanges",
          tip: "Ears with a screw hole at the foot of the walls, to fix the case to a wall or panel.",
        },
        chips("flangeWalls", "On", wallOptions),
        grid(
          2,
          numberField("flangeLength", "Reach"),
          numberField("flangeWidth", "Width"),
          numberField("flangeHoleDiameter", "Hole"),
          numberField("flangeThickness", "Thickness"),
        ),
      ),
    ],
    lid: () => [
      section(
        "Lid",
        { toggleKey: "hasLid", tip: "A separate lid, printed upside down." },
        seg("lidType", "Profile", [
          ["flat", "Flat", "A plate sitting on top"],
          ["lip", "With a lip", "A lip drops inside the base and keeps it in place"],
        ]),
        params.lidType === "lip"
          ? grid(
              3,
              numberField("lidThickness", "Thickness"),
              numberField("lidLipHeight", "Lip height"),
              numberField("lidLipThickness", "Lip wall"),
            )
          : grid(3, numberField("lidThickness", "Thickness")),
      ),
      params.hasLid
        ? section(
            "Fixing",
            { tip: "Screws hold best and come apart; snaps need no tools or parts. Snaps need the lip." },
            seg("lidFixation", "", [
              ["screws", "Screws"],
              ["snap", "Snap latches", "Hooks on the base's walls click into windows in the lid's lip"],
              ["snapJoint", "Snap joint", "Bumps on the lid's lip click into grooves inside the base's walls"],
            ]),
            ...(params.lidFixation === "screws"
              ? [
                  toggle("hasCornerScrews", "Corner screw bosses"),
                  params.hasCornerScrews
                    ? grid(
                        3,
                        numberField("screwDiameter", "Base hole", {
                          title: "For the screw to cut its own thread: a little under its size",
                        }),
                        numberField("lidScrewDiameter", "Lid hole"),
                        numberField("screwHeadDiameter", "Head"),
                        numberField("screwHeadDepth", "Head sinks"),
                        numberField("bossRadius", "Boss radius"),
                        numberField("bossInset", "Inset", { title: "From the outside of the corner to the screw" }),
                      )
                    : null,
                ]
              : [
                  grid(
                    2,
                    numberField("latchWidth", "Width"),
                    numberField("latchDepth", "Catch"),
                    numberField("latchHeight", "Height"),
                    numberField("latchCount", "Per wall", { unit: "" }),
                  ),
                  chips("latchWalls", "On", wallOptions),
                ]),
          )
        : null,
      params.hasLid
        ? section(
            "Opening groove",
            { toggleKey: "hasLidGroove", tip: "A notch at the top of a wall, for a flat tool to lift the lid." },
            seg("grooveWall", "Wall", [["auto", "Auto"], ...wallOptions]),
            grid(
              3,
              numberField("grooveWidth", "Width"),
              numberField("grooveHeight", "Height"),
              numberField("grooveDepth", "Depth"),
            ),
          )
        : null,
    ],
    pcb: () => [
      section(
        "PCB standoffs",
        { toggleKey: "hasPcbStandoffs", tip: "Posts to screw a circuit board to, with holes for its screws." },
        boardPicker(),
        grid(
          2,
          segmented(
            "Mounted on",
            [
              [false, "Base"],
              [true, "Lid"],
            ],
            params.pcbOnLid,
            (v) => set("pcbOnLid", v, true),
          ),
          el("div", { class: "enc-field" }, el("span", {}, " "), toggle("pcbRotated", "Turned 90°")),
        ),
        seg("standoffMode", "Holes", [
          ["grid", "4 corners"],
          ["list", "Each one"],
        ]),
        ...(params.standoffMode === "grid"
          ? [
              grid(
                3,
                numberField("pcbWidth", "Across"),
                numberField("pcbLength", "Along"),
                numberField("pcbStandoffHeight", "Height"),
                numberField("pcbStandoffOuterDia", "Post Ø"),
                numberField("pcbStandoffInnerDia", "Hole Ø"),
              ),
            ]
          : [standoffList()]),
        grid(2, numberField("pcbOffsetX", "Move X"), numberField("pcbOffsetY", "Move Y")),
      ),
    ],
    ports: () => [
      section(
        "Ports and cutouts",
        {
          tip: "Openings in the walls or lid for sockets, switches, screens and cables, each with an optional label cut beside it.",
          action: el(
            "button",
            { class: "enc-btn enc-small", type: "button", onclick: addCutout },
            el("span", { html: ICONS.add }),
            "Add",
          ),
        },
        cutoutList(),
      ),
    ],
    vents: () => [
      section(
        "Vents",
        { tip: "Holes to let warm air out, in the lid and in the walls." },
        toggle("hasVentilation", "In the lid"),
        chips("ventWalls", "In the walls", wallOptions),
        ...(params.hasVentilation || params.ventWalls.length
          ? [
              seg("ventPattern", "Pattern", [
                ["slots", "Slots"],
                ["honeycomb", "Honeycomb"],
                ["dots", "Dots"],
                ["diamonds", "Diamonds"],
              ]),
              seg("ventOrientation", "Running", [
                ["X", "Along X", "In the lid, across the width; in a wall, along it"],
                ["Y", "Along Y", "In the lid, front to back; in a wall, up it"],
              ]),
              grid(
                2,
                numberField("ventSlotCount", params.ventPattern === "slots" ? "Slots" : "Rows up to", { unit: "" }),
                numberField("ventSlotLength", "Length"),
                numberField("ventSlotWidth", params.ventPattern === "slots" ? "Slot width" : "Hole size"),
                numberField("ventSlotSpacing", "Gap"),
              ),
            ]
          : []),
      ),
    ],
    text: () => [
      section(
        "Text",
        {
          toggleKey: "hasText",
          tip: "Words raised on or cut into the lid or a wall: capitals, digits and common signs.",
        },
        textInput("textString", "Text"),
        seg("textPlacement", "On", [["lid", "Lid"], ...wallOptions]),
        seg("textType", "Style", [
          ["deboss", "Cut in"],
          ["emboss", "Raised"],
        ]),
        grid(
          2,
          numberField("textSize", "Size"),
          numberField("textDepth", "Depth"),
          numberField("textOffsetX", "Move X"),
          numberField("textOffsetY", "Move Y"),
        ),
      ),
    ],
  };

  function textInput(key, label, { value, onValue, maxlength = 40, placeholder } = {}) {
    const input = el("input", {
      class: "enc-text",
      value: value ?? params[key] ?? "",
      maxlength,
      "aria-label": label,
      placeholder,
      autocomplete: "off",
    });
    input.addEventListener("input", () => (onValue ? onValue(input.value) : set(key, input.value)));
    return el("label", { class: "enc-field" }, el("span", {}, label), input);
  }

  function boardPicker() {
    const select = el(
      "select",
      { "aria-label": "Board" },
      el("option", { value: "none" }, "Custom"),
      BOARDS.map((b) => el("option", { value: b.id }, b.name)),
    );
    select.value = BOARDS.some((b) => b.id === params.pcbPreset) ? params.pcbPreset : "none";
    select.addEventListener("change", () => {
      const board = BOARDS.find((b) => b.id === select.value);
      remember();
      if (!board) params = { ...params, pcbPreset: "none" };
      else
        params = {
          ...params,
          pcbPreset: board.id,
          standoffMode: "list",
          pcbStandoffs: board.holes.map(([x, y], i) => ({
            id: `s${i + 1}`,
            x,
            y,
            height: board.height,
            outerDia: board.outerDia,
            innerDia: board.innerDia,
          })),
        };
      afterChange(true);
    });
    return el("label", { class: "enc-field" }, el("span", {}, "Board"), el("div", { class: "enc-input" }, select));
  }

  function standoffList() {
    const list = params.pcbStandoffs;
    const update = (i, field, v) => {
      remember();
      params = { ...params, pcbPreset: "none", pcbStandoffs: list.map((s, j) => (j === i ? { ...s, [field]: v } : s)) };
      afterChange(false);
    };
    const rows = list.map((s, i) =>
      el(
        "div",
        { class: "enc-standoff" },
        numberField(null, "X", { range: "standoffX", value: s.x, onValue: (v) => update(i, "x", v), unit: "" }),
        numberField(null, "Y", { range: "standoffY", value: s.y, onValue: (v) => update(i, "y", v), unit: "" }),
        numberField(null, "Height", {
          range: "standoffHeight",
          value: s.height,
          onValue: (v) => update(i, "height", v),
          unit: "",
        }),
        numberField(null, "Post Ø", {
          range: "standoffOuterDia",
          value: s.outerDia,
          onValue: (v) => update(i, "outerDia", v),
          unit: "",
        }),
        numberField(null, "Hole Ø", {
          range: "standoffInnerDia",
          value: s.innerDia,
          onValue: (v) => update(i, "innerDia", v),
          unit: "",
        }),
        el("button", {
          class: "enc-icon-btn enc-tiny",
          type: "button",
          title: "Remove",
          "aria-label": `Remove standoff ${i + 1}`,
          html: ICONS.close,
          onclick: () => {
            remember();
            params = { ...params, pcbPreset: "none", pcbStandoffs: list.filter((_, j) => j !== i) };
            afterChange(true);
          },
        }),
      ),
    );
    const add = el(
      "button",
      {
        class: "enc-btn enc-small",
        type: "button",
        onclick: () => {
          remember();
          const last = list[list.length - 1];
          params = {
            ...params,
            pcbStandoffs: [
              ...list,
              {
                id: `s${Date.now().toString(36)}`,
                x: 0,
                y: 0,
                height: last?.height ?? 6,
                outerDia: last?.outerDia ?? 6,
                innerDia: last?.innerDia ?? 2.5,
              },
            ],
          };
          afterChange(true);
        },
      },
      el("span", { html: ICONS.add }),
      "Add standoff",
    );
    return el(
      "div",
      { class: "enc-section" },
      rows.length ? rows : el("div", { class: "enc-empty" }, "No standoffs yet"),
      el("div", {}, add),
    );
  }

  // Cutouts: a list, and the one being edited open beneath it, changing the model as it's edited.
  let editing = null; // { id, isNew, before }
  const wallLength = (wall) => (wall === "front" || wall === "back" || wall === "lid" ? params.width : params.length);
  const wallTall = (wall) => (wall === "lid" ? params.length : params.height);
  function cutoutName(c) {
    const template = PORTS.find((p) => p.id === c.portTemplate);
    return c.label || template?.name || SHAPES.find(([s]) => s === c.shape)?.[1] || "Cutout";
  }
  function shapeIcon(c) {
    const w = c.shape === "circle" ? c.diameter : c.width;
    const h = c.shape === "circle" ? c.diameter : c.height;
    const k = Math.min(20 / Math.max(w, 1), 14 / Math.max(h, 1));
    const [sw, sh] = [w * k, h * k];
    const body =
      c.shape === "circle"
        ? `<circle cx="16" cy="12" r="${sw / 2}" />`
        : c.shape === "dsub"
          ? `<path d="M${16 - sw / 2} ${12 - sh / 2}h${sw}l-${sw * 0.12} ${sh}h-${sw * 0.76}z" />`
          : `<rect x="${16 - sw / 2}" y="${12 - sh / 2}" width="${sw}" height="${sh}" rx="${c.shape === "type-c" ? sh / 2 : 1}" />`;
    return `<svg class="enc-shape" viewBox="0 0 32 24" aria-hidden="true"><rect x="1" y="1" width="30" height="22" rx="4" fill="none" stroke="currentColor" stroke-opacity=".3"/><g fill="currentColor" opacity=".75">${body}</g></svg>`;
  }
  function setCutout(id, patch) {
    remember();
    params = { ...params, cutouts: params.cutouts.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
    afterChange(false);
  }
  function addCutout() {
    remember();
    const port = PORTS.find((p) => p.id === "usb-c");
    const cutout = {
      id: `c${Date.now().toString(36)}`,
      wall: "front",
      shape: port.shape,
      width: port.width,
      height: port.height,
      diameter: 8,
      rotation: 0,
      x: round(params.width / 2),
      z: round(params.height / 2),
      portTemplate: port.id,
      label: "",
      labelPosition: "above",
      labelSize: 3.5,
    };
    editing = { id: cutout.id, isNew: true, before: null };
    params = { ...params, cutouts: [...params.cutouts, cutout] };
    afterChange(true);
  }
  function editCutout(id) {
    editing = { id, isNew: false, before: JSON.stringify(params.cutouts.find((c) => c.id === id)) };
    renderForm();
  }
  function removeCutout(id) {
    remember();
    if (editing?.id === id) editing = null;
    params = { ...params, cutouts: params.cutouts.filter((c) => c.id !== id) };
    afterChange(true);
  }
  function duplicateCutout(id) {
    const c = params.cutouts.find((x) => x.id === id);
    if (!c) return;
    remember();
    const copy = { ...c, id: `c${Date.now().toString(36)}`, x: round(Math.min(wallLength(c.wall), c.x + 10)) };
    params = { ...params, cutouts: [...params.cutouts, copy] };
    editing = { id: copy.id, isNew: true, before: null };
    afterChange(true);
  }
  const cutoutActions = (c) => [
    { label: "Edit", icon: ICONS.edit, run: () => editCutout(c.id) },
    { label: "Duplicate", icon: ICONS.copy, run: () => duplicateCutout(c.id) },
    "divider",
    { label: "Remove", icon: ICONS.remove, danger: true, run: () => removeCutout(c.id) },
  ];

  function cutoutList() {
    const items = params.cutouts.map((c) => {
      const size = c.shape === "circle" ? `Ø ${fmt(c.diameter)}` : `${fmt(c.width)} × ${fmt(c.height)}`;
      const row = el(
        "li",
        {
          class: "enc-item",
          tabindex: "0",
          "aria-current": String(editing?.id === c.id),
          "aria-label": `${cutoutName(c)}, ${WALL_NAMES[c.wall]}, ${size} mm`,
          onclick: () => editCutout(c.id),
          oncontextmenu: (event) => {
            event.preventDefault();
            openMenu({ x: event.clientX, y: event.clientY }, cutoutActions(c));
          },
          onkeydown: (event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") editCutout(c.id);
            else if (event.key === "Delete" || event.key === "Backspace") removeCutout(c.id);
            else return;
            event.preventDefault();
          },
        },
        el("span", { html: shapeIcon(c), style: "color:var(--accent);display:grid" }),
        el(
          "span",
          {},
          el("b", {}, cutoutName(c)),
          el("small", {}, `${WALL_NAMES[c.wall]} · ${size} mm · at ${fmt(c.x)}, ${fmt(c.z)}`),
        ),
        el("button", {
          class: "enc-icon-btn enc-tiny",
          type: "button",
          title: "More",
          "aria-label": `More for ${cutoutName(c)}`,
          "aria-haspopup": "menu",
          html: ICONS.more,
          onclick: (event) => {
            event.stopPropagation();
            openMenu(event.currentTarget, cutoutActions(c));
          },
        }),
      );
      return row;
    });
    const editingCutout = params.cutouts.find((c) => c.id === editing?.id);
    return el(
      "div",
      { class: "enc-section" },
      items.length
        ? el("ul", { class: "enc-list" }, items)
        : el("div", { class: "enc-empty" }, "No cutouts yet: Add one for a socket, a switch or a screen."),
      editingCutout ? cutoutEditor(editingCutout) : null,
    );
  }

  function cutoutEditor(c) {
    const isLid = c.wall === "lid";
    const select = el(
      "select",
      { "aria-label": "Socket or shape" },
      el(
        "optgroup",
        { label: "Shapes" },
        SHAPES.map(([s, label]) => el("option", { value: `shape:${s}` }, label)),
      ),
      [...new Set(PORTS.map((p) => p.group))].map((group) =>
        el(
          "optgroup",
          { label: group },
          PORTS.filter((p) => p.group === group).map((p) => el("option", { value: `port:${p.id}` }, p.name)),
        ),
      ),
    );
    select.value = c.portTemplate ? `port:${c.portTemplate}` : `shape:${c.shape}`;
    select.addEventListener("change", () => {
      const [kind, value] = select.value.split(":");
      if (kind === "port") {
        const port = PORTS.find((p) => p.id === value);
        setCutout(c.id, {
          portTemplate: port.id,
          shape: port.shape,
          ...(port.shape === "circle" ? { diameter: port.diameter } : { width: port.width, height: port.height }),
        });
      } else setCutout(c.id, { portTemplate: null, shape: value });
      renderForm();
    });
    const field = (key, label, range, unit = "mm") =>
      numberField(null, label, {
        range,
        unit,
        value: c[key],
        onValue: (v) =>
          setCutout(c.id, {
            [key]: v,
            ...(key === "width" || key === "height" || key === "diameter" ? { portTemplate: null } : {}),
          }),
      });
    const done = () => {
      editing = null;
      renderForm();
    };
    const cancel = () => {
      remember();
      if (editing.isNew) params = { ...params, cutouts: params.cutouts.filter((x) => x.id !== c.id) };
      else if (editing.before) {
        const before = JSON.parse(editing.before);
        params = { ...params, cutouts: params.cutouts.map((x) => (x.id === c.id ? before : x)) };
      }
      editing = null;
      afterChange(true);
    };
    return el(
      "div",
      { class: "enc-editor", onkeydown: (event) => event.key === "Escape" && (event.stopPropagation(), cancel()) },
      segmented("Wall", Object.entries(WALL_NAMES), c.wall, (wall) => {
        setCutout(c.id, { wall, x: round(wallLength(wall) / 2), z: round(wallTall(wall) / 2) });
        renderForm();
      }),
      el("label", { class: "enc-field" }, el("span", {}, "Socket or shape"), el("div", { class: "enc-input" }, select)),
      c.shape === "circle"
        ? grid(3, field("diameter", "Diameter", "cutoutDiameter"))
        : grid(
            3,
            field("width", "Width", "cutoutWidth"),
            field("height", "Height", "cutoutHeight"),
            field("rotation", "Turned", "cutoutRotation", "°"),
          ),
      grid(
        2,
        numberField(null, "From left", {
          range: "cutoutPosition",
          value: c.x,
          onValue: (v) => setCutout(c.id, { x: v }),
          title: `0 to ${fmt(wallLength(c.wall))} mm`,
        }),
        numberField(null, isLid ? "From front" : "From bottom", {
          range: "cutoutPosition",
          value: c.z,
          onValue: (v) => setCutout(c.id, { z: v }),
          title: `0 to ${fmt(wallTall(c.wall))} mm`,
        }),
      ),
      textInput(null, "Label", {
        value: c.label,
        onValue: (v) => setCutout(c.id, { label: v }),
        maxlength: 16,
        placeholder: "e.g. USB, 12V",
      }),
      c.label
        ? grid(
            2,
            segmented(
              "Label goes",
              [
                ["above", "Above"],
                ["below", "Below"],
                ["left", "Left"],
                ["right", "Right"],
              ],
              c.labelPosition,
              (labelPosition) => {
                setCutout(c.id, { labelPosition });
                renderForm();
              },
            ),
            numberField(null, "Label size", {
              range: "cutoutLabelSize",
              value: c.labelSize,
              onValue: (v) => setCutout(c.id, { labelSize: v }),
            }),
          )
        : null,
      el(
        "div",
        { class: "enc-editor-actions" },
        el("button", { class: "enc-btn enc-small", type: "button", onclick: cancel }, "Cancel"),
        el(
          "button",
          { class: "enc-btn enc-small enc-primary", type: "button", onclick: done },
          editing.isNew ? "Add" : "Done",
        ),
      ),
    );
  }

  const tabs = $("tabs");
  function renderTabs() {
    tabs.replaceChildren(
      ...TABS.map(([id, label]) =>
        el(
          "button",
          {
            type: "button",
            role: "tab",
            id: `enc-tab-${id}`,
            "aria-selected": String(view.tab === id),
            tabindex: view.tab === id ? "0" : "-1",
            onclick: () => {
              view.tab = id;
              editing = null;
              renderTabs();
              renderForm();
              persist();
            },
            onkeydown: (event) => {
              const i = TABS.findIndex(([t]) => t === id);
              const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              view.tab = TABS[(i + step + TABS.length) % TABS.length][0];
              renderTabs();
              renderForm();
              tabs.querySelector(`#enc-tab-${view.tab}`)?.focus();
            },
          },
          label,
        ),
      ),
    );
  }
  const form = $("form");
  function renderForm() {
    // Keeps focus on the same field when the form is drawn again around it.
    const active = form.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label") : null;
    const scroll = form.scrollTop;
    form.setAttribute("aria-labelledby", `enc-tab-${view.tab}`);
    form.replaceChildren(...TAB_CONTENT[view.tab]().filter(Boolean));
    form.scrollTop = scroll;
    if (active)
      [...form.querySelectorAll("[aria-label]")].find((n) => n.getAttribute("aria-label") === active)?.focus();
  }

  // ---- the bar -----------------------------------------------------------------------------------------------
  const nameInput = $("name");
  nameInput.value = name;
  nameInput.addEventListener("input", () => {
    name = nameInput.value;
    persist();
    updateBar();
  });
  nameInput.addEventListener("change", () => {
    if (!nameInput.value.trim()) nameInput.value = name = UNTITLED;
    updateBar();
  });
  function updateBar() {
    $("dirty").hidden = !dirty();
    $("undo").disabled = !past.length;
    $("redo").disabled = !future.length;
    $("saveModel").disabled = !model?.base?.length;
  }
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  $("reset").addEventListener(
    "click",
    safely(async () => {
      if (
        !(await ui.confirm({
          title: "Back to the defaults?",
          message: "Every setting goes back to how it starts. Undo brings them back.",
        }))
      )
        return;
      remember();
      lastMark = 0;
      params = structuredClone(DEFAULTS);
      editing = null;
      afterChange(true);
    }),
  );

  function safely(fn) {
    return async (...args) => {
      try {
        await fn(...args);
      } catch (err) {
        ui.toast(err?.message || String(err), "error");
      }
    };
  }

  // ---- projects ----------------------------------------------------------------------------------------------
  const readIndex = async () => {
    const list = await storage.get("projects");
    return Array.isArray(list) ? list : [];
  };
  const summary = (p) => `${fmt(p.width)} × ${fmt(p.length)} × ${fmt(p.height)} mm`;

  const saveProject = safely(async () => {
    const id = projectId ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    name = nameInput.value.trim() || UNTITLED;
    nameInput.value = name;
    const previous = projectId ? await storage.get(`project:${id}`) : null;
    const record = { id, name, params, updatedAt: new Date().toISOString(), modelId: previous?.modelId ?? null };
    await storage.set(`project:${id}`, record);
    const index = (await readIndex()).filter((p) => p.id !== id);
    index.unshift({ id, name, size: summary(params), updatedAt: record.updatedAt });
    await storage.set("projects", index);
    projectId = id;
    saved = JSON.parse(stateJson());
    persist();
    updateBar();
    ui.toast(`Saved ${name}`, "success");
    if (!$("projectsDialog").hidden) await renderProjects();
  });

  const confirmLeave = async (what) =>
    !dirty() ||
    ui.confirm({ title: "Leave your changes?", message: `${name} has changes that aren't saved. ${what} anyway?` });

  function load(record) {
    params = normalize(record.params).params;
    name = record.name || UNTITLED;
    projectId = record.id ?? null;
    saved = record.id ? JSON.parse(stateJson()) : null;
    nameInput.value = name;
    past.length = 0;
    future.length = 0;
    editing = null;
    firstShow = true;
    afterChange(true);
  }

  const openProject = safely(async (id) => {
    if (id === projectId) return closeProjects();
    if (!(await confirmLeave("Open another"))) return;
    const record = await storage.get(`project:${id}`);
    if (!record) {
      ui.toast("That project isn't there any more", "warning");
      await renderProjects();
      return;
    }
    load(record);
    closeProjects();
    ui.toast(`Opened ${record.name}`, "success");
  });

  const duplicateProject = safely(async (id) => {
    const record = await storage.get(`project:${id}`);
    if (!record) return;
    const copy = {
      ...record,
      id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: `${record.name} copy`,
      updatedAt: new Date().toISOString(),
      modelId: null,
    };
    await storage.set(`project:${copy.id}`, copy);
    const index = await readIndex();
    index.unshift({ id: copy.id, name: copy.name, size: summary(copy.params), updatedAt: copy.updatedAt });
    await storage.set("projects", index);
    await renderProjects();
  });

  const exportProject = safely(async (id) => {
    const record = id === projectId || !id ? { name, params } : await storage.get(`project:${id}`);
    if (!record) return;
    thingport.download({
      name: `${slugOf(record.name)}.json`,
      data: JSON.stringify(
        { app: "thingport-enclosure", version: 1, name: record.name, params: record.params },
        null,
        2,
      ),
      type: "application/json",
    });
  });

  const deleteProject = safely(async (id) => {
    const index = await readIndex();
    const entry = index.find((p) => p.id === id);
    if (
      !(await ui.confirm({
        title: `Delete ${entry?.name ?? "this project"}?`,
        message: "It goes from your projects for good. Models saved from it stay in your library.",
      }))
    )
      return;
    await storage.remove(`project:${id}`);
    await storage.set(
      "projects",
      index.filter((p) => p.id !== id),
    );
    if (id === projectId) {
      projectId = null;
      saved = null;
      persist();
      updateBar();
    }
    const row = $("projectList").querySelector(`[data-id="${id}"]`);
    const finish = () => void renderProjects();
    if (row && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      row.classList.add("enc-leaving");
      row.addEventListener("animationend", finish, { once: true });
    } else finish();
    ui.toast(`Deleted ${entry?.name ?? "the project"}`, "success");
  });

  const projectActions = (p) => [
    { label: "Open", icon: ICONS.open, run: () => openProject(p.id) },
    { label: "Duplicate", icon: ICONS.copy, run: () => duplicateProject(p.id) },
    { label: "Download JSON", icon: ICONS.json, run: () => exportProject(p.id) },
    "divider",
    { label: "Delete", icon: ICONS.remove, danger: true, run: () => deleteProject(p.id) },
  ];

  async function renderProjects() {
    const list = $("projectList");
    let index;
    try {
      index = await readIndex();
    } catch (err) {
      list.replaceChildren(el("li", { class: "enc-empty" }, err?.message || String(err)));
      return;
    }
    if (!index.length) {
      list.replaceChildren(
        el(
          "li",
          { class: "enc-empty" },
          "No saved projects yet. ",
          el("button", { class: "enc-link", type: "button", onclick: () => void saveProject() }, "Save this one"),
        ),
      );
      return;
    }
    list.replaceChildren(
      ...index
        .slice()
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map((p, i) =>
          el(
            "li",
            {
              class: "enc-project",
              "data-id": p.id,
              tabindex: "0",
              style: `animation-delay:${Math.min(i * 30, 240)}ms`,
              "aria-current": String(p.id === projectId),
              "aria-label": `${p.name}, ${p.size}, saved ${ago(p.updatedAt)}`,
              onclick: () => openProject(p.id),
              oncontextmenu: (event) => {
                event.preventDefault();
                openMenu({ x: event.clientX, y: event.clientY }, projectActions(p));
              },
              onkeydown: (event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") openProject(p.id);
                else if (event.key === "Delete") deleteProject(p.id);
                else if (event.key === "ArrowDown") event.currentTarget.nextElementSibling?.focus();
                else if (event.key === "ArrowUp") event.currentTarget.previousElementSibling?.focus();
                else return;
                event.preventDefault();
              },
            },
            el("span", { class: "enc-box-icon", html: ICONS.box }),
            el(
              "span",
              {},
              el("b", {}, p.name),
              el("small", {}, `${p.size} · saved ${ago(p.updatedAt)}${p.id === projectId ? " · open now" : ""}`),
            ),
            el("button", {
              class: "enc-icon-btn",
              type: "button",
              title: "More",
              "aria-label": `More for ${p.name}`,
              "aria-haspopup": "menu",
              html: ICONS.more,
              onclick: (event) => {
                event.stopPropagation();
                openMenu(event.currentTarget, projectActions(p));
              },
            }),
          ),
        ),
    );
  }

  const dialog = $("projectsDialog");
  async function openProjects() {
    dialog.hidden = false;
    $("projectList").replaceChildren(
      ...Array.from({ length: 3 }, () => el("li", { class: "enc-project", style: "height:56px;opacity:.5" })),
    );
    await renderProjects();
    ($("projectList").querySelector(".enc-project") ?? $("new")).focus();
  }
  function closeProjects() {
    dialog.hidden = true;
    $("projects").focus();
  }
  $("projects").addEventListener("click", () => void openProjects());
  $("projectsClose").addEventListener("click", closeProjects);
  dialog.addEventListener("click", (event) => event.target === dialog && closeProjects());
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    closeProjects();
  });
  $("new").addEventListener(
    "click",
    safely(async () => {
      if (!(await confirmLeave("Start a new one"))) return;
      load({ id: null, name: UNTITLED, params: DEFAULTS });
      saved = JSON.parse(stateJson());
      updateBar();
      closeProjects();
    }),
  );
  const importFile = $("importFile");
  $("import").addEventListener("click", () => importFile.click());
  importFile.addEventListener(
    "change",
    safely(async () => {
      const file = importFile.files?.[0];
      importFile.value = "";
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name} isn't a project: it's not JSON`);
      }
      // Ours ({ name, params }), PrintCasing's ({ version, params }), or the settings alone.
      const raw =
        data && typeof data === "object" && data.params && typeof data.params === "object" ? data.params : data;
      if (!raw || typeof raw !== "object" || !("width" in raw || "height" in raw || "length" in raw))
        throw new Error(`${file.name} doesn't look like an enclosure project`);
      if (!(await confirmLeave("Import"))) return;
      load({ id: null, name: data.name || file.name.replace(/\.json$/i, ""), params: raw });
      closeProjects();
      ui.toast(`Imported ${name}: save it to keep it here`, "success");
    }),
  );

  // ---- downloads and saving to Thingport ---------------------------------------------------------------------
  const files = () => {
    const slug = slugOf(name);
    const out = [{ name: `${slug}-base.stl`, data: stl(model.base, `${name} base`), type: "model/stl" }];
    if (model.lid.length)
      out.push({ name: `${slug}-lid.stl`, data: stl(lidForPrint(model.lid), `${name} lid`), type: "model/stl" });
    return out;
  };

  $("download").addEventListener("click", (event) => {
    const button = event.currentTarget;
    openMenu(button, [
      { label: "Base STL", icon: ICONS.stl, run: safely(async () => (await ready(), thingport.download(files()[0]))) },
      {
        label: "Lid STL, turned to print",
        icon: ICONS.stl,
        disabled: !params.hasLid,
        run: safely(async () => {
          await ready();
          const lid = files()[1];
          if (lid) thingport.download(lid);
        }),
      },
      "divider",
      { label: "Project JSON", icon: ICONS.json, run: () => exportProject(null) },
    ]);
  });

  function describe() {
    const p = model.params;
    const s = model.stats;
    const parts = files();
    const lines = [
      `An enclosure ${s.outer.map(fmt).join(" × ")} mm outside${p.hasLid ? ", with its lid" : ""}, ${s.inner.map(fmt).join(" × ")} mm inside. Made with Thingport's enclosure generator.`,
      "",
      "## What to print",
      "",
      "| Part | File | How |",
      "| --- | --- | --- |",
      `| Base | \`${parts[0].name}\` | Open side up, no supports |`,
    ];
    if (parts[1]) lines.push(`| Lid | \`${parts[1].name}\` | Turned over, its top on the bed |`);
    lines.push("", `About ${Math.round(s.grams)} g of PLA in all, printed solid.`, "", "## Settings", "");
    lines.push(
      `- Walls ${fmt(p.thickness)} mm, corners rounded ${fmt(p.radius)} mm${p.hasLid ? `, ${fmt(p.tolerance)} mm of room for the lid` : ""}`,
    );
    if (p.hasLid) {
      const lip = p.lidType === "lip" ? ` with a ${fmt(p.lidLipHeight)} mm lip` : "";
      const fixing =
        p.lidFixation === "snap"
          ? `held by ${p.latchCount} snap latch${p.latchCount === 1 ? "" : "es"} on each of the ${(p.latchWalls.length ? p.latchWalls : ["left", "right"]).join(", ")} walls`
          : p.lidFixation === "snapJoint"
            ? "held by a snap joint"
            : p.hasCornerScrews
              ? `screwed at the corners: ${fmt(p.screwDiameter)} mm holes in the base, ${fmt(p.lidScrewDiameter)} mm in the lid, for heads up to ${fmt(p.screwHeadDiameter)} mm`
              : "resting in place";
      lines.push(`- Lid ${fmt(p.lidThickness)} mm${lip}, ${fixing}`);
    }
    if (p.hasPcbStandoffs) {
      const board = BOARDS.find((b) => b.id === p.pcbPreset);
      const count = p.standoffMode === "list" ? p.pcbStandoffs.length : 4;
      lines.push(
        `- ${count} PCB standoffs${board ? ` for a ${board.name}` : ""} on the ${p.pcbOnLid ? "lid" : "base"}`,
      );
    }
    for (const c of p.cutouts) {
      const size = c.shape === "circle" ? `Ø ${fmt(c.diameter)} mm` : `${fmt(c.width)} × ${fmt(c.height)} mm`;
      lines.push(`- ${cutoutName(c)} (${size}) in the ${c.wall === "lid" ? "lid" : `${c.wall} wall`}`);
    }
    const ventsIn = [...(p.hasVentilation && p.hasLid ? ["lid"] : []), ...p.ventWalls.map((w) => `${w} wall`)];
    if (ventsIn.length)
      lines.push(
        `- ${p.ventPattern === "slots" ? "Vent slots" : `${p.ventPattern[0].toUpperCase()}${p.ventPattern.slice(1)} vents`} in the ${ventsIn.join(", ")}`,
      );
    if (p.hasText && p.textString.trim())
      lines.push(
        `- "${p.textString}" ${p.textType === "emboss" ? "raised on" : "cut into"} the ${p.textPlacement === "lid" ? "lid" : `${p.textPlacement} wall`}`,
      );
    return lines.join("\n");
  }

  const status = $("status");
  function showStatus(message, actions = []) {
    status.hidden = false;
    status.replaceChildren(
      el("span", {}, message),
      ...actions.map(([label, run]) => el("button", { class: "enc-link", type: "button", onclick: run }, label)),
    );
  }

  $("saveModel").addEventListener(
    "click",
    safely(async () => {
      const button = $("saveModel");
      button.disabled = true;
      try {
        await ready();
        if (!model?.base?.length) throw new Error("There's nothing to save yet");
        const created = await models.create({
          name: name.trim() || UNTITLED,
          description: describe(),
          tags: ["enclosure", "case"],
          files: files(),
        });
        try {
          const picture = await viewer?.snapshot(900, theme.paper);
          if (picture)
            await models.addImages(created.id, [{ name: `${slugOf(name)}.png`, data: picture, type: "image/png" }]);
        } catch {
          // The model stands without its picture.
        }
        if (projectId) {
          const record = await storage.get(`project:${projectId}`);
          if (record) await storage.set(`project:${projectId}`, { ...record, modelId: created.id });
        }
        ui.toast(`Saved ${created.name} to Thingport`, "success");
        showStatus(`Saved as ${created.name}.`, [
          ["Open it", () => models.open(created.id)],
          [
            "Add to a collection",
            safely(async () => {
              const collection = await ui.pickCollection({ title: `Add ${created.name} to` });
              if (!collection) return;
              await thingport.collections.add(collection.id, [created.id]);
              ui.toast(`Added to ${collection.name}`, "success");
            }),
          ],
        ]);
      } finally {
        button.disabled = false;
      }
    }),
  );

  // ---- menus -------------------------------------------------------------------------------------------------
  const menu = $("menu");
  let menuReturn = null;
  function openMenu(anchor, entries) {
    closeMenu();
    menuReturn = anchor instanceof Element ? anchor : document.activeElement;
    menu.replaceChildren(
      ...entries.map((entry) => {
        if (entry === "divider") return document.createElement("hr");
        const button = el("button", {
          type: "button",
          role: "menuitem",
          tabindex: "-1",
          class: entry.danger ? "enc-danger" : null,
          html: `${entry.icon}<span>${escapeHtml(entry.label)}</span>`,
        });
        button.disabled = Boolean(entry.disabled);
        button.addEventListener("click", () => {
          closeMenu();
          entry.run();
        });
        return button;
      }),
    );
    menu.hidden = false;
    const box = shell.getBoundingClientRect();
    const point =
      anchor instanceof Element
        ? (() => {
            const r = anchor.getBoundingClientRect();
            return { x: r.right - menu.offsetWidth, y: r.bottom + 4 };
          })()
        : anchor;
    menu.style.left = `${Math.max(8, Math.min(point.x - box.left, box.width - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(point.y - box.top, box.height - menu.offsetHeight - 8))}px`;
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
    else if (event.key === "Escape" || event.key === "Tab") closeMenu({ restore: true });
    else return;
    event.preventDefault();
    // Escape closes the menu, not the tool's window around it.
    event.stopPropagation();
  });

  // ---- keys --------------------------------------------------------------------------------------------------
  const onKey = (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const typing =
      /^(input|textarea|select)$/i.test(event.target.tagName) &&
      event.target.type !== "range" &&
      event.target.type !== "checkbox";
    if (key === "s") {
      event.preventDefault();
      void saveProject();
    } else if (!typing && key === "z" && !event.shiftKey) {
      event.preventDefault();
      undo();
    } else if (!typing && (key === "y" || (key === "z" && event.shiftKey))) {
      event.preventDefault();
      redo();
    }
  };
  shell.addEventListener("keydown", onKey);
  $("saveProject").addEventListener("click", () => void saveProject());

  renderTabs();
  renderForm();
  renderViewControls();
  updateBar();
  await build();

  return () => {
    closed = true;
    clearTimeout(buildTimer);
    clearTimeout(draftTimer);
    closeMenu();
    void storage.set("draft", { name, params, projectId, saved, view }).catch(() => undefined);
    shell.removeEventListener("keydown", onKey);
    viewer?.dispose();
  };
}
