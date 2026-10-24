// The model sites Grab works on: the built-in ones always, the optional ones (optionalSites.ts) once enabled here.
// Enabling asks the browser for that one site; registering Grab there follows in the background, from the browser's
// permission event.

import { OPTIONAL_SITES, siteEnabled, type OptionalSite } from "../shared/optionalSites";
import type { Provider } from "../shared/urls";
import { clearError, els, showError } from "./dom";
import { MANIFESTS, PROVIDER_IDS, type Logo } from "../shared/providers/_generated";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Listed so people know they're on the way; Grab does nothing on them yet. */
const COMING_SOON: readonly { id: OptionalSite["id"]; name: string }[] = [];

// The same glyphs as the web app's: both take them from the providers' manifests.
const logo = (id: Provider): Logo => MANIFESTS[id].brand.logo;

type Site = { name: string; logo: Logo; optional?: OptionalSite; comingSoon?: boolean };

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
    name: MANIFESTS[id].name,
    logo: logo(id),
    optional: OPTIONAL_SITES.find((site) => site.id === id),
  })),
  ...COMING_SOON.map((site) => ({ name: site.name, logo: logo(site.id), comingSoon: true })),
];

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

function enableButton(site: Site, optional: OptionalSite): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "site__enable";
  btn.textContent = "Enable";
  btn.title = `Asks your browser for access to ${site.name}`;
  btn.setAttribute("aria-label", `Enable on ${site.name}`);
  btn.addEventListener("click", async () => {
    clearError(els.configuredError);
    btn.disabled = true;
    try {
      // Straight away: permissions.request() needs this click's user gesture.
      if (await chrome.permissions.request({ origins: optional.origins })) {
        btn.replaceWith(tick(site, true));
        return;
      }
      showError(`Thingport Grab needs your browser's permission to run on ${site.name}.`, els.configuredError);
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err), els.configuredError);
    }
    btn.disabled = false;
  });
  return btn;
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

export async function loadSites(): Promise<void> {
  const enabled = await Promise.all(SITES.map((site) => (site.optional ? siteEnabled(site.optional) : true)));
  els.sitesList.replaceChildren(
    ...SITES.map((site, index) => {
      const row = document.createElement("li");
      row.className = site.comingSoon ? "site site--soon" : "site";
      const name = document.createElement("span");
      name.className = "site__name";
      name.textContent = site.name;
      const status = site.comingSoon
        ? comingSoonButton(site)
        : enabled[index] || !site.optional
          ? tick(site)
          : enableButton(site, site.optional);
      const { path, color, viewBox, fillRule, layers } = site.logo;
      row.append(
        svg(path, { fill: color, ...(fillRule ? { "fill-rule": fillRule } : {}) }, viewBox, layers),
        name,
        status,
      );
      return row;
    }),
  );
}
