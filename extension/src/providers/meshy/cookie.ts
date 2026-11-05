// Meshy's sign-in cookie as Supabase writes it: `base64-` and the session's JSON in base64url, or, from older Supabase
// clients, the JSON percent-encoded. The backend reads it the same way (backend/src/providers/meshy/session.ts).

export type MeshyCookieSession = { access_token?: unknown; expires_at?: unknown; user?: { id?: unknown } };

/** The session a cookie's value holds, its split chunks joined in order first; null when it isn't one. */
export function meshySessionOf(value: string): MeshyCookieSession | null {
  try {
    const text = value.startsWith("base64-")
      ? new TextDecoder().decode(
          Uint8Array.from(atob(value.slice("base64-".length).replace(/-/g, "+").replace(/_/g, "/")), (char) =>
            char.charCodeAt(0),
          ),
        )
      : decodeURIComponent(value);
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as MeshyCookieSession) : null;
  } catch {
    return null;
  }
}

/** Which chunk of the split cookie a name is; -1 for an unsplit one, which comes first on its own. */
export const meshyChunkIndex = (name: string) => Number(name.match(/\.(\d{1,2})$/)?.[1] ?? -1);
