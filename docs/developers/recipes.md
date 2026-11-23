# Recipes

Complete widgets and tools, each a folder under [`examples/`](examples) in the layout a shared one has. Each is
type-checked against the SDK in CI, so they keep working as it changes. To try one, paste its parts into the editor as
[your first widget](first-widget.md) and [your first tool](first-tool.md) describe, or hand the folder to an AI
assistant and ask it to save it.

| Recipe                                                         | Kind   | Shows                                                                    |
| -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| [Library at a glance](#library-at-a-glance)                    | Widget | Thingport's own API with `api()`, and a layout that follows `onResize`   |
| [OctoPrint progress](#octoprint-progress)                      | Widget | A service on the local network through `fetch`, a secret setting, timers |
| [Tag helper](#tag-helper)                                      | Tool   | Reading the whole library, changing models, confirming, `storage`        |
| [Box with a lid, from OpenSCAD](#box-with-a-lid-from-openscad) | Tool   | `library("openscad")`: a form built from a script, a cancellable render  |
| [Printed it](#printed-it)                                      | Tool   | `commands`, `shared` entries about a model, a part of the model's page   |

## Library at a glance

A panel of the library's totals: models, collections, authors and categories. It reads them from
`GET /api/dashboard/summary`, the endpoint the built-in panels use, through `thingport.api()`, which sends the
request as the signed-in user. When the panel is narrower than four grid columns, it puts the numbers two by two:
`onResize` hears each change of size, and the function it returns stops listening in the cleanup.

<!-- sdk:example library-glance/widget.js -->

[`library-glance/widget.js`](examples/library-glance/widget.js)

```js
// @ts-check

const COUNTS = ["model_count", "collection_count", "author_count", "category_count"];

/** @param {import("../thingport").WidgetSdk} thingport */
export default function mount(thingport) {
  const { root, api, t, onResize } = thingport;
  const grid = root.querySelector(".glance");

  // Four across where the panel is wide enough, two by two where it isn't.
  /** @param {import("../thingport").WidgetSize} size */
  const fit = ({ cols }) => grid.setAttribute("style", `--columns: ${cols >= 4 ? 4 : 2}`);
  fit(thingport.size);
  const stopResizing = onResize(fit);

  let stopped = false;
  (async () => {
    const res = await api("/dashboard/summary");
    if (stopped) return;
    if (!res.ok) {
      grid.innerHTML = `<p class="failed">${t("failed")}</p>`;
      return;
    }
    const summary = await res.json();
    if (stopped) return;
    grid.replaceChildren(
      ...COUNTS.map((key) => {
        const tile = document.createElement("div");
        const value = document.createElement("strong");
        value.textContent = Number(summary[key]).toLocaleString(thingport.language);
        const label = document.createElement("span");
        label.textContent = t(key);
        tile.append(value, label);
        return tile;
      }),
    );
  })();

  return () => {
    stopped = true;
    stopResizing();
  };
}
```

<!-- /sdk:example -->

<!-- sdk:example library-glance/widget.html -->

[`library-glance/widget.html`](examples/library-glance/widget.html)

```html
<style>
  .glance {
    display: grid;
    grid-template-columns: repeat(var(--columns, 4), 1fr);
    gap: 8px;
    height: 100%;
    padding: 12px;
    box-sizing: border-box;
    font-family: var(--tp-font);
    color: var(--tp-text);
  }
  .glance div {
    display: grid;
    align-content: center;
    padding: 8px;
    border-radius: 8px;
    background: var(--tp-background);
  }
  .glance strong {
    font-size: 22px;
    font-variant-numeric: tabular-nums;
  }
  .glance span {
    font-size: 12px;
    color: var(--tp-text-muted);
  }
  .glance .failed {
    grid-column: 1 / -1;
    color: var(--tp-error);
  }
</style>
<div class="glance"></div>
```

<!-- /sdk:example -->

<!-- sdk:example library-glance/locales/en.json -->

[`library-glance/locales/en.json`](examples/library-glance/locales/en.json)

```json
{
  "model_count": "Models",
  "collection_count": "Collections",
  "author_count": "Authors",
  "category_count": "Categories",
  "failed": "Couldn't read the library's totals."
}
```

<!-- /sdk:example -->

<!-- sdk:example library-glance/widget.json -->

[`library-glance/widget.json`](examples/library-glance/widget.json)

```json
{
  "name": "Library at a glance",
  "description": "How many models, collections, authors and categories your library has.",
  "iconUrl": "builtin:thingport/icon",
  "version": "1.0.0",
  "size": { "w": 4, "h": 2, "minW": 2, "minH": 2 },
  "settings": [],
  "hosts": [],
  "locales": ["en"]
}
```

<!-- /sdk:example -->

`t(key)` here is given the summary's own field names as keys, so the labels file is the one place the words live.

## OctoPrint progress

What an [OctoPrint](https://octoprint.org/) printer is printing, how far along it is and how long is left, refreshed
every few seconds. The browser usually can't reach a printer at `http://octopi.local` itself, for want of CORS
headers, so the request goes through `thingport.fetch`, which the Thingport server makes, and only to the hosts the
metadata lists. Someone whose printer has another address adds that host under **Hosts it may reach**.

<!-- sdk:example octoprint-progress/widget.js -->

[`octoprint-progress/widget.js`](examples/octoprint-progress/widget.js)

```js
// @ts-check

/** @param {import("../thingport").WidgetSdk} thingport */
export default function mount(thingport) {
  const { root, settings, t, labels } = thingport;
  labels();

  const panel = root.querySelector(".octo");
  const file = root.querySelector(".file");
  const bar = root.querySelector(".bar");
  const state = root.querySelector(".state");
  const address = String(settings.address).replace(/\/+$/, "");

  async function refresh() {
    try {
      // Through the Thingport server, which may reach the printer on the local network; the browser may not.
      const res = await thingport.fetch(`${address}/api/job`, { headers: { "X-Api-Key": settings.apiKey } });
      if (!res.ok) throw new Error(t("status", { status: res.status }));
      const job = await res.json();
      const done = job.progress?.completion ?? 0;
      panel.classList.remove("failed");
      file.textContent = job.job?.file?.display ?? job.job?.file?.name ?? t("idle");
      bar.setAttribute("style", `--done: ${done / 100}`);
      bar.setAttribute("aria-valuenow", String(Math.round(done)));
      const left = job.progress?.printTimeLeft;
      state.textContent = left
        ? t("left", { state: job.state, percent: Math.round(done), minutes: Math.ceil(left / 60) })
        : job.state;
    } catch (error) {
      panel.classList.add("failed");
      state.textContent = t("failed", { reason: error.message });
    }
  }

  refresh();
  const timer = setInterval(refresh, Number(settings.refresh) * 1000);
  return () => clearInterval(timer);
}
```

<!-- /sdk:example -->

<!-- sdk:example octoprint-progress/widget.html -->

[`octoprint-progress/widget.html`](examples/octoprint-progress/widget.html)

```html
<style>
  .octo {
    display: grid;
    gap: 6px;
    padding: 12px;
    font-family: var(--tp-font);
    color: var(--tp-text);
  }
  .octo .file {
    overflow: hidden;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .octo .bar {
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--tp-divider);
  }
  .octo .bar div {
    height: 100%;
    background: var(--tp-accent);
    transform-origin: left;
    transform: scaleX(var(--done, 0));
    transition: transform 300ms ease-out;
  }
  .octo .state {
    font-size: 12px;
    color: var(--tp-text-muted);
  }
  .octo.failed .state {
    color: var(--tp-error);
  }
  @media (prefers-reduced-motion: reduce) {
    .octo .bar div {
      transition: none;
    }
  }
</style>
<div class="octo">
  <div class="file" data-t="loading">Asking the printer…</div>
  <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div></div></div>
  <div class="state"></div>
</div>
```

<!-- /sdk:example -->

<!-- sdk:example octoprint-progress/locales/en.json -->

[`octoprint-progress/locales/en.json`](examples/octoprint-progress/locales/en.json)

```json
{
  "loading": "Asking the printer…",
  "idle": "Nothing printing",
  "left": "{state} · {percent}% · {minutes} min left",
  "status": "OctoPrint answered {status}",
  "failed": "Couldn't reach OctoPrint: {reason}",
  "settings.address": "OctoPrint address",
  "settings.apiKey": "API key",
  "settings.refresh": "Refresh",
  "settings.seconds5": "Every 5 s",
  "settings.seconds10": "Every 10 s",
  "settings.seconds30": "Every 30 s"
}
```

<!-- /sdk:example -->

<!-- sdk:example octoprint-progress/widget.json -->

[`octoprint-progress/widget.json`](examples/octoprint-progress/widget.json)

```json
{
  "name": "OctoPrint progress",
  "description": "What an OctoPrint printer is printing, how far along it is and how long is left.",
  "iconUrl": "builtin:services/octoprint",
  "version": "1.0.0",
  "size": { "w": 4, "h": 2, "minW": 3, "minH": 2 },
  "settings": [
    {
      "key": "address",
      "type": "text",
      "label": "settings.address",
      "default": "http://octopi.local",
      "placeholder": "http://octopi.local"
    },
    { "key": "apiKey", "type": "text", "label": "settings.apiKey", "secret": true },
    {
      "key": "refresh",
      "type": "choice",
      "label": "settings.refresh",
      "default": "10",
      "options": [
        { "value": "5", "label": "settings.seconds5" },
        { "value": "10", "label": "settings.seconds10" },
        { "value": "30", "label": "settings.seconds30" }
      ]
    }
  ],
  "hosts": ["octopi.local"],
  "locales": ["en"]
}
```

<!-- /sdk:example -->

- The API key is a `secret` setting, shown as a password field in the cog. It's sent to the printer as a header
  through Thingport; the `Cookie` header is never forwarded, so the user's Thingport session doesn't go with it.
- The timer is cleared in the cleanup. Without that, every change of setting or theme would leave another timer
  running.
- The progress bar animates `transform`, not its width, and stops animating for someone who has asked for less motion.

## Tag helper

A tool that finds the models with no tags and tags the ones ticked, a few at a time. It reads the library a page of 200
at a time with `models.list()`, changes each model with `models.update()`, asks before tagging more than ten with
`ui.confirm()`, and keeps the tags used last in `storage`, offered as buttons the next time.

<!-- sdk:example tag-helper/tool.js -->

[`tag-helper/tool.js`](examples/tag-helper/tool.js)

```js
// @ts-check

// How far it looks: the library is read a page at a time, and a big one doesn't need reading to the end at once.
const PAGE = 200;
const MOST = 2000;

/** @param {import("../thingport").ToolSdk} thingport */
export default async function mount(thingport) {
  const { root, models, storage, ui, t, labels } = thingport;
  labels();

  const form = root.querySelector("form");
  const input = form.querySelector("input");
  const recent = root.querySelector(".recent");
  const status = root.querySelector(".status");
  const list = root.querySelector("ul");
  let closed = false;

  /** @type {string[]} */
  let recentTags = (await storage.get("recent")) ?? [];
  showRecent();

  /** @type {import("../thingport").SdkModel[]} */
  const untagged = [];
  // Not awaited: the cleanup below has to be returned while this is still reading, or closing the window
  // couldn't stop it.
  (async () => {
    for (let offset = 0; offset < MOST && !closed; offset += PAGE) {
      const page = await models.list({ limit: PAGE, offset });
      untagged.push(...page.models.filter((model) => !model.tags.length && !model.toolOwned));
      if (!page.hasMore) break;
    }
    if (!closed) showList();
  })().catch((error) => {
    status.textContent = t("failed", { reason: error.message });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tags = input.value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const ticked = [...list.querySelectorAll("input:checked")].map((box) => box.getAttribute("value"));
    if (!tags.length || !ticked.length) {
      ui.toast(t("nothing"), "info");
      return;
    }
    if (ticked.length > 10) {
      const sure = await ui.confirm({
        title: t("confirmTitle"),
        message: t("confirmMessage", { count: ticked.length, tags: tags.join(", ") }),
        confirmLabel: t("apply"),
      });
      if (!sure) return;
    }
    for (const id of ticked) await models.update(id, { tags });
    ui.toast(t("done", { count: ticked.length }), "success");
    recentTags = [...new Set([...tags, ...recentTags])].slice(0, 12);
    await storage.set("recent", recentTags);
    untagged.splice(0, untagged.length, ...untagged.filter((model) => !ticked.includes(model.id)));
    input.value = "";
    showRecent();
    showList();
  });

  function showList() {
    status.textContent = untagged.length ? t("found", { count: untagged.length }) : t("allTagged");
    list.replaceChildren(
      ...untagged.map((model) => {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.value = model.id;
        const label = document.createElement("label");
        label.append(box, model.name);
        const item = document.createElement("li");
        item.append(label);
        return item;
      }),
    );
  }

  function showRecent() {
    recent.replaceChildren(
      ...recentTags.map((tag) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = tag;
        button.title = t("add", { tag });
        button.addEventListener("click", () => {
          input.value = input.value.trim() ? `${input.value}, ${tag}` : tag;
          input.focus();
        });
        return button;
      }),
    );
  }

  return () => {
    closed = true;
  };
}
```

<!-- /sdk:example -->

<!-- sdk:example tag-helper/tool.html -->

[`tag-helper/tool.html`](examples/tag-helper/tool.html)

```html
<style>
  .tagger {
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: 12px;
    height: 100%;
    padding: 16px;
    box-sizing: border-box;
    font-family: var(--tp-font);
    color: var(--tp-text);
  }
  .tagger form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tagger input[name="tags"] {
    flex: 1;
    min-width: 160px;
  }
  .tagger input,
  .tagger button {
    padding: 6px 10px;
    border: 1px solid var(--tp-divider);
    border-radius: 8px;
    background: var(--tp-paper);
    color: var(--tp-text);
    font: inherit;
  }
  .tagger button {
    cursor: pointer;
  }
  .tagger button[type="submit"] {
    border-color: transparent;
    background: var(--tp-accent);
    color: var(--tp-accent-ink);
  }
  .tagger .recent {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tagger .recent button {
    padding: 2px 8px;
    font-size: 12px;
  }
  .tagger ul {
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }
  .tagger li label {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 0;
    border-bottom: 1px solid var(--tp-divider);
  }
  .tagger .status {
    font-size: 12px;
    color: var(--tp-text-muted);
  }
</style>
<div class="tagger">
  <form>
    <input
      name="tags"
      aria-label="Tags"
      data-t-aria="tags"
      data-t-placeholder="tagsHint"
      placeholder="Tags, separated by commas"
    />
    <button type="submit" data-t="apply">Tag the ticked models</button>
  </form>
  <div class="recent"></div>
  <div>
    <p class="status" data-t="looking">Looking for models with no tags…</p>
    <ul></ul>
  </div>
</div>
```

<!-- /sdk:example -->

<!-- sdk:example tag-helper/locales/en.json -->

[`tag-helper/locales/en.json`](examples/tag-helper/locales/en.json)

```json
{
  "tags": "Tags",
  "tagsHint": "Tags, separated by commas",
  "apply": "Tag the ticked models",
  "looking": "Looking for models with no tags…",
  "found": "{count} models have no tags",
  "allTagged": "Every model has a tag.",
  "nothing": "Tick some models and write a tag first.",
  "confirmTitle": "Tag these models?",
  "confirmMessage": "{count} models get the tags {tags}.",
  "done": "Tagged {count} models",
  "add": "Add {tag}",
  "failed": "Couldn't read the library: {reason}"
}
```

<!-- /sdk:example -->

<!-- sdk:example tag-helper/tool.json -->

[`tag-helper/tool.json`](examples/tag-helper/tool.json)

```json
{
  "name": "Tag helper",
  "description": "Finds the models in your library with no tags, and tags them a few at a time.",
  "version": "1.0.0",
  "window": { "width": 640, "height": 560 },
  "hosts": [],
  "category": "library",
  "locales": ["en"]
}
```

<!-- /sdk:example -->

- The default export returns as soon as the window is drawn and reads the library afterwards. A cleanup only exists
  once the export has returned, so a tool that awaited the whole library before returning couldn't be stopped when
  its window closed.
- Models a tool brought (`toolOwned`) are left out: they can be read but not changed.
- `models.update(id, { tags })` replaces a model's tags. To add to them, pass `[...model.tags, ...tags]`.

## Box with a lid, from OpenSCAD

A tool that generates a box and its lid with OpenSCAD and saves them into the library as one 3MF. The model is an
OpenSCAD script inside the tool, and its form is built from `parameters()`, which reads the script's own
[customizer](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Customizer) comments: the groups, the captions and the
ranges. `render()` runs in a worker, so the window keeps responding, and an `AbortController` cancels it, both from
the **Cancel** button and when the window closes.

<!-- sdk:example openscad-box/tool.js -->

[`openscad-box/tool.js`](examples/openscad-box/tool.js)

```js
// @ts-check

// The model, as an OpenSCAD script. Its parameters, groups and captions are read by OpenSCAD itself, so the form
// below is built from them rather than written out a second time.
const SCAD = `
/* [Box] */
// Inside width (mm)
width = 60; // [20:200]
// Inside depth (mm)
depth = 40; // [20:200]
// Inside height (mm)
height = 30; // [10:150]
// Wall (mm)
wall = 2; // [1:0.2:5]

/* [Lid] */
// Make a lid
lid = true;
// Gap between the lid's plug and the box (mm)
clearance = 0.3; // [0:0.05:1]

module shell() {
  difference() {
    cube([width + 2 * wall, depth + 2 * wall, height + wall]);
    translate([wall, wall, wall]) cube([width, depth, height + 1]);
  }
}

module cover() {
  cube([width + 2 * wall, depth + 2 * wall, wall]);
  translate([wall + clearance, wall + clearance, wall])
    cube([width - 2 * clearance, depth - 2 * clearance, 3]);
}

shell();
if (lid) translate([0, depth + 2 * wall + 10, 0]) cover();
`;

/** @param {import("../thingport").ToolSdk} thingport */
export default async function mount(thingport) {
  const { root, storage, models, collections, ui, t, labels } = thingport;
  labels();

  const form = root.querySelector("form");
  const fields = root.querySelector(".parameters");
  const cancel = root.querySelector(".cancel");
  const output = root.querySelector("output");
  /** @type {AbortController | null} */
  let running = null;

  const openscad = await thingport.library("openscad");
  const { parameters } = await openscad.parameters(SCAD);
  const last = (await storage.get("parameters")) ?? {};

  // A fieldset per group, a field per parameter: a switch for a boolean, a number for the rest.
  /** @type {Map<string, import("../thingport").ScadParameter[]>} */
  const groups = new Map();
  for (const parameter of parameters) groups.set(parameter.group, [...(groups.get(parameter.group) ?? []), parameter]);
  for (const [group, members] of groups) {
    const set = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = group;
    set.append(legend);
    for (const parameter of members) {
      const input = document.createElement("input");
      input.name = parameter.name;
      const value = last[parameter.name] ?? parameter.initial;
      if (parameter.type === "boolean") {
        input.type = "checkbox";
        input.checked = Boolean(value);
      } else {
        input.type = "number";
        input.value = String(value);
        if (parameter.min !== undefined) input.min = String(parameter.min);
        if (parameter.max !== undefined) input.max = String(parameter.max);
        input.step = String(parameter.step ?? "any");
      }
      const label = document.createElement("label");
      label.append(parameter.caption ?? parameter.name, input);
      set.append(label);
    }
    fields.append(set);
  }
  output.textContent = "";

  cancel.addEventListener("click", () => running?.abort());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    /** @type {Record<string, number | boolean>} */
    const values = {};
    for (const input of form.querySelectorAll("input")) {
      values[input.name] = input.type === "checkbox" ? input.checked : Number(input.value);
    }
    running = new AbortController();
    cancel.toggleAttribute("hidden", false);
    output.textContent = t("making");
    try {
      const { bytes, seconds } = await openscad.render(SCAD, {
        parameters: values,
        name: t("name"),
        signal: running.signal,
      });
      await storage.set("parameters", values);
      output.textContent = t("made", { seconds: seconds.toFixed(1) });
      const collection = await collections.pick({ title: t("saveTo") });
      if (!collection) return;
      const name = t("modelName", { width: values.width, depth: values.depth, height: values.height });
      const model = await models.create({
        name,
        tags: ["box", "openscad"],
        collectionId: collection.id,
        files: [{ name: `${name}.3mf`, data: bytes }],
      });
      ui.toast(t("saved", { name: model.name }), "success", { openModel: model.id });
    } catch (error) {
      // A cancelled render rejects too; the user asked for that, so it needs no explaining.
      output.textContent = running?.signal.aborted ? "" : t("failed", { reason: error.message });
    } finally {
      running = null;
      cancel.toggleAttribute("hidden", true);
    }
  });

  // Closing the window stops a render that's still going, rather than leaving a worker busy for nothing.
  return () => running?.abort();
}
```

<!-- /sdk:example -->

<!-- sdk:example openscad-box/tool.html -->

[`openscad-box/tool.html`](examples/openscad-box/tool.html)

```html
<style>
  .scadbox {
    display: grid;
    gap: 12px;
    padding: 16px;
    font-family: var(--tp-font);
    color: var(--tp-text);
  }
  .scadbox fieldset {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px;
    margin: 0;
    padding: 8px 0 0;
    border: 0;
    border-top: 1px solid var(--tp-divider);
  }
  .scadbox legend {
    font-weight: 600;
  }
  .scadbox label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--tp-text-muted);
  }
  .scadbox input,
  .scadbox button {
    padding: 6px 10px;
    border: 1px solid var(--tp-divider);
    border-radius: 8px;
    background: var(--tp-paper);
    color: var(--tp-text);
    font: inherit;
  }
  .scadbox .actions {
    display: flex;
    gap: 8px;
  }
  .scadbox button {
    cursor: pointer;
  }
  .scadbox button[type="submit"] {
    border-color: transparent;
    background: var(--tp-accent);
    color: var(--tp-accent-ink);
  }
  .scadbox output {
    font-size: 12px;
    white-space: pre-wrap;
    color: var(--tp-text-muted);
  }
</style>
<form class="scadbox">
  <div class="parameters"></div>
  <div class="actions">
    <button type="submit" data-t="make">Make and save…</button>
    <button type="button" class="cancel" data-t="cancel" hidden>Cancel</button>
  </div>
  <output aria-live="polite" data-t="starting">Starting OpenSCAD…</output>
</form>
```

<!-- /sdk:example -->

<!-- sdk:example openscad-box/locales/en.json -->

[`openscad-box/locales/en.json`](examples/openscad-box/locales/en.json)

```json
{
  "make": "Make and save…",
  "cancel": "Cancel",
  "starting": "Starting OpenSCAD…",
  "making": "OpenSCAD is making the box…",
  "made": "Made in {seconds} s.",
  "name": "Box",
  "modelName": "Box {width}x{depth}x{height}",
  "saveTo": "Save the box to",
  "saved": "Saved {name}",
  "failed": "OpenSCAD couldn't make it: {reason}"
}
```

<!-- /sdk:example -->

<!-- sdk:example openscad-box/tool.json -->

[`openscad-box/tool.json`](examples/openscad-box/tool.json)

```json
{
  "name": "Box with a lid",
  "description": "A box and its lid to the inside size you give, generated by OpenSCAD and kept in your library as a 3MF.",
  "version": "1.0.0",
  "window": { "width": 480, "height": 520 },
  "hosts": [],
  "category": "generators",
  "locales": ["en"]
}
```

<!-- /sdk:example -->

- OpenSCAD is several megabytes of WebAssembly, fetched and compiled the first time a widget or tool asks for it, so
  the window says so while it waits. Everything happens in the browser: the script, the parameters and the model go
  nowhere until `models.create()` uploads the result.
- A render gives a 3MF unless `format` asks for `stl`, `obj`, `off`, `amf` or `mesh`, the geometry without a file.
  `writeThreeMf()` and `layoutRow()` put several meshes into one 3MF, each named, for a planner making many parts.
- The same customizer comments drive Thingport's own **Customize** on a model that came with its script; this tool
  uses one of its own instead, but `models.relatedFiles()` and `models.relatedText()` reach a model's.

## Printed it

A tool the household shares: anyone marks a model as printed, and every model's page says who has printed it, on that
copy or any other of the same model.

- **Two commands**, both `"window": false`: **Mark as printed** under **Tools** in the menu beside a model's Open
  button (`"on": "model"`), and the same in a model grid's toolbar in edit mode, for the models selected
  (`"on": "selection"`). Thingport calls the script's `run` export with the command's id, and `context` says which
  models. Give a selection command a `symbol` for its toolbar button, as in
  [Tool development](../TOOL_DEVELOPMENT.md#commands-on-model-pages-and-grids).
- **A shared entry per model**, `shared.set(key, value, { model })`. Each user's entry is their own, so two people
  marking one model make two entries under the same key. Tying it to the model lets `shared.list({ model })` find it
  from the model's copies too.
- **A part of the model's page**: `"modelPage": { "info": true }` and the `modelInfo` export draw a chip in the info box,
  and `ui.popover()` opens beside it with who and when. `shared.onChange()` redraws it the moment a command or the
  window marks the model, and the cleanup it returns stops listening.
- **The window** lists the user's own entries (`mine`), adds more through Thingport's model picker, `ui.pickModels()`,
  and lets the user choose whom theirs reach with `shared.share()`.

The editor's **Details** have no fields for `commands` and `modelPage`, so hand this one to an
[AI assistant](ai-assistant.md) to save: `save_tool` takes the whole metadata, and the editor keeps both from then on.

<!-- sdk:example printed-it/tool.js -->

[`printed-it/tool.js`](examples/printed-it/tool.js)

```js
// @ts-check

// One shared entry per model a user has printed, keyed by the model's id and tied to it, so that the model's copies
// find it too: the same original, or imported from the same page.
const PREFIX = "printed:";

/**
 * Marks models as printed by the user. The name goes with each, so the window can list them without asking for each.
 *
 * @param {import("../thingport").ToolSdk} thingport
 * @param {{ id: string; name: string }[]} models
 */
async function mark(thingport, models) {
  const at = new Date().toISOString();
  for (const { id, name } of models) await thingport.shared.set(`${PREFIX}${id}`, { name, at }, { model: id });
}

/**
 * Both commands: "Mark as printed" under Tools on a model's page, and in a grid's toolbar for the models selected.
 * They have `"window": false` in the metadata, so Thingport calls this instead of opening the window.
 *
 * @param {string} command
 * @param {import("../thingport").ToolSdk} thingport
 */
export async function run(command, thingport) {
  const { context, models, ui, t } = thingport;
  const ids = command === "mark-selection" ? (context.modelIds ?? []) : context.modelId ? [context.modelId] : [];
  const picked = await Promise.all(ids.map((id) => models.get(id)));
  await mark(thingport, picked);
  ui.toast(t("marked", { count: picked.length }), "success", { openWindow: t("open") });
}

/**
 * The part of every model's page, in its info box: a chip saying how many people have printed it, on this copy or
 * another, and a popover saying who and when. It draws nothing while nobody has, so it takes no room.
 *
 * @param {import("../thingport").ToolSdk} thingport
 */
export function modelInfo(thingport) {
  const { root, context, shared, ui, t, language } = thingport;
  const modelId = context.modelId;
  if (!modelId) return;
  const dates = new Intl.DateTimeFormat(language, { dateStyle: "medium" });
  const chip = document.createElement("button");
  chip.type = "button";
  chip.style.cssText =
    "padding: 2px 10px; border: 1px solid var(--tp-divider); border-radius: 999px; background: var(--tp-paper);" +
    "color: var(--tp-text); font: 12px var(--tp-font); cursor: pointer";
  /** @type {import("../thingport").SdkSharedEntry[]} */
  let entries = [];

  chip.addEventListener("click", () =>
    ui.popover(chip, (box) => {
      box.style.cssText = "padding: 12px; font: 13px var(--tp-font); color: var(--tp-text)";
      box.replaceChildren(
        ...entries.map((entry) => {
          const line = document.createElement("div");
          const who = entry.mine ? t("you") : (entry.user?.name ?? t("someone"));
          const at = new Date(entry.value?.at);
          line.textContent = Number.isNaN(at.getTime()) ? who : `${who} · ${dates.format(at)}`;
          return line;
        }),
      );
    }),
  );

  const draw = async () => {
    entries = await shared.list({ prefix: PREFIX, model: modelId });
    chip.textContent = t("chip", { count: entries.length });
    root.replaceChildren(...(entries.length ? [chip] : []));
  };
  // A command or the window marking the model on this page redraws the chip at once.
  const stop = shared.onChange(() => void draw());
  void draw();
  return stop;
}

/**
 * The window: what the user has marked, to open or unmark, more to add, and whom theirs reach.
 *
 * @param {import("../thingport").ToolSdk} thingport
 */
export default async function mount(thingport) {
  const { root, shared, ui, t, labels } = thingport;
  labels();
  const audience = root.querySelector("button.audience");
  const status = root.querySelector(".status");
  const list = root.querySelector("ul");

  async function showAudience() {
    const { everyone, people } = await shared.audience();
    audience.textContent = everyone ? t("everyone") : t("people", { count: people.length });
  }

  async function showList() {
    const mine = (await shared.list({ prefix: PREFIX })).filter((entry) => entry.mine);
    status.textContent = mine.length ? "" : t("none");
    list.replaceChildren(
      ...mine.map((entry) => {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "name";
        open.textContent = entry.value?.name ?? entry.key;
        open.addEventListener("click", () => ui.openModel(entry.key.slice(PREFIX.length)));
        const unmark = document.createElement("button");
        unmark.type = "button";
        unmark.textContent = t("unmark");
        unmark.addEventListener("click", () => void shared.remove(entry.key));
        const item = document.createElement("li");
        item.append(open, unmark);
        return item;
      }),
    );
  }

  // `share()` is Thingport's own dialog for whom the user's entries reach, and null when they close it.
  audience.addEventListener("click", async () => {
    if (await shared.share()) await showAudience();
  });
  root.querySelector("button.add").addEventListener("click", async () => {
    const picked = await ui.pickModels({ title: t("add"), confirmLabel: t("addConfirm") });
    if (picked.length) await mark(thingport, picked);
  });

  const stop = shared.onChange(() => void showList());
  await Promise.all([showAudience(), showList()]);
  return stop;
}
```

<!-- /sdk:example -->

<!-- sdk:example printed-it/tool.html -->

[`printed-it/tool.html`](examples/printed-it/tool.html)

```html
<style>
  .printed {
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: 12px;
    height: 100%;
    padding: 16px;
    box-sizing: border-box;
    font-family: var(--tp-font);
    color: var(--tp-text);
  }
  .printed header {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .printed h2 {
    flex: 1;
    margin: 0;
    font-size: 16px;
  }
  .printed button {
    padding: 6px 10px;
    border: 1px solid var(--tp-divider);
    border-radius: 8px;
    background: var(--tp-paper);
    color: var(--tp-text);
    font: inherit;
    cursor: pointer;
  }
  .printed button.add {
    border-color: transparent;
    background: var(--tp-accent);
    color: var(--tp-accent-ink);
  }
  .printed .status {
    margin: 0;
    font-size: 12px;
    color: var(--tp-text-muted);
  }
  .printed ul {
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: auto;
  }
  .printed li {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--tp-divider);
  }
  .printed li .name {
    flex: 1;
    border: 0;
    padding: 0;
    text-align: start;
    background: none;
  }
</style>
<div class="printed">
  <header>
    <h2 data-t="title">What you've printed</h2>
    <button class="audience" type="button" data-t="everyone">Everyone sees yours</button>
    <button class="add" type="button" data-t="add">Add models</button>
  </header>
  <p class="status"></p>
  <ul></ul>
</div>
```

<!-- /sdk:example -->

<!-- sdk:example printed-it/locales/en.json -->

[`printed-it/locales/en.json`](examples/printed-it/locales/en.json)

```json
{
  "commands.mark": "Mark as printed",
  "commands.mark-selection": "Mark as printed",
  "marked": "Marked {count} as printed",
  "open": "Open Printed it",
  "title": "What you've printed",
  "add": "Add models",
  "addConfirm": "Mark",
  "none": "Nothing marked yet. Mark a model from the Tools menu on its page, or add some here.",
  "unmark": "Not printed",
  "everyone": "Everyone sees yours",
  "people": "{count} people see yours",
  "chip": "Printed by {count}",
  "you": "You",
  "someone": "Someone"
}
```

<!-- /sdk:example -->

<!-- sdk:example printed-it/tool.json -->

[`printed-it/tool.json`](examples/printed-it/tool.json)

```json
{
  "name": "Printed it",
  "description": "Marks the models you've printed, and shows on each model's page who in the household has printed it.",
  "version": "1.0.0",
  "window": { "width": 460, "height": 520 },
  "hosts": [],
  "category": "library",
  "locales": ["en"],
  "commands": [
    { "id": "mark", "title": "Mark as printed", "on": "model", "window": false },
    { "id": "mark-selection", "title": "Mark as printed", "on": "selection", "window": false }
  ],
  "modelPage": { "info": true }
}
```

<!-- /sdk:example -->

- A model's page shows the entries of everyone whose entries reach the reader, so the chip counts only the people who
  share with them.
- Nothing private goes into a shared value: the model's name and a date. A thumbnail's address, for one, carries its
  writer's session.
- A model a user marks again keeps one entry, with the new date: `set` replaces their entry under the key.
