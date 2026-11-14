import { type SyncProblem, SyncHeldError } from "../syncProblem";
import type { ProviderSync } from "../types";
import { HttpError } from "../../utils/fileUtils";
import {
  fetchSnapmakerList,
  parseSnapmakerListUrl,
  SnapmakerAuthError,
  snapmakerListName,
  snapmakerSiteHost,
  snapmakerSiteIdOf,
  type SnapmakerRegion,
} from "./api";
import {
  getSnapmakerConnection,
  getUserSnapmakerId,
  getUserSnapmakerToken,
  markSnapmakerTokenRejected,
} from "./session";

/** What holds a sync on a site. Each site's are worded apart, as a held sync's is found again by its error. */
function problemsOf(region: SnapmakerRegion): { disconnected: SyncProblem; expired: SyncProblem } {
  const name = region ? "Snapmaker Space China" : "Snapmaker Space";
  return {
    disconnected: { error: `${name} isn't connected`, reason: `${name} isn't connected.`, fix: "you connect it" },
    expired: {
      error: `${name} sign-in ran out`,
      reason: `Your ${name} sign-in ran out; Thingport Grab renews it while the browser it's in is open.`,
      fix: `you open ${snapmakerSiteHost(region)} with Thingport Grab, or connect it again`,
    },
  };
}

const PROBLEMS = { main: problemsOf(null), cn: problemsOf("cn") };
const problemsFor = (region: SnapmakerRegion) => PROBLEMS[region ?? "main"];

export const snapmakerSync: ProviderSync = {
  async fetchListing(sync) {
    // The user's own likes or bookmarks on a site ("likes-<id>", "cn-likes-<id>"), read as them: they're never gone.
    const { region, id } = snapmakerSiteIdOf(sync.externalId);
    const problems = problemsFor(region);
    const token = await getUserSnapmakerToken(sync.userId, region);
    if (!token) {
      const connection = await getSnapmakerConnection(sync.userId, region);
      throw new SyncHeldError(connection === "expired" ? problems.expired : problems.disconnected);
    }
    try {
      const list = id.startsWith("likes-") ? "likes" : "bookmarks";
      return (await fetchSnapmakerList(list, token, undefined, region)).entries.map((e) => e.modelId);
    } catch (err) {
      if (!(err instanceof SnapmakerAuthError)) throw err;
      await markSnapmakerTokenRejected(sync.userId, region);
      throw new SyncHeldError(problems.expired);
    }
  },
  async connectionProblem(sync) {
    const { region } = snapmakerSiteIdOf(sync.externalId);
    const problems = problemsFor(region);
    const connection = await getSnapmakerConnection(sync.userId, region);
    return connection === "disconnected" ? problems.disconnected : connection === "expired" ? problems.expired : null;
  },
  problems: Object.values(PROBLEMS).flatMap(Object.values),
  // Snapmaker shows likes and bookmarks to their owner only, and a sync reads them with the user's own sign-in: one
  // of someone else's would be fed the user's own under the other's name. Each site has its own user ids.
  async assertCanSync(userId, source) {
    const list = parseSnapmakerListUrl(source.url);
    const own = list ? await getUserSnapmakerId(userId, list.region) : null;
    if (!list || !own || own !== list.userId) {
      throw new HttpError(
        400,
        "Snapmaker Space shows likes and bookmarks to their owner only, so only your own can be synced, once Snapmaker is connected",
      );
    }
  },
  listName(source) {
    const list = parseSnapmakerListUrl(source.url);
    return list?.list ? snapmakerListName(list.list, list.region) : null;
  },
};
