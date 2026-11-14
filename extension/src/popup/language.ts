// The language, at the top of the Appearance tab: a field opening a menu of the browser's language (the default)
// and each catalogue by its own name, with its flag and English name as the web app's picker shows them.

import us from "../assets/flags/US.svg";
import ru from "../assets/flags/RU.svg";
import ua from "../assets/flags/UA.svg";
import by from "../assets/flags/BY.svg";
import es from "../assets/flags/ES.svg";
import fr from "../assets/flags/FR.svg";
import lt from "../assets/flags/LT.svg";
import { detectLocale, t, type Locale } from "../shared/i18n";
import { el, icon } from "./adaptTiles";
import { els } from "./dom";
import { openMenu } from "./menu";

// Names stay as each language writes itself, whatever Grab is in.
const LANGUAGES: { code: Locale; name: string; english: string; flag: string }[] = [
  { code: "en", name: "English", english: "English", flag: us },
  { code: "ru", name: "Русский", english: "Russian", flag: ru },
  { code: "uk", name: "Українська", english: "Ukrainian", flag: ua },
  { code: "be", name: "Беларуская", english: "Belarusian", flag: by },
  { code: "es", name: "Español", english: "Spanish", flag: es },
  { code: "fr", name: "Français", english: "French", flag: fr },
  { code: "lt", name: "Lietuvių", english: "Lithuanian", flag: lt },
];

const GLOBE = [
  "M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0",
  "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",
  "M2 12h20",
];
const CHEVRON_DOWN = ["m6 9 6 6 6-6"];

const languageOf = (code: Locale) => LANGUAGES.find((language) => language.code === code) ?? LANGUAGES[0];

function flagOf(code: Locale): HTMLImageElement {
  const img = el("img", "flag");
  img.src = `data:image/svg+xml,${encodeURIComponent(languageOf(code).flag)}`;
  img.alt = "";
  return img;
}

const globe = () => el("span", "globe", icon(GLOBE));

/** The saved choice: null follows the browser. */
let choice: Locale | null = null;
let onChoose: (choice: Locale | null) => void = () => undefined;

/** Draws the field for `chosen`, in the language now shown. */
export function renderLanguage(chosen: Locale | null): void {
  choice = chosen;
  const name = chosen ? languageOf(chosen).name : t("languageBrowser");
  // Beside a language its English name, beside the browser's the language that is.
  const hint = chosen ? languageOf(chosen).english : languageOf(detectLocale()).name;
  els.languageTrigger.replaceChildren(
    chosen ? flagOf(chosen) : globe(),
    el("span", "field-select__value", name),
    ...(hint === name ? [] : [el("span", "field-select__hint", hint)]),
    el("span", "field-select__chevron", icon(CHEVRON_DOWN)),
  );
}

/** `choose` runs with the new choice once one is picked. */
export function setUpLanguage(choose: (choice: Locale | null) => void): void {
  onChoose = choose;
  const field = els.languageTrigger;
  field.addEventListener("click", () => {
    field.setAttribute("aria-expanded", "true");
    const pick = (next: Locale | null) => () => {
      if (next !== choice) onChoose(next);
    };
    openMenu(
      field,
      t("language"),
      [
        {
          label: t("languageBrowser"),
          hint: languageOf(detectLocale()).name,
          icon: globe(),
          checked: choice === null,
          select: pick(null),
        },
        "separator",
        ...LANGUAGES.map((language) => ({
          label: language.name,
          hint: language.english === language.name ? undefined : language.english,
          icon: flagOf(language.code),
          checked: choice === language.code,
          select: pick(language.code),
        })),
      ],
      { width: field.offsetWidth, onClose: () => field.setAttribute("aria-expanded", "false") },
    );
  });
  field.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    field.click();
  });
}
