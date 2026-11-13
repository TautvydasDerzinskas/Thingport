import type { ProviderLicense } from "../../services/licenseCatalog";
import { sleep } from "../../utils/concurrency";

// QIDI Maker's licences, as its publish form names them: the Creative Commons ones, which its pages link at 4.0, and
// its Standard Digital File License, worded as the others' is. A model's details give its code (`license`) and the
// four answers the form takes it from, which its page reads the licence from: whether adaptations may be shared (0
// yes, 1 no, 2 under the same licence), commercial use (0 yes, 1 no), redistribution (0 yes, 1 no) and attribution
// (0 not needed, 1 needed).
const LICENSES: Record<string, string> = {
  CC0: "CC0-1.0",
  BY: "CC-BY-4.0",
  "BY-SA": "CC-BY-SA-4.0",
  "BY-NC": "CC-BY-NC-4.0",
  "BY-NC-SA": "CC-BY-NC-SA-4.0",
  "BY-ND": "CC-BY-ND-4.0",
  "BY-NC-ND": "CC-BY-NC-ND-4.0",
  STANDARD: "sdfl",
};

/** Each code's answers, in the order adaptedShared, commercialUse, redistribute, attributionShare. */
const ANSWERS: Record<string, string> = {
  "0000": "CC0",
  "0001": "BY",
  "0101": "BY-NC",
  "2001": "BY-SA",
  "2101": "BY-NC-SA",
  "1001": "BY-ND",
  "1101": "BY-NC-ND",
  "1111": "STANDARD",
};

const FIELDS = ["adaptedShared", "commercialUse", "redistribute", "attributionShare"] as const;

/** The code the four answers make, as the model's page reads them; null where one is missing or they make none. */
function codeFromAnswers(detail: Record<string, unknown>): string | null {
  const answers = FIELDS.map((field) => detail[field]);
  if (!answers.every((answer) => typeof answer === "number" && Number.isInteger(answer))) return null;
  return ANSWERS[answers.join("")] ?? null;
}

/** The licence a model's details name, as its page shows it; null for none. A code not mapped yet is kept as one
 *  Thingport doesn't know, which allows nothing until a mapping names it and the model is read again. */
export function qidimakerLicenseFrom(detail: Record<string, unknown>): ProviderLicense | null {
  const code = typeof detail.license === "string" ? detail.license.trim().toUpperCase() : "";
  const raw = codeFromAnswers(detail) ?? code;
  if (!raw) return null;
  const id = LICENSES[raw] ?? null;
  return { id, raw, ...(id ? {} : { label: `QIDI Maker licence ${raw}` }) };
}

// An owner going down a list opens models one after another: reads wait this long after the one before.
const READ_GAP_MS = 500;
let lastRead: Promise<unknown> = Promise.resolve();

/** An older import's licence, from its public details alone (not its print profiles too, as `details.read` would),
 *  one read at a time. Null for a model the site no longer has. */
export function readQidimakerLicense(_userId: string, externalId: string): Promise<ProviderLicense | null> {
  const read = lastRead.then(async () => {
    // Loaded when it's read: the API module reads this one's mapping.
    const { fetchQidimakerDetail } = await import("./api");
    const detail = await fetchQidimakerDetail(externalId);
    return detail ? qidimakerLicenseFrom(detail) : null;
  });
  lastRead = read.catch(() => undefined).then(() => sleep(READ_GAP_MS));
  return read;
}
