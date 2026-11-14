import type { ProviderLicense } from "../../services/licenseCatalog";
import { sleep } from "../../utils/concurrency";

// VoxelShare's licences, as its publish form names them: the Creative Commons ones, which its pages link at 4.0, and
// its Standard Digital File License. A model's details give the name (`license`), spelt "CC BY-SA" by the form and
// "CC-BY-SA" on some of the models it copied from other sites.
const LICENSES: Record<string, string> = {
  CC0: "CC0-1.0",
  "CC BY": "CC-BY-4.0",
  "CC BY-SA": "CC-BY-SA-4.0",
  "CC BY-NC": "CC-BY-NC-4.0",
  "CC BY-NC-SA": "CC-BY-NC-SA-4.0",
  "CC BY-ND": "CC-BY-ND-4.0",
  "CC BY-NC-ND": "CC-BY-NC-ND-4.0",
  "STANDARD DIGITAL FILE LICENSE": "sdfl",
};

/** The form's spelling of a name, to look it up by: "CC-BY-SA" and "cc by-sa" are its "CC BY-SA". */
function spelling(value: string): string {
  return value.toUpperCase().replace(/^CC[ -]BY/, "CC BY");
}

/** The licence a model's details name, as its page shows it; null for none. A name not mapped yet is kept as one
 *  Thingport doesn't know, which allows nothing until a mapping names it and the model is read again. */
export function voxelshareLicenseFrom(value: unknown): ProviderLicense | null {
  const raw = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!raw) return null;
  const id = LICENSES[spelling(raw)] ?? null;
  return { id, raw, ...(id ? {} : { label: `VoxelShare licence ${raw}` }) };
}

// An owner going down a list opens models one after another: reads wait this long after the one before.
const READ_GAP_MS = 500;
let lastRead: Promise<unknown> = Promise.resolve();

/** An older import's licence, from its public details alone (not its print profiles too, as `details.read` would),
 *  one read at a time. Null for a model the site no longer has. */
export function readVoxelshareLicense(_userId: string, externalId: string): Promise<ProviderLicense | null> {
  const read = lastRead.then(async () => {
    // Loaded when it's read: the API module reads this one's mapping.
    const { fetchVoxelshareDetail } = await import("./api");
    const detail = await fetchVoxelshareDetail(externalId);
    return detail ? voxelshareLicenseFrom(detail.license) : null;
  });
  lastRead = read.catch(() => undefined).then(() => sleep(READ_GAP_MS));
  return read;
}
