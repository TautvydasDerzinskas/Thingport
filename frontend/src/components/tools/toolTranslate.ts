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

/** Where a `data-t…` attribute puts its words. Text only: a label is a sentence, never markup. */
const PLACES = [
  ["t", (node: HTMLElement, text: string) => (node.textContent = text)],
  ["tTitle", (node: HTMLElement, text: string) => (node.title = text)],
  ["tAria", (node: HTMLElement, text: string) => node.setAttribute("aria-label", text)],
  ["tPlaceholder", (node: HTMLElement, text: string) => node.setAttribute("placeholder", text)],
] as const;

/**
 * Writes the tool's words into its own HTML, so the markup carries a key where the sentence would be and the
 * script doesn't have to assign each one by hand:
 *
 * ```html
 * <h2 data-t="wall.title">Wall size</h2>
 * <button data-t="parts.copy" data-t-title="parts.copyHint">Copy</button>
 * ```
 *
 * The English left in the markup is what shows if the labels never arrive, and what a reviewer reads. Call it
 * again after adding more markup; running it twice over the same nodes is harmless.
 */
export function applyToolLabels(root: ParentNode, t: ToolTranslate): void {
  for (const [name, put] of PLACES) {
    const attribute = `data-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    root.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach((node) => {
      const key = node.dataset[name];
      if (key) put(node, t(key));
    });
  }
}

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
