import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";
import { PROVIDER_IDS, type ProviderId } from "../providers/index.generated";

/** The providers a collection can be synced with from the app. */
export const BROWSABLE_PROVIDERS = PROVIDER_IDS;
export type BrowsableProvider = ProviderId;

/** `connected`: the instance can reach the provider for this user. `account`: who they are there,
 *  for providers without a per-user login; MakerWorld's cookie already says, so it's always null. */
export type ProviderAccount = { connected: boolean; account: string | null };
export type ProviderAccounts = Record<BrowsableProvider, ProviderAccount>;

export type ProviderCollection = {
  id: string;
  name: string;
  url: string;
  model_count: number;
  thumbnails: string[];
  private: boolean;
  owner: string | null;
  /** The Thingport collection already synced with it; a provider collection syncs with one only. */
  synced: { collection_id: string; collection_name: string } | null;
  /** The user's liked models, rather than a collection. */
  likes: boolean;
};

async function call<T>(path: string, fallback: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers: authHeaders(init?.headers) });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback));
  return res.json();
}

export const providerCollectionsApi = {
  accounts: (): Promise<ProviderAccounts> => call("/provider-collections/accounts", "Failed to load providers"),

  /** `value` is a username, handle or profile link; null forgets it. */
  setAccount: (provider: BrowsableProvider, value: string | null): Promise<ProviderAccounts> =>
    call(`/provider-collections/accounts/${provider}`, "Failed to save the username", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    }),

  list: (provider: BrowsableProvider): Promise<ProviderCollection[]> =>
    call(`/provider-collections?provider=${provider}`, "Failed to load collections"),

  lookup: (url: string): Promise<ProviderCollection> =>
    call(`/provider-collections/lookup?url=${encodeURIComponent(url)}`, "Failed to find that collection"),
};
