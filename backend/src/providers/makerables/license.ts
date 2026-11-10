import { licenseIdFromText, licenseIdFromUrl, type ProviderLicense } from "../../services/licenseCatalog";
import { asRecord, asText } from "../../services/trendingModel";

// A project's `license` is one of the seven its /licenses list offers, each a Creative Commons 4.0 licence or CC0,
// by a code of its own: {id, name: "CC BY-NC-SA 4.0", code: "cc_by_nc_sa", description, thumbnail, link}.
const LICENSES: Record<string, string> = {
  cc_0: "CC0-1.0",
  cc_by: "CC-BY-4.0",
  cc_by_sa: "CC-BY-SA-4.0",
  cc_by_nd: "CC-BY-ND-4.0",
  cc_by_nc: "CC-BY-NC-4.0",
  cc_by_nc_sa: "CC-BY-NC-SA-4.0",
  cc_by_nc_nd: "CC-BY-NC-ND-4.0",
};

/** A project's licence from its `license`; null when it has none. A code it adds later is read by its link or name. */
export function makerablesLicense(value: unknown): ProviderLicense | null {
  const license = asRecord(value);
  const code = asText(license?.code);
  const name = asText(license?.name);
  const link = asText(license?.link);
  const raw = code ?? name;
  if (!raw) return null;
  const id = (code ? LICENSES[code] : undefined) ?? licenseIdFromUrl(link) ?? licenseIdFromText(name);
  if (id) return { id, raw };
  return { id: null, raw, label: name ?? code, ...(link ? { url: link } : {}) };
}
