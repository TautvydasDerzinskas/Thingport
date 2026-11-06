import { authHeaders } from "../utils/auth";
import { apiBase, UnauthorizedError } from "./client";

/** What the last check found about who can reach this instance. See backend/src/federation/settings.ts. */
export type ReachabilityKind = "local" | "public" | "public_unverified" | "not_set" | "elsewhere" | "unreachable";

export type Reachability = {
  kind: ReachabilityKind;
  url: string | null;
  addresses: string[];
  checkedAt: string;
};

export type FederationSettings = {
  enabled: boolean;
  socialEnabled: boolean;
  publicUrl: string | null;
  reachability: Reachability | null;
  /** Partners that reached this instance lately. */
  confirmedBy: number;
  /** This instance's key, once it has one. */
  fingerprint: string | null;
};

export type InstanceInfo = {
  origin: string;
  name: string;
  version: string | null;
  fingerprint: string;
  http: boolean;
};

export type PeerStatus = "OUTGOING" | "ACTIVE" | "PAUSED" | "BLOCKED";

export type Peer = {
  id: string;
  origin: string;
  name: string;
  version: string | null;
  fingerprint: string | null;
  status: PeerStatus;
  initiatedBy: "us" | "them";
  note: string | null;
  http: boolean;
  createdAt: string;
  connectedAt: string | null;
  lastSeenAt: string | null;
  lastInboundAt: string | null;
  lastError: string | null;
  /** Activities still waiting to reach it. */
  pending: number;
};

export type IncomingRequest = {
  id: string;
  origin: string;
  /** As the request named itself, until it's opened and checked. */
  name: string;
  http: boolean;
  requesterHandle: string | null;
  targetHandle: string | null;
  note: string | null;
  createdAt: string;
};

export type Instances = {
  incoming: IncomingRequest[];
  outgoing: Peer[];
  partners: Peer[];
  blocked: Peer[];
};

export type RequestDetails = InstanceInfo & { id: string; verified: true };

/** A failure with the server's reason, and its code where the UI acts on it (`key_changed`, `unreachable`, ...). */
export class FederationError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}/federation${path}`, {
    method,
    headers: authHeaders(body === undefined ? {} : { "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { detail?: unknown; code?: unknown } | null;
    throw new FederationError(
      typeof data?.detail === "string" ? data.detail : `Request failed (HTTP ${res.status})`,
      typeof data?.code === "string" ? data.code : null,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const federationApi = {
  getSettings: () => call<FederationSettings>("GET", "/settings"),
  check: () => call<{ reachability: Reachability; canTurnOn: boolean }>("POST", "/check"),
  setEnabled: (enabled: boolean) => call<FederationSettings>("PATCH", "/settings", { enabled }),
  lookup: (address: string) => call<InstanceInfo>("GET", `/lookup?address=${encodeURIComponent(address)}`),
  connect: (address: string, fingerprint: string, note: string | null) =>
    call<{ peer: Peer }>("POST", "/connect", { address, fingerprint, note }),
  instances: () => call<Instances>("GET", "/instances"),
  request: (id: string) => call<RequestDetails>("GET", `/requests/${encodeURIComponent(id)}`),
  approve: (id: string, fingerprint: string) =>
    call<{ peer: Peer }>("POST", `/requests/${encodeURIComponent(id)}/approve`, { fingerprint }),
  decline: (id: string) => call<void>("POST", `/requests/${encodeURIComponent(id)}/decline`),
  blockRequest: (id: string) => call<void>("POST", `/requests/${encodeURIComponent(id)}/block`),
  pause: (id: string, paused: boolean) => call<Peer>("POST", `/peers/${encodeURIComponent(id)}/pause`, { paused }),
  checkPeer: (id: string) => call<Peer>("POST", `/peers/${encodeURIComponent(id)}/check`),
  disconnect: (id: string) => call<void>("POST", `/peers/${encodeURIComponent(id)}/disconnect`),
  block: (id: string) => call<Peer>("POST", `/peers/${encodeURIComponent(id)}/block`),
  unblock: (id: string) => call<void>("POST", `/peers/${encodeURIComponent(id)}/unblock`),
};

/** Whether a check result lets federation be turned on. */
export function canTurnOn(kind: ReachabilityKind | undefined): boolean {
  return kind === "local" || kind === "public" || kind === "public_unverified";
}
