// Views over the whole popup, in place of its header, tabs and footer: Adapt 3MFs' settings, and Add printer over
// those. Back, or Escape, goes to what was there before and gives focus back to what opened the view; a view can
// take Back for a step of its own first (Add printer's makers).

type Options = {
  /** Runs first on Back and Escape; returning true keeps the view open. */
  back?: () => boolean;
  /** Where focus goes back to when what opened the view is gone and nothing has been drawn in its place. */
  fallback?: HTMLElement;
};

type Opened = Options & { view: HTMLElement; opener: HTMLElement | null };

const stack: Opened[] = [];
const main = (): HTMLElement[] =>
  [".header", "#tabs", "main", ".footer"]
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .filter((el): el is HTMLElement => Boolean(el));

function enter(view: HTMLElement): void {
  view.hidden = false;
  view.classList.remove("subview--in");
  // Restarts the slide-in: the class only animates when it's added to an element that has been laid out without it.
  void view.offsetWidth;
  view.classList.add("subview--in");
}

export function openView(view: HTMLElement, opener: HTMLElement | null, options: Options = {}): void {
  if (stack.at(-1)?.view === view) return;
  const below = stack.at(-1);
  if (below) below.view.hidden = true;
  else for (const el of main()) el.hidden = true;
  stack.push({ view, opener, ...options });
  enter(view);
  window.scrollTo(0, 0);
  view.querySelector<HTMLElement>("[data-back]")?.focus();
}

export function closeView(): void {
  const top = stack.pop();
  if (!top) return;
  top.view.hidden = true;
  const below = stack.at(-1);
  if (below) enter(below.view);
  else for (const el of main()) el.hidden = false;
  focusBack(top);
}

/** What opened the view, or what has been drawn in its place since (by its `data-key`), else the fallback. */
function focusBack({ opener, fallback }: Opened): void {
  if (opener?.isConnected) return opener.focus();
  const key = opener?.dataset.key;
  const redrawn = key ? document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) : null;
  (redrawn ?? fallback)?.focus();
}

export function isOpen(view: HTMLElement): boolean {
  return stack.some((opened) => opened.view === view);
}

function goBack(): void {
  const top = stack.at(-1);
  if (top && !top.back?.()) closeView();
}

for (const button of document.querySelectorAll<HTMLButtonElement>(".subview [data-back]")) {
  button.addEventListener("click", goBack);
}

document.addEventListener("keydown", (event) => {
  // A menu or the confirm dialog takes Escape for itself first.
  if (event.key !== "Escape" || event.defaultPrevented || !stack.length) return;
  if (document.querySelector("dialog[open]")) return;
  event.preventDefault();
  goBack();
});
