import { authHeaders } from "../utils/auth";
import { apiBase, UnauthorizedError } from "./client";

/** What the last check found about who can reach this instance. See backend/src/federation/settings.ts. */
export type ReachabilityKind = "local" | "public" | "public_unverified" | "not_set" | "elsewhere" | "unreachable";

/** Why the Public URL didn't lead back here: `reserved` is this machine or a reserved range. */
export type ProbeFailure = "reserved" | "not_found" | "timeout" | "refused" | "certificate" | "redirect" | "failed";

export type Reachability = {
  kind: ReachabilityKind;
  url: string | null;
  addresses: string[];
  checkedAt: string;
  reason?: ProbeFailure | null;
  /** What the failure said: the error, the redirect's target, or the status something else answered with. */
  detail?: string | null;
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
  /** Why this instance should keep a link open to it, if it should: nothing reaches this one at its Public URL, or
   *  it's on the internet and this one is on a local network only, or on a public address nothing has confirmed. */
  suggestLink?: "unreachable" | "local" | "unconfirmed" | null;
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
  /** "ours": this instance keeps a link open to it, as it can't reach this one; "theirs": it keeps one open to this
   *  instance. */
  link: "ours" | "theirs" | null;
  linkOpen: boolean | null;
  linkSeenAt: string | null;
  /** Another instance at this one's address connected with them already. */
  addressTaken: boolean;
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
  /** It can't be reached from here, and keeps a link open to this instance instead. */
  link: boolean;
  linkOpen: boolean | null;
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
  /** It keeps a link open to this instance, which everything about it goes through. */
  link: boolean;
  /** For one with a link: another instance answering at its address directly, with its own key. */
  elsewhere: { name: string; fingerprint: string } | null;
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
  connect: (address: string, fingerprint: string, note: string | null, requestId?: string | null, link = false) =>
    call<{ peer: Peer }>("POST", "/connect", { address, fingerprint, note, requestId: requestId ?? null, link }),
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

/** Whether a check result lets federation be turned on: anything but no Public URL, or one on this machine. One
 *  nothing reaches still connects to the instances it reaches, keeping a link open to each. */
export function canTurnOn(reachability: Reachability | null | undefined): boolean {
  if (!reachability) return false;
  return reachability.kind !== "not_set" && reachability.reason !== "reserved";
}

/** Whether only links work: nothing reaches this instance at its Public URL, but it can be turned on. */
export function linksOnly(reachability: Reachability | null | undefined): boolean {
  return (reachability?.kind === "unreachable" || reachability?.kind === "elsewhere") && canTurnOn(reachability);
}
