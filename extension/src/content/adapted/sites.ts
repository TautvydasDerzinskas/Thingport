// The sites Download adapted works on, by provider: each one whose manifest lists `adapted3mfs` (sites.test.ts holds
// the two to each other).

import type { ProviderId } from "../../providers/index.generated";
import { MAKERWORLD_ADAPT } from "../../providers/makerworld/adaptSite";
import { PRINTABLES_ADAPT } from "../../providers/printables/adaptSite";
import type { AdaptSite } from "./site";

export const ADAPT_SITES: Partial<Record<ProviderId, AdaptSite>> = {
  makerworld: MAKERWORLD_ADAPT,
  printables: PRINTABLES_ADAPT,
};
