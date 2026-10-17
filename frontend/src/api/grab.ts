import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";

/** A browser's Thingport Grab, connected by approval rather than a saved password. */
export type GrabConnection = { id: string; name: string; connected_at: string; last_used_at: string | null };

async function request<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: authHeaders(payload === undefined ? undefined : { "Content-Type": "application/json" }),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await readErrorMessage(res, `Request failed (${res.status})`));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const grabApi = {
  /** Approves the Grab that opened this page: a code for it to read off the tab. */
  approve: (challenge: string, name: string): Promise<{ code: string }> =>
    request("/grab/pairings", "POST", { challenge, name }),
  list: (): Promise<GrabConnection[]> => request("/profile/grab-connections"),
  remove: (id: string): Promise<void> => request(`/profile/grab-connections/${encodeURIComponent(id)}`, "DELETE"),
};
