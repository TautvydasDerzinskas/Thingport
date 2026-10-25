import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";

/** An icon the user uploaded. `url` is public, so it works anywhere an image address does. */
export type UserIcon = { id: string; name: string; url: string; created_at: string };

async function failed(res: Response, fallback: string): Promise<never> {
  if (res.status === 401) throw new UnauthorizedError();
  throw new Error(await readErrorMessage(res, fallback));
}

export const iconsApi = {
  list: async (): Promise<UserIcon[]> => {
    const res = await fetch(`${apiBase()}/icons`, { headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to load your icons");
    return (await res.json()).icons;
  },

  /** A picture is scaled down and kept as a PNG; an SVG is kept as it is. */
  upload: async (file: File): Promise<UserIcon> => {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`${apiBase()}/icons`, { method: "POST", headers: authHeaders(), body });
    if (!res.ok) return failed(res, "Failed to upload the icon");
    return res.json();
  },

  remove: async (id: string): Promise<void> => {
    const res = await fetch(`${apiBase()}/icons/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) return failed(res, "Failed to delete the icon");
  },
};
