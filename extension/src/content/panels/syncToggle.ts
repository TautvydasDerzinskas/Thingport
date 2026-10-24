// "Keep this collection in sync", on provider collection pages. The instance then imports models
// added to the provider's collection later, on its own schedule. Only Grab turns this on: it has
// just seen the collection, so it can tell the instance which models are already there.

import type { SyncLink, SyncLookup } from "../../shared/api";
import { ctx } from "../context";
import { api, escapeHtml } from "../runtime";
import { panelQuery } from "../shell";
import { SITE_NAMES } from "./funStatus";

/** A Thingiverse user's Likes page, which a sync follows like a collection. */
function isLikes(): boolean {
  return ctx().classification.type === "likes";
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
  const provider = SITE_NAMES[ctx().classification.provider] ?? "the site";
  const added = isLikes() ? "Models liked later" : `Models added to it on ${provider} later`;
  const hint = state.sync
    ? `Synced with "${escapeHtml(state.sync.collection_name)}" in Thingport. Untick to stop.`
    : `${added} are imported into Thingport automatically, on a schedule you can change there. Models you leave out now stay out.`;
  return `
    <label class="tg-toggle">
      <input id="tg-sync" type="checkbox" ${state.sync ? "checked" : ""} />
      <span>
        <span class="tg-toggle__label">${isLikes() ? "Keep these likes in sync" : "Keep this collection in sync"}</span>
        <span class="tg-toggle__hint">${hint}</span>
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
    await api("DELETE", `/collection/${state.sync.collection_id}/sync`);
    return { change: "disabled", link: null };
  }
  return { change: "none", link: null };
}

/** One line for the panel's result, or null when sync didn't change. */
export function syncChangeNote(change: SyncChange, link: SyncLink | null): string | null {
  const source = isLikes() ? "liked" : "added to this collection";
  if (change === "enabled" && link) {
    return `Sync is on: models ${source} from now on come into "${link.collection_name}" automatically.`;
  }
  if (change === "disabled") return `Sync is off: models ${source} from now on won't be imported.`;
  return null;
}
