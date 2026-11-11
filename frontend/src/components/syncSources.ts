// What the sync badge, indicator and dialog say about the provider collections a collection follows.
import type { TFunction } from "i18next";
import type { CollectionSync } from "../api/collections";
import type { ImportProvider } from "../api/settings";
import { importProviderInfo } from "../constants/importProviders";
import { MANIFESTS, isProviderId } from "../providers/index.generated";

/** All sources' sites on; some turned off by an admin, so nothing comes from those; or all of them off. */
export type SyncHealth = "ok" | "partial" | "off";

/** Past this many sources, the badge stops showing each one's logo and shows how many there are. */
export const MAX_SOURCE_LOGOS = 3;

export const providerLabel = (provider: string) => importProviderInfo(provider)?.label ?? provider;

/** The source's own name: the provider collection's, a user's Likes, or, for links made before names were kept, the
 *  provider's collection. */
export function sourceName(sync: CollectionSync, t: TFunction): string {
  if (sync.likes_of) return t("models:collections.sync.sourceLikes", { user: sync.likes_of });
  return sync.title?.trim() || t("models:collections.sync.sourceUntitled", { provider: providerLabel(sync.provider) });
}

export const isSourceOff = (sync: CollectionSync, disabled: ReadonlySet<ImportProvider>) =>
  isProviderId(sync.provider) && disabled.has(sync.provider);

export function syncHealth(syncs: CollectionSync[], disabled: ReadonlySet<ImportProvider>): SyncHealth {
  const off = syncs.filter((sync) => isSourceOff(sync, disabled)).length;
  return off === 0 ? "ok" : off === syncs.length ? "off" : "partial";
}

/** The colour a source's provider draws its own things in; for the ring of a collection with many sources. */
export const sourceAccent = (sync: CollectionSync) =>
  isProviderId(sync.provider) ? MANIFESTS[sync.provider].brand.accent : null;

/** What the badge's tooltip says: what it syncs with, then which of those sites an admin turned off. */
export function syncsLabel(syncs: CollectionSync[], disabled: ReadonlySet<ImportProvider>, t: TFunction): string {
  let synced: string;
  if (syncs.length === 1) {
    const [sync] = syncs;
    const provider = providerLabel(sync.provider);
    synced = sync.likes_of
      ? t("models:collections.sync.badgeLikes", { user: sync.likes_of, provider })
      : t("models:collections.sync.badge", { provider });
  } else {
    const sources = syncs
      .map((sync) =>
        t("models:collections.sync.sourceItem", { provider: providerLabel(sync.provider), name: sourceName(sync, t) }),
      )
      .join(", ");
    synced = t("models:collections.sync.badgeMany", { count: syncs.length, sources });
  }
  const off = [...new Set(syncs.filter((sync) => isSourceOff(sync, disabled)).map((sync) => sync.provider))];
  // While other sources still sync, a turned-off site holds up only its own.
  const offKey = syncHealth(syncs, disabled) === "partial" ? "badgeSourceOff" : "badgeOff";
  return [
    synced,
    ...off.map((provider) => t(`models:collections.sync.${offKey}`, { provider: providerLabel(provider) })),
  ].join(". ");
}
