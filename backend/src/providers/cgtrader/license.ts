import type { ProviderLicense } from "../../services/licenseCatalog";
import { textOfHtml } from "../../utils/htmlEntities";
import { resolveCgtraderModel } from "./api";
import { getUserCgtraderSession } from "./session";

// A model page's pricing area names its licence by a key of CGTrader's own. Free models get the "no AI" ones, paid
// models the others; editorial_royalty_free is an older key its pages still show as Royalty Free.
const LICENSES: Record<string, string> = {
  royalty_free: "cgtrader-royalty-free",
  royalty_free_no_ai: "cgtrader-royalty-free-no-ai",
  editorial_royalty_free: "cgtrader-royalty-free",
  editorial: "cgtrader-editorial",
  editorial_no_ai: "cgtrader-editorial-no-ai",
  custom: "cgtrader-custom",
  custom_no_ai: "cgtrader-custom-no-ai",
};

const CUSTOM = new Set(["custom", "custom_no_ai"]);

// What its server writes in `customLicense` for a licence of its own rather than the designer's words: a summary
// ("Content published with the … label may not be sold …"), the generic line about custom licences, or a
// "translation missing" stand-in for one it has no summary of.
const SUMMARIES = [/^Content published with the\b/i, /^Custom License allows uses of the product as specified by/i];

/** A custom licence's own words, as plain text; null for one of the server's summaries. */
function customTerms(html: string | null | undefined): string | null {
  if (!html || /\btranslation_missing\b/.test(html)) return null;
  const text = textOfHtml(html);
  return text && !SUMMARIES.some((summary) => summary.test(text)) ? text : null;
}

/** A model's licence from its pricing area's `license` key, and `customLicense` for a custom one's terms; null when it
 *  names none. A key it adds later keeps its raw value. */
export function cgtraderLicense(key: string | null | undefined, customLicense?: string | null): ProviderLicense | null {
  const raw = key?.trim();
  if (!raw) return null;
  const id = LICENSES[raw] ?? null;
  const terms = CUSTOM.has(raw) ? customTerms(customLicense) : null;
  return {
    id,
    raw,
    ...(id ? {} : { label: raw.replace(/_/g, " ") }),
    ...(terms ? { terms } : {}),
  };
}

// How imports before the licence had a field of its own wrote it, as a row of the description's "Model details":
// "- **License:** Royalty free". A key without a label here was written with its underscores as spaces.
const LABELS: Record<string, string> = {
  "royalty free": "royalty_free",
  "royalty free, not for ai training": "royalty_free_no_ai",
  "editorial use only": "editorial",
  custom: "custom",
};

/** The licence key an older import's description named; null when it names none. */
export function cgtraderLicenseKeyFromNotes(notes: string | null): string | null {
  const label = notes?.match(/^\s*-\s*\*\*License:\*\*\s*(.+?)\s*$/m)?.[1];
  if (!label) return null;
  const lower = label.toLowerCase();
  return LABELS[lower] ?? lower.replace(/\s+/g, "_");
}

/** An older import's licence: from what its description says, which needs no request past CGTrader's bot check --
 *  except a custom licence, whose terms only its page has. Its page otherwise, which needs the check's token. */
export async function readCgtraderLicense(
  userId: string,
  slug: string,
  stored: { notes: string | null },
): Promise<ProviderLicense | null> {
  const key = cgtraderLicenseKeyFromNotes(stored.notes);
  const fromNotes = key ? cgtraderLicense(key) : null;
  if (fromNotes && !CUSTOM.has(key!)) return fromNotes;
  try {
    const model = await resolveCgtraderModel(slug, await getUserCgtraderSession(userId));
    if (!model) throw new Error("This CGTrader model can't be found any more, so its licence can't be read.");
    return model.meta.license ?? null;
  } catch (err) {
    // A custom licence without its terms is still the licence.
    if (fromNotes) return fromNotes;
    throw err;
  }
}
