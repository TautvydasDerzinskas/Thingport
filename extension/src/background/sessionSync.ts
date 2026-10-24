// Sends the instance a provider's sign-in as this browser holds it, at the endpoint its manifest names, whenever it
// changed since it was last sent. Each provider's own module says how its cookies read (providers/sessions.ts).

import { MANIFESTS, type AuthSlot, type ProviderId } from "../shared/providers/_generated";
import { STORAGE_KEYS, type StoredConfig } from "../shared/storage";
import { apiCall, requireConfig } from "./api";
import { SESSION_SOURCES } from "../providers/sessions";

/** `value` tells it from the one sent last; `body` is what its endpoint takes. `userId`: who's signed in there. */
export type BrowserSession = { value: string; body: Record<string, unknown>; userId?: string | null };

export type SessionSource = {
  /** Null when signed out there; undefined when the cookies couldn't be read, which says nothing either way. */
  read(): Promise<BrowserSession | null | undefined>;
  /** What clears the sign-in Grab sent once the user signs out there; left out where it's kept. */
  signedOut?: Record<string, unknown>;
  /** The credential it is, when not the provider's default one. */
  slot?: AuthSlot["slot"];
};

/** The endpoint every backend has, older ones included. */
function endpointOf(provider: ProviderId, slot: AuthSlot["slot"]) {
  const auth = (MANIFESTS[provider].auth as readonly AuthSlot[]).find((a) => a.slot === slot);
  if (!auth?.legacyEndpoint) throw new Error(`${provider} has no ${slot} sign-in to send`);
  return { method: auth.legacyEndpoint.method, path: `/settings/${auth.legacyEndpoint.path}` };
}

// One write at a time, so two providers syncing at once don't each drop the other's entry.
let writes: Promise<unknown> = Promise.resolve();
function remember(provider: ProviderId, entry: { account: string; value: string } | null): Promise<void> {
  const write = writes.then(async () => {
    const stored = (await chrome.storage.local.get(STORAGE_KEYS.lastSyncedSessions)) as StoredConfig;
    const sessions = { ...stored.lastSyncedSessions };
    if (entry) sessions[provider] = entry;
    else delete sessions[provider];
    await chrome.storage.local.set({ [STORAGE_KEYS.lastSyncedSessions]: sessions });
  });
  writes = write.catch(() => undefined);
  return write;
}

/** Best-effort: never throws. Says who's signed in there, where the provider's cookies tell. */
export async function syncSession(provider: ProviderId): Promise<{ userId: string | null }> {
  const source = SESSION_SOURCES[provider];
  const config = source ? await requireConfig().catch(() => null) : null;
  if (!source || !config) return { userId: null };
  const session = await source.read().catch(() => undefined);
  if (session === undefined) return { userId: null };
  const { method, path } = endpointOf(provider, source.slot ?? "default");
  // Per Thingport account, so switching the extension to another one sends it there too.
  const account = `${config.instanceUrl} ${config.email}`;
  const last = config.lastSyncedSessions?.[provider];
  try {
    if (!session) {
      // Clear the sign-in Grab sent, but not one pasted in Thingport.
      if (source.signedOut && last?.account === account) {
        await apiCall(method, path, source.signedOut);
        await remember(provider, null);
      }
    } else if (last?.account !== account || last.value !== session.value) {
      await apiCall(method, path, session.body);
      await remember(provider, { account, value: session.value });
    }
  } catch {}
  return { userId: session?.userId ?? null };
}
