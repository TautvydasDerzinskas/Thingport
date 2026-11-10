// A MakerWorld design's licence, as its design data names it.

import { ccLicenseId, type ProviderLicense } from "../../services/licenseCatalog";
import { textOfHtml } from "../../utils/htmlEntities";

// Its own licences by the name it sends, dashes and case aside. Its Creative Commons ones come as their parts
// ("BY-NC-SA") and link the 4.0 deeds.
const SITE_LICENSES: Record<string, string> = {
  "standard digital file license": "sdfl",
  "makerworld exclusive license": "makerworld-exclusive",
  "standard digital file license - community use": "makerworld-sdfl-community",
  "standard digital file license - platform print only (sdfl-ppo)": "makerworld-sdfl-ppo",
};

function siteKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function siteLicenseId(name: string): string | null {
  const key = siteKey(name);
  if (SITE_LICENSES[key]) return SITE_LICENSES[key];
  if (/\bsdfl-ppo\b|platform print only/.test(key)) return "makerworld-sdfl-ppo";
  if (/community use|\bsdfl-c\b/.test(key)) return "makerworld-sdfl-community";
  return null;
}

/** Its wording of a site licence, which the design carries with it; the Creative Commons ones come without. */
function siteTerms(design: Record<string, unknown>): string | null {
  const info = design.licenseDescriptionInfo;
  const content = info && typeof info === "object" ? (info as Record<string, unknown>).content : null;
  if (typeof content !== "string" || !content.trim()) return null;
  return textOfHtml(content) || null;
}

/** Undefined when the design doesn't carry the field (the one Grab sends is cut down), so it's read again later. */
export function makerworldLicenseFrom(design: Record<string, unknown>): ProviderLicense | null | undefined {
  if (!("license" in design)) return undefined;
  const raw = typeof design.license === "string" ? design.license.trim() : "";
  if (!raw) return null;
  if (raw.toUpperCase() === "CC0") return { id: "CC0-1.0", raw };
  const site = siteLicenseId(raw);
  if (site) return { id: site, raw, terms: siteTerms(design) };
  const cc = ccLicenseId(raw);
  if (cc) return { id: cc, raw };
  return { id: null, raw, label: raw, terms: siteTerms(design) };
}
