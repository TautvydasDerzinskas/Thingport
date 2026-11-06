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
  /** Every person asking and whom, when their admin sent on several at once. */
  asks?: { requesterHandle: string | null; targetHandle: string | null }[];
  note: string | null;
  createdAt: string;
};

/** One of this instance's people asking to reach someone elsewhere, waiting for an admin's Connect. */
export type LocalRequest = {
  id: string;
  /** The instance's likely address, from the handle; the admin can change it when connecting. */
  origin: string;
  http: boolean;
  userName: string | null;
  requesterHandle: string | null;
  targetHandle: string | null;
  note: string | null;
  createdAt: string;
};

export type Instances = {
  incoming: IncomingRequest[];
  local: LocalRequest[];
  outgoing: Peer[];
  partners: Peer[];
  blocked: Peer[];
};

export type RequestDetails = InstanceInfo & {
  id: string;
  verified: true;
  /** The person here they asked to reach, when the request names one. */
  target: { username: string; displayName: string } | null;
  /** What the request that checked out says: a newer one under the same address, forged, may have said otherwise. */
  request?: {
    requesterName: string | null;
    note: string | null;
    asks: {
      requesterHandle: string | null;
      targetHandle: string | null;
      target: { username: string; displayName: string } | null;
    }[];
  };
};

export type MyRequestStatus = "waiting_admin" | "waiting_them" | "connected" | "declined";

export type MyRequest = {
  id: string;
  handle: string;
  note: string | null;
  status: MyRequestStatus;
  createdAt: string;
};

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

async function call<T>(method: string, path: string, body?: unknown, base = "/federation"): Promise<T> {
  const res = await fetch(`${apiBase()}${base}${path}`, {
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
  /** With `requestId`, for one of this instance's people who asked: it answers their request. */
  connect: (address: string, fingerprint: string, note: string | null, requestId?: string | null) =>
    call<{ peer: Peer }>("POST", "/connect", { address, fingerprint, note, requestId: requestId ?? null }),
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

/** A person's own requests to reach someone on another instance. */
export const connectionRequestsApi = {
  mine: () => call<MyRequest[]>("GET", "", undefined, "/me/connection-requests"),
  create: (handle: string, note: string | null) =>
    call<MyRequest>("POST", "", { handle, note }, "/me/connection-requests"),
  cancel: (id: string) => call<void>("DELETE", `/${encodeURIComponent(id)}`, undefined, "/me/connection-requests"),
};

/** Whether a check result lets federation be turned on. */
export function canTurnOn(kind: ReachabilityKind | undefined): boolean {
  return kind === "local" || kind === "public" || kind === "public_unverified";
}
