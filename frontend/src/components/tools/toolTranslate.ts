// A tool's own words.
//
// A tool's labels don't belong in its script: buried there they can't be reviewed as text, can't be handed to a
// translator, and can't be added to without touching the logic. So they live beside it as `locales/<code>.json`,
// a flat map of key to sentence, and Thingport hands the tool a `t()` that reads the one matching the user's
// language.
//
// Falling back is key by key rather than file by file: a half-finished translation shows its own words where it
// has them and English where it doesn't, instead of going all-English at the first gap.

import type { ToolLocales } from "../../api/tools";

/** What a tool calls to turn a key into words. `t("rings.ring", { n: 2 })` fills `{n}` in. */
export type ToolTranslate = (key: string, vars?: Record<string, unknown>) => string;

const FALLBACK = "en";

/**
 * `t` for one tool in one language. A key with no words anywhere comes back as itself, so a label that was never
 * written shows up in the window rather than leaving a blank.
 */
export function toolTranslator(locales: ToolLocales, language: string): ToolTranslate {
  // "pt-BR" takes the tool's "pt" where it has no "pt-BR" of its own.
  const chosen = locales[language] ?? locales[language.split("-")[0]] ?? {};
  const fallback = locales[FALLBACK] ?? {};
  return (key, vars) => {
    const text = chosen[key] ?? fallback[key] ?? key;
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in vars ? String(vars[name as keyof typeof vars]) : whole,
    );
  };
}
