import { authHeaders } from "../utils/auth";
import { apiBase, assertOkWithMessage, readErrorMessage, UnauthorizedError } from "./client";
import type { Collection } from "./collections";
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

export type ExploreOverview = {
  people: ExplorePerson[];
  recent_models: Print[];
  recent_collections: Collection[];
  most_collected: { model: Print; copies: number }[];
};

export type ExploreUserPage = {
  user: ExplorePerson & {
    bio: string | null;
    joined_at: string;
    links: string[];
    /** Whether their own models are shown: the Models tab. */
    models_public: boolean;
  } & ProfileCoverValue;
  collections: Collection[];
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

  explore: () => getJson<ExploreOverview>("/explore", "Failed to load Explore"),

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
