import type { TFunction } from "i18next";

/** "Bea, Dana and Carl", or "Bea, Dana, Carl and 4 more" when `total` is more than the three named: who a collection
 *  is shared with, in the reader's language. */
export function peopleNames(names: string[], total: number, t: TFunction, language: string): string {
  const first = names.slice(0, 3);
  const rest = Math.max(0, total - first.length);
  const shown = rest > 0 ? [...first, t("models:collections.form.andMore", { count: rest })] : first;
  return new Intl.ListFormat(language, { type: "conjunction" }).format(shown);
}
