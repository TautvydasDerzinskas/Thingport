// How syncs and the Browse tab treat each provider beyond the first three, with the providers' own calls mocked: what a
// sync reads, what holds it, what turning one on checks, and the cards the Browse tab shows.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.IMPORT_COLLECTION_DELAY_MS = "0";
  process.env.COLLECTION_SYNC_ITEM_DELAY_MS = "0";
});

const fns = vi.hoisted(() => ({
  fetchSnapmakerList: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listSnapmakerCollections: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchMakeronlineCollection: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchMakeronlineLikes: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchMakeronlineCollectionInfo: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMakeronlineCollections: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchCrealitycloudCollection: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchCrealitycloudLikes: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listCrealitycloudCollections: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchNexprintCollection: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listNexprintCollections: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchThangsCollection: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchThangsLikes: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchThangsPurchases: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listThangsCollections: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchCults3dLikes: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchCults3dOrders: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchCults3dPrintlist: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listCults3dCollections: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  checkMyminifactoryCollection: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchMyminifactoryCollectionObjects: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMyminifactoryUserCollections: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  fetchMyminifactoryCollectionCard: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  resolveMyminifactoryUser: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

const pick = vi.hoisted(
  () => (names: string[]) => Object.fromEntries(names.map((name) => [name, fns[name as keyof typeof fns]])),
);
vi.mock("../src/providers/snapmaker/api", async (original) => ({
  ...(await original<object>()),
  ...pick(["fetchSnapmakerList", "listSnapmakerCollections"]),
}));
vi.mock("../src/providers/makeronline/api", async (original) => ({
  ...(await original<object>()),
  ...pick([
    "fetchMakeronlineCollection",
    "fetchMakeronlineLikes",
    "fetchMakeronlineCollectionInfo",
    "listMakeronlineCollections",
  ]),
}));
vi.mock("../src/providers/crealitycloud/api", async (original) => ({
  ...(await original<object>()),
  ...pick(["fetchCrealitycloudCollection", "fetchCrealitycloudLikes", "listCrealitycloudCollections"]),
}));
vi.mock("../src/providers/nexprint/api", async (original) => ({
  ...(await original<object>()),
  ...pick(["fetchNexprintCollection", "listNexprintCollections"]),
}));
vi.mock("../src/providers/thangs/api", async (original) => ({
  ...(await original<object>()),
  ...pick(["fetchThangsCollection", "fetchThangsLikes", "fetchThangsPurchases", "listThangsCollections"]),
}));
vi.mock("../src/providers/cults3d/api", async (original) => ({
  ...(await original<object>()),
  ...pick(["fetchCults3dLikes", "fetchCults3dOrders", "fetchCults3dPrintlist", "listCults3dCollections"]),
}));
vi.mock("../src/providers/myminifactory/api", async (original) => ({
  ...(await original<object>()),
  ...pick([
    "checkMyminifactoryCollection",
    "fetchMyminifactoryCollectionObjects",
    "listMyminifactoryUserCollections",
    "fetchMyminifactoryCollectionCard",
    "resolveMyminifactoryUser",
  ]),
}));

import { prisma } from "../src/db";
import { fetchListing, runManualSync, syncCollection } from "../src/services/collectionSyncRunner";
import { enableSync, modelIdFromUrl, modelUrlFor } from "../src/services/collectionSyncService";
import {
  getProviderAccounts,
  listProviderCollections,
  lookupProviderCollection,
  setProviderAccount,
} from "../src/services/providerCollectionsService";
import { findOrCreateCollectionByName } from "../src/services/collectionService";
import { setMyminifactoryApiKey } from "../src/providers/myminifactory/apiKey";
import { PROVIDER_IDS } from "../src/providers/index.generated";
import { SnapmakerAuthError } from "../src/providers/snapmaker/api";
import { MakeronlineAuthError } from "../src/providers/makeronline/api";
import { CrealitycloudAuthError } from "../src/providers/crealitycloud/api";
import { NexprintAuthError } from "../src/providers/nexprint/api";
import { ThangsAuthError, ThangsBlockedError, ThangsPrivateCollectionError } from "../src/providers/thangs/api";
import { Cults3dAuthError, Cults3dRateLimitError } from "../src/providers/cults3d/api";
import { setUserSnapmakerToken } from "../src/providers/snapmaker/session";
import { setUserMakeronlineToken } from "../src/providers/makeronline/session";
import { setUserCrealitycloudSession } from "../src/providers/crealitycloud/session";
import { setUserNexprintSession } from "../src/providers/nexprint/session";
import { setUserThangsSession } from "../src/providers/thangs/session";
import { setUserCults3dBrowser, setUserCults3dCredentials } from "../src/providers/cults3d/session";

const stamp = Date.now();
let counter = 0;
const LATER = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

async function newUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `provider-syncs-${stamp}-${counter++}@example.com`, displayName: "Provider Syncs" },
  });
  return user.id;
}

const connect = {
  snapmaker: (userId: string, snapmakerId = "12345") =>
    setUserSnapmakerToken(userId, { token: "sm-token", expiresAt: LATER, userId: snapmakerId }),
  makeronline: (userId: string) =>
    setUserMakeronlineToken(userId, { token: "mo-token", expiresAt: LATER, userId: "mo-user" }),
  crealitycloud: (userId: string, crealityId = "12345") =>
    setUserCrealitycloudSession(userId, { token: "cc-token", userId: crealityId, expiresAt: LATER }),
  nexprint: (userId: string) => setUserNexprintSession(userId, { token: "np-token", expiresAt: LATER }),
  thangs: (userId: string) =>
    setUserThangsSession(userId, {
      token: "th-token",
      refreshToken: "th-refresh",
      userId: "th-user",
      expiresAt: LATER,
    }),
  cults3d: async (userId: string, site = true) => {
    await setUserCults3dCredentials(userId, { nick: "creator", apiKey: "key" });
    if (site) await setUserCults3dBrowser(userId, { session: "_session_id=s", clearance: null, userAgent: null });
  },
};

const entries = (ids: string[], key = "modelId") => ({
  entries: ids.map((id) => ({ [key]: id, title: id, cover: null })),
  total: ids.length,
  truncated: false,
});

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `List ${id}`,
  url: `https://example.com/${id}`,
  modelCount: 2,
  thumbnails: [],
  private: false,
  owner: null,
  ...extra,
});

const URLS = {
  myminifactory: "https://www.myminifactory.com/users/Creator/collection/Dragons",
  snapmakerLikes: "https://space.snapmaker.com/en/creator/12345?tab=interactions&list=likes",
  snapmakerBookmarks: "https://space.snapmaker.com/creator/12345/?tab=interactions&list=bookmarks",
  makeronline: "https://www.makeronline.com/en/user/collectionDetail/owner/123456.html",
  makeronlineLikes: "https://makeronline.com/en/user/likes/models.html",
  crealitycloud: "https://www.crealitycloud.com/collection/3d-model-collection-AbCdEf",
  crealitycloudLikes: "https://crealitycloud.com/user/12345/likes",
  nexprint: "https://www.nexprint.com/en/collection/G10199482",
  thangs: "https://thangs.com/designer/someone/collection/Things-493183",
  thangsLikes: "https://thangs.com/mythangs/liked-models",
  cults3d: "https://cults3d.com/en/design-collections/Creator/My-Printlist",
  cults3dLikes: "https://cults3d.com/en/users/Creator/likes",
};

let userId: string;

/** A sync of `url` on a collection of its own, every model in `knownIds` already seen. */
async function syncRow(provider: string, externalId: string, sourceUrl: string, knownIds: string[] = []) {
  const collection = await findOrCreateCollectionByName(userId, `${provider} ${externalId} ${counter++}`);
  return prisma.collectionSync.create({
    data: { userId, collectionId: collection.id, provider, externalId, sourceUrl, knownIds },
  });
}

const errorOf = async (sync: { id: string }) =>
  (await prisma.collectionSync.findUniqueOrThrow({ where: { id: sync.id } })).lastError;

beforeEach(async () => {
  for (const fn of Object.values(fns)) fn.mockReset();
  fns.fetchThangsPurchases.mockResolvedValue(new Set(["owned"]));
  fns.fetchCults3dOrders.mockResolvedValue(new Map([["owned", "line"]]));
  await setMyminifactoryApiKey(null);
  userId = await newUser();
});

afterAll(async () => {
  await setMyminifactoryApiKey(null);
});

describe("what a sync reads", () => {
  it("reads a MyMiniFactory collection with the instance's key", async () => {
    const sync = {
      userId: "",
      provider: "myminifactory",
      externalId: "creator/dragons",
      sourceUrl: URLS.myminifactory,
    };
    await expect(fetchListing({ ...sync, userId })).rejects.toThrow("MyMiniFactory isn't connected on this Thingport");
    await setMyminifactoryApiKey("mmf-key");
    fns.checkMyminifactoryCollection.mockResolvedValueOnce(null);
    expect(await fetchListing({ ...sync, userId })).toBeNull();
    fns.checkMyminifactoryCollection.mockResolvedValueOnce({ title: "Dragons" });
    fns.fetchMyminifactoryCollectionObjects.mockResolvedValueOnce(entries(["1", "2"], "objectId"));
    expect(await fetchListing({ ...sync, userId })).toEqual(["1", "2"]);
    expect(fns.fetchMyminifactoryCollectionObjects).toHaveBeenCalledWith("creator", "dragons", "mmf-key");
  });

  it("reads the user's Snapmaker likes or bookmarks with their sign-in", async () => {
    const likes = { userId, provider: "snapmaker", externalId: "likes-12345", sourceUrl: URLS.snapmakerLikes };
    await expect(fetchListing(likes)).rejects.toBeInstanceOf(SnapmakerAuthError);
    await connect.snapmaker(userId);
    fns.fetchSnapmakerList.mockResolvedValue(entries(["7"]));
    expect(await fetchListing(likes)).toEqual(["7"]);
    expect(fns.fetchSnapmakerList).toHaveBeenLastCalledWith("likes", "sm-token");
    await fetchListing({ ...likes, externalId: "bookmarks-12345", sourceUrl: URLS.snapmakerBookmarks });
    expect(fns.fetchSnapmakerList).toHaveBeenLastCalledWith("bookmarks", "sm-token");
  });

  it("reads a MakerOnline collection without a sign-in, its likes only with one", async () => {
    const collection = { userId, provider: "makeronline", externalId: "123456", sourceUrl: URLS.makeronline };
    const likes = { userId, provider: "makeronline", externalId: "likes", sourceUrl: URLS.makeronlineLikes };
    fns.fetchMakeronlineCollection.mockResolvedValueOnce(entries(["1"]));
    expect(await fetchListing(collection)).toEqual(["1"]);
    expect(fns.fetchMakeronlineCollection).toHaveBeenLastCalledWith("123456", null);
    fns.fetchMakeronlineCollection.mockResolvedValueOnce(null);
    expect(await fetchListing(collection)).toBeNull();
    await expect(fetchListing(likes)).rejects.toThrow("MakerOnline isn't connected");
    await connect.makeronline(userId);
    fns.fetchMakeronlineLikes.mockResolvedValueOnce(entries(["2"]));
    expect(await fetchListing(likes)).toEqual(["2"]);
    expect(fns.fetchMakeronlineLikes).toHaveBeenLastCalledWith("mo-token");
  });

  it("reads Creality Cloud likes only as the account they're from", async () => {
    const likes = { userId, provider: "crealitycloud", externalId: "likes-12345", sourceUrl: URLS.crealitycloudLikes };
    await expect(fetchListing(likes)).rejects.toThrow("Creality Cloud isn't connected");
    await connect.crealitycloud(userId, "999");
    await expect(fetchListing(likes)).rejects.toThrow("Creality Cloud is connected to another account");
    await connect.crealitycloud(userId);
    fns.fetchCrealitycloudLikes.mockResolvedValueOnce(entries(["a"]));
    expect(await fetchListing(likes)).toEqual(["a"]);
    const collection = { ...likes, externalId: "3d-model-collection-AbCdEf", sourceUrl: URLS.crealitycloud };
    fns.fetchCrealitycloudCollection.mockResolvedValueOnce(entries(["b"]));
    expect(await fetchListing(collection)).toEqual(["b"]);
  });

  it("reads all of a NexPrint collection", async () => {
    fns.fetchNexprintCollection.mockResolvedValueOnce(entries(["G1"]));
    const sync = { userId, provider: "nexprint", externalId: "G10199482", sourceUrl: URLS.nexprint };
    expect(await fetchListing(sync)).toEqual(["G1"]);
    expect(fns.fetchNexprintCollection).toHaveBeenLastCalledWith("G10199482", Number.POSITIVE_INFINITY);
  });

  it("reads Thangs lists with the user's sign-in, knowing what they bought", async () => {
    const likes = { userId, provider: "thangs", externalId: "likes", sourceUrl: URLS.thangsLikes };
    await expect(fetchListing(likes)).rejects.toBeInstanceOf(ThangsAuthError);
    await connect.thangs(userId);
    fns.fetchThangsLikes.mockResolvedValueOnce(entries(["1"]));
    expect(await fetchListing(likes)).toEqual(["1"]);
    expect(fns.fetchThangsLikes).toHaveBeenLastCalledWith("th-user", new Set(["owned"]), Number.POSITIVE_INFINITY);
    fns.fetchThangsCollection.mockResolvedValueOnce(entries(["2"]));
    expect(await fetchListing({ ...likes, externalId: "493183", sourceUrl: URLS.thangs })).toEqual(["2"]);
    expect(fns.fetchThangsCollection).toHaveBeenLastCalledWith(
      "493183",
      "th-token",
      new Set(["owned"]),
      Number.POSITIVE_INFINITY,
    );
  });

  it("reads Cults3D likes and printlists with the user's API key, by slug", async () => {
    const likes = { userId, provider: "cults3d", externalId: "likes:creator", sourceUrl: URLS.cults3dLikes };
    await expect(fetchListing(likes)).rejects.toBeInstanceOf(Cults3dAuthError);
    await connect.cults3d(userId);
    const credentials = { nick: "creator", apiKey: "key" };
    fns.fetchCults3dLikes.mockResolvedValueOnce(entries(["a-slug"], "slug"));
    expect(await fetchListing(likes)).toEqual(["a-slug"]);
    expect(fns.fetchCults3dLikes).toHaveBeenLastCalledWith(
      credentials,
      "Creator",
      new Set(["owned"]),
      Number.POSITIVE_INFINITY,
    );
    fns.fetchCults3dPrintlist.mockResolvedValueOnce(null);
    const printlist = { ...likes, externalId: "creator/my-printlist", sourceUrl: URLS.cults3d };
    expect(await fetchListing(printlist)).toBeNull();
    expect(fns.fetchCults3dPrintlist).toHaveBeenLastCalledWith(
      credentials,
      "creator/my-printlist",
      new Set(["owned"]),
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("what holds a sync", () => {
  it("holds every MyMiniFactory sync while the instance has no key", async () => {
    const sync = await syncRow("myminifactory", "creator/dragons", URLS.myminifactory);
    expect(await syncCollection(sync.id)).toBe("disconnected");
    expect(await errorOf(sync)).toBe("MyMiniFactory isn't connected on this Thingport");
  });

  it("holds Snapmaker syncs without a sign-in, and once Snapmaker turns it down", async () => {
    const sync = await syncRow("snapmaker", "likes-12345", URLS.snapmakerLikes);
    expect(await syncCollection(sync.id)).toBe("disconnected");
    expect(await errorOf(sync)).toBe("Snapmaker Space isn't connected");
    await connect.snapmaker(userId);
    fns.fetchSnapmakerList.mockRejectedValueOnce(new SnapmakerAuthError());
    expect(await syncCollection(sync.id)).toBe("disconnected");
    expect(await errorOf(sync)).toBe("Snapmaker Space sign-in ran out");
  });

  it("holds only MakerOnline's likes without a sign-in", async () => {
    const likes = await syncRow("makeronline", "likes", URLS.makeronlineLikes);
    const collection = await syncRow("makeronline", "123456", URLS.makeronline, ["1"]);
    fns.fetchMakeronlineCollection.mockResolvedValue(entries(["1"]));
    expect(await syncCollection(likes.id)).toBe("disconnected");
    expect(await errorOf(likes)).toBe("MakerOnline isn't connected");
    expect(await syncCollection(collection.id)).toBe("unchanged");
    await connect.makeronline(userId);
    fns.fetchMakeronlineCollection.mockRejectedValueOnce(new MakeronlineAuthError());
    expect(await syncCollection(collection.id)).toBe("disconnected");
    expect(await errorOf(collection)).toBe("MakerOnline sign-in ran out");
  });

  it("holds only the Creality Cloud likes its sign-in was turned down for", async () => {
    await connect.crealitycloud(userId);
    const likes = await syncRow("crealitycloud", "likes-12345", URLS.crealitycloudLikes);
    const collection = await syncRow("crealitycloud", "3d-model-collection-AbCdEf", URLS.crealitycloud, ["b"]);
    fns.fetchCrealitycloudLikes.mockRejectedValueOnce(new CrealitycloudAuthError());
    expect(await syncCollection(likes.id)).toBe("disconnected");
    expect(await errorOf(likes)).toBe("Creality Cloud sign-in ran out");
    expect(await errorOf(collection)).toBeNull();
    fns.fetchCrealitycloudCollection.mockResolvedValueOnce(entries(["b"]));
    expect(await syncCollection(collection.id)).toBe("unchanged");
  });

  it("keeps a NexPrint sync going without a sign-in", async () => {
    const sync = await syncRow("nexprint", "G10199482", URLS.nexprint, ["G1"]);
    fns.fetchNexprintCollection.mockResolvedValueOnce(entries(["G1"]));
    expect(await syncCollection(sync.id)).toBe("unchanged");
  });

  it("holds Thangs syncs without a sign-in, and says so again on Sync now", async () => {
    const sync = await syncRow("thangs", "likes", URLS.thangsLikes);
    expect(await syncCollection(sync.id)).toBe("disconnected");
    expect(await errorOf(sync)).toBe("Thangs isn't connected");
    await prisma.notification.deleteMany({ where: { userId } });
    expect(await runManualSync(sync.id)).toBe("disconnected");
    const note = await prisma.notification.findFirstOrThrow({ where: { userId } });
    expect(note.body).toContain("Thangs gives its files to a signed-in user only");
    await connect.thangs(userId);
    fns.fetchThangsLikes.mockRejectedValueOnce(new ThangsAuthError());
    fns.fetchThangsPurchases.mockResolvedValueOnce(new Set());
    expect(await syncCollection(sync.id)).toBe("disconnected");
    expect(await errorOf(sync)).toBe("Thangs sign-in ran out");
  });

  it("holds Cults3D syncs for a missing API key or browser sign-in", async () => {
    const sync = await syncRow("cults3d", "likes:creator", URLS.cults3dLikes);
    expect(await syncCollection(sync.id)).toBe("disconnected");
    expect(await errorOf(sync)).toBe("Cults3D isn't connected");
    await connect.cults3d(userId, false);
    expect(await syncCollection(sync.id)).toBe("disconnected");
    expect(await errorOf(sync)).toBe("Cults3D sign-in missing");
    await connect.cults3d(userId);
    fns.fetchCults3dOrders.mockRejectedValueOnce(new Cults3dAuthError());
    expect(await syncCollection(sync.id)).toBe("disconnected");
    expect(await errorOf(sync)).toBe("Cults3D turned the API key down");
  });
});

describe("turning a sync on", () => {
  const enable = (url: string, title: string | null = "Found there") =>
    enableSync(userId, { url, title, knownIds: [] });

  it("takes only the user's own Snapmaker lists, named after the list", async () => {
    await expect(enable(URLS.snapmakerLikes)).rejects.toMatchObject({ status: 400 });
    await connect.snapmaker(userId, "999");
    await expect(enable(URLS.snapmakerLikes)).rejects.toThrow("only your own can be synced");
    await connect.snapmaker(userId);
    expect((await enable(URLS.snapmakerBookmarks)).collection_name).toBe("Snapmaker Space bookmarks");
  });

  it("takes MakerOnline's likes once it's connected", async () => {
    await expect(enable(URLS.makeronlineLikes)).rejects.toThrow("MakerOnline shows likes to their owner only");
    expect((await enable(URLS.makeronline)).collection_name).toBe("Found there");
    await connect.makeronline(userId);
    expect((await enable(URLS.makeronlineLikes)).collection_name).toBe("MakerOnline likes");
  });

  it("takes only the user's own Creality Cloud likes", async () => {
    await connect.crealitycloud(userId, "999");
    await expect(enable(URLS.crealitycloudLikes)).rejects.toThrow("only your own can be synced");
    await connect.crealitycloud(userId);
    expect((await enable(URLS.crealitycloudLikes)).collection_name).toBe("Creality Cloud likes");
    expect((await enable(URLS.crealitycloud)).collection_name).toBe("Found there");
  });

  it("takes Thangs lists once it's connected", async () => {
    await expect(enable(URLS.thangs)).rejects.toThrow("Thangs gives its files to a signed-in user only");
    await connect.thangs(userId);
    expect((await enable(URLS.thangsLikes)).collection_name).toBe("Thangs likes");
    expect((await enable(URLS.thangs)).collection_name).toBe("Found there");
  });

  it("takes anyone's Cults3D likes but only the user's own printlists, with their API key", async () => {
    await expect(enable(URLS.cults3dLikes)).rejects.toThrow("Cults3D is read with your own API key");
    await setUserCults3dCredentials(userId, { nick: "someone", apiKey: "key" });
    await expect(enable(URLS.cults3d)).rejects.toThrow("Only your own Cults3D printlists can be synced");
    expect((await enable(URLS.cults3dLikes)).collection_name).toBe("Cults3D likes (@Creator)");
    await setUserCults3dCredentials(userId, { nick: "Creator", apiKey: "key" });
    expect((await enable(URLS.cults3d)).collection_name).toBe("Found there");
  });

  it("takes MyMiniFactory and NexPrint collections as they are, named by the title", async () => {
    expect((await enable(URLS.myminifactory)).collection_name).toBe("Found there");
    expect((await enable(URLS.nexprint, null)).collection_name).toBe("NexPrint Collection G10199482");
  });
});

describe("the Browse tab", () => {
  it("says who the user is, and whether each provider is connected", async () => {
    await connect.cults3d(userId);
    await connect.thangs(userId);
    const accounts = await getProviderAccounts(userId);
    expect(Object.keys(accounts).toSorted()).toEqual([...PROVIDER_IDS].toSorted());
    expect(accounts).toMatchObject({
      snapmaker: { connected: false, account: null },
      thangs: { connected: true, account: null },
      cults3d: { connected: true, account: "creator" },
      myminifactory: { connected: false, account: null },
      printables: { connected: true, account: null },
    });
  });

  it("takes a username only where there's no sign-in to say who it is", async () => {
    for (const [provider, through] of [
      ["snapmaker", "Snapmaker Space is linked through its sign-in"],
      ["makeronline", "MakerOnline is linked through its sign-in"],
      ["crealitycloud", "Creality Cloud is linked through its sign-in"],
      ["nexprint", "NexPrint is linked through its sign-in"],
      ["thangs", "Thangs is linked through its sign-in"],
      ["cults3d", "Cults3D is linked through its API key"],
      ["makerworld", "MakerWorld is linked through its cookie"],
    ] as const) {
      await expect(setProviderAccount(userId, provider, "someone")).rejects.toMatchObject({
        status: 400,
        message: `${through} in Configuration > Providers`,
      });
    }
    await expect(setProviderAccount(userId, "myminifactory", "someone")).rejects.toMatchObject({ status: 409 });
    await setMyminifactoryApiKey("mmf-key");
    fns.resolveMyminifactoryUser.mockResolvedValueOnce(null);
    await expect(setProviderAccount(userId, "myminifactory", "nobody")).rejects.toMatchObject({ status: 404 });
    fns.resolveMyminifactoryUser.mockResolvedValueOnce({ username: "Someone" });
    expect((await setProviderAccount(userId, "myminifactory", "someone")).myminifactory).toEqual({
      connected: true,
      account: "Someone",
    });
    fns.listMyminifactoryUserCollections.mockResolvedValueOnce([card("someone/dragons")]);
    expect((await listProviderCollections(userId, "myminifactory")).map((c) => c.id)).toEqual(["someone/dragons"]);
    expect(fns.listMyminifactoryUserCollections).toHaveBeenLastCalledWith("Someone", "mmf-key");
  });

  it("lists each signed-in provider's lists, or says to connect it", async () => {
    const connectFirst = {
      snapmaker: "Connect Snapmaker Space in Configuration > Providers, or visit it with Thingport Grab",
      makeronline: "Connect MakerOnline in Configuration > Providers, or visit it with Thingport Grab",
      crealitycloud: "Connect Creality Cloud in Configuration > Providers, or visit it with Thingport Grab",
      nexprint: "Connect NexPrint in Configuration > Providers, or visit it with Thingport Grab",
      thangs: "Connect Thangs in Configuration > Providers, or visit it with Thingport Grab",
      cults3d: "Enter your Cults3D nickname and API key in Configuration > Providers",
    } as const;
    for (const [provider, message] of Object.entries(connectFirst)) {
      await expect(listProviderCollections(userId, provider as keyof typeof connectFirst)).rejects.toMatchObject({
        status: 409,
        message,
      });
    }
    for (const provider of Object.keys(connectFirst) as (keyof typeof connectFirst)[]) await connect[provider](userId);
    fns.listSnapmakerCollections.mockResolvedValueOnce([card("likes-12345")]);
    fns.listMakeronlineCollections.mockResolvedValueOnce([card("likes")]);
    fns.listCrealitycloudCollections.mockResolvedValueOnce([card("likes-12345")]);
    fns.listNexprintCollections.mockResolvedValueOnce([card("G1")]);
    fns.listThangsCollections.mockResolvedValueOnce([card("likes")]);
    fns.listCults3dCollections.mockResolvedValueOnce([card("likes:creator")]);
    const synced = await syncRow("nexprint", "G1", URLS.nexprint);
    for (const provider of Object.keys(connectFirst) as (keyof typeof connectFirst)[]) {
      expect((await listProviderCollections(userId, provider)).length).toBe(1);
    }
    expect(fns.listSnapmakerCollections).toHaveBeenCalledWith("sm-token", "12345");
    expect(fns.listMakeronlineCollections).toHaveBeenCalledWith("mo-token", "mo-user");
    expect(fns.listCrealitycloudCollections).toHaveBeenCalledWith({ token: "cc-token", userId: "12345" });
    expect(fns.listNexprintCollections).toHaveBeenCalledWith("np-token");
    expect(fns.listThangsCollections).toHaveBeenCalledWith("th-user", "th-token", new Set(["owned"]));
    expect(fns.listCults3dCollections).toHaveBeenCalledWith({ nick: "creator", apiKey: "key" }, new Set(["owned"]));
    fns.listNexprintCollections.mockResolvedValueOnce([card("G1")]);
    const [nexprint] = await listProviderCollections(userId, "nexprint");
    expect(nexprint.synced).toEqual({ collection_id: synced.collectionId, collection_name: expect.any(String) });
    expect(nexprint.likes).toBe(false);
  });

  it("answers the providers' errors the user can act on", async () => {
    await connect.nexprint(userId);
    await connect.thangs(userId);
    await connect.cults3d(userId);
    fns.listNexprintCollections.mockRejectedValueOnce(new NexprintAuthError());
    await expect(listProviderCollections(userId, "nexprint")).rejects.toMatchObject({ status: 400 });
    fns.listCults3dCollections.mockRejectedValueOnce(new Cults3dRateLimitError());
    await expect(listProviderCollections(userId, "cults3d")).rejects.toMatchObject({ status: 429 });
    fns.fetchThangsCollection.mockRejectedValueOnce(new ThangsPrivateCollectionError());
    await expect(lookupProviderCollection(userId, URLS.thangs)).rejects.toMatchObject({ status: 403 });
    fns.listThangsCollections.mockRejectedValueOnce(new ThangsBlockedError());
    await expect(listProviderCollections(userId, "thangs")).rejects.toMatchObject({ status: 429 });
    fns.listThangsCollections.mockRejectedValue(new ThangsAuthError());
    await expect(listProviderCollections(userId, "thangs")).rejects.toMatchObject({ status: 400 });
    expect((await getProviderAccounts(userId)).thangs.connected).toBe(false);
  });

  it("finds a pasted list link as the same card", async () => {
    for (const provider of ["snapmaker", "makeronline", "crealitycloud", "thangs", "cults3d"] as const) {
      await connect[provider](userId);
    }
    await setMyminifactoryApiKey("mmf-key");

    fns.listSnapmakerCollections.mockResolvedValueOnce([card("bookmarks-12345")]);
    expect((await lookupProviderCollection(userId, URLS.snapmakerBookmarks)).id).toBe("bookmarks-12345");

    fns.listMakeronlineCollections.mockResolvedValueOnce([card("likes")]);
    expect((await lookupProviderCollection(userId, URLS.makeronlineLikes)).id).toBe("likes");
    fns.fetchMakeronlineCollectionInfo.mockResolvedValueOnce({
      name: "Boxes",
      ownerId: "owner",
      modelCount: 3,
      private: true,
    });
    fns.fetchMakeronlineCollection.mockResolvedValueOnce({ entries: [{ modelId: "1", title: "", cover: "c.jpg" }] });
    expect(await lookupProviderCollection(userId, URLS.makeronline)).toMatchObject({
      id: "123456",
      name: "Boxes",
      model_count: 3,
      thumbnails: ["c.jpg"],
      private: true,
    });
    expect(fns.fetchMakeronlineCollection).toHaveBeenLastCalledWith("123456", "mo-token", 4);

    fns.listCrealitycloudCollections.mockResolvedValueOnce([card("likes-12345")]);
    expect((await lookupProviderCollection(userId, URLS.crealitycloudLikes)).id).toBe("likes-12345");
    fns.fetchCrealitycloudCollection.mockResolvedValueOnce({
      info: { name: "Toys", modelCount: 5, private: false },
      entries: [{ cover: "t.jpg" }],
    });
    expect(await lookupProviderCollection(userId, URLS.crealitycloud)).toMatchObject({
      name: "Toys",
      model_count: 5,
      thumbnails: ["t.jpg"],
    });

    fns.fetchNexprintCollection.mockResolvedValueOnce({
      info: { name: "Parts", modelCount: 1, private: false, ownerId: "o" },
      entries: [],
    });
    expect((await lookupProviderCollection(userId, URLS.nexprint)).name).toBe("Parts");
    expect(fns.fetchNexprintCollection).toHaveBeenLastCalledWith("G10199482", 4);

    fns.listThangsCollections.mockResolvedValueOnce([card("likes")]);
    expect((await lookupProviderCollection(userId, URLS.thangsLikes)).id).toBe("likes");
    fns.fetchThangsCollection.mockResolvedValueOnce({
      info: { name: "Things", owner: "someone", modelCount: 2, private: false },
      entries: [],
    });
    expect(await lookupProviderCollection(userId, URLS.thangs)).toMatchObject({ name: "Things", owner: "someone" });

    fns.fetchCults3dLikes.mockResolvedValueOnce({ entries: [{ cover: "l.jpg" }], total: 9 });
    expect(await lookupProviderCollection(userId, URLS.cults3dLikes)).toMatchObject({
      id: "likes:creator",
      name: "Cults3D likes (@Creator)",
      model_count: 9,
      likes: true,
    });
    fns.listCults3dCollections.mockResolvedValueOnce([card("creator/my-printlist")]);
    expect((await lookupProviderCollection(userId, URLS.cults3d)).id).toBe("creator/my-printlist");
    fns.listCults3dCollections.mockResolvedValueOnce([]);
    await expect(lookupProviderCollection(userId, URLS.cults3d)).rejects.toMatchObject({ status: 404 });

    fns.fetchMyminifactoryCollectionCard.mockResolvedValueOnce(card("creator/dragons"));
    expect((await lookupProviderCollection(userId, URLS.myminifactory)).id).toBe("creator/dragons");
    expect(fns.fetchMyminifactoryCollectionCard).toHaveBeenLastCalledWith("creator", "dragons", "mmf-key");
    fns.fetchMyminifactoryCollectionCard.mockResolvedValueOnce(null);
    await expect(lookupProviderCollection(userId, URLS.myminifactory)).rejects.toMatchObject({ status: 404 });
  });
});

describe("a sync's model links", () => {
  it("reads back the id of every provider's model link", () => {
    const ids: Record<string, string> = {
      makerworld: "123",
      printables: "456",
      thingiverse: "789",
      myminifactory: "1011",
      snapmaker: "1213",
      makeronline: "1415",
      crealitycloud: "flexi-shark",
      nexprint: "G1617",
      thangs: "1819",
      cults3d: "a-model",
      eufymake: "be7c829023dd11f19919128e55eac07e",
      pinshape: "111504",
      threedprintsocial: "xc68zh951g26",
    };
    const readBack = Object.fromEntries(
      PROVIDER_IDS.map((provider) => [provider, modelIdFromUrl(provider, modelUrlFor(provider, ids[provider]))]),
    );
    expect(readBack).toEqual(ids);
  });
});
