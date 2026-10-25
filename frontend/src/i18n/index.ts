import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import {
  FALLBACK_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  LOCALES,
  NAMESPACES,
  SUPPORTED_LANGUAGES,
} from "../constants/languages";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: Object.fromEntries(
      Object.entries(LOCALES).map(([code, locale]) => [
        code,
        Object.fromEntries(NAMESPACES.filter((ns) => locale[ns]).map((ns) => [ns, locale[ns]])),
      ]),
    ),
    ns: NAMESPACES,
    defaultNS: "common",
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

export default i18n;
