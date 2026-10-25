import type { AuthUser } from "../api/auth";

const TOKEN_KEY = "thingport_auth_token";
const USER_KEY = "thingport_auth_user";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readToken(): string | null {
  const storage = getStorage();
  if (!storage) return null;
  return storage.getItem(TOKEN_KEY);
}

export function storeToken(token: string) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(TOKEN_KEY);
}

// There's no /me endpoint, so the user is stored with the token from the last login.
export function readUser(): AuthUser | null {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function storeUser(user: AuthUser) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearUser() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(USER_KEY);
}

/** When the token was issued and when it runs out, in ms, from its own claims. Null for one that can't be read. */
export function tokenLifetime(token: string): { issuedAt: number; expiresAt: number } | null {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { iat, exp } = JSON.parse(atob(payload)) as { iat?: unknown; exp?: unknown };
    if (typeof iat !== "number" || typeof exp !== "number") return null;
    return { issuedAt: iat * 1000, expiresAt: exp * 1000 };
  } catch {
    return null;
  }
}

/** Calls back when another tab signs in, renews its token or signs out. */
export function onStoredSessionChange(listener: () => void): () => void {
  const handle = (event: StorageEvent) => {
    if (event.key === TOKEN_KEY || event.key === USER_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", handle);
  return () => window.removeEventListener("storage", handle);
}

export function authHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init || {});
  const token = readToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export function appendTokenToUrl(url: string): string {
  const token = readToken();
  if (!token) return url;
  try {
    const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    parsed.searchParams.set("token", token);
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  }
}
