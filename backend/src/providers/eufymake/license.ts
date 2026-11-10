import type { ProviderLicense } from "../../services/licenseCatalog";
import { sleep } from "../../utils/concurrency";

// eufyMake's licences by the number a model's details give (`license`), as its pages name and link them: 1 is CC0, then
// Creative Commons' six at 4.0, then its own Private Use. 0, or none, is a model its page shows no licence for.
const LICENSES: Record<string, string> = {
  1: "CC0-1.0",
  2: "CC-BY-4.0",
  3: "CC-BY-SA-4.0",
  4: "CC-BY-ND-4.0",
  5: "CC-BY-NC-4.0",
  6: "CC-BY-NC-SA-4.0",
  7: "CC-BY-NC-ND-4.0",
  8: "eufymake-private",
};

// The site answers a burst of more than a few calls a second with a 429, and an owner going down a list opens models
// faster than that: reads wait this long after the one before.
const READ_GAP_MS = 700;

function code(value: unknown): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  return typeof value === "string" && /^\d+$/.test(value.trim()) ? String(Number(value)) : null;
}

/** The licence a model's details name; null for none (0). A number not mapped yet is kept as one Thingport doesn't
 *  know, which allows nothing until a mapping names it and the model is read again. */
export function eufymakeLicenseFrom(model: Record<string, unknown>): ProviderLicense | null {
  const raw = code(model.license);
  if (!raw || raw === "0") return null;
  return { id: LICENSES[raw] ?? null, raw, ...(LICENSES[raw] ? {} : { label: `eufyMake licence ${raw}` }) };
}

let lastRead: Promise<unknown> = Promise.resolve();

/** An older import's licence, from its public details, one read at a time. Null for a model the site no longer has. */
export function readEufymakeLicense(_userId: string, externalId: string): Promise<ProviderLicense | null> {
  const read = lastRead.then(async () => {
    // Loaded when it's read: the API module reads this one's mapping.
    const { fetchEufymakeModel } = await import("./api");
    const model = await fetchEufymakeModel(externalId);
    return model ? eufymakeLicenseFrom(model) : null;
  });
  lastRead = read.catch(() => undefined).then(() => sleep(READ_GAP_MS));
  return read;
}
