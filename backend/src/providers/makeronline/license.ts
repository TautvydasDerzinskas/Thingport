import type { ProviderLicense } from "../../services/licenseCatalog";

// MakerOnline's licences by the number a model's details give (`license`), as its pages name and link them. Not the
// order other sites number them in: 2 is ShareAlike here and 3 NonCommercial. The text of its Standard Digital File
// License is in its pages, not in the details.
const LICENSES: Record<string, string> = {
  1: "CC-BY-4.0",
  2: "CC-BY-SA-4.0",
  3: "CC-BY-NC-4.0",
  4: "CC-BY-NC-SA-4.0",
  5: "CC-BY-ND-4.0",
  6: "CC-BY-NC-ND-4.0",
  7: "CC0-1.0",
  8: "sdfl",
};

function code(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && /^\d+$/.test(value.trim()) ? value.trim() : null;
}

/** The licence a model's details name; null for none (0). A number not mapped yet is kept as one Thingport doesn't
 *  know, which allows nothing until a mapping names it and the model is read again. */
export function makeronlineLicenseFrom(detail: Record<string, unknown>): ProviderLicense | null {
  const raw = code(detail.license);
  if (!raw || Number(raw) === 0) return null;
  return { id: LICENSES[raw] ?? null, raw, ...(LICENSES[raw] ? {} : { label: `MakerOnline licence ${raw}` }) };
}
