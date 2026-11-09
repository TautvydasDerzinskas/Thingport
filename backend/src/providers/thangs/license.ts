// A Thangs model's licence. Thangs has no list of licences: a designer uploads a file of their own (a .txt or a .pdf),
// and the model names it by its path ("<uuid>/Standard Digital File License.txt"). What it is is read off the file's
// name and its text, which Thangs hands out as text (/v2/models/<id>/license); where both say, they must agree.

import { licenseIdFromText, type ProviderLicense } from "../../services/licenseCatalog";
import { textOfHtml } from "../../utils/htmlEntities";

/** Long enough for a licence's full legal code. */
export const THANGS_TERMS_MAX = 20_000;
// A licence names itself in its first lines; reading further finds other licences it merely mentions.
const TEXT_NAME_CHARS = 400;
const DOCUMENT_EXTENSION = /\.(txt|pdf|md|rtf|docx?|odt|html?)$/i;

/** The file's own name, without the folders Thangs keeps it in or its extension. */
export function thangsLicenseFileName(path: string): string {
  const file = path.split("/").findLast(Boolean) ?? path;
  let name = file;
  try {
    name = decodeURIComponent(file);
  } catch {}
  return name.replace(DOCUMENT_EXTENSION, "").replace(/\s+/g, " ").trim() || file;
}

// File names run words together ("StandardDigitalFileLicense") and use Creative Commons' older spellings
// ("Attribution-NonCommercial-NoDerivs 4.0 International") without saying "Creative Commons".
function idOfName(name: string): string | null {
  const spaced = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_+/g, " ")
    .replace(/no[\s-]?derivs\b/gi, "NoDerivatives");
  const cc =
    /\battribution[\s-]*(?:non[\s-]?commercial|no[\s-]?derivatives|share[\s-]?alike|\d\.0|international)/i.test(
      spaced,
    ) && !/creative commons/i.test(spaced)
      ? `Creative Commons ${spaced}`
      : spaced;
  return licenseIdFromText(cc);
}

/** Plain text, cut to THANGS_TERMS_MAX: some designers upload a licence's web page, which comes as HTML. */
function plain(text: string): string | null {
  const body = /^\s*<(?:!doctype|html)\b/i.test(text) ? textOfHtml(text) : text.replace(/\r\n?/g, "\n");
  const trimmed = body.replace(/\n{3,}/g, "\n\n").trim();
  if (!trimmed) return null;
  return trimmed.length > THANGS_TERMS_MAX ? `${trimmed.slice(0, THANGS_TERMS_MAX - 1).trimEnd()}…` : trimmed;
}

/** Undefined when the model's data doesn't carry the field; null for a model without a licence file. `text`: the
 *  file's text, null when Thangs has none for it. One whose name and text say nothing known allows nothing. */
export function thangsLicenseFrom(path: unknown, text: string | null): ProviderLicense | null | undefined {
  if (path === undefined) return undefined;
  if (typeof path !== "string" || !path.trim()) return null;
  const raw = path.trim();
  const label = thangsLicenseFileName(raw);
  const terms = text ? plain(text) : null;
  const byName = idOfName(label);
  const byText = terms ? idOfName(terms.slice(0, TEXT_NAME_CHARS)) : null;
  // The text is what applies: a licence the file's name gives that its text doesn't bear out isn't vouched for.
  const id = !terms ? byName : byText && (!byName || byName === byText) ? byText : null;
  return id ? { id, raw, label, terms } : { id: null, raw, label, terms, allows: [] };
}
