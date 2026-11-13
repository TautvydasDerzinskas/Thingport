// QIDI Maker for Download adapted (content/adapted/): its print profiles are QIDI Studio projects, listed in its public
// model data with links to its CDN, which lets any page read them: no sign-in needed, as for Thingport's own imports,
// and the download its own button counts isn't counted. The button goes under its Open in QIDI Studio, for the profile
// picked above it, which the page writes into its address.

import { fetchFile, safeFilename } from "../../content/adapted/download";
import { bambuFamilyFormat } from "../../content/adapted/formats";
import { pickById, visible, type AdaptFile, type AdaptSite } from "../../content/adapted/site";
import { gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { loadQidimakerModel, type QidimakerModel } from "./api";
import { parseQidimakerModelUrl } from "./urls.generated";

const NAME = "QIDI Maker";

/** A profile's 3MF, with its link. Its link names it by when it was uploaded, so it's named after the model. */
type Linked = AdaptFile & { link: string };

/** The model's profiles as 3MFs, in the page's order, each shown by the profile's name. */
export function profileFiles(model: QidimakerModel): Linked[] {
  const name = `${model.title ?? "QIDI Maker model"}.3mf`;
  return model.profiles.map((profile) => ({
    id: profile.id,
    name,
    title: profile.title,
    size: null,
    link: profile.url,
  }));
}

/** The profile the page shows: the `?profile_id=` it writes as one is picked, else the `#profileId-` of a link
 *  Thingport made; "other" where that names one with no 3MF here. */
export function pickedProfile(href: string, files: AdaptFile[]): AdaptFile | null | "other" {
  const own = new URL(href).searchParams.get("profile_id")?.trim();
  return pickById(files, own || parseQidimakerModelUrl(href)?.requestedProfileId);
}

const links = new Map<string, string>();

async function readFiles(pageUrl: string): Promise<Linked[]> {
  const modelId = parseQidimakerModelUrl(pageUrl)?.modelId;
  const model = modelId ? await loadQidimakerModel(modelId) : null;
  if (modelId && !model) throw new Error(`${NAME} didn't say which profiles this model has. Try again in a moment.`);
  const files = model ? profileFiles(model) : [];
  for (const file of files) links.set(file.id, file.link);
  return files;
}

export const QIDIMAKER_ADAPT: AdaptSite = {
  id: "qidimaker",
  name: NAME,
  filesAre: "QIDI Maker's files are QIDI Studio projects",
  formats: [bambuFamilyFormat("QIDIStudio", "02.07.02.10")],

  async files(pageUrl) {
    return (await readFiles(pageUrl)).map(({ link: _link, ...file }) => file);
  },

  selected: (files) => pickedProfile(location.href, files),

  async download(pageUrl, file, progress) {
    const stop = rotatePhrases(gettingFilePhrases(NAME), progress);
    let link = links.get(file.id);
    try {
      // A profile added or changed since the page was read is read again.
      link ??= (await readFiles(pageUrl)).find((each) => each.id === file.id)?.link;
    } finally {
      stop();
    }
    if (!link)
      throw new Error(`Couldn't find this profile among the model's on ${NAME}. Reload the page, then try again.`);
    const { bytes } = await fetchFile(link, NAME, progress, { init: { credentials: "omit" } });
    return { bytes, filename: safeFilename(file.name) };
  },

  // Its Open in QIDI Studio, at the foot of the Print Profile card.
  anchor: () => visible(document.querySelector<HTMLElement>(".model-info .profile .actions")),

  // A row of its own under that one, inside the card, as wide and as far from its sides: the site sets the same margin
  // all round its button, so Grab's takes it too, closer to the button above.
  place(host, anchor) {
    anchor.after(host);
    host.toggleAttribute("data-below", true);
    const { marginLeft, marginRight, marginBottom } = getComputedStyle(anchor);
    const gap = 12;
    host.style.margin = `${gap - (parseFloat(marginBottom) || 0)}px ${marginRight} ${marginBottom} ${marginLeft}`;
  },

  dark: () => document.documentElement.getAttribute("data-theme") === "dark",
  themeWatch: () => ({ target: document.documentElement, attributeFilter: ["data-theme"] }),
};
