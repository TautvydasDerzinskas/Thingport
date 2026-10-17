import { authHeaders } from "../utils/auth";
import type { AuthResult } from "./auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";

/** A provider as the sign-in page shows it. */
export type SignInProvider = { slug: string; name: string };

export type OidcProvider = {
  id: string;
  slug: string;
  name: string;
  issuer_url: string;
  client_id: string;
  has_client_secret: boolean;
  scopes: string;
  enabled: boolean;
  create_accounts: boolean;
  link_by_email: boolean;
  /** Null until PUBLIC_URL is set. */
  redirect_uri: string | null;
  /** People who have signed in with it. */
  user_count: number;
};

export type OidcSettings = { public_url: string | null; providers: OidcProvider[] };

/** client_secret: omitted keeps the saved one, null or "" removes it. slug is only taken when adding. */
export type OidcProviderInput = {
  name: string;
  slug?: string;
  issuer_url: string;
  client_id: string;
  client_secret?: string | null;
  scopes: string;
  enabled: boolean;
  create_accounts: boolean;
  link_by_email: boolean;
};

export type OidcAccountMatch =
  | { action: "sign_in" | "link"; user: { id: string; email: string; display_name: string } }
  | { action: "create"; email: string; display_name: string }
  | { action: "refuse"; reason: string };

/** How the signed-in user can sign in: their password, and each provider they could connect or have. */
export type ProfileSignIn = {
  has_password: boolean;
  /** Recent enough to set a password or change email without confirming it's them first. */
  signed_in_recently: boolean;
  can_connect: boolean;
  providers: Array<{
    slug: string;
    name: string;
    enabled: boolean;
    connection: { id: string; email: string | null; connected_at: string; last_used_at: string | null } | null;
  }>;
};

/** Profile pages a confirm round trip comes back to. */
export type ConfirmPage = "/profile/password" | "/profile/email";

export type OidcTestOutcome =
  | { status: "waiting" }
  | { status: "done"; ok: true; claims: Record<string, unknown>; match: OidcAccountMatch }
  | { status: "done"; ok: false; error: string };

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

export const oidcApi = {
  /** Where the browser goes to sign in with a provider; the backend sends it on. */
  startUrl: (slug: string): string => `${apiBase()}/auth/oidc/${encodeURIComponent(slug)}/start`,

  /** Where the browser goes to join through a provider with an invitation. */
  inviteUrl: (slug: string, inviteToken: string): string =>
    `${apiBase()}/auth/oidc/${encodeURIComponent(slug)}/start?invite=${encodeURIComponent(inviteToken)}`,

  /** Trades the one-time code the callback page got for a session. */
  exchange: async (code: string): Promise<AuthResult> => {
    const res = await fetch(`${apiBase()}/auth/oidc/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, "Sign-in failed"));
    return res.json();
  },

  profile: (): Promise<ProfileSignIn> => request("/profile/sign-in"),
  /** The provider's URL to send the browser to; it comes back to the profile. */
  connect: (slug: string): Promise<{ url: string }> =>
    request(`/profile/sign-in/${encodeURIComponent(slug)}/connect`, "POST"),
  confirm: (slug: string, next: ConfirmPage): Promise<{ url: string }> =>
    request(`/profile/sign-in/${encodeURIComponent(slug)}/confirm`, "POST", { next }),
  disconnect: (connectionId: string): Promise<void> =>
    request(`/profile/sign-in/connections/${encodeURIComponent(connectionId)}`, "DELETE"),

  get: (): Promise<OidcSettings> => request("/settings/auth/oidc"),
  check: (issuerUrl: string): Promise<{ ok: true; issuer: string } | { ok: false; error: string }> =>
    request("/settings/auth/oidc/check", "POST", { issuer_url: issuerUrl }),
  create: (input: OidcProviderInput): Promise<OidcProvider> => request("/settings/auth/oidc/providers", "POST", input),
  update: (id: string, input: Partial<OidcProviderInput>): Promise<OidcProvider> =>
    request(`/settings/auth/oidc/providers/${encodeURIComponent(id)}`, "PATCH", input),
  remove: (id: string): Promise<void> => request(`/settings/auth/oidc/providers/${encodeURIComponent(id)}`, "DELETE"),
  startTest: (id: string): Promise<{ url: string; test_id: string }> =>
    request(`/settings/auth/oidc/providers/${encodeURIComponent(id)}/test`, "POST"),
  testOutcome: (testId: string): Promise<OidcTestOutcome> =>
    request(`/settings/auth/oidc/tests/${encodeURIComponent(testId)}`),
};
