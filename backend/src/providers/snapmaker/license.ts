import { licenseIdFromUrl, type ProviderLicense } from "../../services/licenseCatalog";
import { textOfHtml } from "../../utils/htmlEntities";

// Snapmaker Space's licences by the id a model's details give (`licenseId`, the licence itself beside it as
// `copyright`), as its public list (`/model/license/list`) has them.
const LICENSES: Record<string, string> = {
  1: "CC-BY-4.0",
  2: "CC-BY-NC-4.0",
  3: "CC-BY-SA-4.0",
  4: "CC-BY-NC-SA-4.0",
  5: "CC-BY-ND-4.0",
  6: "CC-BY-NC-ND-4.0",
  7: "CC0-1.0",
  8: "sdfl",
  9: "snapmaker-only",
};
// Its own two have no page anywhere: their words come with each model.
const SITE_OWN = new Set(["8", "9"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function code(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return typeof value === "string" && /^\d+$/.test(value.trim()) ? value.trim() : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The licence a model's public details name; null for one that names none. */
export function snapmakerLicenseFrom(detail: Record<string, unknown>): ProviderLicense | null {
  const copyright = isRecord(detail.copyright) ? detail.copyright : null;
  const raw = code(detail.licenseId) ?? code(copyright?.id);
  if (!raw) return null;
  const desc = str(copyright?.desc);
  const terms = desc ? textOfHtml(desc) || null : null;
  const id = LICENSES[raw];
  if (id) return { id, raw, ...(SITE_OWN.has(raw) && terms ? { terms } : {}) };
  // One added since: a Creative Commons one by its link, any other by the name and words the site gives it.
  const url = str(copyright?.url);
  return { id: licenseIdFromUrl(url), raw, label: str(copyright?.name), url, terms };
}
