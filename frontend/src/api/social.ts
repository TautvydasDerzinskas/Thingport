import { authHeaders } from "../utils/auth";
import { apiBase, assertOkWithMessage, readErrorMessage, UnauthorizedError } from "./client";
import type { Collection } from "./collections";
import type { Print } from "./prints";

/** Another of the instance's users, as social features show them: never their email. */
export type UserCard = {
  id: string;
  display_name: string;
  /** Of the provider profile they linked as themselves, when it has one. */
  avatar_url: string | null;
};

export type SocialStatus = {
  /** An admin has social features on: collections can be made public. */
  enabled: boolean;
  /** And there's someone else on the instance: the sidebar offers Explore. */
  explore: boolean;
};

/** Administration > Social. */
export type SocialSettings = { enabled: boolean };

export type ExplorePerson = UserCard & { collection_count: number; model_count: number };

export type ExploreOverview = {
  people: ExplorePerson[];
  recent_models: Print[];
  recent_collections: Collection[];
  most_collected: { model: Print; copies: number }[];
};

export type ExploreUserPage = {
  user: ExplorePerson & { bio: string | null; joined_at: string };
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

  user: (userId: string) =>
    getJson<ExploreUserPage>(`/explore/user/${encodeURIComponent(userId)}`, "Failed to load this user"),

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
