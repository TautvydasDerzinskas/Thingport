// Loading states that cycle through short, playful phrases about the work in progress, so a wait of
// a few seconds reads as something happening rather than a stuck panel. Each set describes its own
// step; the first phrase is the plain description.

import type { Provider } from "../../shared/urls";
import { panelQuery, renderPanel } from "../shell";
import { MANIFESTS, PROVIDER_IDS } from "../../shared/providers/_generated";

const ROTATE_MS = 2500;

export const SITE_NAMES = Object.fromEntries(PROVIDER_IDS.map((id) => [id, MANIFESTS[id].name])) as Record<
  Provider,
  string
>;

/** The instance inspects the link: finds the file, reads its title, checks whether it's a zip. */
export function checkingLinkPhrases(provider: Provider): string[] {
  return [
    "Checking the link…",
    `Asking ${SITE_NAMES[provider]} nicely…`,
    "Sniffing out the file…",
    "Peeking behind the download button…",
    "Reading the name tag…",
    "Measuring twice…",
    "Checking it's really a model…",
    "Shaking the box to hear what's inside…",
    "Reading the fine print…",
  ];
}

/** The instance downloads the file, builds the model, its plates and gallery, and files it. */
export function importingPhrases(provider: Provider): string[] {
  return [
    "Importing…",
    `Carrying it over from ${SITE_NAMES[provider]}…`,
    "Downloading the file…",
    "Crunching the model…",
    "Unpacking the plates…",
    "Taking the photos…",
    "Framing the thumbnail…",
    "Writing the label…",
    "Crediting the designer…",
    "Finding it a shelf…",
  ];
}

/** "Fetch missing details": fills the library model's empty details and images. */
export function fillingGapsPhrases(provider: Provider): string[] {
  return [
    "Filling in the blanks…",
    `Asking ${SITE_NAMES[provider]} for the details…`,
    "Looking for missing photos…",
    "Leaving your edits alone…",
    "Comparing notes…",
    "Dusting off the shelf…",
  ];
}

/** The instance downloads a zip to list the files inside it. */
export const zipFilesPhrases = [
  "Loading files…",
  "Downloading the archive…",
  "Unzipping carefully…",
  "Counting what's inside…",
  "Peeking into every folder…",
  "Sorting the models from the extras…",
  "Untangling the file names…",
];

/** The instance pages through a collection or likes list and checks which are in the library. */
export function loadingModelsPhrases(provider: Provider): string[] {
  return [
    "Loading models…",
    `Flipping through ${SITE_NAMES[provider]}…`,
    "Paging through the list…",
    "Counting the models…",
    "Gathering the thumbnails…",
    "Checking what's already on your shelf…",
    "Lining them up…",
  ];
}

/** Short, for the "Download normalized" button: MakerWorld hands over the 3MF. */
export const gettingFilePhrases = ["Getting file…", "Finding the 3MF…", "Asking MakerWorld…"];

/** Short, for the "Download normalized" button: the Bambu project becomes a plain 3MF. */
export const normalizingPhrases = [
  "Normalizing…",
  "Keeping the colors…",
  "Translating settings…",
  "Repacking plates…",
  "Smoothing it out…",
];

function noop(): void {}

/** Shows the first phrase, then a random other one every few seconds, never the same twice in a
 *  row. Returns the function that stops it. */
export function rotatePhrases(phrases: readonly string[], show: (phrase: string) => void): () => void {
  show(phrases[0]);
  if (phrases.length < 2) return noop;
  let current = 0;
  const timer = setInterval(() => {
    let next = Math.floor(Math.random() * (phrases.length - 1));
    if (next >= current) next += 1;
    current = next;
    show(phrases[current]);
  }, ROTATE_MS);
  return () => clearInterval(timer);
}

let stopPanelRotation = noop;

/** The panel's status line, rotating until the panel renders something else. */
export function renderFunStatus(phrases: readonly string[]): void {
  stopPanelRotation();
  renderPanel(`<div class="tg-status tg-status--fun"></div>`);
  const el = panelQuery<HTMLElement>(".tg-status--fun");
  if (!el) return;
  stopPanelRotation = rotatePhrases(phrases, (phrase) => {
    if (!el.isConnected) {
      stopPanelRotation();
      return;
    }
    el.textContent = phrase;
    // Restarts the fade-in on every change.
    el.classList.remove("tg-status--fun");
    void el.offsetWidth;
    el.classList.add("tg-status--fun");
  });
}
