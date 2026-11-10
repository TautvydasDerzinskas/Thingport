import { useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

/** Print times and amounts in the reader's language: "40 min" and "0,4" in French where English has "40m" and "0.4". */
export type ProfileFormat = {
  duration(seconds: number | null | undefined): string | null;
  grams(grams: number | null | undefined): string | null;
  /** At most `digits` decimals, or exactly that many when `fixed`. */
  number(value: number, digits: number, fixed?: boolean): string;
};

export function profileFormat(t: TFunction, language: string): ProfileFormat {
  const formatters = new Map<string, Intl.NumberFormat>();
  const number = (value: number, digits: number, fixed = false) => {
    const key = `${digits}:${fixed}`;
    let formatter = formatters.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(language, {
        maximumFractionDigits: digits,
        minimumFractionDigits: fixed ? digits : 0,
      });
      formatters.set(key, formatter);
    }
    return formatter.format(value);
  };
  // Cyrillic text takes "г" and "кг". Chromium's ICU has no Belarusian, whose units read as Russian's do.
  const cyrillic = /^(ru|uk|be)(-|$)/i.test(language);
  const unitLanguage = Intl.NumberFormat.supportedLocalesOf([language]).length ? language : "ru";
  const units = new Map<string, Intl.NumberFormat>();
  const unit = (value: number, name: "gram" | "kilogram", digits: number) => {
    let formatter = units.get(`${name}:${digits}`);
    if (!formatter) {
      formatter = new Intl.NumberFormat(unitLanguage, {
        style: "unit",
        unit: name,
        unitDisplay: "short",
        maximumFractionDigits: digits,
        minimumFractionDigits: name === "kilogram" ? digits : 0,
      });
      units.set(`${name}:${digits}`, formatter);
    }
    return formatter.format(value);
  };
  return {
    duration(seconds) {
      if (seconds == null || seconds <= 0) return null;
      const minutes = Math.max(1, Math.round(seconds / 60));
      if (minutes < 60) return t("models:detail.profiles.minutes", { m: minutes });
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return m ? t("models:detail.profiles.hoursMinutes", { h, m }) : t("models:detail.profiles.hours", { h });
    },
    grams(grams) {
      if (grams == null || grams <= 0) return null;
      const value = grams >= 1000 ? grams / 1000 : grams;
      const digits = grams >= 1000 ? 2 : grams < 10 ? 1 : 0;
      if (cyrillic) return unit(value, grams >= 1000 ? "kilogram" : "gram", digits);
      return `${number(value, digits, grams >= 1000)} ${grams >= 1000 ? "kg" : "g"}`;
    },
    number,
  };
}

export function useProfileFormat(): ProfileFormat {
  const { t, i18n } = useTranslation("models");
  const language = i18n.resolvedLanguage ?? i18n.language;
  return useMemo(() => profileFormat(t, language), [t, language]);
}
