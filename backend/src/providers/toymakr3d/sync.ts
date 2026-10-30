import { HttpError } from "../../utils/fileUtils";
import { SyncHeldError, type SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { TOYMAKR3D_LIKES_KEY, TOYMAKR3D_LIKES_NAME, Toymakr3dAuthError, fetchToymakr3dLikes } from "./api";
import { getToymakr3dConnection, getUserToymakr3dCookie, markToymakr3dSessionRejected } from "./session";

const DISCONNECTED: SyncProblem = {
  error: "Toymakr3D isn't connected",
  reason: "Toymakr3D shows liked products to their owner only, and it isn't connected.",
  fix: "you open toymakr3d.com signed in with Thingport Grab, or connect it",
};
const EXPIRED: SyncProblem = {
  error: "Toymakr3D sign-in ran out",
  reason: "Toymakr3D turned your sign-in down.",
  fix: "you open toymakr3d.com signed in with Thingport Grab, or connect it again",
};

// The liked products are Toymakr3D's only list, and need the sign-in.
const signInOnly = (externalId: string) => externalId === TOYMAKR3D_LIKES_KEY;

export const toymakr3dSync: ProviderSync = {
  async fetchListing(sync) {
    const cookie = await getUserToymakr3dCookie(sync.userId);
    if (!cookie) throw new SyncHeldError(DISCONNECTED);
    // All of them, not the import dialog's first few hundred, or likes past those would never be found.
    return (await fetchToymakr3dLikes(cookie, Number.POSITIVE_INFINITY)).entries.map((entry) => entry.modelId);
  },
  async connectionProblem(sync) {
    const { state } = await getToymakr3dConnection(sync.userId);
    return state === "disconnected" ? DISCONNECTED : state === "expired" ? EXPIRED : null;
  },
  signInOnly,
  rejected: {
    is: (err) => err instanceof Toymakr3dAuthError,
    mark: (userId) => markToymakr3dSessionRejected(userId),
    problem: EXPIRED,
  },
  problems: [DISCONNECTED, EXPIRED],
  // Its likes page names no user, so a sync reads whoever's sign-in Thingport has: there has to be one.
  async assertCanSync(userId, source) {
    if (signInOnly(source.externalId) && !(await getUserToymakr3dCookie(userId))) {
      throw new HttpError(
        400,
        "Toymakr3D shows liked products to their owner only: connect Toymakr3D first, or visit it with Thingport Grab",
      );
    }
  },
  listName: (source) => (signInOnly(source.externalId) ? TOYMAKR3D_LIKES_NAME : null),
};
