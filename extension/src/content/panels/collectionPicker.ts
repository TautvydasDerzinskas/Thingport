// The "Collection" picker on single-model imports (batch imports get their own auto-named collection), and the
// find-or-create both of them file into.
//
// One box does both jobs: type to narrow the list, or type a name that isn't in it to make that collection. A
// native <select> hid "Create new collection" among the names and made a long list hard to get through; here the
// field is the search, the list filters as you type, and a "Create" row shows the moment what you typed is new.
// What the field says at import time is what counts, so nothing is lost if the list is never opened.

import type { Collection } from "../../shared/api";
import { api } from "../runtime";
import { panelQuery } from "../shell";

/** Loaded with the picker's markup, read again when the import starts. */
let loaded: Collection[] = [];

const normalize = (name: string): string => name.trim().toLowerCase();

const match = (name: string): Collection | undefined =>
  loaded.find((collection) => normalize(collection.name || "") === normalize(name));

/** Case-insensitive match on name, created if missing. Null on failure; the import proceeds. */
export async function findOrCreateCollection(name: string | null): Promise<string | null> {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;
  const normalized = normalize(trimmed);
  try {
    const collections = await api<Collection[]>("GET", "/collections");
    const existing = collections.find((c) => !c.system_key && normalize(c.name || "") === normalized);
    if (existing) return existing.id;
    return (await api<Collection>("POST", "/collections", { name: trimmed })).id;
  } catch {
    return null;
  }
}

/** Call wireCollectionPicker() once it's rendered. */
export async function collectionPickerHtml(): Promise<string> {
  try {
    loaded = (await api<Collection[]>("GET", "/collections")).filter((c) => !c.system_key);
  } catch {
    return ""; // import still works without the picker
  }
  return `
    <label class="tg-label" for="tg-collection">Collection (optional)</label>
    <div class="tg-combo">
      <div class="tg-combo__field">
        <input
        id="tg-collection"
        class="tg-combo__input"
        type="text"
        role="combobox"
        aria-expanded="false"
        aria-controls="tg-collection-list"
        aria-autocomplete="list"
        autocomplete="off"
        maxlength="200"
        placeholder="Search, or type a new name"
      />
        <button type="button" class="tg-combo__toggle" aria-label="Show collections" tabindex="-1">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <ul class="tg-combo__list" id="tg-collection-list" role="listbox" hidden></ul>
    </div>
    <div class="tg-combo__note" id="tg-collection-note" hidden></div>
  `;
}

type Row = { label: string; value: string; kind: "none" | "existing" | "new" };

function rowsFor(query: string): Row[] {
  const trimmed = query.trim();
  const needle = normalize(trimmed);
  const hits = loaded.filter((c) => !needle || normalize(c.name || "").includes(needle));
  const rows: Row[] = [{ label: "No collection", value: "", kind: "none" }];
  for (const c of hits) rows.push({ label: c.name || "Untitled", value: c.name || "", kind: "existing" });
  // Only when it would make something new: an exact name already in the list is picked, not created again.
  if (trimmed && !match(trimmed)) rows.push({ label: `Create “${trimmed}”`, value: trimmed, kind: "new" });
  return rows;
}

/** Turns the field into a filtered list of collections, with a row that creates what's typed. */
export function wireCollectionPicker(): void {
  const input = panelQuery<HTMLInputElement>("#tg-collection");
  const list = panelQuery<HTMLUListElement>("#tg-collection-list");
  const toggle = panelQuery<HTMLButtonElement>(".tg-combo__toggle");
  const note = panelQuery<HTMLElement>("#tg-collection-note");
  const combo = panelQuery<HTMLElement>(".tg-combo");
  if (!input || !list || !toggle || !note || !combo) return;

  let rows: Row[] = [];
  let active = -1;

  /** Says when the field would make a collection rather than file into one. */
  function showNote(): void {
    const typed = input!.value.trim();
    const creating = Boolean(typed) && !match(typed);
    note!.textContent = creating ? `“${typed}” will be created` : "";
    note!.hidden = !creating;
  }

  function highlight(index: number): void {
    active = index;
    for (const [i, el] of [...list!.children].entries()) {
      el.classList.toggle("tg-combo__option--active", i === active);
      el.setAttribute("aria-selected", String(i === active));
    }
    const current = list!.children[active];
    current?.scrollIntoView({ block: "nearest" });
    // What a screen reader reads out as the arrow keys move, the focus staying in the field.
    if (current?.id) input!.setAttribute("aria-activedescendant", current.id);
    else input!.removeAttribute("aria-activedescendant");
  }

  function render(): void {
    rows = rowsFor(input!.value);
    const current = normalize(input!.value);
    list!.replaceChildren(
      ...rows.map((row, index) => {
        const el = document.createElement("li");
        el.className = row.kind === "new" ? "tg-combo__option tg-combo__option--new" : "tg-combo__option";
        el.setAttribute("role", "option");
        el.id = `tg-collection-option-${index}`;
        el.dataset.index = String(index);
        if (row.kind === "new") {
          const plus = document.createElement("span");
          plus.className = "tg-combo__plus";
          plus.setAttribute("aria-hidden", "true");
          plus.textContent = "+";
          el.append(plus, row.label);
        } else {
          el.textContent = row.label;
        }
        if (row.kind === "existing" && normalize(row.value) === current) el.classList.add("tg-combo__option--on");
        return el;
      }),
    );
    // What Enter would do: the one being created when nothing else matches, else the first name found.
    highlight(rows.length > 1 ? 1 : 0);
    showNote();
  }

  function open(): void {
    if (!list!.hidden) return;
    render();
    list!.hidden = false;
    combo!.classList.add("tg-combo--open");
    input!.setAttribute("aria-expanded", "true");
  }

  function close(): void {
    list!.hidden = true;
    combo!.classList.remove("tg-combo--open");
    input!.setAttribute("aria-expanded", "false");
    input!.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function choose(index: number): void {
    const row = rows[index];
    if (!row) return;
    input!.value = row.value;
    close();
    showNote();
    input!.focus();
  }

  input.addEventListener("focus", open);
  input.addEventListener("click", open);
  input.addEventListener("input", () => {
    open();
    render();
  });
  // Where a browser doesn't focus a button that's clicked, the field would lose focus instead, and the focusout
  // below would close the list before the click could tell it had been open.
  toggle.addEventListener("mousedown", (event) => event.preventDefault());
  toggle.addEventListener("click", () => (list.hidden ? (input.focus(), open()) : close()));

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open();
      highlight((active + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
      return;
    }
    if (event.key === "Enter" && !list.hidden) {
      event.preventDefault();
      choose(active);
      return;
    }
    if (event.key === "Escape" && !list.hidden) {
      event.preventDefault();
      close();
    }
  });

  list.addEventListener("mousedown", (event) => {
    // Before the blur that closing would otherwise race.
    event.preventDefault();
    const index = (event.target as HTMLElement).closest<HTMLElement>(".tg-combo__option")?.dataset.index;
    if (index !== undefined) choose(Number(index));
  });

  // Anywhere else in the panel, including the Import button.
  combo.addEventListener("focusout", (event) => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (!next || !combo.contains(next)) close();
  });
}

export type CollectionChoice = { id: string } | { newName: string } | null;

/** Read when the import starts, before SPA navigation can clear the panel: whatever the field says, whether or not
 *  the list was ever opened. A name already in the list files into it; any other name makes that collection. */
export function readCollectionChoice(): CollectionChoice {
  const typed = panelQuery<HTMLInputElement>("#tg-collection")?.value.trim();
  if (!typed) return null;
  const existing = match(typed);
  return existing ? { id: existing.id } : { newName: typed };
}

/** A new name files into the collection already called that, if there is one. */
export async function collectionIdFor(choice: CollectionChoice): Promise<string | null> {
  if (!choice) return null;
  return "id" in choice ? choice.id : findOrCreateCollection(choice.newName);
}
