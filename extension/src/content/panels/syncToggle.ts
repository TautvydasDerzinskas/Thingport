// "Keep this collection in sync", on provider collection pages. The instance then imports models
// added to the provider's collection later, on its own schedule. Only Grab turns this on: it has
// just seen the collection, so it can tell the instance which models are already there.

import type { SyncLink, SyncLookup } from "../../shared/api";
import { ctx } from "../context";
import { api, escapeHtml } from "../runtime";
import { panelQuery } from "../shell";
import { SITE_NAMES } from "./funStatus";
import { t } from "../../shared/i18n";

/** A Thingiverse user's Likes page, which a sync follows like a collection. */
function isLikes(): boolean {
  const { classification } = ctx();
  return classification.kind === "batch" && classification.type === "likes";
}

/** Null when the page can't be synced, or the instance predates synced collections. */
export async function loadSyncState(): Promise<SyncLookup | null> {
  try {
    const state = await api<SyncLookup>("GET", `/collection-sync?url=${encodeURIComponent(ctx().url)}`);
    return state.supported ? state : null;
  } catch {
    return null;
  }
}

/** Off by default; on when this collection is already synced. */
export function syncToggleHtml(state: SyncLookup | null): string {
  if (!state) return "";
  const provider = SITE_NAMES[ctx().classification.provider] ?? t("theSite");
  const hint = state.sync
    ? t("syncActive", { name: state.sync.collection_name })
    : isLikes() ? t("syncLikesHint") : t("syncCollectionHint", { provider });
  return `
    <label class="tg-toggle">
      <input id="tg-sync" type="checkbox" ${state.sync ? "checked" : ""} />
      <span>
        <span class="tg-toggle__label">${escapeHtml(t(isLikes() ? "syncLikes" : "syncCollection"))}</span>
        <span class="tg-toggle__hint">${escapeHtml(hint)}</span>
      </span>
    </label>
  `;
}

export function readSyncToggle(): boolean {
  return Boolean(panelQuery<HTMLInputElement>("#tg-sync")?.checked);
}

export type SyncChange = "enabled" | "kept" | "disabled" | "none";

/** Applies the toggle. `knownIds` are every model id the panel saw in the collection. Returns the
 *  synced collection, which batch imports from this page file into. */
export async function applySyncToggle(
  state: SyncLookup | null,
  wanted: boolean,
  { title, knownIds }: { title: string | null; knownIds: string[] },
): Promise<{ change: SyncChange; link: SyncLink | null }> {
  if (!state) return { change: "none", link: null };
  if (wanted) {
    const link = await api<SyncLink>("POST", "/collection-sync", { url: ctx().url, title, known_ids: knownIds });
    return { change: state.sync ? "kept" : "enabled", link };
  }
  if (state.sync) {
    // Only this page's source: the collection may follow others too. An instance that sends no id predates that, and
    // knows only the collection's one sync.
    const { id, collection_id } = state.sync;
    await api("DELETE", id ? `/collection/${collection_id}/sync/${id}` : `/collection/${collection_id}/sync`);
    return { change: "disabled", link: null };
  }
  return { change: "none", link: null };
}

/** One line for the panel's result, or null when sync didn't change. */
export function syncChangeNote(change: SyncChange, link: SyncLink | null): string | null {
  if (change === "enabled" && link) {
    return t(isLikes() ? "syncEnabledLikes" : "syncEnabledCollection", { name: link.collection_name });
  }
  if (change === "disabled") return t(isLikes() ? "syncDisabledLikes" : "syncDisabledCollection");
  return null;
}
