// The Filaments tab on a model's page: what the picked profile needs down the side, a column per person naming
// their spool that matches, and the list edited in place for everyone who sees what the editor shares.

import { PALETTE, normaliseHex } from "./colour.js";
import { MAX_FILAMENTS, NEEDS, loadForModel, matchAll, needsFor, newId } from "./shelf.js";
import {
  addStyle,
  avatar,
  BASE_CSS,
  escapeHtml,
  filamentDetail,
  filamentLabel,
  formatGrams,
  icon,
  onReturn,
  personName,
  spoolLabel,
  summary,
  swatch,
  themeClass,
  tone,
} from "./parts.js";

const TAB_CSS = `
.fs-tab { display: flex; flex-direction: column; gap: 10px; }
.fs-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fs-tools .fs-spacer { flex: 1; }
.fs-profile { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; color: var(--tp-text); }
.fs-profile svg { width: 16px; height: 16px; color: var(--tp-text-muted); }
.fs-profile .fs-select { max-width: 320px; }
.fs-profile-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.fs-wrap { overflow-x: auto; border: 1px solid var(--tp-divider); border-radius: 10px; }
.fs-grid { display: grid; min-width: min-content; }
.fs-r { display: contents; }
.fs-c {
  display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 10px; border-top: 1px solid var(--tp-divider);
  font-size: 12.5px; transition: background-color 150ms;
}
.fs-c > span { min-width: 0; }
.fs-c small { display: block; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fs-c b { font-weight: 600; }
.fs-head .fs-c { border-top: 0; font-size: 11.5px; font-weight: 600; color: var(--tp-text-muted); background: var(--fs-tint); }
.fs-mid { flex-direction: column; justify-content: center; gap: 0; text-align: center; }
.fs-head .fs-mid { flex-direction: row; gap: 6px; }
.fs-mid small { max-width: 100%; }
.fs-foot .fs-c { color: var(--tp-text-muted); font-size: 12px; }
.fs-editing .fs-need { flex-direction: column; align-items: stretch; gap: 6px; }
.fs-ed { display: flex; align-items: center; gap: 6px; animation: fs-in 180ms ease-out; }
.fs-ed .fs-type { flex: 1; min-width: 90px; }
.fs-ed .fs-hex { width: 92px; }
.fs-ed-sw { position: relative; display: inline-flex; cursor: pointer; border-radius: 50% !important; }
.fs-ed-sw input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.fs-ed-sw:focus-within { outline: 2px solid var(--tp-accent); outline-offset: 2px; }
.fs-ed-pal { gap: 5px; animation: fs-in 180ms ease-out; }
.fs-ed-pal > button { width: 18px; height: 18px; }
.fs-row-new .fs-c { animation: fs-in 180ms ease-out; }
.fs-together {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-radius: 9px;
  font-size: 12.5px; animation: fs-fade 200ms ease-out;
}
.fs-together svg { width: 18px; height: 18px; }
.fs-together.fs-all { background: color-mix(in srgb, var(--fs-same) 12%, transparent); }
.fs-together.fs-all svg { color: var(--fs-same); }
.fs-together.fs-some { background: color-mix(in srgb, var(--fs-close) 12%, transparent); }
.fs-together.fs-some svg { color: var(--fs-close); }
.fs-together.fs-none { background: var(--fs-tint); }
.fs-together.fs-none svg { color: var(--tp-text-muted); }
.fs-together > span { flex: 1; min-width: 180px; }
.fs-actions { display: flex; justify-content: flex-end; gap: 8px; animation: fs-in 180ms ease-out; }
.fs-blank { display: flex; align-items: center; gap: 10px; padding: 10px 2px; color: var(--tp-text-muted); font-size: 12.5px; }
.fs-blank > span { flex: 1; }
.fs-skel-row { display: grid; grid-template-columns: 18px 1fr 110px 110px; gap: 10px; align-items: center; padding: 8px 10px; }
.fs-skel-row .fs-skel { height: 12px; }
.fs-skel-row .fs-skel:first-child { height: 18px; border-radius: 50% !important; }
.fs-problem { display: flex; align-items: center; gap: 10px; color: var(--tp-error); font-size: 12.5px; }
`;

const MATERIAL_SUGGESTIONS = [
  "PLA",
  "PLA Matte",
  "PLA Silk",
  "PETG",
  "PETG HF",
  "ABS",
  "ASA",
  "TPU 95A",
  "PC",
  "PA-CF",
  "PVA",
  "HIPS",
];

export function modelTab(thingport) {
  const { root, shared, ui, t, context, language } = thingport;
  addStyle(root, BASE_CSS + TAB_CSS);
  const box = document.createElement("div");
  box.className = `fs-ui fs-tab ${themeClass(thingport)}`;
  root.append(box);
  const materialsId = `fs-materials-${newId()}`;

  let data = null;
  let problem = null;
  // The rows being edited, each with the hex as typed and the last colour it read as.
  let draft = null;
  let saving = false;
  let fresh = null;
  let closed = false;
  let reads = 0;

  async function load() {
    const read = ++reads;
    try {
      const next = await loadForModel(thingport, context.modelId, context.fileId);
      if (closed || read !== reads) return;
      data = next;
      problem = null;
    } catch (error) {
      if (closed || read !== reads) return;
      problem = error?.message || String(error);
    }
    // A change from elsewhere mid-edit shows in the people's columns, leaving the rows being typed in alone, unless
    // the people changed: then the columns are drawn again, the rows from what's typed.
    if (draft && data && peopleOf(data) === drawnPeople) updateMatches();
    else render();
  }

  // Whose columns the grid has, so a change that adds or takes one away draws it whole.
  let drawnPeople = "";
  const peopleOf = (shown) => shown.everyone.map((person) => person.key).join("|");

  const draftNeeds = () =>
    needsFor(data.model, context.fileId, {
      filaments: draft.map((row) => ({ type: row.type.trim() || null, color: row.color, grams: row.grams })),
    });
  const shownNeeds = () => (draft ? draftNeeds() : data.needs);

  function cell(match) {
    if (!match)
      return `<span class="fs-no" aria-hidden="true">—</span><span class="fs-sr">${escapeHtml(t("grid.doesnt"))}</span>`;
    const name = escapeHtml(spoolLabel(t, match.entry.value));
    const mark =
      match.grade === "same"
        ? `<span class="fs-has">${icon("check")}${escapeHtml(t("grid.hasIt"))}</span>`
        : `<span class="fs-near">≈ ${escapeHtml(t("grid.close"))}</span>`;
    return `${mark}<small title="${name}">${name}</small>`;
  }

  const countPill = (have, count) =>
    `<span class="fs-pill ${have === count ? "fs-all" : have ? "fs-some" : "fs-none"}">${escapeHtml(t("grid.of", { have, count }))}</span>`;

  function editor(row, index) {
    const palette = PALETTE.map(
      ([name, hex]) =>
        `<button type="button" role="radio" aria-checked="${row.color === hex}" data-pick="${index}" data-hex="${hex}" style="--fs-c:${hex}" aria-label="${escapeHtml(t(`colour.${name}`))}" title="${escapeHtml(t(`colour.${name}`))}"></button>`,
    ).join("");
    const anyColour = escapeHtml(t("edit.anyColour"));
    return `
      <div class="fs-ed">
        <label class="fs-ed-sw" title="${escapeHtml(t("edit.pick"))}">${swatch(row.color, "fs-l")}<input type="color" data-native="${index}" value="${(row.color ?? "#FFFFFF").toLowerCase()}" aria-label="${escapeHtml(t("edit.pick"))}"></label>
        <input class="fs-input fs-small fs-type" data-type="${index}" list="${materialsId}" value="${escapeHtml(row.type)}" maxlength="60" placeholder="${escapeHtml(t("edit.material"))}" aria-label="${escapeHtml(t("edit.material"))}">
        <input class="fs-input fs-small fs-mono fs-hex" data-hex="${index}" value="${escapeHtml(row.hex)}" maxlength="9" placeholder="${anyColour}" aria-label="${escapeHtml(t("edit.hex"))}" aria-invalid="${row.hex.trim() !== "" && !normaliseHex(row.hex)}">
      </div>
      <div class="fs-palette fs-ed-pal" role="radiogroup" aria-label="${escapeHtml(t("edit.colour"))}">${palette}<button type="button" role="radio" class="fs-any" aria-checked="${row.color === null}" data-pick="${index}" data-hex="" aria-label="${anyColour}" title="${anyColour}"></button></div>`;
  }

  function grid(needs, match) {
    const { everyone } = data;
    const columns = `minmax(230px, 1.6fr) repeat(${everyone.length}, minmax(110px, 150px))${draft ? " 40px" : ""}`;
    const head = everyone
      .map(
        (person) =>
          `<div role="columnheader" class="fs-c fs-mid">${avatar(t, person)}<span>${escapeHtml(personName(t, person))}</span></div>`,
      )
      .join("");
    const rows = needs
      .map((need, i) => {
        const row = draft?.[i];
        const first = row
          ? editor(row, i)
          : `${swatch(need.color)}<span><b>${escapeHtml(filamentLabel(t, need))}</b><small>${escapeHtml(filamentDetail(t, need, language))}</small></span>`;
        const cells = match.rows[i].cells
          .map((found, j) => `<div role="cell" class="fs-c fs-mid" data-cell="${i}:${j}">${cell(found)}</div>`)
          .join("");
        const remove = row
          ? `<div role="cell" class="fs-c"><button type="button" class="fs-icon-btn" data-remove="${i}" aria-label="${escapeHtml(t("edit.remove"))}" title="${escapeHtml(t("edit.remove"))}">${icon("delete")}</button></div>`
          : "";
        return `<div role="row" class="fs-r${row && row.id === fresh ? " fs-row-new" : ""}"><div role="rowheader" class="fs-c fs-need">${first}</div>${cells}${remove}</div>`;
      })
      .join("");
    const grams = needs.reduce((sum, need) => sum + (need.grams ?? 0), 0);
    const lead = draft
      ? `<button type="button" class="fs-btn fs-small" data-act="add"${draft.length >= MAX_FILAMENTS ? " disabled" : ""}>${icon("add")}${escapeHtml(t("edit.add"))}</button>`
      : grams
        ? escapeHtml(t("grid.total", { grams: formatGrams(grams, language) }))
        : "";
    const counts = match.counts
      .map((have, j) => `<div role="cell" class="fs-c fs-mid" data-count="${j}">${countPill(have, match.count)}</div>`)
      .join("");
    return `
      <div class="fs-wrap"><div class="fs-grid${draft ? " fs-editing" : ""}" role="table" aria-label="${escapeHtml(t("modelPage.tab"))}" style="grid-template-columns:${columns}">
        <div role="row" class="fs-r fs-head"><div role="columnheader" class="fs-c">${escapeHtml(t("grid.needs"))}</div>${head}${draft ? `<div role="columnheader" class="fs-c"><span class="fs-sr">${escapeHtml(t("edit.remove"))}</span></div>` : ""}</div>
        ${rows}
        <div role="row" class="fs-r fs-foot"><div role="cell" class="fs-c">${lead}</div>${counts}${draft ? '<div role="cell" class="fs-c"></div>' : ""}</div>
      </div></div>`;
  }

  function together(match) {
    if (!data.spools.length)
      return `<div class="fs-together fs-none" data-summary>${icon("shelf")}<span>${escapeHtml(t("sum.noSpools"))}</span><button type="button" class="fs-btn fs-small" data-act="open">${escapeHtml(t("tab.openShelf"))}</button></div>`;
    if (!match.count) return "";
    const kind = tone(match);
    return `<div class="fs-together ${kind}" data-summary>${icon(kind === "fs-all" ? "check" : "warn")}<span>${escapeHtml(summary(t, match, data.everyone))}</span></div>`;
  }

  function toolbar() {
    const { model, file, edit } = data;
    const profiles = model.files.filter((other) => other.profile || other.id === file?.id);
    const title = (other) => other.profile?.name || other.name;
    let picker = "";
    if (profiles.length > 1)
      picker = `<label class="fs-profile">${icon("profile")}<span class="fs-sr">${escapeHtml(t("tab.profile"))}</span><select class="fs-select fs-small" data-act="profile"${draft ? " disabled" : ""}>${profiles
        .map(
          (other) =>
            `<option value="${escapeHtml(other.id)}"${other.id === file?.id ? " selected" : ""}>${escapeHtml(title(other))}</option>`,
        )
        .join("")}</select></label>`;
    else if (file?.profile)
      picker = `<span class="fs-profile" title="${escapeHtml(t("tab.profile"))}">${icon("profile")}<span class="fs-profile-name">${escapeHtml(title(file))}</span></span>`;
    const edited =
      edit && !draft
        ? `<span class="fs-edited">${icon("edit")}${escapeHtml(edit.mine ? t("tab.editedByYou") : t("tab.editedBy", { name: edit.user?.name ?? "?" }))}</span><button type="button" class="fs-btn fs-quiet fs-small" data-act="reset">${icon("reset")}${escapeHtml(t("tab.reset"))}</button>`
        : "";
    const editButton =
      draft || !shownNeeds().length
        ? ""
        : `<button type="button" class="fs-btn fs-outline fs-small" data-act="edit">${icon("edit")}${escapeHtml(t("tab.edit"))}</button>`;
    return `<div class="fs-tools">${picker}${edited}<span class="fs-spacer"></span><button type="button" class="fs-btn fs-quiet fs-small" data-act="open">${icon("shelf")}${escapeHtml(t("tab.openShelf"))}</button>${editButton}</div>`;
  }

  function render() {
    box.setAttribute("aria-busy", String(!data && !problem));
    drawnPeople = data ? peopleOf(data) : "";
    if (!data) {
      box.innerHTML = problem
        ? `<div class="fs-problem">${icon("warn")}<span>${escapeHtml(t("tab.failed", { error: problem }))}</span><button type="button" class="fs-btn fs-small" data-act="retry">${escapeHtml(t("tab.retry"))}</button></div>`
        : `<span class="fs-sr">${escapeHtml(t("loading"))}</span>${'<div class="fs-skel-row" aria-hidden="true"><span class="fs-skel"></span><span class="fs-skel"></span><span class="fs-skel"></span><span class="fs-skel"></span></div>'.repeat(3)}`;
      return;
    }
    const needs = shownNeeds();
    const match = matchAll(needs, data.spools, data.everyone);
    let body;
    if (!needs.length && !draft)
      body = `<div class="fs-blank">${swatch(null, "fs-l")}<span>${escapeHtml(t(data.edit ? "empty.noneSet" : "empty.noFilaments"))}</span><button type="button" class="fs-btn fs-outline fs-small" data-act="start">${icon("add")}${escapeHtml(t("edit.add"))}</button></div>`;
    else
      body =
        grid(needs, match) +
        (draft
          ? `<datalist id="${materialsId}">${MATERIAL_SUGGESTIONS.map((name) => `<option value="${name}"></option>`).join("")}</datalist>
             <div class="fs-actions"><button type="button" class="fs-btn fs-quiet fs-small" data-act="cancel"${saving ? " disabled" : ""}>${escapeHtml(t("edit.cancel"))}</button><button type="button" class="fs-btn fs-primary fs-small" data-act="save"${saving ? " disabled" : ""}>${escapeHtml(t("edit.save"))}</button></div>`
          : "");
    box.innerHTML = toolbar() + body + (needs.length ? together(match) : "");
    // While a save goes, the rows are what it sends: nothing in them changes until it's done.
    if (saving) for (const control of box.querySelectorAll(".fs-grid input, .fs-grid button")) control.disabled = true;
  }

  /** While editing: the people's columns, the counts and the summary follow what's typed, the inputs left alone. */
  function updateMatches() {
    const needs = draftNeeds();
    const match = matchAll(needs, data.spools, data.everyone);
    match.rows.forEach((row, i) =>
      row.cells.forEach((found, j) => {
        const target = box.querySelector(`[data-cell="${i}:${j}"]`);
        if (target) target.innerHTML = cell(found);
      }),
    );
    match.counts.forEach((have, j) => {
      const target = box.querySelector(`[data-count="${j}"]`);
      if (target) target.innerHTML = countPill(have, match.count);
    });
    const old = box.querySelector("[data-summary]");
    const next = together(match);
    if (old && next) old.outerHTML = next;
    else if (old) old.remove();
    else if (next) box.insertAdjacentHTML("beforeend", next);
  }

  /** One edited row's colour, shown in its swatch, inputs and palette. */
  function showColour(index, { hexInput = true } = {}) {
    const row = draft[index];
    const cellBox = box.querySelector(`[data-type="${index}"]`)?.closest(".fs-need");
    if (!cellBox) return;
    cellBox.querySelector(".fs-sw").outerHTML = swatch(row.color, "fs-l");
    if (row.color) cellBox.querySelector("[data-native]").value = row.color.toLowerCase();
    const hex = cellBox.querySelector("[data-hex]");
    if (hexInput) hex.value = row.hex;
    hex.setAttribute("aria-invalid", String(row.hex.trim() !== "" && !normaliseHex(row.hex)));
    for (const option of cellBox.querySelectorAll("[data-pick]"))
      option.setAttribute("aria-checked", String((option.dataset.hex || null) === row.color));
  }

  const blankRow = () => ({ id: newId(), type: "PLA", hex: "#FFFFFF", color: "#FFFFFF", grams: null });

  function startEdit(withRow = false) {
    draft = data.needs.map((need) => ({
      id: newId(),
      type: need.type ?? "",
      hex: need.color ?? "",
      color: need.color,
      grams: need.grams,
    }));
    if ((withRow || !draft.length) && draft.length < MAX_FILAMENTS) {
      const row = blankRow();
      draft.push(row);
      fresh = row.id;
    }
    render();
    box.querySelector("[data-type]")?.focus();
  }

  const failed = (error) => ui.toast(t("toast.failed", { error: error?.message || String(error) }), "error");

  async function save() {
    const bad = draft.findIndex((row) => row.hex.trim() !== "" && !normaliseHex(row.hex));
    if (bad >= 0) return box.querySelector(`[data-hex="${bad}"]`)?.focus();
    const filaments = draft.map((row) => ({
      type: row.type.trim() || null,
      color: row.hex.trim() ? normaliseHex(row.hex) : null,
      grams: row.grams ?? null,
    }));
    saving = true;
    render();
    try {
      await shared.set(`${NEEDS}${context.modelId}`, { filaments }, { model: context.modelId });
      draft = null;
      await load();
    } catch (error) {
      failed(error);
    } finally {
      saving = false;
      if (!closed) {
        render();
        // Saved, so the editor's gone: back to the button that opened it.
        if (!draft) box.querySelector('[data-act="edit"]')?.focus();
      }
    }
  }

  async function reset() {
    const sure = await ui.confirm({
      title: t("reset.title"),
      message: t("reset.message"),
      confirmLabel: t("tab.reset"),
    });
    if (!sure || closed) return;
    try {
      await shared.set(`${NEEDS}${context.modelId}`, { filaments: null }, { model: context.modelId });
      await load();
    } catch (error) {
      failed(error);
    }
  }

  box.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target || target.disabled) return;
    const act = target.dataset.act;
    if (act === "open") return ui.openWindow();
    // A save owns the rows until it's done.
    if (saving) return;
    if (act === "edit") return startEdit();
    if (act === "start") return startEdit(true);
    if (act === "retry") return void load();
    if (act === "reset") return void reset();
    if (act === "save") return void save();
    if (act === "cancel") {
      draft = null;
      render();
      return void box.querySelector('[data-act="edit"]')?.focus();
    }
    if (act === "add") {
      if (draft.length >= MAX_FILAMENTS) return;
      const row = blankRow();
      draft.push(row);
      fresh = row.id;
      render();
      return box.querySelector(`[data-type="${draft.length - 1}"]`)?.focus();
    }
    if (target.dataset.remove !== undefined) {
      const index = Number(target.dataset.remove);
      draft.splice(index, 1);
      fresh = null;
      render();
      return (
        box.querySelector(`[data-remove="${Math.min(index, draft.length - 1)}"]`) ??
        box.querySelector('[data-act="add"]')
      )?.focus();
    }
    if (target.dataset.pick !== undefined) {
      const index = Number(target.dataset.pick);
      draft[index].color = target.dataset.hex || null;
      draft[index].hex = target.dataset.hex;
      showColour(index);
      updateMatches();
    }
  });

  box.addEventListener("input", (event) => {
    if (saving) return;
    const input = event.target;
    if (input.dataset.type !== undefined) {
      draft[Number(input.dataset.type)].type = input.value;
      return updateMatches();
    }
    if (input.dataset.hex !== undefined) {
      const index = Number(input.dataset.hex);
      const row = draft[index];
      row.hex = input.value;
      if (!input.value.trim()) row.color = null;
      else row.color = normaliseHex(input.value) ?? row.color;
      showColour(index, { hexInput: false });
      return updateMatches();
    }
    if (input.dataset.native !== undefined) {
      const index = Number(input.dataset.native);
      draft[index].color = normaliseHex(input.value);
      draft[index].hex = draft[index].color;
      showColour(index);
      updateMatches();
    }
  });

  box.addEventListener("change", (event) => {
    if (event.target.dataset.act === "profile") ui.selectFile(event.target.value);
  });

  box.addEventListener("keydown", (event) => {
    if (!draft || saving) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      draft = null;
      render();
      box.querySelector('[data-act="edit"]')?.focus();
    } else if (event.key === "Enter" && event.target.matches("input:not([type=color])")) {
      event.preventDefault();
      void save();
    }
  });

  const stop = shared.onChange?.(() => void load()) ?? (() => {});
  const stopReturn = onReturn(() => void load());
  render();
  void load();

  return () => {
    closed = true;
    stop();
    stopReturn();
  };
}
