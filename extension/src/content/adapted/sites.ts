// The sites Download adapted works on, by provider: each one whose manifest lists `adapted3mfs` (sites.test.ts holds
// the two to each other).

import { CREALITYCLOUD_ADAPT } from "../../providers/crealitycloud/adaptSite";
import type { ProviderId } from "../../providers/index.generated";
import { MAKERWORLD_ADAPT } from "../../providers/makerworld/adaptSite";
import { NEXPRINT_ADAPT } from "../../providers/nexprint/adaptSite";
import { PRINTABLES_ADAPT } from "../../providers/printables/adaptSite";
import { SNAPMAKER_ADAPT } from "../../providers/snapmaker/adaptSite";
import type { AdaptSite } from "./site";

export const ADAPT_SITES: Partial<Record<ProviderId, AdaptSite>> = {
  makerworld: MAKERWORLD_ADAPT,
  printables: PRINTABLES_ADAPT,
  crealitycloud: CREALITYCLOUD_ADAPT,
  snapmaker: SNAPMAKER_ADAPT,
  nexprint: NEXPRINT_ADAPT,
};
