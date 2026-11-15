import { localeOf, translate, type TranslationValues } from "../shared/i18n";
import { STORAGE_KEYS } from "../shared/storage";

/** Background errors can outlive a page, so take their locale from storage rather than a DOM global. */
export async function backgroundText(key: string, values: TranslationValues = {}): Promise<string> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.locale);
    return translate(localeOf(stored[STORAGE_KEYS.locale], globalThis.navigator?.languages ?? []), key, values);
  } catch {
    return translate("en", key, values);
  }
}
