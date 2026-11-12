// Adapt 3MFs in the popup. Its row under Offline features (Extra features once connected) says which slicers and
// printers copies are made for, or asks for a slicer; its cog opens its settings over the popup: Slicer, Printers,
// where the Download adapted button goes, and the sites it works on. Not connected, they're Grab's own; connected, the
// slicers and printers are the Thingport instance's, managed there. Add printer lists the makers first, then a
// maker's printers as tiles; typing searches every printer.

import {
  ADAPT_PLACEMENTS,
  defaultNozzle,
  type AdaptPlacement,
  type AdaptPrinter,
  type AdaptSettings,
} from "../shared/adaptSettings";
import { send, type AdaptView, type ThingportPrinter } from "../shared/messages";
import { OPTIONAL_SITES, siteEnabled } from "../shared/optionalSites";
import { SLICER_LABELS } from "../shared/slicers";
import { STORAGE_KEYS } from "../shared/storage";
import { printerCatalogue, type CatalogueBrand, type CataloguePrinter } from "../printers/catalogue";
import { MANIFESTS, PROVIDER_IDS, type ProviderId } from "../providers/index.generated";
import {
  addPrinterTile,
  el,
  icon,
  ICONS,
  printerTile,
  slicerMarkSvg,
  slicerTile,
  type ShownPrinter,
} from "./adaptTiles";
import { clearError, els, opensInTab, showError } from "./dom";
import { openMenu } from "./menu";
import { nameMatches, nameWords } from "./printerSearch";
import { providerLogo } from "./sites";
import { isOpen, openView } from "./subview";

const TIPS = {
  slicer: "The slicers you open models in. A copy is made for one: they read 3MFs differently.",
  printers: "Your printers. A copy for one names that slicer's presets for it and lays its plates out on its bed.",
  button: "Where Download adapted goes on a model's page.",
  sites: "The sites it works on. Some need your browser's permission first, which Allow asks for.",
};

const PLACE_LABELS: Record<AdaptPlacement, string> = {
  beside: "Beside the site's button",
  bubble: "In Grab's bubble",
};

// Most people's printers are among these; the rest are a click away.
const COMMON_MAKERS = [
  "bambulab",
  "creality",
  "prusaresearch",
  "anycubic",
  "elegoo",
  "qidi",
  "snapmaker",
  "flashforge",
  "sovol",
  "artillery",
  "ultimaker",
  "vorondesign",
];
const SEARCH_LIMIT = 60;

// Where Download adapted works: the sites whose 3MFs Grab can adapt.
const ADAPT_SITES: ProviderId[] = PROVIDER_IDS.filter(
  (id) => (MANIFESTS[id].capabilities as { bambuProjects?: true }).bambuProjects,
);

const catalogue = printerCatalogue();
type Index = Awaited<ReturnType<typeof catalogue.index>>;

let view: AdaptView | null = null;
let index: Index | null = null;
let brands = new Map<string, CatalogueBrand>();
const siteOn = new Map<ProviderId, boolean>();
// Add printer: the maker opened, if one is, and whether every maker is listed.
// The maker whose printers are shown, and what the makers' list was searched for when it was picked.
let picking: { maker: string | null; allMakers: boolean; query: string } = { maker: null, allMakers: false, query: "" };

/** What copies are made for now. Thingport's slicers and printers are managed there, so they're only shown here. */
type InUse = {
  slicers: string[];
  printers: ShownPrinter[];
  slicersFromThingport: boolean;
  printersFromThingport: boolean;
  note: string | null;
  retry: boolean;
};

function shownOwn(printers: AdaptPrinter[]): ShownPrinter[] {
  return printers.map(({ id, nozzle }) => {
    const known = index?.byId.get(id);
    return known
      ? { ...known, brandName: brands.get(known.brand)?.name ?? known.brand, nozzle }
      : { id, brandName: "", model: id, nozzle, bed: null, height: null, extruders: 1 };
  });
}

const shownThingport = (printers: ThingportPrinter[]): ShownPrinter[] => printers.map((printer) => ({ ...printer }));

function inUse(current: AdaptView): InUse {
  const thingport = current.thingport;
  const own = {
    slicers: current.own.slicers,
    printers: shownOwn(current.own.printers),
    slicersFromThingport: false,
    printersFromThingport: false,
  };
  if (thingport && "slicers" in thingport) {
    return {
      slicers: thingport.slicers,
      slicersFromThingport: true,
      printers: thingport.printers ? shownThingport(thingport.printers) : own.printers,
      printersFromThingport: Boolean(thingport.printers),
      note: thingport.printers ? null : "Your Thingport instance doesn't keep printers yet, so Grab uses its own.",
      retry: false,
    };
  }
  if (thingport) {
    return {
      ...own,
      note: `Couldn't reach your Thingport instance (${thingport.error}), so Grab uses its own slicers and printers.`,
      retry: true,
    };
  }
  return { ...own, note: null, retry: false };
}

/** Puts focus back where it was, by the `data-key` of what had it, after `container` is drawn again. */
function redraw(container: HTMLElement, draw: () => void): void {
  const key = (document.activeElement as HTMLElement | null)?.dataset?.key;
  draw();
  if (key && container.contains(document.activeElement) === false) {
    container.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  }
}

function renderAll(): void {
  renderSetup();
  if (isOpen(els.adaptView)) redraw(els.adaptSections, renderSettings);
  if (isOpen(els.addPrinterView)) redraw(els.addPrinterBody, renderAddPrinter);
}

/** Shown at once, put back if it can't be saved. */
async function save(change: Partial<AdaptSettings>, errorEl: HTMLElement = els.adaptError): Promise<void> {
  if (!view) return;
  // A read under way began before this change, so what it brings back is older.
  reads++;
  clearError(errorEl);
  const before = view.own;
  view = { ...view, own: { ...view.own, ...change } };
  renderAll();
  const res = await send("SET_ADAPT_SETTINGS", change);
  if (res?.ok) {
    view = { ...view, own: res.data };
    renderAll();
    return;
  }
  view = { ...view, own: before };
  renderAll();
  showError(res?.error ?? "Couldn't save", errorEl);
}

// ---- The row ----------------------------------------------------------------------------------------------------

function renderSetup(): void {
  if (!view) {
    els.adaptSetup.replaceChildren();
    return;
  }
  const use = inUse(view);
  if (!use.slicers.length && use.slicersFromThingport) {
    // Connected, they're picked in Thingport.
    const link = el("a", "text-btn adapt-setup__nudge", "Pick your slicer in Thingport", icon(ICONS.open));
    link.href = `${view.instanceUrl}/?configuration=slicer`;
    link.dataset.key = "adapt-nudge";
    els.adaptSetup.replaceChildren(opensInTab(link));
    return;
  }
  if (!use.slicers.length) {
    const nudge = el("button", "text-btn adapt-setup__nudge", "Pick your slicer", icon(ICONS.chevron));
    nudge.type = "button";
    nudge.dataset.key = "adapt-nudge";
    nudge.addEventListener("click", () => openSettings(nudge, { toSlicers: true }));
    els.adaptSetup.replaceChildren(nudge);
    return;
  }
  const said = [
    use.slicers.map((id) => SLICER_LABELS[id] ?? id).join(", "),
    use.printers.map((printer) => printer.model).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
  const text = el("span", "adapt-setup__text", said);
  text.title = said;
  els.adaptSetup.replaceChildren(
    el("span", "adapt-setup__marks", ...use.slicers.slice(0, 3).map((id) => slicerMarkSvg(id, 14))),
    text,
  );
}

// ---- Settings ---------------------------------------------------------------------------------------------------

function help(tip: string): HTMLElement {
  const mark = el("span", "help", "?");
  mark.tabIndex = 0;
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", tip);
  mark.dataset.tip = tip;
  return mark;
}

function section(title: string, tip: string, body: Node[], aside: Node[] = []): HTMLElement {
  const head = el("div", "sv-section__head", el("h3", "sv-section__title", title), help(tip), ...aside);
  return el("section", "sv-section", head, ...body);
}

/** "From Thingport" and a link to where it's managed there. */
function fromThingport(tab: "slicer" | "printers"): Node[] {
  const link = el("a", "text-btn sv-manage", "Manage", icon(ICONS.open));
  link.href = `${view?.instanceUrl ?? ""}/?configuration=${tab}`;
  link.title = `Opens your Thingport instance's ${tab === "slicer" ? "Slicer" : "Printers"} settings`;
  return [el("span", "sv-from", "From Thingport"), opensInTab(link)];
}

function slicerSection(use: InUse): HTMLElement {
  if (use.slicersFromThingport) {
    const body = use.slicers.length
      ? [el("div", "st-grid", ...use.slicers.map((id) => slicerTile(id)))]
      : [el("p", "sv-empty", "No slicers picked in Thingport yet.")];
    return section("Slicer", TIPS.slicer, body, fromThingport("slicer"));
  }
  const grid = el("div", "st-grid");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Your slicers");
  for (const id of Object.keys(SLICER_LABELS)) {
    const on = use.slicers.includes(id);
    const tile = slicerTile(id, on);
    tile.dataset.key = `slicer:${id}`;
    tile.addEventListener("click", () => {
      const slicers = on ? use.slicers.filter((slicer) => slicer !== id) : [...use.slicers, id];
      void save({ slicers });
    });
    grid.append(tile);
  }
  return section("Slicer", TIPS.slicer, [grid]);
}

/** The settings' control with `key`, as they're drawn now. */
const drawnItem = (key: string) => els.adaptSections.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);

function printerMenu(tile: HTMLElement, printer: ShownPrinter): void {
  const own = view?.own.printers ?? [];
  const nozzles = index?.byId.get(printer.id)?.nozzles ?? (printer.nozzle ? [printer.nozzle] : []);
  openMenu(tile, `${printer.brandName} ${printer.model}`, [
    { heading: `${printer.brandName} ${printer.model}`.trim() },
    ...nozzles.map((nozzle) => ({
      label: `${nozzle} mm nozzle`,
      checked: nozzle === printer.nozzle,
      select: () => void save({ printers: own.map((mine) => (mine.id === printer.id ? { ...mine, nozzle } : mine)) }),
    })),
    "separator",
    {
      label: "Remove",
      danger: true,
      select: () => {
        // Its tile goes with it, drawn away before the change is saved: focus goes to the next printer's, else the
        // one before, else Add printer, straight away.
        const keys = own.map((mine) => `printer:${mine.id}`);
        const at = keys.indexOf(`printer:${printer.id}`);
        const next = keys[at + 1] ?? keys[at - 1] ?? "add-printer";
        const saving = save({ printers: own.filter((p) => p.id !== printer.id) });
        drawnItem(next)?.focus();
        // Put back, as it couldn't be saved: focus goes back to it, unless the user has moved on meanwhile.
        void saving.then(() => {
          const restored = drawnItem(`printer:${printer.id}`);
          if (restored && (document.activeElement as HTMLElement | null)?.dataset.key === next) restored.focus();
        });
      },
    },
  ]);
}

function printerSection(use: InUse): HTMLElement {
  if (use.printersFromThingport) {
    const body = use.printers.length
      ? [el("div", "pt-grid", ...use.printers.map((printer) => printerTile(printer, { button: false })))]
      : [el("p", "sv-empty", "No printers in Thingport yet.")];
    return section("Printers", TIPS.printers, body, fromThingport("printers"));
  }
  const grid = el("div", "pt-grid");
  for (const printer of use.printers) {
    const tile = printerTile(printer, { button: true });
    tile.dataset.key = `printer:${printer.id}`;
    tile.setAttribute("aria-haspopup", "menu");
    tile.addEventListener("click", () => printerMenu(tile, printer));
    tile.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      printerMenu(tile, printer);
    });
    grid.append(tile);
  }
  const add = addPrinterTile();
  add.dataset.key = "add-printer";
  add.addEventListener("click", () => openAddPrinter(add));
  grid.append(add);
  return section("Printers", TIPS.printers, [grid]);
}

function placementSection(current: AdaptPlacement): HTMLElement {
  const group = el("div", "seg");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Where Download adapted goes");
  for (const place of ADAPT_PLACEMENTS) {
    const option = el("button", "seg__opt", PLACE_LABELS[place]);
    option.type = "button";
    option.setAttribute("role", "radio");
    option.setAttribute("aria-checked", String(place === current));
    option.tabIndex = place === current ? 0 : -1;
    option.dataset.key = `place:${place}`;
    option.addEventListener("click", () => void save({ placement: place }));
    group.append(option);
  }
  group.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = ADAPT_PLACEMENTS[(ADAPT_PLACEMENTS.indexOf(current) + 1) % ADAPT_PLACEMENTS.length];
    void save({ placement: next });
    // Saving has drawn the sections anew already, this group with them.
    els.adaptSections.querySelector<HTMLElement>(`[data-key="place:${next}"]`)?.focus();
  });
  const note = el("p", "sv-note", "Where a site's own button can't be found, it goes in the bubble.");
  return section("Button", TIPS.button, [group, note]);
}

function sitesSection(): HTMLElement {
  const list = el("ul", "sv-sites");
  for (const id of ADAPT_SITES) {
    const optional = OPTIONAL_SITES.find((site) => site.id === id);
    const name = MANIFESTS[id].name;
    const row = el("li", "sv-site", el("span", "sv-site__logo", providerLogo(id)), el("span", "sv-site__name", name));
    if (!optional || siteOn.get(id)) {
      row.append(el("span", "sv-site__on", icon(ICONS.check), optional ? "On" : "Always on"));
    } else {
      const allow = el("button", "text-btn sv-site__allow", "Allow");
      allow.type = "button";
      allow.dataset.key = `site:${id}`;
      allow.setAttribute("aria-label", `Allow Thingport Grab on ${name}`);
      allow.addEventListener("click", async () => {
        clearError(els.adaptError);
        // Straight away: permissions.request() needs this click's user gesture.
        if (await chrome.permissions.request({ origins: optional.origins })) {
          siteOn.set(id, true);
          renderAll();
        } else {
          showError(`Thingport Grab needs your browser's permission to run on ${name}.`, els.adaptError);
        }
      });
      row.append(allow);
    }
    list.append(row);
  }
  return section("Sites", TIPS.sites, [list]);
}

function noteBlock(use: InUse): HTMLElement {
  const note = el("p", use.retry ? "sv-alert sv-alert--problem" : "sv-alert", use.note ?? "");
  if (use.retry) {
    const retry = el("button", "text-btn", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => void loadAdapt());
    note.append(" ", retry);
  }
  return note;
}

/** The last read failing, with a way to read again. */
function readFailedBlock(message: string): HTMLElement {
  const note = el("p", "sv-alert sv-alert--problem", `Couldn't read the settings: ${message}`);
  const retry = el("button", "text-btn", "Try again");
  retry.type = "button";
  retry.dataset.key = "read-again";
  retry.addEventListener("click", () => void loadAdapt());
  note.append(" ", retry);
  return note;
}

function renderSettings(): void {
  const failed = readFailed ? [readFailedBlock(readFailed)] : [];
  if (!view) {
    els.adaptSections.replaceChildren(...failed);
    return;
  }
  const use = inUse(view);
  els.adaptSections.replaceChildren(
    ...failed,
    ...(use.note ? [noteBlock(use)] : []),
    slicerSection(use),
    printerSection(use),
    placementSection(view.own.placement),
    sitesSection(),
  );
}

function openSettings(opener: HTMLElement, { toSlicers = false } = {}): void {
  els.adaptViewSwitch.checked = els.normalizeSwitch.checked;
  clearError(els.adaptError);
  renderSettings();
  // A slicer picked through the nudge takes the nudge away: focus goes back to the cog then.
  openView(els.adaptView, opener, { fallback: els.adaptSettingsBtn });
  if (toSlicers) els.adaptSections.querySelector<HTMLElement>(".st")?.focus();
}

els.adaptSettingsBtn.addEventListener("click", () => openSettings(els.adaptSettingsBtn));

// The view's switch is the row's: the row's saves it (popup/index.ts).
els.adaptViewSwitch.addEventListener("change", () => {
  els.normalizeSwitch.checked = els.adaptViewSwitch.checked;
  els.normalizeSwitch.dispatchEvent(new Event("change"));
});
els.normalizeSwitch.addEventListener("change", () => {
  els.adaptViewSwitch.checked = els.normalizeSwitch.checked;
});

// ---- Add printer ------------------------------------------------------------------------------------------------

const brandName = (printer: CataloguePrinter) => brands.get(printer.brand)?.name ?? printer.brand;
const matches = (printer: CataloguePrinter, query: string[]) =>
  nameMatches(`${brandName(printer)} ${printer.model}`, query);

/** A printer to add, or to take out again: on as one of the user's. */
function pickTile(printer: CataloguePrinter): HTMLElement {
  const own = view?.own.printers ?? [];
  const mine = own.some((p) => p.id === printer.id);
  const tile = printerTile({ ...printer, brandName: brandName(printer) }, { button: true, pressed: mine });
  tile.dataset.key = `pick:${printer.id}`;
  tile.addEventListener("click", () => {
    const printers = mine
      ? own.filter((p) => p.id !== printer.id)
      : [...own, { id: printer.id, nozzle: defaultNozzle(printer.nozzles) }];
    void save({ printers }, els.addPrinterError);
  });
  return tile;
}

function makerRow(brand: CatalogueBrand): HTMLButtonElement {
  const row = el(
    "button",
    "ap-brand",
    el("span", "ap-brand__name", brand.name),
    el("span", "ap-brand__count", String(brand.printers)),
    icon(ICONS.chevron),
  );
  row.type = "button";
  row.dataset.key = `maker:${brand.id}`;
  row.setAttribute("aria-label", `${brand.name}, ${brand.printers} printer${brand.printers === 1 ? "" : "s"}`);
  row.addEventListener("click", () => {
    picking = { ...picking, maker: brand.id, query: els.addPrinterSearch.value };
    els.addPrinterSearch.value = "";
    renderAddPrinter();
    els.addPrinterSearch.focus();
  });
  return row;
}

const groupLabel = (label: string, count: number) => el("div", "ap-group", label, el("span", "", String(count)));

function renderAddPrinter(): void {
  if (!index) {
    els.addPrinterBody.replaceChildren(el("p", "sv-empty", "Grab's list of printers didn't load."));
    return;
  }
  const query = nameWords(els.addPrinterSearch.value);
  const maker = picking.maker ? brands.get(picking.maker) : undefined;
  const total = maker ? maker.printers : index.printers.length;
  els.addPrinterTitle.textContent = maker ? maker.name : "Add printer";
  els.addPrinterCount.textContent = `${total} printer${total === 1 ? "" : "s"}`;
  els.addPrinterSearch.placeholder = maker ? `Search ${maker.name}` : `Search ${total} printers`;
  els.addPrinterSearch.setAttribute("aria-label", els.addPrinterSearch.placeholder);

  if (maker) {
    const listed = index.printers.filter((p) => p.brand === maker.id && matches(p, query));
    els.addPrinterStatus.textContent = `${listed.length} printer${listed.length === 1 ? "" : "s"}`;
    els.addPrinterBody.replaceChildren(
      listed.length
        ? el("div", "pt-grid", ...listed.map(pickTile))
        : el("p", "sv-empty", `No ${maker.name} printer is called that.`),
    );
    return;
  }

  if (query.length) {
    const makers = index.brands.filter((brand) => nameMatches(brand.name, query));
    const found = index.printers.filter((p) => matches(p, query));
    const shown = found.slice(0, SEARCH_LIMIT);
    const byMaker = new Map<string, CataloguePrinter[]>();
    for (const printer of shown) byMaker.set(printer.brand, [...(byMaker.get(printer.brand) ?? []), printer]);
    els.addPrinterStatus.textContent = `${found.length} printer${found.length === 1 ? "" : "s"} found`;
    const parts: Node[] = [];
    if (makers.length) parts.push(groupLabel("Makers", makers.length), el("div", "ap-brands", ...makers.map(makerRow)));
    for (const [brand, printers] of byMaker) {
      parts.push(
        groupLabel(brands.get(brand)?.name ?? brand, printers.length),
        el("div", "pt-grid", ...printers.map(pickTile)),
      );
    }
    if (found.length > shown.length)
      parts.push(el("p", "sv-note", `${found.length - shown.length} more: type more of the name.`));
    if (!parts.length) parts.push(el("p", "sv-empty", "No printer is called that. Try its maker's name."));
    els.addPrinterBody.replaceChildren(...parts);
    return;
  }

  const listed = picking.allMakers
    ? index.brands.toSorted((a, b) => a.name.localeCompare(b.name))
    : COMMON_MAKERS.map((id) => brands.get(id)).filter((brand): brand is CatalogueBrand => Boolean(brand));
  els.addPrinterStatus.textContent = "";
  const parts: Node[] = [groupLabel("Makers", index.brands.length), el("div", "ap-brands", ...listed.map(makerRow))];
  if (!picking.allMakers) {
    const all = el("button", "text-btn ap-all", `All ${index.brands.length} makers`);
    all.type = "button";
    all.dataset.key = "all-makers";
    all.addEventListener("click", () => {
      picking = { ...picking, allMakers: true };
      renderAddPrinter();
      els.addPrinterBody.querySelector<HTMLElement>(".ap-brand")?.focus();
    });
    parts.push(all);
  }
  els.addPrinterBody.replaceChildren(...parts);
}

function openAddPrinter(opener: HTMLElement): void {
  picking = { maker: null, allMakers: false, query: "" };
  els.addPrinterSearch.value = "";
  clearError(els.addPrinterError);
  renderAddPrinter();
  // Back from a maker's printers goes to the makers first.
  openView(els.addPrinterView, opener, {
    back: () => {
      if (!picking.maker) return false;
      const maker = picking.maker;
      // Back to the list it was picked from, searched as it was, so the maker is in it again.
      els.addPrinterSearch.value = picking.query;
      picking = { ...picking, maker: null, query: "" };
      renderAddPrinter();
      els.addPrinterBody.querySelector<HTMLElement>(`[data-key="maker:${CSS.escape(maker)}"]`)?.focus();
      return true;
    },
  });
  els.addPrinterSearch.focus();
}

els.addPrinterSearch.addEventListener("input", () => renderAddPrinter());

// ---- Loading ----------------------------------------------------------------------------------------------------

async function loadIndex(): Promise<void> {
  if (index) return;
  try {
    index = await catalogue.index();
    brands = new Map(index.brands.map((brand) => [brand.id, brand]));
  } catch (err) {
    console.warn("[adapt] Grab's printer list didn't load:", err);
  }
}

async function loadSiteStates(): Promise<void> {
  for (const id of ADAPT_SITES) {
    const optional = OPTIONAL_SITES.find((site) => site.id === id);
    siteOn.set(id, optional ? await siteEnabled(optional) : true);
  }
}

// Reads begun, and changes saved, so far: a read that finishes after a newer one began, or after a change, is dropped.
let reads = 0;
// Why the last read failed, shown in the settings while they're open.
let readFailed: string | null = null;

/** Reads the settings, and the instance's slicers and printers once connected, then draws what's showing. */
export async function loadAdapt(): Promise<void> {
  const read = ++reads;
  const [res] = await Promise.all([send("GET_ADAPT_SETTINGS"), loadIndex(), loadSiteStates()]);
  if (read !== reads) return;
  if (!res?.ok) {
    readFailed = res?.error ?? "Couldn't read Adapt 3MFs' settings";
    showError(readFailed, els.offlineError);
    if (isOpen(els.adaptView)) redraw(els.adaptSections, renderSettings);
    return;
  }
  readFailed = null;
  view = res.data;
  renderAll();
}

// Another window's popup; or, just after connecting, Grab's picks having gone to the instance (adaptCarriedTo is
// written once they have), which the instance's lists then show.
chrome.storage.onChanged.addListener((changes, area) => {
  const keys = [
    STORAGE_KEYS.adaptSlicers,
    STORAGE_KEYS.adaptPrinters,
    STORAGE_KEYS.adaptPlacement,
    STORAGE_KEYS.adaptCarriedTo,
  ];
  if (area === "local" && keys.some((key) => key in changes)) void loadAdapt();
});
chrome.permissions.onAdded.addListener(() => void loadSiteStates().then(renderAll));
