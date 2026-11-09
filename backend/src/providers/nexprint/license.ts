import type { ProviderLicense } from "../../services/licenseCatalog";

// NexPrint's licences by the number a model's details give (`licenseType`), counted from 0 as its pages count them;
// its links put the Creative Commons ones at 4.0. Its pages show the Standard Digital File License for a model with no
// number, or one they don't know, but that's their fallback rather than anything the model says, so neither gives one.
const LICENSES = [
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "CC-BY-ND-4.0",
  "CC-BY-NC-ND-4.0",
  "CC0-1.0",
  "sdfl",
];

function code(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return typeof value === "string" && /^\d+$/.test(value.trim()) ? String(Number(value)) : null;
}

/** The licence a model's details name; null for none, or a number its pages don't know either. */
export function nexprintLicenseFrom(detail: Record<string, unknown>): ProviderLicense | null {
  const raw = code(detail.licenseType);
  const id = raw === null ? undefined : LICENSES[Number(raw)];
  return raw !== null && id ? { id, raw } : null;
}
