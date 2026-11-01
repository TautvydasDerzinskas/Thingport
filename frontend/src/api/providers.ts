import { authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";
import { type AuthSlot, isProviderId, type ProviderId } from "../providers/index.generated";

export type ConnectionStatus = "connected" | "expired" | "disconnected";
export type SlotName = AuthSlot["slot"];

/** One credential: expired once the provider turned it down. Never the credential itself. */
export type SlotState = { status: ConnectionStatus; account: string | null };

/** Whether an admin left a provider on, and how the user is connected to it, by the slots its manifest lists. */
export type ProviderState = { id: ProviderId; enabled: boolean; slots: Partial<Record<SlotName, SlotState>> };

/** The server looked at a credential and turned it down, rather than failing to answer. */
export class ConnectionRefusedError extends Error {}

export const providersApi = {
  /** Only the providers this frontend has manifests for: the backend may be older or newer. */
  list: async (): Promise<ProviderState[]> => {
    const res = await fetch(`${apiBase()}/providers`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Failed to load providers"));
    const { providers } = (await res.json()) as { providers: (Omit<ProviderState, "id"> & { id: string })[] };
    return providers.filter((p): p is ProviderState => isProviderId(p.id));
  },

  /** Checked with the provider before it's saved; null fields forget the credential. */
  saveConnection: async (
    provider: ProviderId,
    slot: SlotName,
    values: Record<string, string | null>,
  ): Promise<void> => {
    const res = await fetch(`${apiBase()}/providers/${provider}/connection/${slot}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...values, verify: true }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      const message = await readErrorMessage(res, "Failed to update the connection");
      // 422 is the provider's own no. A proxy's 403, or a 503 when it couldn't be asked, says nothing of the credential.
      throw res.status === 422 ? new ConnectionRefusedError(message) : new Error(message);
    }
  },
};
