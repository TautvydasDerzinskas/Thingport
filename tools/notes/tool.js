const PREFIX = "note:";
const LIMIT = 500;
const personalChanges = new EventTarget();

async function readPublicNotes(shared, options) {
  const notes = [];
  let before;
  for (;;) {
    const page = await shared.list({ ...options, before });
    notes.push(...page);
    if (page.length < 5000) return notes;
    before = page.at(-1).cursor;
  }
}

async function readPersonalNotes(storage, prefix) {
  const keys = (await storage.keys()).filter((key) => key.startsWith(prefix));
  const notes = [];
  for (let i = 0; i < keys.length; i += 8) {
    notes.push(
      ...(await Promise.all(
        keys.slice(i, i + 8).map(async (key) => {
          const value = await storage.get(key);
          return { key, value, mine: true, modelId: key.split(":")[1], updatedAt: value?.updatedAt };
        }),
      )),
    );
  }
  return notes;
}

async function readNotes({ shared, storage }, { model, preview } = {}) {
  const personalPrefix = preview ? PREFIX + model + ":" + preview + ":" : PREFIX;
  const [personal, publicNotes] = await Promise.all([
    readPersonalNotes(storage, personalPrefix),
    readPublicNotes(shared, { prefix: PREFIX, model, preview }),
  ]);
  const matchingPublic = preview
    ? publicNotes.filter((note) => note.previewMatch ?? note.key.startsWith(personalPrefix))
    : publicNotes;
  return [...personal, ...matchingPublic.map((note) => ({ ...note, public: true }))]
    .filter(
      ({ value, mine }) =>
        (model || mine) &&
        typeof value?.text === "string" &&
        value.text.length > 0 &&
        value.text.length <= LIMIT &&
        [value.x, value.y].every((point) => Number.isFinite(point) && point >= 0 && point <= 1),
    )
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

function onNotesChange(thingport, listener) {
  personalChanges.addEventListener("change", listener);
  const stop = thingport.shared.onChange(listener);
  return () => {
    personalChanges.removeEventListener("change", listener);
    stop();
  };
}

function button(label, action, className = "") {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", action);
  return element;
}

async function confirmRemove({ ui, shared, storage, t }, note) {
  const confirmed = await ui.confirm({
    title: t("board.deleteTitle"),
    message: t("board.deleteMessage"),
    confirmLabel: t("board.delete"),
    destructive: true,
  });
  if (!confirmed) return false;
  if (note.public) await shared.remove(note.key);
  else {
    await storage.remove(note.key);
    personalChanges.dispatchEvent(new Event("change"));
  }
  return true;
}

export default function mount(thingport) {
  const { root, labels, models, t, ui, language } = thingport;
  const search = root.querySelector("input");
  const status = root.querySelector(".notes-status");
  const cards = root.querySelector(".notes-cards");
  const more = root.querySelector(".notes-more");
  const retry = root.querySelector(".notes-retry");
  const template = root.querySelector(".note-template");
  const modelsById = new Map();
  let alive = true;
  let revision = 0;
  let shown = 40;
  let notes = [];
  let loadStatus = "board.loading";

  labels();

  function renderStatus() {
    retry.hidden = loadStatus !== "board.error";
    status.textContent = loadStatus ? t(loadStatus) : "";
  }

  function render() {
    const query = search.value.trim().toLocaleLowerCase(language);
    const filtered = notes.filter((note) =>
      [note.value.text, modelsById.get(note.modelId)?.name].some((text) =>
        text?.toLocaleLowerCase(language).includes(query),
      ),
    );
    const elements = filtered.slice(0, shown).map((note) => {
      const card = template.content.firstElementChild.cloneNode(true);
      const model = modelsById.get(note.modelId);
      const isPublic = Boolean(note.public);
      card.dataset.public = String(isPublic);
      const link = card.querySelector(".note-model");
      const thumbnail = link.firstElementChild;
      const name = model?.name ?? t("board.unavailable");
      link.lastElementChild.textContent = name;
      link.disabled = !model;
      if (model) link.addEventListener("click", () => models.open(model.id));
      if (model?.thumbnail) {
        const image = document.createElement("img");
        image.src = model.thumbnail;
        image.alt = "";
        image.loading = "lazy";
        thumbnail.append(image);
      } else {
        thumbnail.textContent = Array.from(name)[0] ?? "–";
      }
      card.querySelector(".note-text").textContent = note.value.text;
      card.querySelector(".note-visibility").textContent = t(isPublic ? "board.public" : "board.personal");
      const remove = card.querySelector(".note-delete");
      remove.textContent = t("board.delete");
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await confirmRemove(thingport, note);
        } catch {
          if (alive) ui.toast(t("board.deleteFailed"), "error");
        } finally {
          remove.disabled = false;
        }
      });
      return card;
    });
    cards.replaceChildren(...elements);
    renderStatus();
    if (!loadStatus && !filtered.length) status.textContent = t(query ? "board.noMatches" : "board.empty");
    more.hidden = shown >= filtered.length;
  }

  async function load() {
    const run = ++revision;
    loadStatus = "board.loading";
    renderStatus();
    try {
      const incoming = await readNotes(thingport);
      const missing = [...new Set(incoming.map((note) => note.modelId))].filter((id) => id && !modelsById.has(id));
      for (let i = 0; i < missing.length && alive && revision === run; i += 8) {
        await Promise.all(
          missing.slice(i, i + 8).map(async (id) => {
            try {
              modelsById.set(id, await models.get(id));
            } catch {
              // Leave failed lookups uncached so the next load can try again.
            }
          }),
        );
      }
      if (!alive || revision !== run) return;
      notes = incoming;
      loadStatus = null;
      render();
    } catch {
      if (!alive || revision !== run) return;
      loadStatus = "board.error";
      renderStatus();
    }
  }

  search.addEventListener("input", () => {
    shown = 40;
    render();
  });
  more.addEventListener("click", () => {
    shown += 40;
    render();
  });
  retry.addEventListener("click", load);
  const stop = onNotesChange(thingport, load);
  void load();
  return () => {
    alive = false;
    stop();
  };
}

const previewCss = `
  .tp-notes-preview { position:absolute; inset:0; }
  .tp-notes-preview button, .tp-notes-add {
    border:1px solid var(--tp-divider); color:var(--tp-text); background:var(--tp-paper);
    pointer-events:auto; font:inherit; cursor:pointer; box-shadow:0 2px 8px #0003;
  }
  .tp-notes-preview .note-pin, .tp-notes-add {
    position:absolute; display:grid; place-items:center; width:30px; height:30px;
  }
  .tp-notes-add { position:static; border-radius:7px; }
  .tp-notes-add .note-glyph {
    display:block; width:14px; height:14px; border:1.5px solid currentColor; border-radius:2px;
    background:linear-gradient(currentColor,currentColor) 3px 4px / 6px 1px no-repeat,
      linear-gradient(currentColor,currentColor) 3px 7px / 5px 1px no-repeat;
  }
  .tp-notes-preview .note-pin { transform:translate(-50%,-50%); border-radius:50%; }
  .tp-notes-preview .note-pin:is(:hover, :focus-visible) { z-index:1; }
  .tp-notes-preview .note-pin[data-public="true"] { color:var(--tp-accent); }
  .tp-notes-preview .note-target {
    position:absolute; inset:0; display:grid; align-items:end; justify-items:center;
    padding:8px; border:2px dashed white; background:#0003; color:white; cursor:crosshair;
  }
  .tp-notes-preview .note-target span { padding:4px 8px; border-radius:4px; background:#17242de6; }
  .tp-notes-preview .note-cursor {
    position:absolute; display:grid; place-items:center; width:24px; height:24px;
    transform:translate(-50%,-50%); border-radius:50%;
    background:var(--tp-accent); color:var(--tp-accent-ink); pointer-events:none;
  }
  .tp-note-popup { display:grid; gap:8px; padding:14px; font:14px/1.45 var(--tp-font); color:var(--tp-text); }
  .tp-note-popup :is(p,h3) { margin:0; overflow-wrap:anywhere; white-space:pre-wrap; }
  .tp-note-popup label { display:grid; gap:4px; }
  .tp-note-popup :is(textarea,select,button) {
    font:inherit; color:inherit; border:1px solid var(--tp-divider);
    padding:5px 8px; background:var(--tp-paper); border-radius:5px;
  }
  .tp-note-popup textarea { resize:vertical; min-height:54px; }
  .tp-note-popup small { color:var(--tp-text-muted); }
  .tp-note-popup footer { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
  .tp-note-popup button { cursor:pointer; }
  .tp-note-popup button[type=submit] { background:var(--tp-accent); color:var(--tp-accent-ink); }
  .tp-note-popup button:disabled { opacity:.6; cursor:default; }
  @media (pointer:coarse) {
    .tp-notes-preview .note-pin, .tp-notes-add { width:44px; height:44px; }
    .tp-note-popup :is(textarea,select) { font-size:16px; }
  }
`;

const center = { x: 0.5, y: 0.5 };
const clamp = (value) => Math.max(0, Math.min(1, value));
function position(element, point) {
  element.style.left = point.x * 100 + "%";
  element.style.top = point.y * 100 + "%";
}

// Each module draw gets exactly the visible bounds and identity of the current static model image.
export function modelImage(thingport) {
  const {
    root,
    preview,
    context: { modelId },
    shared,
    storage,
    t,
    ui,
  } = thingport;
  if (!modelId || !preview) return;
  const prefix = PREFIX + modelId + ":" + preview.key + ":";
  const style = document.createElement("style");
  style.textContent = previewCss;
  const overlay = document.createElement("div");
  overlay.className = "tp-notes-preview";
  const pins = document.createElement("div");
  root.append(style);
  preview.root.append(overlay);
  overlay.append(pins);
  let alive = true;
  let revision = 0;
  let place = null;
  const visibilityName = (isPublic) => t(isPublic ? "board.public" : "board.personal");

  function togglePlacement() {
    if (place) {
      place.remove();
      overlay.querySelector(".note-cursor")?.remove();
      place = null;
      add.setAttribute("aria-pressed", "false");
      add.setAttribute("aria-label", t("preview.add"));
      add.focus();
      return;
    }
    let point = center;
    const cursor = document.createElement("span");
    cursor.className = "note-cursor";
    cursor.setAttribute("aria-hidden", "true");
    cursor.textContent = "+";
    position(cursor, point);
    place = button(
      "",
      (event) => {
        const area = place.getBoundingClientRect();
        if (event.detail)
          point = {
            x: clamp((event.clientX - area.left) / area.width),
            y: clamp((event.clientY - area.top) / area.height),
          };
        position(cursor, point);
        place.remove();
        place = null;
        add.setAttribute("aria-pressed", "false");
        add.setAttribute("aria-label", t("preview.add"));
        const key = prefix + Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
        edit(cursor, { key, value: { ...point, text: "" }, public: false }, () => {
          cursor.remove();
          add.focus({ preventScroll: true });
        });
      },
      "note-target",
    );
    const hint = document.createElement("span");
    hint.textContent = t("preview.place");
    place.append(hint);
    place.setAttribute("aria-label", t("preview.placeKeyboard"));
    place.addEventListener("keydown", (event) => {
      if (event.key === "Escape") return togglePlacement();
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const step = steps[event.key];
      if (!step) return;
      event.preventDefault();
      const distance = event.shiftKey ? 0.1 : 0.02;
      point = { x: clamp(point.x + step[0] * distance), y: clamp(point.y + step[1] * distance) };
      position(cursor, point);
    });
    overlay.append(place, cursor);
    add.setAttribute("aria-pressed", "true");
    add.setAttribute("aria-label", t("preview.cancelPlacement"));
    place.focus({ preventScroll: true });
  }

  const add = button("", togglePlacement, "tp-notes-add");
  const glyph = document.createElement("span");
  glyph.className = "note-glyph";
  glyph.setAttribute("aria-hidden", "true");
  add.append(glyph);
  add.setAttribute("aria-label", t("preview.add"));
  add.setAttribute("aria-pressed", "false");
  add.title = t("preview.add");
  root.append(add);

  function edit(anchor, note, cleanup) {
    const popover = ui.popover(
      anchor,
      (panel) => {
        const form = document.createElement("form");
        form.className = "tp-note-popup";
        const title = document.createElement("h3");
        title.textContent = t(note.value.text ? "preview.edit" : "preview.new");
        const field = document.createElement("label");
        field.textContent = t("preview.text");
        const text = document.createElement("textarea");
        text.required = true;
        text.maxLength = LIMIT;
        text.rows = 3;
        text.value = note.value.text;
        field.append(text);
        const audience = document.createElement("label");
        audience.textContent = t("preview.visibility");
        const select = document.createElement("select");
        select.add(new Option(visibilityName(false), "personal"));
        select.add(new Option(visibilityName(true), "public"));
        select.value = note.public ? "public" : "personal";
        select.disabled = Boolean(note.value.text);
        audience.append(select);
        const help = document.createElement("small");
        function describe() {
          help.textContent = t(select.value === "public" ? "preview.publicHelp" : "preview.personalHelp");
        }
        select.addEventListener("change", describe);
        describe();
        const actions = document.createElement("footer");
        const cancel = button(t("preview.cancel"), () => popover.close());
        const save = document.createElement("button");
        save.type = "submit";
        save.textContent = t("preview.save");
        actions.append(cancel, save);
        form.append(title, field, audience, help, actions);
        panel.append(form);
        text.focus();
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const value = text.value.trim();
          if (!value || save.disabled) return;
          save.disabled = true;
          cancel.disabled = true;
          text.disabled = true;
          // A retry uses the same key and the same store, even if the first write reached the server.
          select.disabled = true;
          try {
            const contents = { x: note.value.x, y: note.value.y, text: value };
            if (select.value === "public") await shared.set(note.key, contents, { model: note.modelId ?? modelId });
            else {
              await storage.set(note.key, { ...contents, updatedAt: new Date().toISOString() });
              personalChanges.dispatchEvent(new Event("change"));
            }
            if (alive) popover.close();
          } catch {
            if (alive) ui.toast(t("preview.saveFailed"), "error");
          } finally {
            save.disabled = false;
            cancel.disabled = false;
            text.disabled = false;
          }
        });
        return cleanup;
      },
      { placement: "right", width: 300 },
    );
  }

  function view(anchor, note) {
    const popover = ui.popover(
      anchor,
      (panel) => {
        const content = document.createElement("div");
        content.className = "tp-note-popup";
        const scope = document.createElement("small");
        const author = !note.mine && note.user?.name;
        scope.textContent = visibilityName(Boolean(note.public)) + (author ? " · " + author : "");
        const text = document.createElement("p");
        text.textContent = note.value.text;
        const actions = document.createElement("footer");
        if (note.mine) {
          const remove = button(t("board.delete"), async () => {
            remove.disabled = true;
            try {
              if (await confirmRemove(thingport, note)) popover.close();
            } catch {
              if (alive) ui.toast(t("board.deleteFailed"), "error");
            } finally {
              remove.disabled = false;
            }
          });
          const change = button(t("preview.edit"), () => edit(anchor, note));
          actions.append(remove, change);
        }
        actions.append(button(t("preview.close"), () => popover.close()));
        content.append(scope, text, actions);
        panel.append(content);
      },
      { placement: "right", width: 280 },
    );
  }

  async function load() {
    const run = ++revision;
    try {
      const notes = await readNotes(thingport, { model: modelId, preview: preview.key });
      if (!alive || run !== revision) return;
      const oldPins = new Map([...pins.children].map((pin) => [pin.dataset.key, pin]));
      const keep = new Set();
      for (const note of notes) {
        const key = (note.user?.id ?? "") + "/" + note.key;
        const existing = oldPins.get(key);
        const isPublic = Boolean(note.public);
        const label = t("preview.open", { visibility: visibilityName(isPublic), text: note.value.text });
        const pin = existing ?? button(isPublic ? "◎" : "•", () => view(pin, pin.note), "note-pin");
        keep.add(pin);
        pin.dataset.key = key;
        pin.dataset.public = String(isPublic);
        pin.textContent = isPublic ? "◎" : "•";
        pin.note = note;
        pin.setAttribute("aria-label", label);
        pin.title = label;
        position(pin, note.value);
        if (!existing) pins.append(pin);
      }
      for (const pin of oldPins.values()) if (!keep.has(pin)) pin.remove();
    } catch {
      if (alive && run === revision) ui.toast(t("board.error"), "error");
    }
  }

  const stop = onNotesChange(thingport, load);
  void load();
  return () => {
    alive = false;
    stop();
  };
}
