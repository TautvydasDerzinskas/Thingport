// MakerWorld for Download adapted (content/adapted/): its files are Bambu Studio projects, its own button is found by
// its label in any of the site's languages (its class names are build hashes), its theme is a class on <html>, and a
// model's 3MF is the page's selected print profile, downloaded with the user's own MakerWorld sign-in.

import { placeAfter, type AdaptFile, type AdaptSite } from "../../content/adapted/site";
import { fetchFile, sourceFilename } from "../../content/adapted/download";
import { gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { t } from "../../shared/i18n";
import { resolveMakerworldDownloadUrl } from "./downloadResolver";
import { DOWNLOAD_3MF, DOWNLOAD_OTHER, DOWNLOAD_STL, OPEN_IN_APP } from "./labels";

// One file: whichever print profile the page has selected when it's downloaded.
const selectedProfile = (): AdaptFile => ({
  id: "selected-profile",
  name: t("adaptSite.selectedPrintProfile"),
  size: null,
});

// MakerWorld's main action: usually the "Open in Bambu Studio" split button, whose menu holds "Download 3MF" and
// "Download STL/CAD Files". The English patterns also catch app names the translated sets don't list.
const ACTION_LABELS: ((text: string) => boolean)[] = [
  (text) => OPEN_IN_APP.has(text) || /^open in .+/i.test(text),
  (text) => DOWNLOAD_3MF.has(text) || DOWNLOAD_STL.has(text) || DOWNLOAD_OTHER.has(text) || /^download\b/i.test(text),
];
const MAX_LABEL_LENGTH = 40;

function findActionLabel(): HTMLElement | null {
  const candidates = [...document.querySelectorAll<HTMLElement>("button, a, span, div")].filter((el) => {
    if (el.childElementCount > 2 || el.offsetParent === null || el.closest("#thingport-grab-adapted")) return false;
    const text = (el.textContent || "").trim();
    return text.length <= MAX_LABEL_LENGTH && ACTION_LABELS.some((matches) => matches(text));
  });
  // Innermost, so wrappers repeating the same text don't win.
  const leaves = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
  for (const matches of ACTION_LABELS) {
    const match = leaves.find((el) => matches((el.textContent || "").trim()));
    if (match) return match;
  }
  return null;
}

/** The clickable element around the label, then the outermost wrapper that's still just the control (e.g. both halves
 *  of the split button). */
function controlBox(label: HTMLElement): HTMLElement {
  let box = label.closest<HTMLElement>("button, a, [role=button]") ?? label;
  // The cursor is inherited, so the control is the outermost element that still has it.
  while (
    box.parentElement &&
    box.parentElement !== document.body &&
    getComputedStyle(box.parentElement).cursor === "pointer"
  )
    box = box.parentElement;
  const { width, height } = box.getBoundingClientRect();
  for (let parent = box.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const rect = parent.getBoundingClientRect();
    // Grows only by the split button's arrow, never by a whole extra row.
    if (Math.abs(rect.height - height) > 1 || rect.width > width * 1.5) break;
    box = parent;
  }
  return box;
}

export const MAKERWORLD_ADAPT: AdaptSite = {
  id: "makerworld",
  name: "MakerWorld",
  get filesAre() {
    return t("adaptSite.filesAreProjects", { site: "MakerWorld", slicer: "Bambu Studio" });
  },

  files: async () => [selectedProfile()],

  async download(pageUrl, _file, progress) {
    const stop = rotatePhrases(gettingFilePhrases("MakerWorld"), progress);
    // The adapter reads the 3MF project, never the raw-files zip.
    const resolved = await resolveMakerworldDownloadUrl(pageUrl, { profileOnly: true }).finally(stop);
    if (!resolved) throw new Error(t("couldNotGetMakerworldFile"));
    const { res, bytes } = await fetchFile(resolved.downloadUrl, "MakerWorld", progress);
    return { bytes, filename: sourceFilename(res, resolved.downloadUrl) };
  },

  anchor() {
    const label = findActionLabel();
    return label ? controlBox(label) : null;
  },

  place: placeAfter,

  // MakerWorld sets its theme as a class on <html>, which the button's shadow root can't see.
  dark: () => document.documentElement.classList.contains("dark"),
  themeWatch: () => ({ target: document.documentElement, attributeFilter: ["class"] }),
};
