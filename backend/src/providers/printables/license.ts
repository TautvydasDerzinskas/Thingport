// A Printables model's licence, as its API's `license { id name abbreviation content }` gives it.

import { licenseIdFromText, licenseIdFromUrl, type ProviderLicense } from "../../services/licenseCatalog";
import { textOfHtml } from "../../utils/htmlEntities";

// Its licences by id, from its own list (the API's `licenses`). Creative Commons ones link the 4.0 deeds.
const BY_ID: Record<string, string> = {
  "7": "CC0-1.0",
  "1": "CC-BY-4.0",
  "2": "CC-BY-SA-4.0",
  "8": "CC-BY-ND-4.0",
  "3": "CC-BY-NC-4.0",
  "4": "CC-BY-NC-SA-4.0",
  "6": "CC-BY-NC-ND-4.0",
  "9": "GPL-2.0",
  "12": "GPL-3.0",
  "10": "LGPL-3.0",
  "11": "BSD-2-Clause",
  "13": "sdfl",
  "14": "printables-commercial-nd",
  "15": "printables-commercial",
  "16": "OCL-1.0",
  "17": "OCL-1.1",
  "18": "CERN-OHL-S-2.0",
  "24": "Apache-2.0",
};
// The Open Community License v1.1 with its add-ons (attribution, R&D only, small business only), which the catalogue
// has no ids for: shown by Printables' own name and wording.
const OCL_ADD_ONS = new Set(["19", "20", "21", "22", "23"]);
// Its own licences, whose wording it sends with each model.
const OWN_WORDING = new Set(["13", "14", "15"]);

function str(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function wording(content: string | null): string | null {
  return content ? textOfHtml(content) || null : null;
}

/** Undefined when the read didn't ask for it; null for a model with none, as Club models answer anyone. */
export function printablesLicenseFrom(license: unknown): ProviderLicense | null | undefined {
  if (license === undefined) return undefined;
  if (!license || typeof license !== "object") return null;
  const record = license as Record<string, unknown>;
  const raw = str(record.id);
  const name = str(record.name);
  const content = str(record.content);
  if (!raw) return null;
  // The General Attribution add-on asks for credit, which OCL alone doesn't.
  if (OCL_ADD_ONS.has(raw)) {
    return {
      id: "OCL-1.1",
      raw,
      label: name,
      terms: wording(content),
      ...(/GAtt|General Attribution/i.test(`${name ?? ""} ${str(record.abbreviation) ?? ""}`)
        ? { requires: { credit: true } }
        : {}),
    };
  }
  const known = BY_ID[raw];
  if (known) return OWN_WORDING.has(raw) ? { id: known, raw, terms: wording(content) } : { id: known, raw };
  // One added since: by its link, else its name.
  const href = content?.match(/href="([^"]+)"/)?.[1] ?? null;
  const id = licenseIdFromUrl(href) ?? licenseIdFromText(name);
  return id ? { id, raw } : { id: null, raw, label: name, terms: wording(content) };
}
