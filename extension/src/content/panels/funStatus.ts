// Loading states that cycle through short, playful phrases about the work in progress, so a wait of
// a few seconds reads as something happening rather than a stuck panel. Each set describes its own
// step; the first phrase is the plain description.

import type { Provider } from "../../shared/urls";
import { panelQuery, renderPanel } from "../shell";
import { MANIFESTS, PROVIDER_IDS } from "../../providers/index.generated";
import { t } from "../../shared/i18n";

const ROTATE_MS = 2500;

export const SITE_NAMES = Object.fromEntries(PROVIDER_IDS.map((id) => [id, MANIFESTS[id].name])) as Record<
  Provider,
  string
>;

/** The instance inspects the link: finds the file, reads its title, checks whether it's a zip. */
export function checkingLinkPhrases(provider: Provider): string[] {
  return [
    t("checkingLink"),
    t("funAskingSite", { site: SITE_NAMES[provider] }),
    t("funSniffingFile"),
    t("funPeekingDownload"),
    t("funReadingNameTag"),
    t("funMeasuringTwice"),
    t("funCheckingModel"),
    t("funShakingBox"),
    t("funReadingFinePrint"),
  ];
}

/** The instance downloads the file, builds the model, its plates and gallery, and files it. */
export function importingPhrases(provider: Provider): string[] {
  return [
    t("importing"),
    t("funCarryingFrom", { site: SITE_NAMES[provider] }),
    t("funDownloadingFile"),
    t("funCrunchingModel"),
    t("funUnpackingPlates"),
    t("funTakingPhotos"),
    t("funFramingThumb"),
    t("funWritingLabel"),
    t("funCreditingDesigner"),
    t("funFindingShelf"),
  ];
}

/** "Fetch missing details": fills the library model's empty details and images. */
export function fillingGapsPhrases(provider: Provider): string[] {
  return [
    t("funFillingBlanks"),
    t("funAskingSiteDetails", { site: SITE_NAMES[provider] }),
    t("funMissingPhotos"),
    t("funLeaveEdits"),
    t("funComparingNotes"),
    t("funDustingShelf"),
  ];
}

/** The instance downloads a zip to list the files inside it. */
export let zipFilesPhrases: string[] = [];

/** The instance pages through a collection or likes list and checks which are in the library. */
export function loadingModelsPhrases(provider: Provider): string[] {
  return [
    t("loadingModels"),
    t("funFlippingSite", { site: SITE_NAMES[provider] }),
    t("funPagingList"),
    t("funCountingModels"),
    t("funGatheringThumbs"),
    t("funCheckingLibrary"),
    t("funLiningUp"),
  ];
}

/** Short, for the "Download adapted" button: MakerWorld hands over the 3MF. */
export let gettingFilePhrases: string[] = [];

/** Short, for the "Download adapted" button: the Bambu project becomes a copy for the slicer. */
export let adaptingPhrases: string[] = [];

/** Keeps live phrase exports in the locale selected by the content-script state. */
export function refreshFunStatusPhrases(): void {
  zipFilesPhrases = [
    t("funLoadingFiles"),
    t("funDownloadingArchive"),
    t("funUnzipping"),
    t("funCountingContents"),
    t("funPeekingFolders"),
    t("funSortingModels"),
    t("funUntanglingFileNames"),
  ];
  gettingFilePhrases = [t("funGettingFile"), t("funFinding3mf"), t("funAskingMakerWorld")];
  adaptingPhrases = [
    t("adapting"),
    t("funKeepingColors"),
    t("funTranslatingSettings"),
    t("funRepackingPlates"),
    t("funSmoothing"),
  ];
}

refreshFunStatusPhrases();

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
