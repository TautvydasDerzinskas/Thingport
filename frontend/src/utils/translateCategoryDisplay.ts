import type { i18n as I18n } from "i18next";
import type { Category } from "../api/categories";
import { FALLBACK_LANGUAGE, matchLanguage } from "../constants/languages";

export type CategoryDisplayText = {
  name: string;
  metaTitle: string | null;
  metaDescription: string | null;
};

type DefaultCategoryText = { name: string; metaTitle: string; metaDescription: string };

/** The starter categories are MakerWorld's tree (backend/src/seedData/defaultCategories.ts), so its first id names
 *  their translations. */
function firstMakerworldCatId(category: Category): number | null {
  const first = category.makerworld_cat_ids.split(";")[0]?.trim();
  if (!first) return null;
  const id = Number(first);
  return Number.isFinite(id) ? id : null;
}

/** All locales are always loaded, so English is available as reference text. */
function defaultCategoryText(i18n: I18n, lng: string, id: number): DefaultCategoryText | undefined {
  return i18n.getResourceBundle(lng, "models")?.defaultCategories?.[id];
}

/** Shows the UI language's text for a starter category field only while it still matches the original
 * English verbatim (i.e. the user hasn't edited it). Each field is checked independently. */
export function translateCategoryDisplay(category: Category, i18n: I18n): CategoryDisplayText {
  const stored: CategoryDisplayText = {
    name: category.name,
    metaTitle: category.meta_title,
    metaDescription: category.meta_description,
  };

  const lang = matchLanguage(i18n.language);
  if (lang === FALLBACK_LANGUAGE) return stored;

  const id = firstMakerworldCatId(category);
  if (id === null) return stored;
  const en = defaultCategoryText(i18n, FALLBACK_LANGUAGE, id);
  const local = defaultCategoryText(i18n, lang, id);
  if (!en || !local) return stored;

  return {
    name: category.name === en.name ? local.name : category.name,
    metaTitle: category.meta_title === en.metaTitle ? local.metaTitle : category.meta_title,
    metaDescription:
      category.meta_description === en.metaDescription ? local.metaDescription : category.meta_description,
  };
}
