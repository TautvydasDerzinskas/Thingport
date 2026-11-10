import { authHeaders } from "../utils/auth";
import type { CoverPreset } from "../constants/profileCovers";
import type { AvatarStyle } from "../constants/avatar";
import type { AuthUser } from "./auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";

/** A cover is either a drawn one or a linked author's picture; an uploaded picture goes through `uploadCover`. */
export type PublicProfilePatch = {
  bio?: string | null;
  cover_preset?: CoverPreset;
  cover_author_id?: string;
  /** Where the cover is cropped: 0 shows its top, 100 its bottom. */
  cover_position_y?: number;
  /** Web addresses, at most five; the list replaces the one before. */
  links?: string[];
  /** Shows the user's own models to the others on Explore. */
  models_public?: boolean;
  /** One of these at a time: a design, a linked author's picture, or back to automatic. */
  avatar_style?: AvatarStyle;
  avatar_author_id?: string;
  avatar_auto?: true;
};

async function userFrom(res: Response, fallback: string): Promise<AuthUser> {
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback));
  return (await res.json()).user;
}

/** The signed-in user's profile as the others see it: bio and cover. */
export const profileApi = {
  me: async (): Promise<AuthUser> =>
    userFrom(await fetch(`${apiBase()}/me`, { headers: authHeaders() }), "Failed to load your profile"),

  update: async (patch: PublicProfilePatch): Promise<AuthUser> =>
    userFrom(
      await fetch(`${apiBase()}/me/public-profile`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(patch),
      }),
      "Failed to save your profile",
    ),

  /** Whether a username is free, as it's typed. */
  usernameAvailable: async (
    username: string,
  ): Promise<{ available: boolean; reason: "invalid" | "taken" | null; message?: string }> => {
    const res = await fetch(`${apiBase()}/me/username-available?username=${encodeURIComponent(username)}`, {
      headers: authHeaders(),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Couldn't check the username"));
    return res.json();
  },

  setUsername: async (username: string): Promise<AuthUser> =>
    userFrom(
      await fetch(`${apiBase()}/me/username`, {
        method: "PATCH",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ username }),
      }),
      "Failed to save your username",
    ),

  /** Cut square and kept as the avatar, replacing an earlier upload. */
  uploadAvatar: async (file: File): Promise<AuthUser> => {
    const body = new FormData();
    body.append("file", file);
    return userFrom(
      await fetch(`${apiBase()}/me/avatar`, { method: "POST", headers: authHeaders(), body }),
      "Failed to upload the avatar",
    );
  },

  /** Scaled down and kept as the cover, replacing an earlier upload. */
  uploadCover: async (file: File, positionY: number): Promise<AuthUser> => {
    const body = new FormData();
    body.append("file", file);
    body.append("position_y", String(Math.round(positionY)));
    return userFrom(
      await fetch(`${apiBase()}/me/cover`, { method: "POST", headers: authHeaders(), body }),
      "Failed to upload the cover",
    );
  },
};
