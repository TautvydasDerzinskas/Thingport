import type { TFunction } from "i18next";
import type { ProviderState, SlotName } from "../api/providers";
import type { ProviderId } from "./index.generated";

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

/** Whether a provider's imports work for the user. */
export function providerReady(state: ProviderState): boolean {
  const ready = PROVIDER_UI[state.id]?.ready;
  return ready ? ready(state) : !state.slots.default || connected(state, "default");
}
