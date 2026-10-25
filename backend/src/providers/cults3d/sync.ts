import { HttpError } from "../../utils/fileUtils";
import { syncLikesUsername } from "../names";
import type { SyncProblem } from "../syncProblem";
import type { ProviderSync } from "../types";
import { Cults3dAuthError, fetchCults3dLikes, fetchCults3dOrders, fetchCults3dPrintlist } from "./api";
import { getCults3dConnection, getUserCults3dCredentials, markCults3dApiRejected } from "./session";

const API_DISCONNECTED: SyncProblem = {
  error: "Cults3D isn't connected",
  reason: "Thingport reads Cults3D with your own API key, and none is set.",
  fix: "you enter your Cults3D nickname and API key",
};
const API_EXPIRED: SyncProblem = {
  error: "Cults3D turned the API key down",
  reason: "Cults3D turned your API key down; deleting it on the site ends it.",
  fix: "you enter a working Cults3D API key",
};
const SITE_DISCONNECTED: SyncProblem = {
  error: "Cults3D sign-in missing",
  reason: "Cults3D gives its files to a signed-in user only, and Thingport Grab hasn't sent the browser's sign-in.",
  fix: "you open cults3d.com signed in with Thingport Grab, or paste its sign-in",
};
const SITE_EXPIRED: SyncProblem = {
  error: "Cults3D sign-in ran out",
  reason: "Cults3D turned your sign-in down; it ends 20 days after it was last used, or on signing out.",
  fix: "you sign in on cults3d.com with Thingport Grab, or paste its sign-in again",
};

export const cults3dSync: ProviderSync = {
  async fetchListing(sync) {
    // Read with the user's API key (see connectionProblem). Paid models they own are kept in, the rest of the paid
    // ones left out.
    const credentials = await getUserCults3dCredentials(sync.userId);
    if (!credentials) throw new Cults3dAuthError();
    const owned = new Set((await fetchCults3dOrders(credentials)).keys());
    const likesOf = syncLikesUsername(sync);
    const listing = likesOf
      ? await fetchCults3dLikes(credentials, likesOf, owned, Number.POSITIVE_INFINITY)
      : await fetchCults3dPrintlist(credentials, sync.externalId, owned, Number.POSITIVE_INFINITY);
    return listing ? listing.entries.map((e) => e.slug) : null;
  },
  async connectionProblem(sync) {
    const { api, site } = await getCults3dConnection(sync.userId);
    if (api === "disconnected") return API_DISCONNECTED;
    if (api === "expired") return API_EXPIRED;
    if (site === "disconnected") return SITE_DISCONNECTED;
    if (site === "expired") return SITE_EXPIRED;
    return null;
  },
  rejected: {
    is: (err) => err instanceof Cults3dAuthError,
    mark: (userId) => markCults3dApiRejected(userId),
    problem: API_EXPIRED,
  },
  problems: [API_DISCONNECTED, API_EXPIRED, SITE_DISCONNECTED, SITE_EXPIRED],
  // Its listings are read with the user's API key, which shows no one's printlists but their own.
  async assertCanSync(userId, source) {
    const connection = await getCults3dConnection(userId);
    if (connection.api !== "connected") {
      throw new HttpError(400, "Cults3D is read with your own API key: enter it in Configuration > Providers first");
    }
    if (!source.likesOf && !source.externalId.startsWith(`${connection.nick?.toLowerCase()}/`)) {
      throw new HttpError(400, "Only your own Cults3D printlists can be synced: Cults3D's API shows no one else's");
    }
  },
};
