import type * as cheerio from "cheerio";
import { licenseById, licenseIdFromText, licenseIdFromUrl, type ProviderLicense } from "../../services/licenseCatalog";
import { fetchPinshapeModelPage, pinshapeModelFromPage } from "./api";

// Every Pinshape model carries one of seven Creative Commons licences -- its browse filter's Attribution, Attribution
// ShareAlike, Attribution Non-Commercial, Attribution Non-Commercial ShareAlike, Attribution No Derivatives,
// Attribution Non-Commercial No Derivatives, and Public Domain -- shown on its page as a card that links to the licence.
// The link is what says it, the 4.0 version included; the card's name and badge are read where it has none.

type Card = { url: string | null; name: string | null; short: string | null };

function clean(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

/** A model's licence from its card's link, short name ("CC BY-NC-SA") and long one; null when there's no card. */
export function pinshapeLicense(card: Card): ProviderLicense | null {
  const raw = card.url ?? card.short ?? card.name;
  if (!raw) return null;
  const id = licenseIdFromUrl(card.url) ?? licenseIdFromText(card.short) ?? licenseIdFromText(card.name);
  const known = licenseById(id);
  return {
    id: known?.id ?? null,
    raw,
    // A licence Thingport doesn't know is shown by the site's own name for it.
    ...(known ? {} : { label: card.name ?? card.short }),
    ...(card.url && card.url !== known?.url ? { url: card.url } : {}),
  };
}

/** The licence card in a model's page's `scope`: the one that links to a licence, or shows the site's licence badge. */
export function pinshapeLicenseIn($: cheerio.CheerioAPI, scope: string): ProviderLicense | null {
  const main = $(scope).first();
  const badge = main.find('img[src*="/static/images/licenses/"]').first();
  const link = main.find('a[href*="creativecommons.org"]').first();
  const card = (badge.length ? badge : link).closest(".card");
  if (!card.length) return null;
  return pinshapeLicense({
    url: clean(card.find('a[href*="creativecommons.org"]').first().attr("href")),
    name: clean(card.find("h6").first().text()),
    short: clean(card.find('img[src*="/static/images/licenses/"]').first().attr("alt")),
  });
}

/** An older import's licence, from its page alone: no tags call, unlike its details. Throws for a model it no longer
 *  shows, which says nothing about its licence. */
export async function readPinshapeLicense(
  _userId: string,
  modelId: string,
  _stored: { notes: string | null },
): Promise<ProviderLicense | null> {
  const html = await fetchPinshapeModelPage(modelId);
  const model = html === null ? null : pinshapeModelFromPage(html, modelId);
  if (!model) throw new Error("This Pinshape model can't be found any more, so its licence can't be read.");
  return model.meta.license ?? null;
}
