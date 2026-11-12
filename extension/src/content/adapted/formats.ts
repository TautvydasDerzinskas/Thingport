// What a site's 3MFs are before one is downloaded, by the kinds its manifest lists (`adapted3mfs`): a typical file
// of each kind, enough to say which slicers get a copy. The downloaded file itself decides what its copy is.

import { FORMAT_VERSION, type ThreeMfFormat } from "../../adapter/index.generated";
import { MANIFESTS, type ProviderId } from "../../providers/index.generated";

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

export function siteFormats(provider: ProviderId): ThreeMfFormat[] {
  const kinds = (MANIFESTS[provider].capabilities as { adapted3mfs?: readonly Kind[] }).adapted3mfs ?? [];
  return kinds.map((kind) => TYPICAL[kind]);
}
