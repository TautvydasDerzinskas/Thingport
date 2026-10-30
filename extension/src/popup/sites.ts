// The model sites Grab works on: the built-in ones always, the optional ones (optionalSites.ts) once enabled here.
// Enabling asks the browser for that one site; registering Grab there follows in the background, from the browser's
// permission event. They show in two columns, so fifteen of them don't push the popup past the height a browser gives
// it, and the one whose site the active tab is on is lifted out of the grid into a card of its own at the top, with
// what it imports -- so the site in front of the user takes no searching for.

import { OPTIONAL_SITES, siteEnabled, type OptionalSite } from "../shared/optionalSites";
import { send } from "../shared/messages";
import type { Provider } from "../shared/urls";
import { clearError, els, showError } from "./dom";
import { ABOUT, MANIFESTS, PROVIDER_IDS, type Logo } from "../providers/index.generated";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Listed so people know they're on the way; Grab does nothing on them yet. */
const COMING_SOON: readonly { id: OptionalSite["id"]; name: string }[] = [];

// The same glyphs as the web app's: both take them from the providers' manifests.
const logo = (id: Provider): Logo => MANIFESTS[id].brand.logo;

type Site = { id: Provider; name: string; logo: Logo; optional?: OptionalSite; comingSoon?: boolean };

export function providerName(provider: Provider): string {
  return MANIFESTS[provider]?.name ?? provider;
}

/** The provider's logo in its own colours, as listed under Providers. */
export function providerLogo(provider: Provider): SVGSVGElement {
  const { path, color, viewBox, fillRule, layers } = logo(provider);
  return svg(path, { fill: color, ...(fillRule ? { "fill-rule": fillRule } : {}) }, viewBox, layers);
}

const SITES: Site[] = [
  ...PROVIDER_IDS.map((id) => ({
    id,
    name: MANIFESTS[id].name,
    logo: logo(id),
    optional: OPTIONAL_SITES.find((site) => site.id === id),
  })),
  ...COMING_SOON.map((site) => ({ id: site.id, name: site.name, logo: logo(site.id), comingSoon: true })),
];

/** Every site that can be enabled, so the count doesn't promise what Grab can't do yet. */
const LISTED = SITES.filter((site) => !site.comingSoon);

/** The sites enabled right now, so the count and Enable all follow each one turned on without a full reload. */
const enabled = new Set<Provider>();

function svg(
  path: string,
  attrs: Record<string, string>,
  viewBox = "0 0 24 24",
  layers: Logo["layers"] = [],
): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", viewBox);
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", path);
  for (const [name, value] of Object.entries(attrs)) p.setAttribute(name, value);
  el.append(p);
  for (const layer of layers) {
    const extra = document.createElementNS(SVG_NS, "path");
    extra.setAttribute("d", layer.d);
    extra.setAttribute("fill", layer.color);
    if (layer.fillRule) extra.setAttribute("fill-rule", layer.fillRule);
    el.append(extra);
  }
  return el;
}

function tick(site: Site, appeared = false): HTMLElement {
  const el = document.createElement("span");
  el.className = appeared ? "site__tick site__tick--new" : "site__tick";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `Enabled on ${site.name}`);
  el.title = "Enabled";
  el.append(
    svg("M5 12.5l4.5 4.5L19 7.5", {
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "3",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
  return el;
}

/** The mark on a site not enabled yet. The whole row is the button that turns it on, so this is decoration. */
function plus(): HTMLElement {
  const el = document.createElement("span");
  el.className = "site__plus";
  el.setAttribute("aria-hidden", "true");
  el.append(
    svg("M12 5v14M5 12h14", { fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round" }),
  );
  return el;
}

/** Asks the browser for one site when `btn` is clicked, and calls `done` once it's granted. */
function onEnable(btn: HTMLButtonElement, site: Site, optional: OptionalSite, done: () => void): void {
  btn.addEventListener("click", async () => {
    clearError(els.configuredError);
    btn.disabled = true;
    try {
      // Straight away: permissions.request() needs this click's user gesture.
      if (await chrome.permissions.request({ origins: optional.origins })) {
        enabled.add(site.id);
        renderHead();
        done();
        return;
      }
      showError(`Thingport Grab needs your browser's permission to run on ${site.name}.`, els.configuredError);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err), els.configuredError);
    }
    btn.disabled = false;
  });
}

// The title sits on a wrapper: a disabled button gets no hover events in every browser.
function comingSoonButton(site: Site): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "site__soon";
  wrap.title = "Coming soon";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "site__enable";
  btn.textContent = "Enable";
  btn.disabled = true;
  btn.setAttribute("aria-label", `${site.name}: coming soon`);
  wrap.append(btn);
  return wrap;
}

/** A grid row's contents, laid out the same whether the row is a button or not. */
function fillRow<T extends HTMLElement>(el: T, site: Site, status: Element): T {
  el.className = "site__row";
  const name = document.createElement("span");
  name.className = "site__name";
  name.textContent = site.name;
  el.append(providerLogo(site.id), name, status);
  return el;
}

/** One site of the grid: its name with a tick, or the whole row as the button that turns it on. `appeared` pops the
 *  tick in where the button was. */
function siteRow(site: Site, appeared = false): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "site";
  if (site.comingSoon) {
    row.classList.add("site--soon");
    row.append(fillRow(document.createElement("div"), site, comingSoonButton(site)));
  } else if (enabled.has(site.id) || !site.optional) {
    row.append(fillRow(document.createElement("div"), site, tick(site, appeared)));
  } else {
    row.classList.add("site--off");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = `Asks your browser for access to ${site.name}`;
    btn.setAttribute("aria-label", `Enable on ${site.name}`);
    onEnable(btn, site, site.optional, () => row.replaceWith(siteRow(site, true)));
    row.append(fillRow(btn, site, plus()));
  }
  return row;
}

function renderHead(): void {
  els.sitesCount.textContent = `${enabled.size} of ${LISTED.length} sites enabled`;
  els.sitesEnableAll.hidden = enabled.size >= LISTED.length;
}

/** The card above the grid: the provider whose site the active tab is on, what that site is, and whether Grab is
 *  already allowed to run on it. */
function renderFeatured(site: Site | null): void {
  els.featured.hidden = !site;
  if (!site) return;
  // Its own colour, washed out far enough to read as a tint of the popup's surface in either theme.
  const accent = MANIFESTS[site.id].brand.accent;
  els.featured.style.setProperty("--site-accent-wash", `${accent}24`);
  els.featured.style.setProperty("--site-accent-line", `${accent}59`);
  els.featuredLogo.replaceChildren(providerLogo(site.id));
  els.featuredName.textContent = site.name;
  els.featuredDesc.textContent = ABOUT[site.id];

  // Enabled is the usual state here: the active provider is only known from a page of Grab's own on the site, and
  // that only runs where it's allowed to. Access taken back in the browser's settings leaves such a page behind in
  // an open tab, though, so the card offers it back.
  if (enabled.has(site.id) || !site.optional) {
    els.featuredStatus.replaceChildren(tick(site));
    return;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "site__enable featured__enable";
  btn.textContent = "Enable";
  btn.setAttribute("aria-label", `Enable on ${site.name}`);
  onEnable(btn, site, site.optional, () => els.featuredStatus.replaceChildren(tick(site, true)));
  els.featuredStatus.replaceChildren(btn);
}

/** The provider whose site the user is looking at, as its own page told the background
 *  (background/providerTab.ts). Null anywhere else, Grab's own tab included. */
async function featuredSite(): Promise<Site | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) return null;
    const res = await send("GET_TAB_PROVIDER", { tabId: tab.id });
    const provider = res?.ok ? res.data : null;
    return LISTED.find((site) => site.id === provider) ?? null;
  } catch {
    return null;
  }
}

els.sitesEnableAll.addEventListener("click", async () => {
  clearError(els.configuredError);
  const origins = LISTED.flatMap((site) => (site.optional && !enabled.has(site.id) ? [...site.optional.origins] : []));
  if (!origins.length) return;
  els.sitesEnableAll.disabled = true;
  try {
    // Straight away: permissions.request() needs this click's user gesture.
    if (await chrome.permissions.request({ origins })) {
      await loadSites();
      return;
    }
    showError("Thingport Grab needs your browser's permission to run on these sites.", els.configuredError);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err), els.configuredError);
  }
  els.sitesEnableAll.disabled = false;
});

export async function loadSites(): Promise<void> {
  const flags = await Promise.all(LISTED.map((site) => (site.optional ? siteEnabled(site.optional) : true)));
  enabled.clear();
  for (const [index, site] of LISTED.entries()) if (flags[index]) enabled.add(site.id);
  renderHead();
  const featured = await featuredSite();
  renderFeatured(featured);
  els.sitesList.replaceChildren(...SITES.filter((site) => site !== featured).map((site) => siteRow(site)));
}
