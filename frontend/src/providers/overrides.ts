import type { TFunction } from "i18next";
import type { ConnectionStatus, ProviderState, SlotName } from "../api/providers";
import { manifestOf, type ProviderId, type RegionId } from "./index.generated";

/** Where a provider's UI isn't what its manifest alone gives. */
type ProviderUi = {
  /** Whether its imports work: its default credential connected, when left out. */
  ready?(state: ProviderState): boolean;
  /** What's missing for its imports once its default credential is connected and not turned down: as a tooltip, and
   *  as a menu's short status. */
  missing?(state: ProviderState, t: TFunction): { tooltip: string; status: string } | undefined;
};

const connected = (state: ProviderState, slot: SlotName) => state.slots[slot]?.status === "connected";

export const PROVIDER_UI: Partial<Record<ProviderId, ProviderUi>> = {
  // Its API key reads models and lists; the browser's sign-in, which Thingport Grab sends, downloads the files.
  cults3d: {
    ready: (state) => connected(state, "default") && connected(state, "browser"),
    missing(state, t) {
      const browser = state.slots.browser?.status;
      if (browser === "connected") return undefined;
      const tooltip = t(
        browser === "expired" ? "providers:cults3d.status.siteExpired" : "providers:cults3d.status.siteMissing",
      );
      return { tooltip, status: t("providers:cults3d.status.siteMissingStatus") };
    },
  },
  // Imports need only the instance's API key; the user's own sign-in adds paid and login-only models.
  myminifactory: { ready: (state) => connected(state, "instance") },
};

/** The sign-ins its tile connects, one per site with accounts of its own: its main site's ("default"), then each of
 *  its regions' (VoxelShare's China one), named after it. */
export function siteSlots(id: ProviderId): ("default" | RegionId)[] {
  return ["default", ...(manifestOf(id).regions ?? []).map((region) => region.id)];
}

/** Its sign-in across its sites: connected where any is, else expired where any was turned down; undefined for a
 *  provider with none to give, or before it's known. */
export function signInStatus(state: ProviderState): ConnectionStatus | undefined {
  const statuses = siteSlots(state.id).flatMap((slot) => state.slots[slot]?.status ?? []);
  if (!statuses.length) return undefined;
  if (statuses.includes("connected")) return "connected";
  return statuses.includes("expired") ? "expired" : "disconnected";
}

/** What says a site's sign-in ran out, as a tooltip and as a menu's short status: its main site's, or a region's. */
export function expiredTexts(id: ProviderId, slot: "default" | RegionId, t: TFunction) {
  const at = slot === "default" ? `providers:${id}.status` : `providers:${id}.status.${slot}`;
  return { tooltip: t(`${at}.expired`), status: t(`${at}.expiredStatus`) };
}

/** The first of its sites whose sign-in ran out, if one has. */
export function expiredSite(state: ProviderState): "default" | RegionId | undefined {
  return siteSlots(state.id).find((slot) => state.slots[slot]?.status === "expired");
}

/** What's missing once it's connected: its own (PROVIDER_UI), else another site's sign-in that ran out. */
export function missingOf(state: ProviderState, t: TFunction): { tooltip: string; status: string } | undefined {
  const own = PROVIDER_UI[state.id]?.missing?.(state, t);
  if (own) return own;
  const expired = expiredSite(state);
  return expired ? expiredTexts(state.id, expired, t) : undefined;
}

/** Whether a provider's imports work for the user: one of its sites' sign-ins connected, unless its own rule says. */
export function providerReady(state: ProviderState): boolean {
  const ready = PROVIDER_UI[state.id]?.ready;
  return ready ? ready(state) : !state.slots.default || signInStatus(state) === "connected";
}
