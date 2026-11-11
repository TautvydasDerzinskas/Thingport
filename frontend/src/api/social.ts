import type { License } from "./prints";
import { appendTokenToUrl, authHeaders } from "../utils/auth";
import { apiBase, assertOkWithMessage, readErrorMessage, UnauthorizedError } from "./client";
import { sharePeopleIn, type Collection, type SharePerson } from "./collections";
import { FederationError } from "./federation";
import type { ListPrintsResult, Print, PrintSortMode } from "./prints";
import type { ProfileCoverValue } from "../constants/profileCovers";

/** Another of the instance's users, as social features show them: never their email. */
export type UserCard = {
  id: string;
  display_name: string;
  /** Of the provider profile they linked as themselves, when it has one. */
  avatar_url: string | null;
};

/** Asked for something of Explore while an admin has social features off. */
export class SocialOffError extends Error {
  constructor() {
    super("Social features are off");
  }
}

export type SocialStatus = {
  /** An admin has social features on: collections can be made public. */
  enabled: boolean;
  /** And there's someone else on the instance: the sidebar offers Explore. */
  explore: boolean;
  /** And chats are on too: the sidebar offers Chats. */
  chats: boolean;
  /** Connected instances are on: usernames show as handles, and people can ask to reach someone elsewhere. */
  federation: boolean;
  /** What follows the @ in this instance's handles, while federation is on. */
  instance_host: string | null;
};

/** Administration > Users' social features card and its settings. `chats` counts only while `enabled` is on. */
export type SocialSettings = { enabled: boolean; chats: boolean };

export type ExplorePerson = UserCard & { collection_count: number; model_count: number };

/** A partner instance there's something of to show: Explore's filter. */
export type InstanceRef = { id: string; name: string; origin: string; http: boolean };

/** Someone on a partner instance, as Explore shows them: their picture comes through this instance. */
export type RemoteOwner = { id: string; display_name: string; avatar_url: string | null };

export type RemotePerson = RemoteOwner & {
  /** username@their-instance. */
  handle: string | null;
  collection_count: number;
  model_count: number;
  shared_at: string | null;
  instance: InstanceRef;
};

export type RemoteModelCard = {
  id: string;
  title: string;
  thumb_url: string | null;
  file_count: number;
  shared_at: string | null;
  owner: RemoteOwner;
  instance: InstanceRef;
};

export type RemoteCollectionCard = {
  id: string;
  name: string;
  description: string | null;
  item_count: number;
  cover_urls: string[];
  updated_at: string | null;
  owner: RemoteOwner;
  instance: InstanceRef;
};

export type ExploreOverview = {
  people: ExplorePerson[];
  recent_models: Print[];
  recent_collections: Collection[];
  most_collected: { model: Print; copies: number }[];
  /** Collections their owners shared with the user, the latest first: the first page, the rest from `sharedWithYou`. */
  shared_with_you?: Collection[];
  shared_with_you_total?: number;
  /** When each of the above was last shared, by id: what orders partners' beside them. */
  shared_at?: { people: Record<string, string>; models: Record<string, string>; collections: Record<string, string> };
  /** What partners share, while connected instances are on, and what their people shared with the user (with when). */
  elsewhere?: {
    people: RemotePerson[];
    recent_models: RemoteModelCard[];
    recent_collections: RemoteCollectionCard[];
    shared_with_you?: (RemoteCollectionCard & { shared_at: string })[];
    /** How many there are: the rest from `elsewhere.shared`. */
    shared_with_you_total?: number;
  };
  instances?: InstanceRef[];
};

/** A collection a partner's person shared with the user, with when. */
export type RemoteSharedCard = RemoteCollectionCard & { shared_at: string };

/** Explore narrowed: everything, this instance's own, or one partner's (its id). */
export type ExploreScope = "all" | "here" | string;

export type RemotePersonPage = {
  person: RemotePerson & {
    bio: string | null;
    links: string[];
    joined_at: string | null;
  } & ProfileCoverValue;
  /** The first page of them; the rest from `elsewhere.personCollections`. */
  collections: RemoteCollectionCard[];
  collections_total: number;
};

export type RemoteModel = RemoteModelCard & {
  description: string | null;
  images: string[];
  /** `url` is API-relative, through this instance; null when the partner gave no address for the file. */
  /** `folder` as Plate.folder, from a partner new enough to say. */
  files: { name: string; folder?: string | null; size: number | null; media_type: string | null; url: string | null }[];
  updated_at: string | null;
  owner_handle: string | null;
  collections: { id: string; name: string }[];
  /** The viewer's own copy of it, once they made one. */
  library_copy_id: string | null;
  /** As its owner's library has it; absent from an older instance, or a partner too old to say. */
  license?: License | null;
  creator?: string | null;
  source_provider?: string | null;
  source_url?: string | null;
};

/** Copying a partner's model into the viewer's library, file by file, in the background. */
export type RemoteCopyStatus = {
  state: "idle" | "copying" | "done" | "failed";
  files: { name: string; size: number | null; received: number; done: boolean }[];
  copy_id: string | null;
  error: string | null;
};

/** Where a copy of a partner's model came from. `owner_avatar_url` is API-relative, as the other files are. */
export type RemoteOrigin = {
  instance: Pick<InstanceRef, "name" | "origin" | "http">;
  /** Their page here, while their instance is connected and still lists them. */
  owner_id: string | null;
  owner_name: string;
  owner_handle: string | null;
  owner_avatar_url: string | null;
  /** The original's page here, while its instance is connected and still shares it. */
  original_id: string | null;
};

/** `models` is a page of them, in the collection's order; `total` counts all of them. */
export type RemoteCollectionPage = { collection: RemoteCollectionCard; models: RemoteModelCard[]; total: number };

export type ExploreUserPage = {
  user: ExplorePerson & {
    bio: string | null;
    joined_at: string;
    links: string[];
    /** Whether their own models are shown: the Models tab. */
    models_public: boolean;
  } & ProfileCoverValue;
  /** The first page of them; the rest from `userCollections`. */
  collections: Collection[];
  collections_total: number;
};

// A partner's pictures come through this instance at addresses relative to the API, like the other files: an <img>
// sends no header, so the session goes in the address.
const picture = (url: string | null): string | null => (url ? appendTokenToUrl(`${apiBase()}${url}`) : null);
const withOwner = <T extends { owner: RemoteOwner }>(item: T): T => ({
  ...item,
  owner: { ...item.owner, avatar_url: picture(item.owner.avatar_url) },
});
const personPictures = <T extends RemotePerson>(person: T): T => ({
  ...person,
  avatar_url: picture(person.avatar_url),
});
const modelPictures = <T extends RemoteModelCard>(model: T): T => ({
  ...withOwner(model),
  thumb_url: picture(model.thumb_url),
});
const collectionPictures = <T extends RemoteCollectionCard>(collection: T): T => ({
  ...withOwner(collection),
  cover_urls: collection.cover_urls.flatMap((url) => picture(url) ?? []),
});

const getOrNull = async <T>(path: string): Promise<T | null> => {
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === "social_off") throw new SocialOffError();
    return null;
  }
  await assertOkWithMessage(res, "Failed to load this");
  return res.json();
};

const remoteCopyCall = async (method: "GET" | "POST", id: string): Promise<RemoteCopyStatus> => {
  const res = await fetch(`${apiBase()}/explore/elsewhere/model/${encodeURIComponent(id)}/copy`, {
    method,
    headers: authHeaders(),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { detail?: unknown; code?: unknown } | null;
    throw new FederationError(
      typeof data?.detail === "string" ? data.detail : "Couldn't copy it",
      typeof data?.code === "string" ? data.code : null,
      res.status,
    );
  }
  return res.json();
};

const getJson = async <T>(path: string, fallback: string): Promise<T> => {
  const res = await fetch(`${apiBase()}${path}`, { headers: authHeaders() });
  if (res.status === 401) throw new UnauthorizedError();
  await assertOkWithMessage(res, fallback);
  return res.json();
};

export const socialApi = {
  status: () => getJson<SocialStatus>("/social", "Failed to load social features"),

  getSettings: () => getJson<SocialSettings>("/social/settings", "Failed to load social settings"),

  updateSettings: async (patch: Partial<SocialSettings>): Promise<SocialSettings> => {
    const res = await fetch(`${apiBase()}/social/settings`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(patch),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to update social settings"));
    return res.json();
  },

  explore: async (scope: ExploreScope = "all"): Promise<ExploreOverview> => {
    const overview = await getJson<ExploreOverview>(
      scope === "all" ? "/explore" : `/explore?scope=${encodeURIComponent(scope)}`,
      "Failed to load Explore",
    );
    const elsewhere = overview.elsewhere;
    return elsewhere
      ? {
          ...overview,
          elsewhere: {
            people: elsewhere.people.map(personPictures),
            recent_models: elsewhere.recent_models.map(modelPictures),
            recent_collections: elsewhere.recent_collections.map(collectionPictures),
            shared_with_you: (elsewhere.shared_with_you ?? []).map(collectionPictures),
            shared_with_you_total: elsewhere.shared_with_you_total,
          },
        }
      : overview;
  },

  /** What partners' people share, read-only: null for something no longer there (or connected instances off). */
  elsewhere: {
    /** What partners' people (one partner's, for its id) shared with the user, past the first page Explore came with. */
    shared: async (params: {
      scope: ExploreScope;
      limit: number;
      offset: number;
    }): Promise<{ items: RemoteSharedCard[]; total: number }> => {
      const qs = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
      if (params.scope !== "all") qs.set("scope", params.scope);
      const res = await fetch(`${apiBase()}/explore/elsewhere/shared?${qs}`, { headers: authHeaders() });
      await assertOkWithMessage(res, "Failed to load the collections");
      const items = (await res.json()) as RemoteSharedCard[];
      return { items: items.map(collectionPictures), total: Number(res.headers.get("X-Total-Count") ?? 0) };
    },
    person: async (id: string): Promise<RemotePersonPage | null> => {
      const page = await getOrNull<RemotePersonPage>(`/explore/elsewhere/person/${encodeURIComponent(id)}`);
      return (
        page && {
          person: { ...personPictures(page.person), background_url: picture(page.person.background_url ?? null) },
          collections: page.collections.map(collectionPictures),
          collections_total: page.collections_total,
        }
      );
    },
    model: async (id: string): Promise<RemoteModel | null> => {
      const model = await getOrNull<RemoteModel>(`/explore/elsewhere/model/${encodeURIComponent(id)}`);
      return model && { ...modelPictures(model), images: model.images.flatMap((url) => picture(url) ?? []) };
    },
    collection: async (id: string, params: { limit: number; offset: number }): Promise<RemoteCollectionPage | null> => {
      const qs = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
      const page = await getOrNull<RemoteCollectionPage>(
        `/explore/elsewhere/collection/${encodeURIComponent(id)}?${qs}`,
      );
      return (
        page && {
          collection: collectionPictures(page.collection),
          models: page.models.map(modelPictures),
          total: page.total,
        }
      );
    },
    personModels: async (
      id: string,
      params: { limit: number; offset: number },
    ): Promise<{ items: RemoteModelCard[]; total: number; hasMore: boolean } | null> => {
      const qs = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
      const res = await fetch(`${apiBase()}/explore/elsewhere/person/${encodeURIComponent(id)}/models?${qs}`, {
        headers: authHeaders(),
      });
      if (res.status === 401) throw new UnauthorizedError();
      if (res.status === 404) return null;
      await assertOkWithMessage(res, "Failed to load the models");
      return {
        items: ((await res.json()) as RemoteModelCard[]).map(modelPictures),
        total: Number(res.headers.get("X-Total-Count") ?? 0),
        hasMore: res.headers.get("X-Has-More") === "true",
      };
    },
    personCollections: async (
      id: string,
      params: { limit: number; offset: number },
    ): Promise<{ items: RemoteCollectionCard[]; total: number; hasMore: boolean } | null> => {
      const qs = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
      const res = await fetch(`${apiBase()}/explore/elsewhere/person/${encodeURIComponent(id)}/collections?${qs}`, {
        headers: authHeaders(),
      });
      if (res.status === 401) throw new UnauthorizedError();
      if (res.status === 404) return null;
      await assertOkWithMessage(res, "Failed to load the collections");
      return {
        items: ((await res.json()) as RemoteCollectionCard[]).map(collectionPictures),
        total: Number(res.headers.get("X-Total-Count") ?? 0),
        hasMore: res.headers.get("X-Has-More") === "true",
      };
    },
    /** Starts copying it into the viewer's library, or says how it's going: `copy_limit` and `no_files` are the
     *  codes of the reasons it can't. */
    copy: (id: string) => remoteCopyCall("POST", id),
    copyStatus: (id: string) => remoteCopyCall("GET", id),
    /** Every file of the partner's model, zipped through this instance. */
    zip: async (id: string): Promise<Response> => {
      const res = await fetch(`${apiBase()}/explore/elsewhere/model/${encodeURIComponent(id)}/files.zip`, {
        headers: authHeaders(),
      });
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { detail?: unknown; code?: unknown } | null;
        throw new FederationError(
          typeof data?.detail === "string" ? data.detail : "Failed to download the files",
          typeof data?.code === "string" ? data.code : null,
          res.status,
        );
      }
      return res;
    },
  },

  /** Null for someone who shares nothing (or no such user): told apart from a request that failed. */
  /** A page of a user's own models, once they made them public; null while they're private. */
  userModels: async (
    userId: string,
    params: { order_by?: PrintSortMode; limit: number; offset: number },
  ): Promise<ListPrintsResult | null> => {
    const qs = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    if (params.order_by) qs.set("orderBy", params.order_by);
    const res = await fetch(`${apiBase()}/explore/user/${encodeURIComponent(userId)}/models?${qs}`, {
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status === 404) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (body.code === "social_off") throw new SocialOffError();
      return null;
    }
    await assertOkWithMessage(res, "Failed to load the models");
    return {
      items: await res.json(),
      hasMore: res.headers.get("X-Has-More") === "true",
      total: Number(res.headers.get("X-Total-Count") ?? 0),
    };
  },

  /** A page of a user's public collections past the first, which came with their page; null for none any more. */
  /** Collections their owners shared with the user, past the first page Explore came with, each with when it was last
   *  shared or added to (older servers leave that out). */
  sharedWithYou: async (params: {
    limit: number;
    offset: number;
  }): Promise<{ items: (Collection & { shared_at?: string | null })[]; total: number }> => {
    const qs = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    const res = await fetch(`${apiBase()}/explore/shared?${qs}`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    await assertOkWithMessage(res, "Failed to load the collections");
    return { items: await res.json(), total: Number(res.headers.get("X-Total-Count") ?? 0) };
  },

  /** People to share a collection with: by any part of their name, or their whole email. */
  people: async (query: string): Promise<SharePerson[]> =>
    sharePeopleIn(
      (
        await getJson<{ people: SharePerson[] }>(
          `/social/people?q=${encodeURIComponent(query)}`,
          "Failed to find people",
        )
      ).people,
    ),

  userCollections: async (
    userId: string,
    params: { limit: number; offset: number },
  ): Promise<{ items: Collection[]; total: number; hasMore: boolean } | null> => {
    const qs = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
    const res = await fetch(`${apiBase()}/explore/user/${encodeURIComponent(userId)}/collections?${qs}`, {
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status === 404) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (body.code === "social_off") throw new SocialOffError();
      return null;
    }
    await assertOkWithMessage(res, "Failed to load the collections");
    return {
      items: await res.json(),
      total: Number(res.headers.get("X-Total-Count") ?? 0),
      hasMore: res.headers.get("X-Has-More") === "true",
    };
  },

  user: async (userId: string): Promise<ExploreUserPage | null> => {
    const res = await fetch(`${apiBase()}/explore/user/${encodeURIComponent(userId)}`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (res.status === 404) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (body.code === "social_off") throw new SocialOffError();
      return null;
    }
    await assertOkWithMessage(res, "Failed to load this user");
    return res.json();
  },

  /** Another user's shared model into the user's own library. A model they already have comes back instead, with
   *  `copied` false. Filing one into a collection copies it too (collectionsApi.addItem). */
  copy: async (printId: string): Promise<{ print: Print; copied: boolean }> => {
    const res = await fetch(`${apiBase()}/print/${encodeURIComponent(printId)}/copy`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    await assertOkWithMessage(res, "Failed to copy the model");
    return res.json();
  },
};
