import { licenseIdFromText, type ProviderLicense } from "../../services/licenseCatalog";

// A gallery item's `license` is set on its library parts alone, the kits OwlCAD re-hosts: "CC0", "CC-BY" -- every one of
// them from a source that gives CC BY 3.0, the version OwlCAD's string leaves out -- or "MIT". Its community CAD
// projects carry none: what covers them is its terms for publishing to the gallery.
const LICENSES: Record<string, string> = {
  CC0: "CC0-1.0",
  "CC-BY": "CC-BY-3.0",
  MIT: "MIT",
};

/** A gallery item's licence by its `license` and its `type`; null for a library part that says none. */
export function owlcadLicense(item: { license?: string | null; type?: string | null }): ProviderLicense | null {
  const raw = item.license?.trim();
  if (!raw) return item.type === "part" ? null : { id: "owlcad-terms", raw: "" };
  const id = LICENSES[raw] ?? licenseIdFromText(raw);
  return id ? { id, raw } : { id: null, raw, label: raw };
}
