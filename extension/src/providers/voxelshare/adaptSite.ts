// VoxelShare for Download adapted (content/adapted/): its print profiles are Flashforge slicer projects, listed in its
// public model data with signed links to its image host, which lets the page read them: no sign-in needed, as for
// Thingport's own imports, and the download its own button reports isn't reported. The button goes under its Open in
// Flash Studio Desktop, for the profile picked in the list above it, which the page marks there and nowhere else.

import { fetchFile, safeFilename } from "../../content/adapted/download";
import { orcaFamilyFormat } from "../../content/adapted/formats";
import { pickById, visible, type AdaptFile, type AdaptSite } from "../../content/adapted/site";
import { gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { t } from "../../shared/i18n";
import { loadVoxelshareModel, shownProfileId, type VoxelshareModel } from "./api";
import { parseVoxelshareModelUrl } from "./urls.generated";

const NAME = "VoxelShare";
// Between its button and Grab's, as between its other blocks.
const GAP = 12;
// The least of its list of profiles Grab's row leaves, so a few still show above it.
const LIST_MIN = 120;

/** A profile's 3MF, with its link. Its link names it by when it was uploaded, so it's named after the model. */
type Linked = AdaptFile & { link: string };

/** The model's profiles as 3MFs, in the page's order, each shown by the profile's name. */
export function profileFiles(model: VoxelshareModel): Linked[] {
  const name = `${model.title ?? "VoxelShare model"}.3mf`;
  return model.profiles.map((profile) => ({
    id: profile.id,
    name,
    title: profile.title,
    size: null,
    link: profile.url,
  }));
}

/** The profile the page shows: the one marked in its list, else the `#profileId-` of a link Thingport made; "other"
 *  where that names one with no 3MF here. */
export function pickedProfile(href: string, files: AdaptFile[], root: ParentNode = document) {
  return pickById(files, shownProfileId(href, root));
}

async function readFiles(pageUrl: string): Promise<Linked[]> {
  const modelId = parseVoxelshareModelUrl(pageUrl)?.modelId;
  const model = modelId ? await loadVoxelshareModel(modelId) : null;
  if (modelId && !model) throw new Error(t("adaptSite.noProfileList", { site: NAME }));
  return model ? profileFiles(model) : [];
}

/** Under `anchor`, as wide, its list of profiles giving up the room Grab's row takes: the site's card has a fixed
 *  height, which the row would otherwise spill out of over what's below it. */
export function placeUnder(host: HTMLElement, anchor: HTMLElement): void {
  anchor.after(host);
  host.toggleAttribute("data-below", true);
  host.style.margin = `${GAP}px 0 0`;
  const list = anchor.parentElement?.querySelector<HTMLElement>(".list-container-scroll");
  if (!list || list.dataset.thingportShrunk) return;
  const height = list.getBoundingClientRect().height;
  const taken = host.getBoundingClientRect().height + GAP;
  if (!height || !taken) return;
  list.dataset.thingportShrunk = "1";
  list.style.height = `${Math.max(LIST_MIN, Math.round(height - taken))}px`;
}

export const VOXELSHARE_ADAPT: AdaptSite = {
  id: "voxelshare",
  name: NAME,
  get filesAre() {
    return t("adaptSite.filesAreProjects", { site: NAME, slicer: "Flash Studio" });
  },
  // Flash Studio's, Flashforge's slicer: an OrcaSlicer 2.3.2 that tags its projects as Bambu Studio's, the tag beside.
  formats: [orcaFamilyFormat("BambuStudio", "01.10.01.50", "2.3.2")],

  async files(pageUrl) {
    return (await readFiles(pageUrl)).map(({ link: _link, ...file }) => file);
  },

  selected: (files) => pickedProfile(location.href, files),

  async download(pageUrl, file, progress) {
    const stop = rotatePhrases(gettingFilePhrases(NAME), progress);
    let link: string | undefined;
    try {
      // Read again each time: its links are signed for a day, and a profile may have been added since.
      link = (await readFiles(pageUrl)).find((each) => each.id === file.id)?.link;
    } finally {
      stop();
    }
    if (!link) throw new Error(t("adaptSite.profileNotFound", { site: NAME }));
    const { bytes } = await fetchFile(link, NAME, progress, { init: { credentials: "omit" } });
    return { bytes, filename: safeFilename(file.name) };
  },

  // Its Open in Flash Studio Desktop, at the foot of the Print Profile tab of its card.
  anchor: () => visible(document.querySelector<HTMLElement>(".right-panel .download-btn-wrapper")),

  place: placeUnder,

  // It shows no dark theme.
  dark: () => false,
  themeWatch: () => ({ target: document.documentElement, attributeFilter: ["class"] }),
};
