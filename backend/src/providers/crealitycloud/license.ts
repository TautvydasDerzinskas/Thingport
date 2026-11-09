import { licenseById, licenseIdFromText, type ProviderLicense } from "../../services/licenseCatalog";

// Creality Cloud names a model's licence in its details (`license`), as its upload form offers them; "CXY-SL" is its
// own Standard License, the one the form starts on. Its links put the Creative Commons ones at 4.0.
const LICENSES: Record<string, string> = {
  "CC BY": "CC-BY-4.0",
  "CC BY-SA": "CC-BY-SA-4.0",
  "CC BY-NC": "CC-BY-NC-4.0",
  "CC BY-NC-SA": "CC-BY-NC-SA-4.0",
  "CC BY-ND": "CC-BY-ND-4.0",
  "CC BY-NC-ND": "CC-BY-NC-ND-4.0",
  CC0: "CC0-1.0",
  "CXY-SL": "crealitycloud-standard",
};
// What its page adds under the licence of a model for its members or exclusive to it, whatever the licence says.
const DESIGNER_ONLY = "Copyright is owned by the designer. Non-commercial use only.";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The licence a model's details (`groupItem`) name; null for none. One not mapped yet is kept by its name, as one
 *  Thingport doesn't know, which allows nothing until a mapping names it and the model is read again. */
export function crealitycloudLicenseFrom(groupItem: Record<string, unknown>): ProviderLicense | null {
  const raw = str(groupItem.license);
  if (!raw) return null;
  const id = LICENSES[raw.toUpperCase().replace(/\s+/g, " ")] ?? licenseIdFromText(raw);
  if (!groupItem.isVip && !groupItem.isExclusive) return { id, raw };
  const allows = licenseById(id)?.allows ?? [];
  return {
    id,
    raw,
    terms: DESIGNER_ONLY,
    ...(allows.includes("commercial") ? { allows: allows.filter((action) => action !== "commercial") } : {}),
  };
}

/** An older import's licence, from its details alone: the print profiles the import also reads say nothing of it.
 *  Null for a model the site no longer has. */
export async function readCrealitycloudLicense(_userId: string, externalId: string): Promise<ProviderLicense | null> {
  // Loaded when it's read: the API module reads this one's mapping.
  const { fetchCrealitycloudGroupItem } = await import("./api");
  const groupItem = await fetchCrealitycloudGroupItem(externalId);
  return groupItem ? crealitycloudLicenseFrom(groupItem) : null;
}
