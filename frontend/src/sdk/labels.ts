// The words a widget or a tool shows, in the user's language.
//
// They don't belong in the script: buried there they can't be reviewed as text, can't be handed to a translator,
// and can't be added to without touching the logic. So they live beside it as `locales/<code>.json`, a flat map of
// key to sentence, and Thingport hands the script a `t()` that reads the one matching the user's language.
//
// Falling back is key by key rather than file by file: a half-finished translation shows its own words where it
// has them and English where it doesn't, instead of going all-English at the first gap.

/** Every language something has, by code: `{ "en": { "save.title": "Save" } }`. */
export type Locales = Record<string, Record<string, string>>;

/** What a script calls to turn a key into words. `t("rings.ring", { n: 2 })` fills `{n}` in. */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** Where a `data-t…` attribute puts its words. Text only: a label is a sentence, never markup. */
const PLACES = [
  ["t", (node: HTMLElement, text: string) => (node.textContent = text)],
  ["tTitle", (node: HTMLElement, text: string) => (node.title = text)],
  ["tAria", (node: HTMLElement, text: string) => node.setAttribute("aria-label", text)],
  ["tPlaceholder", (node: HTMLElement, text: string) => node.setAttribute("placeholder", text)],
] as const;

/**
 * Writes the words into the widget's or tool's own HTML, so the markup carries a key where the sentence would be
 * and the script doesn't have to assign each one by hand:
 *
 * ```html
 * <h2 data-t="wall.title">Wall size</h2>
 * <button data-t="parts.copy" data-t-title="parts.copyHint">Copy</button>
 * ```
 *
 * The English left in the markup is what shows if the labels never arrive, and what a reviewer reads. Call it
 * again after adding more markup; running it twice over the same nodes is harmless.
 */
export function applyLabels(root: ParentNode, t: Translate): void {
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
 * `t` for one widget or tool in one language. A key with no words anywhere comes back as itself, so a label that
 * was never written shows up on screen rather than leaving a blank.
 */
export function translator(locales: Locales, language: string): Translate {
  // "pt-BR" takes its "pt" where it has no "pt-BR" of its own.
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
