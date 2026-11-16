// The window: the household's spools as cards, filtered by person, material, brand and colour, each person's own to
// add, change and take off the shelf. Opened on a model, it also offers to add what that model needs.

import { PALETTE, bucketOf, nameOf, normaliseHex } from "./colour.js";
import {
  AMOUNTS,
  BRANDS,
  MATERIALS,
  NEEDS,
  SPOOL,
  amountPercent,
  currentEdit,
  family,
  missingOnShelf,
  needsFor,
  newId,
  ownerKey,
  people,
  prefillFor,
  readAll,
  spoolValue,
  spoolsOf,
  writesInTurn,
} from "./shelf.js";
import {
  BASE_CSS,
  addStyle,
  avatar,
  escapeHtml,
  filamentLabel,
  formatGrams,
  icon,
  personName,
  spoolArt,
  spoolLabel,
  swatch,
  themeClass,
  toastFailures,
} from "./parts.js";

const MATERIAL_CHOICES = [...MATERIALS, "other"];
const AMOUNT_CHOICES = [...AMOUNTS, "grams"];
// Below this many grams a weighed spool's bar warns, as "Nearly out" does.
const LOW_GRAMS = 150;

export default function mount(thingport) {
  const { root, shared, models, ui, t, labels, language, context } = thingport;
  addStyle(root, BASE_CSS);
  const shell = root.querySelector(".fs");
  shell.classList.add(themeClass(thingport));
  const $ = (id) => root.querySelector(`#fs-${id}`);
  const peopleBar = $("people");
  const materialsBar = $("materials");
  const brandSelect = $("brand");
  const colourButton = $("colour");
  const needsStrip = $("needs");
  const cards = $("cards");
  const empty = $("empty");
  const veil = $("veil");
  const form = $("dialog");
  const body = $("dialog-body");
  const input = (name) => $(`f-${name}`);

  // Everything read under spool:, as stored; validated where it's used.
  let entries = null;
  let needEntries = [];
  // Whether the edits about the model have been read: until then its needs aren't known, rather than the profile's.
  let needsRead = false;
  let model = null;
  let everyone = [];
  let problem = null;
  const filter = { who: null, material: null, brand: null, colour: null };
  // What the bar's menus list, from the last draw.
  let moreMaterials = [];
  let colours = [];
  let needs = [];
  let menu = null;
  let dialog = null;
  let closed = false;
  let reads = 0;
  // Writes going, and writes started or ended: a read either overlaps is dropped, and the one after them shows.
  let pending = 0;
  let writes = 0;
  // Cards drawn last time, so only new ones come in with an animation.
  let drawn = new Set();
  const inTurn = writesInTurn();
  const safely = (fn) => toastFailures(thingport, fn, () => closed);

  async function load() {
    const read = ++reads;
    const at = writes;
    const [spoolList, needList, picked] = await Promise.all([
      readAll(shared, { prefix: SPOOL }),
      context.modelId ? readAll(shared, { prefix: NEEDS, model: context.modelId }).catch(() => null) : [],
      context.modelId && !model ? models.get(context.modelId).catch(() => null) : model,
    ]);
    if (closed || read !== reads || pending || at !== writes) return;
    entries = spoolList;
    // A failed read of the edits keeps the last that worked: as none, an edit would read as the profile's list.
    if (needList) {
      needEntries = needList;
      needsRead = true;
    }
    model = picked;
    problem = null;
    render();
  }

  async function refresh() {
    try {
      await load();
    } catch (error) {
      if (closed) return;
      const message = error?.message || String(error);
      if (entries === null) {
        problem = message;
        render();
      } else ui.toast(t("toast.failed", { error: message }), "error");
    }
  }

  /** Saves through `fn` in its key's turn, then reads the shelf again once nothing else is saving. */
  async function write(key, fn) {
    pending += 1;
    writes += 1;
    try {
      return await inTurn(key, fn);
    } finally {
      pending -= 1;
      writes += 1;
      if (!pending && !closed) void refresh();
    }
  }

  const reader = () => {
    const me = everyone[0];
    return me?.id ? { id: me.id, name: me.name, avatarUrl: me.avatarUrl } : null;
  };

  // ---- drawing ----

  function render() {
    const loading = entries === null;
    // Nothing to add to until the shelf is read: a spool added before would be lost.
    $("add").disabled = loading;
    cards.setAttribute("aria-busy", String(loading && !problem));
    if (loading) {
      showEmpty(problem ? { title: t("shelf.failed"), hint: problem, act: "retry", label: t("shelf.retry") } : null);
      cards.hidden = Boolean(problem);
      if (!problem)
        cards.innerHTML =
          '<li class="fs-card fs-skel-card" aria-hidden="true"><span class="fs-skel"></span></li>'.repeat(8);
      return;
    }
    const spools = spoolsOf(entries);
    everyone = people([...entries, ...needEntries]);
    if (filter.who && !everyone.some((person) => person.key === filter.who)) filter.who = null;
    const theirs = filter.who ? spools.filter((entry) => ownerKey(entry) === filter.who) : spools;
    drawPeople();
    drawMaterials(theirs);
    drawBrands(spools);
    drawColours(theirs);
    drawNeeds(spools);
    drawCards(spools, theirs);
  }

  function drawPeople() {
    peopleBar.hidden = everyone.length < 2;
    const chip = (key, label, person) =>
      `<button type="button" class="fs-chip${person ? "" : " fs-plain"}" data-who="${escapeHtml(key)}" aria-pressed="${(filter.who ?? "") === key}">${person ? avatar(t, person) : ""}<span>${escapeHtml(label)}</span></button>`;
    peopleBar.innerHTML = [
      chip("", t("people.everyone")),
      ...everyone.map((person) => chip(person.key, personName(t, person), person)),
    ].join("");
  }

  function drawMaterials(theirs) {
    const counts = new Map();
    for (const entry of theirs) {
      const name = family(entry.value.material);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const ordered = [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    let shown = ordered.slice(0, 4);
    const chosen = filter.material;
    if (chosen && !shown.some(([name]) => name === chosen))
      shown = [...shown.slice(0, 3), [chosen, counts.get(chosen) ?? 0]];
    moreMaterials = ordered.filter(([name]) => !shown.some(([other]) => other === name));
    materialsBar.hidden = ordered.length < 2 && !chosen;
    materialsBar.innerHTML = [
      `<button type="button" data-material="" aria-pressed="${!chosen}">${escapeHtml(t("filter.all"))}</button>`,
      ...shown.map(
        ([name, count]) =>
          `<button type="button" data-material="${escapeHtml(name)}" aria-pressed="${chosen === name}">${escapeHtml(name)}<b>${count}</b></button>`,
      ),
      moreMaterials.length
        ? `<button type="button" data-more aria-haspopup="menu" aria-expanded="false">${escapeHtml(t("filter.more"))}${icon("drop")}</button>`
        : "",
    ].join("");
  }

  function drawBrands(spools) {
    const brands = new Map();
    for (const entry of spools) {
      const brand = entry.value.brand.trim();
      if (brand && !brands.has(brand.toLowerCase())) brands.set(brand.toLowerCase(), brand);
    }
    if (filter.brand && !brands.has(filter.brand)) filter.brand = null;
    brandSelect.hidden = brands.size < 2 && !filter.brand;
    brandSelect.innerHTML = [
      `<option value="">${escapeHtml(t("filter.anyBrand"))}</option>`,
      ...[...brands]
        .toSorted((a, b) => a[1].localeCompare(b[1]))
        .map(
          ([key, label]) =>
            `<option value="${escapeHtml(key)}"${filter.brand === key ? " selected" : ""}>${escapeHtml(label)}</option>`,
        ),
    ].join("");
  }

  function drawColours(theirs) {
    colours = PALETTE.filter(([name]) => theirs.some((entry) => bucketOf(entry.value.color) === name));
    const chosen = PALETTE.find(([name]) => name === filter.colour);
    colourButton.hidden = colours.length < 2 && !chosen;
    colourButton.classList.toggle("fs-on", Boolean(chosen));
    colourButton.innerHTML = chosen
      ? `${swatch(chosen[1], "fs-s")}<span>${escapeHtml(t(`colour.${chosen[0]}`))}</span>${icon("drop")}`
      : `${icon("palette")}<span>${escapeHtml(t("filter.anyColour"))}</span>${icon("drop")}`;
    colourButton.setAttribute(
      "aria-label",
      `${t("filter.colour")}: ${chosen ? t(`colour.${chosen[0]}`) : t("filter.anyColour")}`,
    );
  }

  function drawNeeds(spools) {
    needs = model && needsRead ? needsFor(model, context.fileId, currentEdit(needEntries)) : [];
    needsStrip.hidden = !needs.length;
    if (!needs.length) return;
    const missing = new Set(missingOnShelf(needs, spools));
    const chips = needs.map((need, i) => {
      const label = escapeHtml(filamentLabel(t, need));
      return missing.has(need)
        ? `<button type="button" class="fs-need fs-missing" data-need="${i}" aria-label="${escapeHtml(t("shelf.addThis", { name: filamentLabel(t, need) }))}" title="${escapeHtml(t("shelf.addThis", { name: filamentLabel(t, need) }))}">${swatch(need.color, "fs-s")}<span>${label}</span>${icon("add")}</button>`
        : `<span class="fs-need" title="${escapeHtml(t("shelf.onShelf"))}">${swatch(need.color, "fs-s")}<span>${label}</span>${icon("done")}<span class="fs-sr">${escapeHtml(t("shelf.onShelf"))}</span></span>`;
    });
    needsStrip.innerHTML = `<span class="fs-needs-title">${escapeHtml(t("shelf.forModel", { name: model.name }))}</span>${chips.join("")}<span class="fs-spacer"></span>${
      missing.size
        ? `<button type="button" class="fs-btn fs-outline fs-small" data-act="add-needed">${icon("queue")}${escapeHtml(t("shelf.addNeeded"))}</button>`
        : `<span class="fs-all-set">${icon("check")}${escapeHtml(t("shelf.allOnShelf"))}</span>`
    }`;
  }

  function showEmpty(state) {
    empty.hidden = !state;
    if (!state) return;
    $("empty-title").textContent = state.title;
    $("empty-hint").textContent = state.hint ?? "";
    $("empty-hint").hidden = !state.hint;
    const button = $("empty-act");
    button.textContent = state.label;
    button.dataset.act = state.act;
    button.className = `fs-btn ${state.act === "add" ? "fs-primary" : "fs-outline"} fs-small`;
  }

  function drawCards(spools, theirs) {
    let list = theirs;
    if (filter.material) list = list.filter((entry) => family(entry.value.material) === filter.material);
    if (filter.brand) list = list.filter((entry) => entry.value.brand.trim().toLowerCase() === filter.brand);
    if (filter.colour) list = list.filter((entry) => bucketOf(entry.value.color) === filter.colour);
    const order = new Map(everyone.map((person, i) => [person.key, i]));
    const named = (entry) => entry.value.colorName || t(`colour.${nameOf(entry.value.color)}`);
    list = list.toSorted(
      (a, b) =>
        (order.get(ownerKey(a)) ?? 99) - (order.get(ownerKey(b)) ?? 99) ||
        family(a.value.material).localeCompare(family(b.value.material)) ||
        named(a).localeCompare(named(b)) ||
        a.value.brand.localeCompare(b.value.brand),
    );
    if (!spools.length)
      showEmpty({ title: t("shelf.emptyTitle"), hint: t("shelf.emptyHint"), act: "add", label: t("shelf.add") });
    else if (!list.length) showEmpty({ title: t("shelf.noneMatch"), act: "clear", label: t("filter.clear") });
    else showEmpty(null);
    cards.hidden = !list.length;
    const keyOf = (entry) => `${ownerKey(entry)}|${entry.key}`;
    cards.replaceChildren(...list.map((entry) => card(entry, !drawn.has(keyOf(entry)))));
    drawn = new Set(list.map(keyOf));
  }

  function card(entry, enter) {
    const spool = entry.value;
    const li = document.createElement("li");
    li.className = `fs-card${entry.mine ? " fs-mine" : ""}${enter ? " fs-enter" : ""}${entry.saving ? " fs-saving" : ""}`;
    li.dataset.key = entry.key;
    const name = escapeHtml(spool.colorName || t(`colour.${nameOf(spool.color)}`));
    const lineFamily = spool.line ? family(spool.line) : null;
    const sub = escapeHtml(
      [spool.brand, spool.line, lineFamily === family(spool.material) ? "" : spool.material]
        .filter(Boolean)
        .join(" · "),
    );
    const percent = amountPercent(spool);
    const amount =
      spool.grams !== null
        ? t("amount.gramsLeft", { grams: formatGrams(spool.grams, language) })
        : spool.left
          ? t(`amount.${spool.left}`)
          : "";
    const low = spool.left === "low" || (spool.grams !== null && spool.grams < LOW_GRAMS);
    const person = everyone.find((other) => other.key === ownerKey(entry)) ?? { ...entry.user, mine: entry.mine };
    const note = escapeHtml(spool.note);
    li.innerHTML = `
      ${entry.mine ? `<button type="button" class="fs-icon-btn fs-more" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(t("card.more", { name: spoolLabel(t, spool) }))}" title="${escapeHtml(t("card.moreTitle"))}">${icon("more")}</button>` : ""}
      <div class="fs-card-top">${spoolArt(spool.color)}<div class="fs-card-text"><b title="${name}">${name}</b><small title="${sub}">${sub}</small></div></div>
      ${percent === null ? "" : `<div class="fs-amount${low ? " fs-low" : ""}" aria-hidden="true"><i style="width:${percent}%"></i></div>`}
      <div class="fs-card-meta"><span class="fs-owner">${avatar(t, person)}<span>${escapeHtml(personName(t, person))}</span></span><span>${escapeHtml(amount)}</span></div>
      ${note ? `<small class="fs-card-note" title="${note}">${note}</small>` : ""}`;
    return li;
  }

  // ---- changes ----

  const putSpool = safely(async (key, value, onFailed = () => {}) => {
    const existing = entries.find((entry) => entry.mine && entry.key === key);
    const before = existing?.value;
    if (existing) Object.assign(existing, { value, saving: true });
    else
      entries.unshift({
        key,
        value,
        mine: true,
        user: reader(),
        updatedAt: new Date().toISOString(),
        cursor: "",
        saving: true,
      });
    render();
    try {
      await write(key, () => shared.set(key, value));
    } catch (error) {
      if (before) {
        const still = entries.find((entry) => entry.mine && entry.key === key);
        if (still) Object.assign(still, { value: before, saving: false });
      } else entries = entries.filter((entry) => !(entry.mine && entry.key === key));
      render();
      onFailed();
      throw error;
    }
  });

  const takeOff = safely(async (key, usedUp) => {
    const entry = entries.find((other) => other.mine && other.key === key);
    if (!entry) return;
    const name = spoolLabel(t, entry.value);
    const sure = await ui.confirm(
      usedUp
        ? { title: t("usedUp.title", { name }), message: t("usedUp.message"), confirmLabel: t("card.usedUp") }
        : {
            title: t("remove.title", { name }),
            message: t("remove.message"),
            confirmLabel: t("card.remove"),
            destructive: true,
          },
    );
    if (!sure || closed) return;
    entries = entries.filter((other) => !(other.mine && other.key === key));
    render();
    try {
      await write(key, () => shared.remove(key));
    } catch (error) {
      if (!entries.some((other) => other.mine && other.key === key)) entries = [entry, ...entries];
      render();
      throw error;
    }
  });

  // ---- menus ----

  function closeMenu({ restore = false } = {}) {
    if (!menu) return;
    const { element, opener } = menu;
    element.remove();
    menu = null;
    opener?.setAttribute("aria-expanded", "false");
    if (restore) opener?.focus();
    if (due) refreshWhenIdle();
  }

  /** Opens a menu `fill` puts the items in, under `opener` (on its left edge or right) or at a pointer. */
  function openMenu(opener, fill, { align = "left", at = null } = {}) {
    closeMenu();
    const element = document.createElement("div");
    element.className = "fs-menu";
    element.setAttribute("role", "menu");
    fill(element);
    shell.append(element);
    const frame = shell.getBoundingClientRect();
    const box = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : opener.getBoundingClientRect();
    const wanted = at || align === "left" ? box.left - frame.left : box.right - frame.left - element.offsetWidth;
    const left = Math.max(8, Math.min(wanted, frame.width - element.offsetWidth - 8));
    let top = box.bottom - frame.top + 4;
    if (top + element.offsetHeight > frame.height - 8)
      top = Math.max(8, box.top - frame.top - element.offsetHeight - 4);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    opener?.setAttribute("aria-expanded", "true");
    menu = { element, opener };
    (element.querySelector('[aria-checked="true"]') ?? element.querySelector("[role^=menuitem]"))?.focus();
  }

  function menuItem(label, act, { iconName = null, danger = false, checked = null } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", checked === null ? "menuitem" : "menuitemradio");
    if (checked !== null) button.setAttribute("aria-checked", String(checked));
    if (danger) button.className = "fs-danger";
    button.innerHTML = `${iconName ? icon(iconName) : ""}<span>${escapeHtml(label)}</span>`;
    button.addEventListener("click", () => {
      closeMenu({ restore: true });
      act();
    });
    return button;
  }

  function openCardMenu(key, opener, at = null) {
    const entry = entries?.find((other) => other.mine && other.key === key);
    if (!entry) return;
    openMenu(
      opener,
      (element) =>
        element.append(
          menuItem(t("card.edit"), () => openDialog({ key, value: entry.value }), { iconName: "edit" }),
          menuItem(t("card.usedUp"), () => takeOff(key, true), { iconName: "done" }),
          document.createElement("hr"),
          menuItem(t("card.remove"), () => takeOff(key, false), { iconName: "delete", danger: true }),
        ),
      { align: "right", at },
    );
  }

  function openColourMenu() {
    openMenu(colourButton, (element) => {
      element.append(
        menuItem(t("filter.anyColour"), () => setFilter("colour", null), {
          iconName: "palette",
          checked: !filter.colour,
        }),
      );
      const row = document.createElement("div");
      row.className = "fs-palette";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", t("filter.colour"));
      for (const [name, hex] of colours) {
        const button = menuItem("", () => setFilter("colour", name), { checked: filter.colour === name });
        button.className = "fs-swatch";
        button.style.setProperty("--fs-c", hex);
        button.setAttribute("aria-label", t(`colour.${name}`));
        button.title = t(`colour.${name}`);
        button.replaceChildren();
        row.append(button);
      }
      element.append(row);
    });
  }

  function openMoreMaterials(opener) {
    openMenu(opener, (element) =>
      element.append(
        ...moreMaterials.map(([name, count]) =>
          menuItem(`${name} · ${count}`, () => setFilter("material", name), { checked: filter.material === name }),
        ),
      ),
    );
  }

  /** Arrow keys move between a menu's items; Escape and Tab leave it. */
  function menuKeys(event) {
    const items = [...menu.element.querySelectorAll("[role^=menuitem]")];
    const at = items.indexOf(document.activeElement);
    const go = (index) => items[(index + items.length) % items.length]?.focus();
    if (event.key === "ArrowDown" || event.key === "ArrowRight") go(at + 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(items.length - 1);
    else if (event.key === "Escape") closeMenu({ restore: true });
    else if (event.key === "Tab") return closeMenu();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function setFilter(name, value) {
    filter[name] = value;
    render();
  }

  // ---- the spool dialog ----

  function stateOf(spool) {
    const upper = spool.material.trim().toUpperCase();
    const choice = MATERIALS.includes(upper) ? upper : "other";
    return {
      brand: spool.brand,
      line: spool.line,
      choice,
      other: choice === "other" ? spool.material : "",
      colorName: spool.colorName,
      color: spool.color,
      hex: spool.color,
      amount: spool.grams !== null ? "grams" : spool.left,
      grams: spool.grams !== null ? String(spool.grams) : "",
      note: spool.note,
    };
  }

  function newSpool() {
    // The brand of the user's newest spool, as the next one is often the same.
    const last = spoolsOf(entries ?? []).find((entry) => entry.mine);
    return spoolValue({ brand: last?.value.brand ?? "", material: "PLA", color: "#FFFFFF", left: "full" });
  }

  function brandOptions() {
    const seen = new Map();
    for (const entry of spoolsOf(entries ?? [])) {
      const brand = entry.value.brand.trim();
      if (brand && !seen.has(brand.toLowerCase())) seen.set(brand.toLowerCase(), brand);
    }
    for (const brand of BRANDS) if (!seen.has(brand.toLowerCase())) seen.set(brand.toLowerCase(), brand);
    return [...seen.values()].map((brand) => `<option value="${escapeHtml(brand)}"></option>`).join("");
  }

  function openDialog({ key = null, value = null, queue = [] } = {}) {
    if (entries === null) return;
    closeMenu();
    const opener = root.contains(document.activeElement) ? document.activeElement : null;
    const first = value ?? (queue.length ? prefillFor(queue[0]) : newSpool());
    dialog = { key, queue: [...queue], total: queue.length, opener, state: stateOf(first) };
    fillDialog();
    veil.hidden = false;
    input("brand").focus();
  }

  function closeDialog() {
    if (!dialog) return;
    const { opener } = dialog;
    dialog = null;
    veil.hidden = true;
    (opener?.isConnected ? opener : $("add")).focus();
    if (due) refreshWhenIdle();
  }

  function showDialogColour({ typed = false } = {}) {
    const state = dialog.state;
    $("art").style.setProperty("--fs-c", state.color);
    input("native").value = state.color.toLowerCase();
    if (!typed) input("hex").value = state.hex;
    const bad = !normaliseHex(state.hex);
    input("hex").setAttribute("aria-invalid", String(bad && state.hex.trim() !== ""));
    $("hex-bad").hidden = !bad || state.hex.trim() === "";
    input("name").placeholder = t(`colour.${nameOf(state.color)}`);
    for (const button of input("palette").children)
      button.setAttribute("aria-checked", String(button.dataset.hex === state.color));
  }

  function showChoices() {
    const state = dialog.state;
    for (const button of input("material").children)
      button.setAttribute("aria-pressed", String(button.dataset.choice === state.choice));
    input("other").hidden = state.choice !== "other";
    for (const button of input("left").children)
      button.setAttribute("aria-pressed", String(button.dataset.amount === state.amount));
    $("grams").hidden = state.amount !== "grams";
  }

  function fillDialog() {
    const state = dialog.state;
    $("dialog-title").textContent = t(dialog.key ? "dialog.editTitle" : "dialog.addTitle");
    $("step").textContent =
      dialog.total > 1 ? t("dialog.step", { n: dialog.total - dialog.queue.length + 1, count: dialog.total }) : "";
    $("skip").hidden = dialog.total < 2;
    $("submit").textContent = t(dialog.key ? "dialog.save" : "dialog.add");
    $("brands").innerHTML = brandOptions();
    input("brand").value = state.brand;
    input("material").innerHTML = MATERIAL_CHOICES.map(
      (choice) =>
        `<button type="button" data-choice="${choice}" aria-pressed="false">${escapeHtml(choice === "other" ? t("dialog.other") : choice)}</button>`,
    ).join("");
    input("other").value = state.other;
    input("other").removeAttribute("aria-invalid");
    input("line").value = state.line;
    input("name").value = state.colorName;
    input("palette").innerHTML = PALETTE.map(
      ([name, hex]) =>
        `<button type="button" role="radio" aria-checked="false" data-hex="${hex}" style="--fs-c:${hex}" aria-label="${escapeHtml(t(`colour.${name}`))}" title="${escapeHtml(t(`colour.${name}`))}"></button>`,
    ).join("");
    input("left").innerHTML = AMOUNT_CHOICES.map(
      (amount) =>
        `<button type="button" data-amount="${amount}" aria-pressed="false">${escapeHtml(t(`amount.${amount}`))}</button>`,
    ).join("");
    input("grams").value = state.grams;
    input("grams").removeAttribute("aria-invalid");
    input("note").value = state.note;
    showChoices();
    showDialogColour();
  }

  /** On to the next filament the model needs, or closed after the last. */
  function advance(lastBrand) {
    dialog.queue.shift();
    if (!dialog.queue.length) return closeDialog();
    const next = prefillFor(dialog.queue[0]);
    if (!next.brand) next.brand = lastBrand;
    dialog.key = null;
    dialog.state = stateOf(next);
    fillDialog();
    body.classList.remove("fs-next");
    void body.offsetWidth;
    body.classList.add("fs-next");
    input("brand").focus();
  }

  function submitDialog() {
    const state = dialog.state;
    const material = state.choice === "other" ? state.other.trim() : state.choice;
    if (!material) {
      input("other").setAttribute("aria-invalid", "true");
      return input("other").focus();
    }
    const color = normaliseHex(state.hex);
    if (!color) {
      input("hex").setAttribute("aria-invalid", "true");
      $("hex-bad").hidden = false;
      return input("hex").focus();
    }
    let grams = null;
    if (state.amount === "grams" && state.grams.trim() !== "") {
      grams = Number(state.grams);
      if (!Number.isFinite(grams) || grams < 0 || grams > 100000) {
        input("grams").setAttribute("aria-invalid", "true");
        return input("grams").focus();
      }
    }
    const value = spoolValue({
      brand: state.brand,
      line: state.line,
      material,
      colorName: state.colorName,
      color,
      left: AMOUNTS.includes(state.amount) ? state.amount : null,
      grams,
      note: state.note,
    });
    const key = dialog.key ?? `${SPOOL}${newId()}`;
    const editing = dialog.key;
    advance(value.brand);
    // The form goes as the spool shows; should it not be saved, it comes back as it was sent, to try again.
    void putSpool(key, value, () => {
      if (!dialog && !closed) openDialog({ key: editing, value });
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (dialog) submitDialog();
  });

  form.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !dialog) return;
    const state = dialog.state;
    if (button.dataset.act === "cancel") return closeDialog();
    if (button.dataset.act === "skip") return advance(state.brand);
    if (button.dataset.choice) {
      state.choice = button.dataset.choice;
      showChoices();
      if (state.choice === "other") input("other").focus();
      return;
    }
    if (button.dataset.amount) {
      // A second press clears it: how much is left is optional.
      state.amount = state.amount === button.dataset.amount ? null : button.dataset.amount;
      showChoices();
      if (state.amount === "grams") input("grams").focus();
      return;
    }
    if (button.dataset.hex) {
      state.color = button.dataset.hex;
      state.hex = button.dataset.hex;
      showDialogColour();
    }
  });

  form.addEventListener("input", (event) => {
    if (!dialog) return;
    const state = dialog.state;
    const field = event.target;
    const text = field.value;
    if (field === input("brand")) state.brand = text;
    else if (field === input("other")) {
      state.other = text;
      field.removeAttribute("aria-invalid");
    } else if (field === input("line")) state.line = text;
    else if (field === input("name")) state.colorName = text;
    else if (field === input("note")) state.note = text;
    else if (field === input("grams")) {
      state.grams = text;
      field.removeAttribute("aria-invalid");
    } else if (field === input("hex")) {
      state.hex = text;
      state.color = normaliseHex(text) ?? state.color;
      showDialogColour({ typed: true });
    } else if (field === input("native")) {
      state.color = normaliseHex(text) ?? state.color;
      state.hex = state.color;
      showDialogColour();
    }
  });

  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return closeDialog();
    }
    if (event.key !== "Tab") return;
    // Focus stays in the dialog while it's open.
    const stops = [...form.querySelectorAll("button, input, select, [tabindex='0']")].filter(
      (element) => !element.disabled && !element.closest("[hidden]"),
    );
    const at = stops.indexOf(document.activeElement);
    if (event.shiftKey && at <= 0) {
      event.preventDefault();
      stops.at(-1).focus();
    } else if (!event.shiftKey && at === stops.length - 1) {
      event.preventDefault();
      stops[0].focus();
    }
  });

  veil.addEventListener("pointerdown", (event) => {
    if (event.target === veil) closeDialog();
  });

  // ---- the bar, the strip and the cards ----

  peopleBar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-who]");
    if (button) setFilter("who", button.dataset.who || null);
  });
  materialsBar.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.more !== undefined) return openMoreMaterials(button);
    setFilter("material", button.dataset.material || null);
  });
  brandSelect.addEventListener("change", () => setFilter("brand", brandSelect.value || null));
  colourButton.addEventListener("click", () => (menu?.opener === colourButton ? closeMenu() : openColourMenu()));

  const showAudience = (audience) => {
    $("share-label").textContent = audience.everyone
      ? t("share.everyone")
      : audience.people.length
        ? t("share.people", { count: audience.people.length })
        : t("share.onlyYou");
  };
  $("share").addEventListener(
    "click",
    safely(async () => {
      const audience = await shared.share();
      if (audience && !closed) showAudience(audience);
    }),
  );

  shell.addEventListener("click", (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "add" && !event.target.closest("form")) return openDialog();
    if (act === "clear") {
      Object.assign(filter, { who: null, material: null, brand: null, colour: null });
      return render();
    }
    if (act === "retry") {
      problem = null;
      render();
      return void refresh();
    }
    if (act === "add-needed") return openDialog({ queue: missingOnShelf(needs, spoolsOf(entries ?? [])) });
  });
  needsStrip.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-need]");
    if (chip) openDialog({ queue: [needs[Number(chip.dataset.need)]] });
  });
  cards.addEventListener("click", (event) => {
    const more = event.target.closest(".fs-more");
    if (!more) return;
    if (menu?.opener === more) return closeMenu();
    openCardMenu(more.closest(".fs-card").dataset.key, more);
  });
  cards.addEventListener("contextmenu", (event) => {
    const li = event.target.closest(".fs-card.fs-mine");
    if (!li) return;
    event.preventDefault();
    openCardMenu(li.dataset.key, li.querySelector(".fs-more"), { x: event.clientX, y: event.clientY });
  });

  const onOutside = (event) => {
    if (menu && !menu.element.contains(event.target) && !menu.opener?.contains(event.target)) closeMenu();
  };
  const onKey = (event) => {
    if (menu) menuKeys(event);
  };
  document.addEventListener("pointerdown", onOutside, true);
  shell.addEventListener("keydown", onKey);

  // Others' changes show up while it's open: now and then, on coming back to the window, and when a part of a model's
  // page changes something. Not while a menu, the dialog or the brand list is open; that refresh comes after.
  let due = false;
  function refreshWhenIdle() {
    due = Boolean(menu || dialog || document.activeElement === brandSelect);
    if (!due) void refresh();
  }
  const timer = setInterval(refreshWhenIdle, 30000);
  window.addEventListener("focus", refreshWhenIdle);
  const stopChanges = shared.onChange?.(refreshWhenIdle) ?? (() => {});

  labels();
  render();
  void refresh();
  void safely(async () => showAudience(await shared.audience()))();

  return () => {
    closed = true;
    closeMenu();
    clearInterval(timer);
    stopChanges();
    window.removeEventListener("focus", refreshWhenIdle);
    document.removeEventListener("pointerdown", onOutside, true);
    shell.removeEventListener("keydown", onKey);
  };
}
