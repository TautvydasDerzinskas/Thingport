// A Cults3D creation's licence, as its API's `license { code name spdxId }` gives it.

import { ccLicenseId, licenseById, licenseIdFromText, type ProviderLicense } from "../../services/licenseCatalog";

// Its codes are the anchors of its licence page (/en/licenses#cults_pu), case and dashes aside. Creative Commons ones
// say 4.0 there; its GNU licences link the 3.0 "or later" texts.
const BY_CODE: Record<string, string> = {
  cults_pu: "cults-pu",
  cults_cu: "cults-cu",
  cults_cu_nd: "cults-cu-nd",
  cc_pddc: "CC0-1.0",
  cc0: "CC0-1.0",
  cern_ohl: "CERN-OHL-1.2",
  gpl: "GPL-3.0",
  lgpl: "LGPL-3.0",
  mit: "MIT",
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function idOfCode(code: string): string | null {
  const key = code.toLowerCase().replace(/[\s-]+/g, "_");
  if (BY_CODE[key]) return BY_CODE[key];
  return key.startsWith("cc_by") ? ccLicenseId(key) : null;
}

// SPDX's "-only" and "-or-later" GNU ids, which the catalogue keeps as one.
function idOfSpdx(spdx: string): string | null {
  return licenseById(spdx)?.id ?? licenseById(spdx.replace(/-(only|or-later)$/i, ""))?.id ?? null;
}

/** Undefined when the read didn't ask for it; null for a creation with none. */
export function cults3dLicenseFrom(license: unknown): ProviderLicense | null | undefined {
  if (license === undefined) return undefined;
  if (!license || typeof license !== "object") return null;
  const record = license as Record<string, unknown>;
  const code = str(record.code);
  const spdx = str(record.spdxId);
  const name = str(record.name);
  const raw = code ?? spdx ?? name;
  if (!raw) return null;
  const id = (code && idOfCode(code)) ?? (spdx && idOfSpdx(spdx)) ?? licenseIdFromText(name);
  return id ? { id, raw } : { id: null, raw, label: name ?? raw };
}
