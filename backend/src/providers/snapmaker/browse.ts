import { HttpError } from "../../utils/fileUtils";
import { createLogger } from "../../logger";
import type { ProviderBrowse } from "../types";
import { listSnapmakerCollections, SnapmakerAuthError, snapmakerSiteIdOf, type SnapmakerRegion } from "./api";
import {
  getSnapmakerConnection,
  getUserSnapmakerId,
  getUserSnapmakerToken,
  markSnapmakerTokenRejected,
} from "./session";

const log = createLogger("snapmaker");
const CONNECT = "Connect Snapmaker Space in Configuration > Providers, or visit it with Thingport Grab";
const SITES: readonly SnapmakerRegion[] = [null, "cn"];

/** A site's likes and bookmarks, read with its sign-in; one it turns down is remembered. */
async function siteCards(userId: string, region: SnapmakerRegion, token: string, snapmakerId: string) {
  try {
    return await listSnapmakerCollections(token, snapmakerId, region);
  } catch (err) {
    if (err instanceof SnapmakerAuthError) await markSnapmakerTokenRejected(userId, token, region);
    throw err;
  }
}

/** The sites the user is signed in to, with their token and who they are there. */
async function signedInSites(userId: string) {
  const sites = await Promise.all(
    SITES.map(async (region) => {
      const [token, snapmakerId] = await Promise.all([
        getUserSnapmakerToken(userId, region),
        getUserSnapmakerId(userId, region),
      ]);
      return token && snapmakerId ? [{ region, token, snapmakerId }] : [];
    }),
  );
  return sites.flat();
}

export const snapmakerBrowse: ProviderBrowse = {
  async account(userId) {
    const states = await Promise.all(SITES.map((region) => getSnapmakerConnection(userId, region)));
    return { connected: states.includes("connected"), account: null };
  },
  linkedThrough: "sign-in",
  // The user's likes and bookmarks on each site they're signed in to, which only they can read. A site that can't be
  // read leaves the other's shown, and fails the tab only when no site could be.
  async cards(userId) {
    const signedIn = await signedInSites(userId);
    if (!signedIn.length) throw new HttpError(409, CONNECT);
    const read = await Promise.allSettled(
      signedIn.map(({ region, token, snapmakerId }) => siteCards(userId, region, token, snapmakerId)),
    );
    const failed = read.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : []));
    if (failed.length === read.length) throw failed[0];
    // A sign-in turned down is remembered, and shown as expired; anything else is worth a line.
    for (const err of failed) {
      if (!(err instanceof SnapmakerAuthError))
        log.warn("one site's lists couldn't be read", { user: userId, error: err });
    }
    return read.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  },
  // Only the user's own likes and bookmarks are there to find, on the site the list is from.
  async card(userId, source) {
    const { region } = snapmakerSiteIdOf(source.externalId);
    const site = (await signedInSites(userId)).find((s) => s.region === region);
    if (!site) throw new HttpError(409, CONNECT);
    const cards = await siteCards(userId, site.region, site.token, site.snapmakerId);
    return cards.find((own) => own.id === source.externalId) ?? null;
  },
  httpError: (err) => (err instanceof SnapmakerAuthError ? new HttpError(400, err.message) : undefined),
};
