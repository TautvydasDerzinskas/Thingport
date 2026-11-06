import net from "node:net";
import { prisma } from "../db";
import { createLog } from "../services/auditLog";
import { createNotification } from "../services/notificationService";
import { getPublicUrl } from "../services/settingsService";
import { ensureUsername } from "../services/usernames";
import { HttpError } from "../utils/fileUtils";
import { isLocalName } from "./addresses";
import { isFederationLive } from "./settings";

/** A person's request to reach someone on an instance this one isn't connected with. It's only a note for the admins:
 *  nothing is fetched from what a person typed (see FEDERATION_DEVELOPMENT.md), and an admin's Connect does the
 *  rest. */

const MAX_PENDING_PER_USER = 10;

export type Handle = { username: string; host: string; origin: string };

/** `bob@prints.example`, `@bob@192.168.1.30:8000` or `bob@[fd00::5]:8080`: the person, and their instance's likely
 *  address. Plain HTTP for an address on a local network, HTTPS otherwise; the admin who connects can change it. */
export function parseHandle(input: string): Handle {
  const match =
    /^@?([a-z0-9](?:[a-z0-9._-]{0,28}[a-z0-9])?)@(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?$/i.exec(
      input.trim(),
    );
  const port = match?.[3] ? Number(match[3]) : null;
  if (!match || (port !== null && (port < 1 || port > 65535))) {
    throw new HttpError(400, "Enter someone's handle, like name@their.instance", "invalid_handle");
  }
  const username = match[1]!.toLowerCase();
  const hostname = match[2]!.toLowerCase();
  const host = port ? `${hostname}:${port}` : hostname;
  const bare = hostname.replace(/^\[|\]$/g, "");
  const local = net.isIP(bare) !== 0 || isLocalName(bare);
  return { username, host, origin: `${local ? "http" : "https"}://${host}` };
}

const hostOf = (origin: string) => new URL(origin).host;

export type MyRequestStatus = "waiting_admin" | "waiting_them" | "connected" | "declined";

export type MyRequest = {
  id: string;
  handle: string;
  note: string | null;
  status: MyRequestStatus;
  createdAt: string;
};

/** A person's requests and how each stands now. */
export async function listMyRequests(userId: string): Promise<MyRequest[]> {
  const requests = await prisma.peerRequest.findMany({
    where: { kind: "LOCAL", userId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const peers = await prisma.peer.findMany({
    where: { origin: { in: [...new Set(requests.map((request) => request.origin))] } },
    select: { origin: true, status: true },
  });
  const peerStatus = new Map(peers.map((peer) => [peer.origin, peer.status]));
  return requests.map((request) => {
    const peer = peerStatus.get(request.origin);
    const status: MyRequestStatus =
      request.status === "PENDING"
        ? "waiting_admin"
        : request.status === "DECLINED"
          ? "declined"
          : peer === "ACTIVE" || peer === "PAUSED"
            ? "connected"
            : peer === "OUTGOING"
              ? "waiting_them"
              : // Approved here, then declined there or disconnected since.
                "declined";
    return {
      id: request.id,
      handle: request.targetHandle ?? hostOf(request.origin),
      note: request.note,
      status,
      createdAt: request.createdAt.toISOString(),
    };
  });
}

export async function createUserRequest(userId: string, input: string, note: string | null): Promise<MyRequest> {
  if (!(await isFederationLive())) throw new HttpError(409, "Connected instances are off", "federation_off");
  const handle = parseHandle(input);
  const publicUrl = await getPublicUrl();
  if (publicUrl && hostOf(publicUrl) === handle.host) {
    throw new HttpError(400, "That's someone on this instance", "same_instance");
  }
  // Whichever scheme the instance is on: the guess above may not be the address an admin connected with.
  const known = await prisma.peer.findFirst({
    where: { origin: { in: [`http://${handle.host}`, `https://${handle.host}`] } },
    select: { status: true },
  });
  if (known?.status === "ACTIVE" || known?.status === "PAUSED") {
    throw new HttpError(409, "This instance is already connected with that one", "already_connected");
  }
  if (known?.status === "OUTGOING") {
    throw new HttpError(409, "Your admin has already asked that instance to connect", "already_asked");
  }
  if (known?.status === "BLOCKED") {
    throw new HttpError(409, "This instance doesn't connect with that one", "not_available");
  }
  const target = `${handle.username}@${handle.host}`;
  const pending = await prisma.peerRequest.findMany({
    where: { kind: "LOCAL", userId, status: "PENDING" },
    select: { targetHandle: true },
  });
  if (pending.some((request) => request.targetHandle === target)) {
    throw new HttpError(409, "You've already asked to reach them", "exists");
  }
  if (pending.length >= MAX_PENDING_PER_USER) {
    throw new HttpError(429, "Wait for your admin to answer the requests you've made", "request_limit");
  }
  const username = await ensureUsername(userId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { displayName: true } });
  const clean = (note ?? "").replace(/\s+/g, " ").trim().slice(0, 1000) || null;
  const request = await prisma.peerRequest.create({
    data: {
      kind: "LOCAL",
      origin: handle.origin,
      userId,
      requesterName: user.displayName,
      requesterHandle: publicUrl ? `${username}@${hostOf(publicUrl)}` : username,
      targetHandle: target,
      note: clean,
    },
  });
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  await Promise.all(
    admins.map((admin) =>
      createNotification(admin.id, {
        type: "federation",
        title: `${user.displayName} asks to reach ${target}`,
        body: clean ?? `${handle.host} isn't connected with this instance yet.`,
        internalPath: `/admin-social?request=${request.id}`,
      }).catch(() => {}),
    ),
  );
  void createLog({ userId, action: "federation_user_requested", targetId: request.id, details: { handle: target } });
  return {
    id: request.id,
    handle: target,
    note: clean,
    status: "waiting_admin",
    createdAt: request.createdAt.toISOString(),
  };
}

/** Withdrawn by the person who asked, while it still waits for an admin. */
export async function cancelUserRequest(userId: string, id: string): Promise<void> {
  const { count } = await prisma.peerRequest.updateMany({
    where: { id, userId, kind: "LOCAL", status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (count === 0) throw new HttpError(404, "No such request", "not_found");
}

/** Everyone whose request to reach someone on `origin`'s instance an admin sent on, told how it went. */
export async function notifyRequesters(origin: string, text: { title: string; body: string | null }): Promise<void> {
  const requests = await prisma.peerRequest.findMany({
    where: { kind: "LOCAL", status: "APPROVED", origin, userId: { not: null } },
    select: { userId: true },
  });
  const users = [...new Set(requests.map((request) => request.userId!))];
  await Promise.all(
    users.map((userId) =>
      createNotification(userId, { type: "federation", ...text, internalPath: "/explore" }).catch(() => {}),
    ),
  );
}
