import type * as cheerio from "cheerio";
import { ccLicenseId, licenseIdFromText, type ProviderLicense } from "../../services/licenseCatalog";
import { fetchToymakr3dModelPage, toymakr3dModelFromPage } from "./api";

// Every Toymakr3D model's page shows the same licence card, "CC BY-NC-ND - Attribution - Non Commercial - No
// Derivatives", free and paid alike, linking to its terms of service. Those name the version, 4.0, and add a
// restriction of their own: the files may not be shared anywhere else -- which takes away the sharing CC BY-NC-ND
// would allow.
const TERMS_URL = "https://www.toymakr3d.com/term-of-service";
const TERMS =
  "Additional restriction: you are not allowed to share these files on other websites, or social media other than " +
  "Toymakr3D.com.";

function clean(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

/** A model's licence by its card's name and link; null for a page with no card. */
export function toymakr3dLicense(name: string | null, link: string | null = null): ProviderLicense | null {
  if (!name) return null;
  // The badge first ("CC BY-NC-ND"), then the words after it.
  const code = name.match(/^CC[\s-]+([A-Z]+(?:-[A-Z]+)*)\b/i)?.[1];
  const id = (code ? ccLicenseId(code, "4.0") : null) ?? licenseIdFromText(name);
  return {
    id,
    raw: name,
    ...(id ? {} : { label: name }),
    url: link ?? TERMS_URL,
    terms: TERMS,
    allows: [],
  };
}

/** The licence card on a model's page. */
export function toymakr3dLicenseIn($: cheerio.CheerioAPI): ProviderLicense | null {
  const card = $(".product--layout--standard .product__license .license-card").first();
  return toymakr3dLicense(
    clean(card.find(".license-card__name").first().text()),
    clean(card.find(".license-card__row-content a[href]").first().attr("href")),
  );
}

/** An older import's licence, from its page alone: its details also build the category index. Throws for a model
 *  it no longer shows, which says nothing about its licence. */
export async function readToymakr3dLicense(
  _userId: string,
  modelId: string,
  _stored: { notes: string | null },
): Promise<ProviderLicense | null> {
  const html = await fetchToymakr3dModelPage(modelId);
  const model = html === null ? null : toymakr3dModelFromPage(html, modelId);
  if (!model) throw new Error("This Toymakr3D model can't be found any more, so its licence can't be read.");
  return model.meta.license ?? null;
}
