import { LANGUAGE_FLAGS } from "./languageFlags";

export type Locale = Record<string, Record<string, unknown>>;

// Namespaces by area: "common" (generic words), "app" (shell chrome, modals), "library" (viewer
// overlays and previews), "models" (Models page, model detail, author page), "providers" (each provider's own, by
// its id). A locale may be partial: missing keys fall back to English.
export const NAMESPACES = ["common", "app", "library", "models", "providers"];

/** Every `i18n/locales/<code>.json`, keyed by code: dropping in a file adds the language. */
export const LOCALES: Record<string, Locale> = Object.fromEntries(
  Object.entries(import.meta.glob<Locale>("../i18n/locales/*.json", { eager: true, import: "default" })).map(
    ([path, locale]) => [path.slice(path.lastIndexOf("/") + 1, -".json".length), locale],
  ),
);

export const FALLBACK_LANGUAGE = "en";

// Chromium's ICU data names `be` in English even when asked in Belarusian.
const SELF_LANGUAGE_NAMES: Record<string, string> = { be: "Беларуская" };

function displayName(code: string, inLanguage: string): string {
  if (code === inLanguage && SELF_LANGUAGE_NAMES[code]) return SELF_LANGUAGE_NAMES[code];
  try {
    const name = new Intl.DisplayNames([inLanguage], { type: "language" }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(inLanguage) + name.slice(1);
  } catch {
    return code;
  }
}

export type Language = {
  code: string;
  /** Named in itself ("Lietuvių"), so it's recognisable from any UI language. */
  label: string;
  /** Named in English, for search. */
  englishName: string;
};

// English first, the rest by their own name.
export const SUPPORTED_LANGUAGES: Language[] = Object.keys(LOCALES)
  .map((code) => ({ code, label: displayName(code, code), englishName: displayName(code, "en") }))
  .toSorted((a, b) =>
    a.code === FALLBACK_LANGUAGE ? -1 : b.code === FALLBACK_LANGUAGE ? 1 : a.label.localeCompare(b.label),
  );

const PLURAL = /_(zero|one|two|few|many|other)$/;
// Whole numbers up to 999 and the powers of ten, as `npm run i18n:check` counts: Spanish and French take `many` only
// for 1,000,000 and the like, and a fraction-only form (Lithuanian `many`) isn't asked for.
const SAMPLES = [...Array.from({ length: 1000 }, (_, n) => n), ...Array.from({ length: 10 }, (_, k) => 10 ** (k + 3))];

function leaves(node: unknown, prefix = "", into = new Set<string>()): Set<string> {
  if (node && typeof node === "object")
    for (const [key, value] of Object.entries(node)) leaves(value, prefix ? `${prefix}.${key}` : key, into);
  else into.add(prefix);
  return into;
}

function pluralForms(code: string): string[] {
  const rules = new Intl.PluralRules(code);
  return [...new Set(SAMPLES.map((n) => rules.select(n)))];
}

/**
 * How much of `english` a language's `own` messages translate, 0 to 100, rounded down so only a complete one says 100.
 * A counted word is there once it has every form the language's whole numbers take; a plain English key some
 * languages count (they give it plural forms instead) is there with either.
 */
export function completeness(english: unknown, own: unknown, code: string): number {
  const englishKeys = leaves(english);
  const plurals = new Set([...englishKeys].filter((key) => PLURAL.test(key)).map((key) => key.replace(PLURAL, "")));
  const plain = [...englishKeys].filter((key) => !PLURAL.test(key));
  const ownKeys = leaves(own);
  const ownPlurals = new Set([...ownKeys].filter((key) => PLURAL.test(key)).map((key) => key.replace(PLURAL, "")));
  const forms = pluralForms(code);
  let found = 0;
  for (const key of plain) if (ownKeys.has(key) || ownPlurals.has(key)) found++;
  for (const base of plurals) if (forms.every((form) => ownKeys.has(`${base}_${form}`))) found++;
  const total = plain.length + plurals.size;
  // Nothing to translate is nothing missing.
  return total ? Math.floor((found / total) * 100) : 100;
}

/** How much of English a supported language has translated, 0 to 100. */
export function translatedPercent(code: string): number {
  return LOCALES[code] ? completeness(LOCALES[FALLBACK_LANGUAGE], LOCALES[code], code) : 0;
}

/** The flag file for a language code ("pt-BR" tries "pt-br", then "pt"), or null for one without a flag. */
export function languageFlagUrl(code: string): string | null {
  const lower = code.toLowerCase();
  const flag = LANGUAGE_FLAGS[lower] ?? LANGUAGE_FLAGS[lower.split("-")[0]];
  return flag ? `${import.meta.env.BASE_URL}flags/${flag}.svg` : null;
}

/** The supported language for an i18next language ("pt-BR" falls back to "pt"). */
export function matchLanguage(lng: string | undefined): string {
  if (!lng) return FALLBACK_LANGUAGE;
  const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
  return codes.find((c) => c === lng) ?? codes.find((c) => c === lng.split("-")[0]) ?? FALLBACK_LANGUAGE;
}

export const LANGUAGE_STORAGE_KEY = "thingport_language";
