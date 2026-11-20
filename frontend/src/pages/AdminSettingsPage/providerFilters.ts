import { MANIFESTS, type ProviderId } from "../../providers/index.generated";
import { defaultSortDirection, type SortDirection } from "../../utils/sortDirection";

export type ProviderStatus = "all" | "on" | "off";
/** Dates use `order`, which is the order providers were added in. */
export type ProviderSort = "newest" | "name";

export const FEATURES = ["collections", "likes", "profiles", "paidModels"] as const;
export type Feature = (typeof FEATURES)[number];

/** Who signs in: nobody, optionally the user, each user, or the admin once for the instance. */
export const SIGN_INS = ["none", "optional", "user", "key"] as const;
export type SignInKind = (typeof SIGN_INS)[number];

/** Its files come only through Thingport Grab; it works best with FlareSolverr. */
export const NEEDS = ["grabOnly", "flaresolverr"] as const;
export type NeedKind = (typeof NEEDS)[number];

export type ProviderFilters = {
  status: ProviderStatus;
  /** Has every one of these. */
  features: Feature[];
  /** Is any one of these; all when empty. */
  signIns: SignInKind[];
  /** Has every one of these. */
  needs: NeedKind[];
};

export const NO_FILTERS: ProviderFilters = { status: "all", features: [], signIns: [], needs: [] };

export function signInKind(id: ProviderId): SignInKind {
  switch (MANIFESTS[id].signIn) {
    case "none":
      return "none";
    case "userOptional":
      return "optional";
    case "user":
      return "user";
    default:
      return "key";
  }
}

export function hasFeature(id: ProviderId, feature: Feature): boolean {
  return MANIFESTS[id].capabilities[feature];
}

export function hasNeed(id: ProviderId, need: NeedKind): boolean {
  const { helpers } = MANIFESTS[id];
  return need === "grabOnly" ? helpers.grab === "required" : helpers.flaresolverr === "recommended";
}

export function matchesFilters(id: ProviderId, enabled: boolean, filters: ProviderFilters): boolean {
  if (filters.status === "on" && !enabled) return false;
  if (filters.status === "off" && enabled) return false;
  if (!filters.features.every((feature) => hasFeature(id, feature))) return false;
  if (filters.signIns.length && !filters.signIns.includes(signInKind(id))) return false;
  return filters.needs.every((need) => hasNeed(id, need));
}

/** For the filter button's badge: the status counts as one. */
export function activeFilterCount(filters: ProviderFilters): number {
  return (filters.status === "all" ? 0 : 1) + filters.features.length + filters.signIns.length + filters.needs.length;
}

export function sortProviders(
  ids: readonly ProviderId[],
  sort: ProviderSort,
  locale?: string,
  direction: SortDirection = defaultSortDirection(sort),
): ProviderId[] {
  const sign = direction === "asc" ? 1 : -1;
  if (sort === "newest") return ids.toSorted((a, b) => sign * (MANIFESTS[a].order - MANIFESTS[b].order));
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  return ids.toSorted((a, b) => sign * collator.compare(MANIFESTS[a].name, MANIFESTS[b].name));
}
