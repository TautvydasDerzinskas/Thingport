import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import be from "../../i18n/locales/be.json";
import ru from "../../i18n/locales/ru.json";
import uk from "../../i18n/locales/uk.json";
import es from "../../i18n/locales/es.json";
import fr from "../../i18n/locales/fr.json";
import lt from "../../i18n/locales/lt.json";

type Category = "one" | "few" | "many";
type Forms = Record<string, Record<Category, string>>;

const counts = [0, 1, 2, 5, 11, 21, 22, 25] as const;
const categoryForCount: Record<(typeof counts)[number], Category> = {
  0: "many",
  1: "one",
  2: "few",
  5: "many",
  11: "many",
  21: "one",
  22: "few",
  25: "many",
};

const locales = { ru, uk, be };
type Language = keyof typeof locales;

const fixtures: Record<Language, { pickerLabels: Record<string, string>; forms: Forms }> = {
  ru: {
    pickerLabels: {
      "dashboard.collectionCount.label": "Коллекции",
      "dashboard.modelCount.label": "Модели",
      "dashboard.authorCount.label": "Уникальные авторы",
      "dashboard.categoryCount.label": "Категории и папки",
    },
    forms: {
      "dashboard.collectionCount.count": { one: "коллекция", few: "коллекции", many: "коллекций" },
      "dashboard.modelCount.count": { one: "модель", few: "модели", many: "моделей" },
      "dashboard.authorCount.count": { one: "уникальный автор", few: "уникальных автора", many: "уникальных авторов" },
      "dashboard.categoryCount.count": {
        one: "категория или папка",
        few: "категории или папки",
        many: "категорий или папок",
      },
      "dashboard.topAuthors.modelCount": {
        one: "{{count}} модель",
        few: "{{count}} модели",
        many: "{{count}} моделей",
      },
      "dashboard.topProviders.modelCount": {
        one: "{{count}} модель",
        few: "{{count}} модели",
        many: "{{count}} моделей",
      },
      "dashboard.viewCount": { one: "{{count}} просмотр", few: "{{count}} просмотра", many: "{{count}} просмотров" },
      "dashboard.printCount": { one: "{{count}} печать", few: "{{count}} печати", many: "{{count}} печатей" },
    },
  },
  uk: {
    pickerLabels: {
      "dashboard.collectionCount.label": "Колекції",
      "dashboard.modelCount.label": "Моделі",
      "dashboard.authorCount.label": "Унікальні автори",
      "dashboard.categoryCount.label": "Категорії та папки",
    },
    forms: {
      "dashboard.collectionCount.count": { one: "колекція", few: "колекції", many: "колекцій" },
      "dashboard.modelCount.count": { one: "модель", few: "моделі", many: "моделей" },
      "dashboard.authorCount.count": { one: "унікальний автор", few: "унікальні автори", many: "унікальних авторів" },
      "dashboard.categoryCount.count": {
        one: "категорія або папка",
        few: "категорії або папки",
        many: "категорій або папок",
      },
      "dashboard.topAuthors.modelCount": {
        one: "{{count}} модель",
        few: "{{count}} моделі",
        many: "{{count}} моделей",
      },
      "dashboard.topProviders.modelCount": {
        one: "{{count}} модель",
        few: "{{count}} моделі",
        many: "{{count}} моделей",
      },
      "dashboard.viewCount": { one: "{{count}} перегляд", few: "{{count}} перегляди", many: "{{count}} переглядів" },
      "dashboard.printCount": { one: "{{count}} друк", few: "{{count}} друки", many: "{{count}} друків" },
    },
  },
  be: {
    pickerLabels: {
      "dashboard.collectionCount.label": "Калекцыі",
      "dashboard.modelCount.label": "Мадэлі",
      "dashboard.authorCount.label": "Унікальныя аўтары",
      "dashboard.categoryCount.label": "Катэгорыі і папкі",
    },
    forms: {
      "dashboard.collectionCount.count": { one: "калекцыя", few: "калекцыі", many: "калекцый" },
      "dashboard.modelCount.count": { one: "мадэль", few: "мадэлі", many: "мадэляў" },
      "dashboard.authorCount.count": { one: "унікальны аўтар", few: "унікальныя аўтары", many: "унікальных аўтараў" },
      "dashboard.categoryCount.count": {
        one: "катэгорыя або папка",
        few: "катэгорыі або папкі",
        many: "катэгорый або папак",
      },
      "dashboard.topAuthors.modelCount": {
        one: "{{count}} мадэль",
        few: "{{count}} мадэлі",
        many: "{{count}} мадэляў",
      },
      "dashboard.topProviders.modelCount": {
        one: "{{count}} мадэль",
        few: "{{count}} мадэлі",
        many: "{{count}} мадэляў",
      },
      "dashboard.viewCount": { one: "{{count}} прагляд", few: "{{count}} прагляды", many: "{{count}} праглядаў" },
      "dashboard.printCount": { one: "{{count}} друк", few: "{{count}} друкі", many: "{{count}} друкаў" },
    },
  },
};

describe("dashboard count labels", () => {
  it.each(Object.entries({ es, fr, lt }))("uses %s labels instead of English fallback", async (language, locale) => {
    const i18n = createInstance();
    await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: locale.app } } });
    for (const name of ["collectionCount", "modelCount", "authorCount", "categoryCount"]) {
      for (const count of [1, 2, 5, 21, 1000000]) {
        expect(i18n.exists(`dashboard.${name}.count`, { count, lng: language })).toBe(true);
      }
    }
  });
  for (const language of Object.keys(fixtures) as Language[]) {
    const fixture = fixtures[language];
    it(`declines ${language} dashboard counts without changing picker labels`, async () => {
      const i18n = createInstance();
      await i18n.init({
        lng: language,
        fallbackLng: false,
        defaultNS: "app",
        resources: { [language]: { app: locales[language].app } },
      });
      const t = i18n.getFixedT(language, "app");

      for (const [key, label] of Object.entries(fixture.pickerLabels)) expect(t(key)).toBe(label);
      for (const count of counts) {
        for (const [key, forms] of Object.entries(fixture.forms)) {
          expect(t(key, { count })).toBe(forms[categoryForCount[count]].replace("{{count}}", String(count)));
        }
      }
    });
  }
});
