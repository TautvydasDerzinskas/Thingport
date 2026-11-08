import { LIKES_ID_PREFIX } from "../index.generated";
import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import {
  checkPixup3dAuth,
  fetchPixup3dCollection,
  fetchPixup3dOwnedPosts,
  fetchPixup3dWishlist,
  Pixup3dAuthError,
  type Pixup3dSession,
  pixup3dWishlistName,
} from "./api";
import { getPixup3dConnection, withPixup3dSession } from "./session";

const DISCONNECTED: SyncProblem = {
  error: "PIXUP isn't connected",
  reason: "PIXUP gives its files to signed-in members only, and it isn't connected.",
  fix: "you open pixup3d.com signed in with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "PIXUP sign-in ran out",
  reason: "PIXUP turned your sign-in down.",
  fix: "you open pixup3d.com signed in with Thingport Grab, or connect it again",
};

// A collection is kept by whose it is and its number.
const COLLECTION_KEY = /^(.+)\/(\d{1,9})$/;

/** A collection the site no longer shows: gone, unless the sign-in it was read with is what it turned down. A private
 *  one shows only to its owner, so a sign-in that ran out looks just like a deleted collection, and a sync must hold
 *  rather than unsync it then. */
async function goneUnlessSignedOut(session: Pixup3dSession | null): Promise<null> {
  if (!session) return null;
  const check = await checkPixup3dAuth(session);
  if (check === "rejected") throw new Pixup3dAuthError();
  if (check === "unreachable") throw new Error("Couldn't ask PIXUP whether the sign-in still works");
  return null;
}

export const pixup3dSync: ProviderSync = {
  // All of a list's models, not the import dialog's first few hundred, or ones past those would never be found. Paid
  // ones the user hasn't bought are left out, as they couldn't be imported; the ones they own are kept.
  fetchListing(sync) {
    return withPixup3dSession(sync.userId, async (session) => {
      const wishlistOf = sync.externalId.startsWith(LIKES_ID_PREFIX)
        ? sync.externalId.slice(LIKES_ID_PREFIX.length)
        : null;
      const collection = wishlistOf ? null : sync.externalId.match(COLLECTION_KEY);
      if (!wishlistOf && !collection) return null;
      const listing = wishlistOf
        ? await fetchPixup3dWishlist(wishlistOf, Number.POSITIVE_INFINITY)
        : await fetchPixup3dCollection(collection![1], collection![2], Number.POSITIVE_INFINITY, session);
      if (!listing) return wishlistOf ? null : goneUnlessSignedOut(session);
      if (!listing.entries.some((entry) => entry.price > 0)) return listing.entries.map((entry) => entry.postId);
      if (!session) throw new Pixup3dAuthError();
      const owned = await fetchPixup3dOwnedPosts(session);
      return listing.entries.filter((entry) => entry.price === 0 || owned.has(entry.postId)).map((e) => e.postId);
    });
  },
  // Every model's files need the sign-in, so a sync waits for one rather than fail them all.
  async connectionProblem(sync) {
    const { state } = await getPixup3dConnection(sync.userId);
    return state === "disconnected" ? DISCONNECTED : state === "expired" ? EXPIRED : null;
  },
  rejected: {
    is: (err) => err instanceof Pixup3dAuthError,
    // Marked already, by the read it turned down, and only while it was still the sign-in stored: a newer one saved
    // meanwhile isn't marked for it.
    mark: async () => undefined,
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED],
  // Its wishlists are its likes, and named so.
  listName: (source) =>
    source.externalId.startsWith(LIKES_ID_PREFIX)
      ? pixup3dWishlistName(source.likesOf ?? source.externalId.slice(LIKES_ID_PREFIX.length))
      : null,
};
