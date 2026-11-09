// A Thing's licence: its API names it ("Creative Commons - Attribution - Non-Commercial"); its public page links it,
// in the page's structured data.

import { licenseById, licenseIdFromText, licenseIdFromUrl, type ProviderLicense } from "../../services/licenseCatalog";

// Its upload codes (cc, cc-sa, cc-nd, cc-nc, cc-nc-sa, cc-nc-nd, pd0, gpl, lgpl, bsd) come back as names. The Creative
// Commons ones carry no version; its pages link the 4.0 deeds, and GNU - GPL the GPL 3.0. Older Things may say
// "Attribution - …" without "Creative Commons", or plain "Public Domain".
function idOfName(name: string): string | null {
  const cc = /\battribution\b/i.test(name) && !/creative commons/i.test(name) ? `Creative Commons ${name}` : name;
  return licenseIdFromText(cc);
}

/** From the API's Thing. Null for one that names none; undefined for a read without the field. */
export function thingiverseLicenseFrom(thing: Record<string, unknown>): ProviderLicense | null | undefined {
  if (!("license" in thing)) return undefined;
  const raw = typeof thing.license === "string" ? thing.license.trim() : "";
  if (!raw) return null;
  const id = idOfName(raw);
  if (!id) return { id: null, raw, label: raw };
  // A Thing whose creator turned remixing off, where the licence alone would allow it.
  const allows = licenseById(id)?.allows ?? [];
  if (thing.allows_derivatives === false && allows.includes("remix")) {
    return { id, raw, allows: allows.filter((action) => action !== "remix") };
  }
  return { id, raw };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** From a Thing's public page: the link in its structured data (a Product, whose page's CreativeWork has it). Null for
 *  a page that links none; undefined for one without the data at all, such as the page for a Thing it doesn't have. */
export function thingiverseLicenseFromPage(html: string): ProviderLicense | null | undefined {
  let found = false;
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    for (const item of Array.isArray(data) ? data : [data]) {
      const product = record(item);
      if (product?.["@type"] !== "Product") continue;
      found = true;
      const url = record(product.mainEntityOfPage)?.license ?? product.license;
      if (typeof url !== "string" || !url.trim()) continue;
      const raw = url.trim();
      const id = licenseIdFromUrl(raw);
      return id ? { id, raw } : { id: null, raw, url: raw };
    }
  }
  return found ? null : undefined;
}
