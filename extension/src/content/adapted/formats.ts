// What a site's 3MFs are before one is downloaded, by the kinds its manifest lists (`adapted3mfs`): a typical file
// of each kind, enough to say which slicers get a copy, unless the site gives its own. The downloaded file itself
// decides what its copy is.

import { FORMAT_VERSION, type ThreeMfFormat } from "../../adapter/index.generated";
import { MANIFESTS } from "../../providers/index.generated";
import type { AdaptSite } from "./site";

type Kind = "bambu" | "prusa" | "plain";

const UNKNOWN = { v: FORMAT_VERSION, orcaTag: null, printer: null, nozzle: null, plates: null } as const;

const TYPICAL: Record<Kind, ThreeMfFormat> = {
  // From a recent Bambu Studio, with its names for settings.
  bambu: {
    ...UNKNOWN,
    kind: "bambu",
    app: "BambuStudio",
    appVersion: "02.08.00.00",
    filaments: null,
    dialect: "bambu",
  },
  prusa: { ...UNKNOWN, kind: "prusa", app: "PrusaSlicer", appVersion: "2.9.0", filaments: null, dialect: null },
  // In several colours: one in a single colour needs no copy anywhere.
  plain: { ...UNKNOWN, kind: "plain", app: null, appVersion: null, filaments: 2, dialect: null, painted: false },
};

export function siteFormats(site: AdaptSite): ThreeMfFormat[] {
  if (site.formats) return site.formats;
  const kinds = (MANIFESTS[site.id].capabilities as { adapted3mfs?: readonly Kind[] }).adapted3mfs ?? [];
  return kinds.map((kind) => TYPICAL[kind]);
}

/** A Bambu layout project written by another app that keeps Bambu Studio's names for settings (QIDI Studio), as a
 *  site's typical file: `app` and its `version`. */
export function bambuFamilyFormat(app: string, version: string): ThreeMfFormat {
  return { ...TYPICAL.bambu, app, appVersion: version };
}

/** A Bambu layout project written by another app, as a site's typical file: `app` and its `version`, the OrcaSlicer
 *  tag beside it if it writes one, in OrcaSlicer's names for settings. */
export function orcaFamilyFormat(app: string, version: string, orcaTag: string | null = null): ThreeMfFormat {
  return { ...TYPICAL.bambu, app, appVersion: version, orcaTag, dialect: "orca" };
}
