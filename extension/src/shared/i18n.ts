import en from "./locales/en.json";
import ru from "./locales/ru.json";
import uk from "./locales/uk.json";
import be from "./locales/be.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import lt from "./locales/lt.json";

// Runtime catalogs are deliberately independent of WebExtension `_locales`: Chrome does not
// support Belarusian (`be`), while every choice must work in Chrome, Edge and Firefox.

export const LOCALES = ["en", "ru", "uk", "be", "es", "fr", "lt"] as const;
export type Locale = (typeof LOCALES)[number];

export type TranslationValues = Record<string, string | number>;
type Messages = Record<string, string>;

export const catalogs: Record<Locale, Messages> = { en, ru, uk, be, es, fr, lt };
let activeLocale: Locale = "en";

export function detectLocale(languages: readonly string[] = navigator.languages): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if ((LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return "en";
}

export function localeOf(value: unknown, languages?: readonly string[]): Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
    ? (value as Locale)
    : detectLocale(languages);
}

export function setLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getLocale(): Locale {
  return activeLocale;
}

export function translate(locale: Locale, key: string, values: TranslationValues = {}): string {
  const message = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  return message.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}

export function t(key: string, values: TranslationValues = {}): string {
  return translate(activeLocale, key, values);
}

export function applyTranslations(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]"))
    element.textContent = t(element.dataset.i18n!);
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-aria-label]"))
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel!));
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-title]"))
    element.title = t(element.dataset.i18nTitle!);
  for (const element of root.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]"))
    element.placeholder = t(element.dataset.i18nPlaceholder!);
}
