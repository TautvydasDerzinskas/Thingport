import { appendTokenToUrl, authHeaders } from "../utils/auth";
import { apiBase, assertOk, assertOkWithMessage, readErrorMessage } from "./client";
import { BULK_LIMIT, type Print } from "./prints";
import type { RemoteRef } from "./chats";
import type { UserCard } from "./social";

export type SystemCollectionKey = "favorites" | "history";

/** How often a synced collection is checked, in hours. */
export const SYNC_INTERVAL_HOURS = [1, 6, 24] as const;
export type SyncIntervalHours = (typeof SYNC_INTERVAL_HOURS)[number];

/** Which print profiles a synced MakerWorld collection brings for each new model. */
export type SyncProfileScope = "url" | "designer" | "all";

/** One of the provider collections a collection follows, linked by Thingport Grab or the sync dialog's Browse tab. */
export type CollectionSync = {
  /** Names this source in the calls that change, sync or stop it. */
  id: string;
  provider: string;
  source_url: string;
  /** The provider collection's name when it was linked; null on older links and on Likes (see `likes_of`). */
  title: string | null;
  profile_scope: SyncProfileScope;
  last_checked_at: string | null;
  last_error: string | null;
  /** Set when it follows a user's likes (Thingiverse, or the user's own on Printables) rather than a
   *  collection: their username. */
  likes_of: string | null;
  /** How often the provider's collection is checked. */
  interval_hours: SyncIntervalHours;
  /** Roughly when it's next checked; null with scheduled sync off. */
  next_sync_at: string | null;
  /** When "Sync now" can be used again; null when it can be now. */
  sync_now_at: string | null;
};

export type Collection = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  item_count: number;
  cover_items: Print[];
  created_at: string;
  /** Set only for the built-in pseudo-collections, which get a translated name and no edit/delete. */
  system_key: SystemCollectionKey | null;
  /** Always false for a system pseudo-collection. */
  bookmarked: boolean;
  /** The provider collections it follows, oldest first; empty when it isn't synced. */
  syncs: CollectionSync[];
  /** The first of `syncs`, kept for older clients. Use `syncs`. */
  sync: CollectionSync | null;
  /** Set on the collection of a tool's models: it can be opened and bookmarked, not edited, and goes with the tool. */
  tool_id: string | null;
  /** Shown to the instance's other users while an admin has social features on. */
  is_public?: boolean;
  /** Who besides its owner sees it while social features are on. */
  visibility?: CollectionVisibility;
  /** On the user's own shared collection: how many it's shared with, and the first few. */
  shared_with?: { count: number; people: SharePerson[] } | null;
  /** Set on another user's collection: whose it is. Null on the viewer's own. */
  owner?: UserCard | null;
};

/** Nobody but its owner, the people it's shared with, or everyone (on Explore). */
export type CollectionVisibility = "private" | "shared" | "public";

/** Someone a collection is shared with: here, or on a partner instance (`remote`). Never their email. */
export type SharePerson = UserCard & { remote?: RemoteRef | null };

/** Who the user's collection is shared with: the whole list, kept while it's private or public too. */
export type CollectionSharing = {
  visibility: CollectionVisibility;
  people: SharePerson[];
  max_people: number;
};

export type CollectionSharingPatch = {
  visibility?: CollectionVisibility;
  add_user_ids?: string[];
  remove_user_ids?: string[];
  /** People on connected instances, by their id here. */
  add_remote_person_ids?: string[];
  remove_remote_person_ids?: string[];
};

export type CollectionInput = {
  name: string;
  description?: string | null;
  tags?: string[];
  /** Left as it is when not given. */
  visibility?: CollectionVisibility;
};

export type CollectionMembership = {
  id: string;
  name: string;
  in_collection: boolean;
};

export type CollectionCount = {
  id: string;
  name: string;
  count: number;
};

export type CollectionMergeResult = {
  /** The kept collection, with every model now in it. */
  collection: Collection;
  merged_ids: string[];
  /** Models that weren't in the kept collection before. */
  added: number;
};

// Someone elsewhere's picture comes through this instance at an address relative to the API: an <img> sends no header,
// so the session goes in the address, as for partners' pictures on Explore.
const sharePersonIn = (person: SharePerson): SharePerson =>
  person.remote && person.avatar_url
    ? { ...person, avatar_url: appendTokenToUrl(`${apiBase()}${person.avatar_url}`) }
    : person;
const sharingIn = (sharing: CollectionSharing): CollectionSharing => ({
  ...sharing,
  people: sharing.people.map(sharePersonIn),
});
const collectionIn = (collection: Collection): Collection =>
  collection.shared_with
    ? {
        ...collection,
        shared_with: { ...collection.shared_with, people: collection.shared_with.people.map(sharePersonIn) },
      }
    : collection;
export const sharePeopleIn = (people: SharePerson[]): SharePerson[] => people.map(sharePersonIn);

/** `collection` as its sharing now has it: what a card shows of who sees it. */
export const withSharing = (collection: Collection, sharing: CollectionSharing): Collection => ({
  ...collection,
  visibility: sharing.visibility,
  is_public: sharing.visibility === "public",
  shared_with:
    sharing.visibility === "shared" ? { count: sharing.people.length, people: sharing.people.slice(0, 3) } : null,
});

const postJson = (path: string, body: unknown) =>
  fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

export const collectionsApi = {
  list: async (): Promise<Collection[]> => {
    const res = await fetch(`${apiBase()}/collections`, { headers: authHeaders() });
    assertOk(res, "Failed to list collections");
    return ((await res.json()) as Collection[]).map(collectionIn);
  },

  get: async (id: string): Promise<Collection> => {
    const res = await fetch(`${apiBase()}/collection/${id}`, { headers: authHeaders() });
    assertOk(res, "Failed to load collection");
    return collectionIn(await res.json());
  },

  create: async (input: CollectionInput): Promise<Collection> => {
    const res = await fetch(`${apiBase()}/collections`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    await assertOkWithMessage(res, "Create collection failed");
    return res.json();
  },

  update: async (id: string, input: CollectionInput): Promise<Collection> => {
    const res = await fetch(`${apiBase()}/collection/${id}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Update collection failed"));
    return collectionIn(await res.json());
  },

  delete: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${id}`, { method: "DELETE", headers: authHeaders() });
    assertOk(res, "Delete collection failed");
  },

  sharing: async (id: string): Promise<CollectionSharing> => {
    const res = await fetch(`${apiBase()}/collection/${id}/sharing`, { headers: authHeaders() });
    await assertOkWithMessage(res, "Failed to load who it's shared with");
    return sharingIn(await res.json());
  },

  /** Its visibility, and people added to its list or taken off it; the others stay. */
  updateSharing: async (id: string, patch: CollectionSharingPatch): Promise<CollectionSharing> => {
    const res = await fetch(`${apiBase()}/collection/${id}/sharing`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    // No fallback of its own: the form says it in the reader's language when the server gave no reason.
    await assertOkWithMessage(res, "");
    return sharingIn(await res.json());
  },

  /** How many models a merge of these would hold: the same whichever is kept. */
  previewMerge: async (ids: string[]): Promise<{ models: number }> => {
    const res = await postJson("/collections/merge/preview", { ids });
    await assertOkWithMessage(res, "Failed to preview the merge");
    return res.json();
  },

  /** Moves the others' models into `primaryId` and deletes the others. */
  merge: async (primaryId: string, ids: string[]): Promise<CollectionMergeResult> => {
    const res = await postJson("/collections/merge", { primary_id: primaryId, ids });
    await assertOkWithMessage(res, "Merge failed");
    const result = (await res.json()) as CollectionMergeResult;
    return { ...result, collection: collectionIn(result.collection) };
  },

  /** Their models are untouched. */
  deleteMany: async (ids: string[]): Promise<{ deleted: string[] }> => {
    const res = await postJson("/collections/delete", { ids });
    await assertOkWithMessage(res, "Delete collections failed");
    return res.json();
  },

  /** The print itself is untouched. */
  removeItem: async (collectionId: string, printId: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${collectionId}/items/${printId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assertOk(res, "Remove from collection failed");
  },

  addItem: async (collectionId: string, printId: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${collectionId}/items/${printId}`, {
      method: "POST",
      headers: authHeaders(),
    });
    assertOk(res, "Add to collection failed");
  },

  /** `not_found`: those that couldn't be filed, as given -- gone, or another user's no longer shared. Another user's
   *  shared models are copied into the user's library first. */
  addItems: async (collectionId: string, printIds: string[]): Promise<{ not_found: string[] }> => {
    const res = await fetch(`${apiBase()}/collection/${collectionId}/items`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ print_ids: printIds }),
    });
    assertOk(res, "Add to collection failed");
    const body = (await res.json()) as { not_found?: string[] };
    return { not_found: body.not_found ?? [] };
  },

  /** The prints themselves are untouched. */
  removeItems: async (collectionId: string, printIds: string[]): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${collectionId}/items`, {
      method: "DELETE",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ print_ids: printIds }),
    });
    assertOk(res, "Remove from collection failed");
  },

  listForPrint: async (printId: string): Promise<CollectionMembership[]> => {
    const res = await fetch(`${apiBase()}/print/${printId}/collections`, { headers: authHeaders() });
    assertOk(res, "Failed to list collections");
    return res.json();
  },

  /** Every real collection, with how many of `printIds` it holds. */
  listForPrints: async (printIds: string[]): Promise<CollectionCount[]> => {
    const byId = new Map<string, CollectionCount>();
    for (let i = 0; i < printIds.length; i += BULK_LIMIT) {
      const res = await fetch(`${apiBase()}/prints/collections`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ print_ids: printIds.slice(i, i + BULK_LIMIT) }),
      });
      assertOk(res, "Failed to list collections");
      for (const row of (await res.json()) as CollectionCount[]) {
        const seen = byId.get(row.id);
        if (seen) seen.count += row.count;
        else byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  },

  bookmark: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${id}/bookmark`, { method: "POST", headers: authHeaders() });
    assertOk(res, "Failed to bookmark collection");
  },

  unbookmark: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${id}/bookmark`, { method: "DELETE", headers: authHeaders() });
    assertOk(res, "Failed to remove bookmark");
  },

  /** One source's settings; the collection's other sources keep theirs. */
  updateSync: async (
    id: string,
    syncId: string,
    settings: { profile_scope?: SyncProfileScope; interval_hours?: SyncIntervalHours },
  ): Promise<CollectionSync> => {
    const res = await fetch(`${apiBase()}/collection/${id}/sync/${syncId}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to save sync settings"));
    return res.json();
  },

  /** Links this collection to a provider's, alongside any it already follows, from the sync dialog's Browse tab.
   *  `title`: the provider collection's name, to tell the sources apart. `importing`: the provider collection's current
   *  models are being imported (not on MakerWorld, which only follows new ones). `waiting`: a private Printables
   *  collection or likes, whose models come in on the user's next visit to Printables with Thingport Grab. */
  enableSync: async (
    id: string,
    input: {
      url: string;
      title?: string | null;
      profile_scope?: SyncProfileScope;
      interval_hours?: SyncIntervalHours;
    },
  ): Promise<{ sync: CollectionSync; importing: boolean; waiting: boolean }> => {
    const res = await fetch(`${apiBase()}/collection/${id}/sync`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to start syncing"));
    return res.json();
  },

  /** Starts a sync of one source of this collection; its result arrives as a notification. Answers with the source as
   *  it starts, its Sync now cool-down included. */
  runSync: async (id: string, syncId: string): Promise<CollectionSync> => {
    const res = await fetch(`${apiBase()}/collection/${id}/sync/${syncId}/run`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to start syncing"));
    return res.json();
  },

  /** The collection, its models and its other sources stay; new models from this source just stop coming in. */
  stopSync: async (id: string, syncId: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/collection/${id}/sync/${syncId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to stop syncing"));
  },
};

/** `collection` with `sync` in place of the source of the same id, or added when it's new. */
export function withSync(collection: Collection, sync: CollectionSync): Collection {
  const known = collection.syncs.some((s) => s.id === sync.id);
  const syncs = known ? collection.syncs.map((s) => (s.id === sync.id ? sync : s)) : [...collection.syncs, sync];
  return { ...collection, syncs, sync: syncs[0] ?? null };
}

/** `collection` without the source `syncId`. */
export function withoutSync(collection: Collection, syncId: string): Collection {
  const syncs = collection.syncs.filter((s) => s.id !== syncId);
  return { ...collection, syncs, sync: syncs[0] ?? null };
}
