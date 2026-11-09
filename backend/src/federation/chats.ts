import type { Chat, ChatAttachment, ChatMessage, Peer, Prisma, RemotePerson } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "../db";
import { getPublicUrl, getSocialSettings } from "../services/settingsService";
import { HttpError } from "../utils/fileUtils";
import { paragraphOf } from "../utils/htmlEntities";
import { originOf } from "./addresses";
import { enqueueActivity, kickDelivery } from "./delivery";
import { avatarIcon } from "./publish";
import { AP_PREFIX, getRuntime, INSTANCE, type Runtime } from "./runtime";
import { isFederationLive } from "./settings";

/** Chats with partners' people (docs/FEDERATION_DEVELOPMENT.md, "Chats"). This instance speaks for its own people:
 *  every activity is the instance actor's, signed with its key, with the person a Note is from embedded as its
 *  `attributedTo`. A partner believes that only of people on that partner's own origin, except in a room hosted on it:
 *  a room is kept by the instance that hosts it, which passes on (`Announce`) what its members elsewhere say. A partner
 *  with members keeps a copy of the room (`Chat.remoteApId`), told its name and members on each change (`Update` of
 *  its `Group`); their people's messages go to the host. Direct messages: each side keeps its own chat of the two.
 *  Storing what arrives, and notifying, is chatService's; this file is the wire. */

const AS = "https://www.w3.org/ns/activitystreams";

export type PersonCard = { id: string; name: string; handle: string | null; instance: string; origin: string };
export type IncomingPerson = { id: string; name: string | null; preferredUsername: string | null; icon: string | null };
export type IncomingNote = {
  id: string;
  attributedTo: IncomingPerson | null;
  to: string[];
  context: string | null;
  text: string;
  attachments: { href: string; name: string }[];
};
export type IncomingGroup = {
  id: string;
  name: string | null;
  summary: string | null;
  /** When its host changed it; null from one that doesn't say. */
  updated: Date | null;
  members: IncomingPerson[];
};

/** Thrown to answer a partner with an error, so its delivery tries the activity again later instead of it being lost:
 *  chats are off here for now, or a room's message came before the room. Fedify answers 500 and doesn't count it as
 *  handled. */
export class RetryLater extends Error {}

// A partner's deletion of a message not here yet: kept a while, so the message is dropped when it comes.
const TOMBSTONE_MS = 7 * 24 * 60 * 60 * 1000;
const tombstoneKey = (apId: string) => `thingport:chat-deleted:${apId}`;

/** Whether `apId` was deleted, before it came, by one of `origins` (the instance whose person wrote it, or the room's
 *  host). The record goes once it's used. */
async function deletedBefore(apId: string, origins: (string | null)[]): Promise<boolean> {
  const found = await prisma.federationKv.findUnique({ where: { key: tombstoneKey(apId) } });
  if (!found || (found.expiresAt && found.expiresAt < new Date())) return false;
  const origin = (found.value as { origin?: unknown } | null)?.origin;
  if (typeof origin !== "string" || !origins.includes(origin)) return false;
  await prisma.federationKv.delete({ where: { key: found.key } }).catch(() => {});
  return true;
}

/** Where this instance is, and its actor: all that addressing and queuing something takes. */
export type Here = Pick<Runtime, "origin" | "actorUrl">;

export const personUrl = (at: Here, userId: string) => `${at.origin}${AP_PREFIX}/actors/${userId}`;
const messageUrl = (at: Here, id: string) => `${at.origin}${AP_PREFIX}/messages/${id}`;
export const roomUrl = (at: Here, chatId: string) => `${at.origin}${AP_PREFIX}/rooms/${chatId}`;
const modelUrl = (at: Here, printId: string) => `${at.origin}${AP_PREFIX}/models/${printId}`;

/** The id of one of this instance's people, from their actor's address here; null for anything else. */
export function localUserId(runtime: Pick<Runtime, "origin">, url: string): string | null {
  const prefix = `${runtime.origin}${AP_PREFIX}/actors/`;
  const id = url.startsWith(prefix) ? url.slice(prefix.length) : "";
  return /^[a-z0-9]{10,40}$/i.test(id) && id !== "instance" ? id : null;
}

/** A room hosted here, from its Group's address; null for anything else. */
function localRoomId(runtime: Runtime, url: string): string | null {
  const prefix = `${runtime.origin}${AP_PREFIX}/rooms/`;
  const id = url.startsWith(prefix) ? url.slice(prefix.length) : "";
  return /^[a-z0-9]{10,40}$/i.test(id) ? id : null;
}

export async function live(): Promise<Runtime | null> {
  return (await isFederationLive()) ? getRuntime() : null;
}

/** Here as the runtime has it, without loading it: a chat change made while connected instances are off (a message
 *  deleted, someone joining or leaving, a room changed or deleted) is queued for partners all the same, and sent once
 *  they're on again. */
export async function here(db?: Pick<Prisma.TransactionClient, "setting">): Promise<Here> {
  // In the caller's transaction when it has one: it needn't wait for another connection while holding its own.
  const publicUrl = await getPublicUrl(db);
  // What partners know this instance by: without it nothing can be addressed to them, so the change isn't made (its
  // transaction undone) and can be made again once it's set.
  if (!publicUrl) {
    throw new HttpError(
      409,
      "Set this instance's Public URL first: partners can't be told without it",
      "no_public_url",
    );
  }
  const origin = new URL(publicUrl).origin;
  return { origin, actorUrl: new URL(`${origin}${AP_PREFIX}/actors/${INSTANCE}`) };
}

/** Federation work queued in a transaction of the chat change it follows, so neither is kept without the other. */
type Db = Prisma.TransactionClient;

/** Queues `activity` for `peer`. `chat`: the room's address, or the person a direct chat is with; what's queued for one
 *  goes in order. */
async function send(
  runtime: Here,
  peer: Pick<Peer, "id" | "origin" | "inboxUrl">,
  chat: string,
  activity: Record<string, unknown>,
  tx?: Db,
): Promise<void> {
  if (!peer.inboxUrl) return;
  await enqueueActivity(
    {
      origin: peer.origin,
      inboxUrl: peer.inboxUrl,
      peerId: peer.id,
      orderKey: chat,
      activity: {
        "@context": AS,
        id: `${runtime.origin}${AP_PREFIX}/activities/${crypto.randomUUID()}`,
        actor: runtime.actorUrl.href,
        ...activity,
      },
    },
    tx,
  );
}

/** Sends what was queued in a transaction, once it's committed. */
export function kick(): void {
  kickDelivery();
}

/** One of this instance's people, as a Note names them. */
export async function localPerson(runtime: Here, userId: string, db: Db = prisma): Promise<Record<string, unknown>> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true } });
  const icon = await avatarIcon(runtime, userId);
  return {
    id: personUrl(runtime, userId),
    type: "Person",
    name: user?.displayName.slice(0, 120) ?? "Someone",
    preferredUsername: user?.username ?? undefined,
    icon: icon ? { type: "Image", url: icon } : undefined,
  };
}

/** Someone a message came from, as it said, for showing them while they're not (or no longer) known here. */
export function cardOf(person: IncomingPerson): PersonCard {
  const origin = originOf(person.id) ?? "";
  const host = origin ? new URL(origin).host : "";
  return {
    id: person.id,
    name: (person.name || person.preferredUsername || host || "Someone").slice(0, 120),
    handle: person.preferredUsername ? `${person.preferredUsername.toLowerCase().slice(0, 30)}@${host}` : null,
    instance: host,
    origin,
  };
}

type StoredMessage = ChatMessage & { attachments: ChatAttachment[] };

/** A message as a Note: one written here by one of its people, or one from elsewhere this instance passes on. */
async function noteOf(runtime: Runtime, message: StoredMessage, context: string | null, to: string[], db: Db = prisma) {
  const card = message.remoteSenderCard as PersonCard | null;
  const attributedTo =
    message.senderId && !card
      ? await localPerson(runtime, message.senderId, db)
      : card
        ? { id: card.id, type: "Person", name: card.name, preferredUsername: card.handle?.split("@")[0] }
        : null;
  return {
    id: message.apId ?? messageUrl(runtime, message.id),
    type: "Note",
    attributedTo,
    to,
    ...(context ? { context } : {}),
    content: paragraphOf(message.body),
    source: { content: message.body, mediaType: "text/plain" },
    published: message.createdAt.toISOString(),
    attachment: message.attachments.flatMap((attachment) =>
      attachment.printId
        ? [{ type: "Link", href: modelUrl(runtime, attachment.printId), name: attachment.name }]
        : attachment.remoteModelApId
          ? [{ type: "Link", href: attachment.remoteModelApId, name: attachment.name }]
          : [],
    ),
  };
}

type ChatWithRemote = Chat & {
  remoteMembers: { person: RemotePerson & { peer: Peer } }[];
  hostPeer: Peer | null;
};

async function chatWithRemote(chatId: string, db: Db = prisma): Promise<ChatWithRemote | null> {
  return db.chat.findUnique({
    where: { id: chatId },
    include: { remoteMembers: { include: { person: { include: { peer: true } } } }, hostPeer: true },
  });
}

/** The partners with people in a chat hosted here, now. */
export async function partnersOf(chatId: string): Promise<string[]> {
  const rows = await prisma.chatRemoteMember.findMany({
    where: { chatId },
    select: { person: { select: { peerId: true } } },
  });
  return [...new Set(rows.map((row) => row.person.peerId))];
}

// Sent to while paused too: delivery keeps what's queued for a paused partner, in order, until it's resumed.
const reachable = (peer: Peer | null | undefined): peer is Peer =>
  Boolean(peer && (peer.status === "ACTIVE" || peer.status === "PAUSED"));
const REACHABLE = { in: ["ACTIVE", "PAUSED"] as ("ACTIVE" | "PAUSED")[] };
// A room's update, kept well inside what a partner's inbox takes (256 KiB), however long its members' names.
const GROUP_BUDGET = 200 * 1024;

// ---------------------------------------------------------------------------------------------------------------------
// Sending

/** A message written here, sent on to wherever else it's read: the other person's instance, every partner with members
 *  in a room hosted here, or the host of a room hosted elsewhere. */
export async function messageWritten(chatId: string, messageId: string, tx?: Db): Promise<void> {
  const db = tx ?? prisma;
  const runtime = await live();
  const chat = await chatWithRemote(chatId, db);
  if (!runtime || !chat) return;
  const message = await db.chatMessage.findUnique({ where: { id: messageId }, include: { attachments: true } });
  if (!message || message.deletedAt || !message.senderId) return;
  const id = messageUrl(runtime, message.id);
  const sent = { ...message, apId: id };
  if (chat.hostPeerId) {
    if (!reachable(chat.hostPeer) || !chat.remoteApId) return;
    const note = await noteOf(runtime, sent, chat.remoteApId, [chat.remoteApId], db);
    await send(runtime, chat.hostPeer, chat.remoteApId, { type: "Create", to: [chat.remoteApId], object: note }, tx);
  } else if (chat.kind === "DIRECT") {
    const other = chat.remoteMembers[0]?.person;
    if (!other || !reachable(other.peer)) return;
    const note = await noteOf(runtime, sent, null, [other.apId], db);
    await send(runtime, other.peer, other.apId, { type: "Create", to: [other.apId], object: note }, tx);
  } else {
    const room = roomUrl(runtime, chat.id);
    const note = await noteOf(runtime, sent, room, [room], db);
    for (const peer of peersIn(chat)) await send(runtime, peer, room, { type: "Create", to: [room], object: note }, tx);
  }
  await db.chatMessage.updateMany({ where: { id: message.id, apId: null }, data: { apId: id } });
}

const peersIn = (chat: ChatWithRemote): Peer[] => {
  const peers = new Map(chat.remoteMembers.map(({ person }) => [person.peer.id, person.peer]));
  return [...peers.values()].filter(reachable);
};

/** A message deleted here, deleted wherever else it's kept. `exceptPeerId`: the partner it was deleted from, already
 *  without it. */
export async function messageDeleted(chatId: string, messageId: string, exceptPeerId?: string, tx?: Db): Promise<void> {
  const db = tx ?? prisma;
  const runtime = await here();
  const chat = await chatWithRemote(chatId, db);
  const message = await db.chatMessage.findUnique({ where: { id: messageId }, select: { apId: true, senderId: true } });
  if (!chat || !message) return;
  // One written here and deleted before it went out still has the address it went out under.
  const apId = message.apId ?? (message.senderId ? messageUrl(runtime, messageId) : null);
  if (!apId) return;
  const peers = chat.hostPeerId ? (reachable(chat.hostPeer) ? [chat.hostPeer] : []) : peersIn(chat);
  const order =
    chat.remoteApId ??
    (chat.kind === "DIRECT" ? chat.remoteMembers[0]?.person.apId : null) ??
    roomUrl(runtime, chat.id);
  for (const peer of peers) {
    if (peer.id !== exceptPeerId) await send(runtime, peer, order, { type: "Delete", object: apId }, tx);
  }
}

type GroupMember = { id: string; type: "Person"; name: string; preferredUsername?: string };

/** Everyone in a room as its update names them, no pictures, names cut as far as it takes to stay within the budget:
 *  every member is in it, whatever their names. */
function membersWithin(members: GroupMember[]): GroupMember[] {
  for (const length of [80, 24, 8, 0]) {
    const cut = members.map((member) => ({ ...member, name: member.name.slice(0, length) }));
    if (length === 0 || Buffer.byteLength(JSON.stringify(cut)) <= GROUP_BUDGET) return cut;
  }
  return members;
}

/** A room hosted here, as its partners with members are told it: its name, description and everyone in it, stamped with
 *  when, so a partner never applies an older one over a newer. `formerPeerIds` are told too, so those whose people are no
 *  longer in it drop their copy. */
export async function roomChanged(chatId: string, formerPeerIds: string[] = [], tx?: Db): Promise<void> {
  const db = tx ?? prisma;
  const runtime = await here();
  const chat = await chatWithRemote(chatId, db);
  if (!chat || chat.kind !== "ROOM" || chat.hostPeerId) return;
  const locals = await db.chatMember.findMany({
    where: { chatId },
    select: { user: { select: { id: true, displayName: true, username: true } } },
  });
  const members = membersWithin([
    ...locals.map(({ user }) => ({
      id: personUrl(runtime, user.id),
      type: "Person" as const,
      name: user.displayName,
      preferredUsername: user.username ?? undefined,
    })),
    ...chat.remoteMembers.map(({ person }) => ({
      id: person.apId,
      type: "Person" as const,
      name: person.displayName,
      preferredUsername: person.username ?? undefined,
    })),
  ]);
  const group = {
    id: roomUrl(runtime, chat.id),
    type: "Group",
    name: chat.name ?? "Room",
    summary: chat.description ?? undefined,
    updated: new Date().toISOString(),
    attachment: members,
  };
  const peers = new Map(peersIn(chat).map((peer) => [peer.id, peer]));
  if (formerPeerIds.length) {
    for (const peer of await db.peer.findMany({ where: { id: { in: formerPeerIds }, status: REACHABLE } })) {
      peers.set(peer.id, peer);
    }
  }
  for (const peer of peers.values()) {
    const theirs = chat.remoteMembers
      .filter(({ person }) => person.peerId === peer.id)
      .map(({ person }) => person.apId);
    await send(runtime, peer, group.id, { type: "Update", to: theirs.length ? theirs : [group.id], object: group }, tx);
  }
}

/** A room hosted here deleted: its partners drop their copies. */
export async function roomDeleted(chatId: string, peerIds: string[], tx?: Db): Promise<void> {
  const runtime = await here();
  if (!peerIds.length) return;
  for (const peer of await (tx ?? prisma).peer.findMany({ where: { id: { in: peerIds }, status: REACHABLE } })) {
    const room = roomUrl(runtime, chatId);
    await send(runtime, peer, room, { type: "Delete", object: room }, tx);
  }
}

/** Someone here left a room hosted elsewhere: its host takes them out. */
export async function roomLeft(chat: Chat, userId: string, tx?: Db): Promise<void> {
  const runtime = await here();
  if (!chat.hostPeerId || !chat.remoteApId) return;
  const host = await (tx ?? prisma).peer.findUnique({ where: { id: chat.hostPeerId } });
  if (!reachable(host)) return;
  const left = { type: "Remove", object: personUrl(runtime, userId), target: chat.remoteApId };
  await send(runtime, host, chat.remoteApId, left, tx);
}

// ---------------------------------------------------------------------------------------------------------------------
// Receiving: what a partner sent, verified by Fedify against its compared key. Each only for an ACTIVE partner, with
// chats on here.

async function senderPeer(actorId: URL): Promise<Peer | null> {
  const peer = await prisma.peer.findFirst({ where: { actorUrl: actorId.href, status: "ACTIVE" } });
  if (!peer) return null;
  const { enabled, chats } = await getSocialSettings();
  // Kept at the partner, tried again, until they're back on: nothing's lost meanwhile.
  if (!enabled || !chats) throw new RetryLater("Chats are off here for now");
  return peer;
}

/** Someone on `peer`, as a message or room names them: who the index has, or kept from now on as the message said,
 *  unlisted (they may share nothing there). Only someone on that partner's own origin. In `db`'s transaction, if given:
 *  nothing it writes is kept unless that is. */
export async function personOn(
  peer: Peer,
  person: IncomingPerson,
  db: Db | typeof prisma = prisma,
): Promise<RemotePerson | null> {
  if (originOf(person.id) !== peer.origin) return null;
  const card = cardOf(person);
  const found = await db.remotePerson.findUnique({ where: { apId: person.id } });
  if (found) {
    if (found.peerId !== peer.id) return null;
    if (found.listed) return found;
    return db.remotePerson.update({
      where: { id: found.id },
      data: {
        displayName: card.name,
        username: card.handle?.split("@")[0] ?? null,
        avatarUrl: person.icon && originOf(person.icon) === peer.origin ? person.icon : found.avatarUrl,
      },
    });
  }
  // Or kept by a message that came at the same moment: skipped, not failed, which would undo a transaction it's in.
  await db.remotePerson.createMany({
    data: {
      peerId: peer.id,
      apId: person.id,
      displayName: card.name,
      username: card.handle?.split("@")[0] ?? null,
      avatarUrl: person.icon && originOf(person.icon) === peer.origin ? person.icon : null,
      listed: false,
    },
    skipDuplicates: true,
  });
  const kept = await db.remotePerson.findUnique({ where: { apId: person.id } });
  return kept?.peerId === peer.id ? kept : null;
}

export type Arrival = {
  chatId: string;
  note: IncomingNote;
  sender: RemotePerson | null;
  card: PersonCard;
};

/** Where a Note from `peer` belongs, if anywhere: a room hosted here (from one of its members on that partner), the copy
 *  of a room that partner hosts, or direct messages with one of this instance's people. */
export async function placeNote(
  actorId: URL,
  note: IncomingNote,
  relayed: boolean,
): Promise<(Arrival & { peer: Peer; hostedHere: boolean }) | null> {
  const peer = await senderPeer(actorId);
  const runtime = await getRuntime();
  if (!peer || !note.attributedTo || !note.id) return null;
  const card = cardOf(note.attributedTo);
  if (await deletedBefore(note.id, [originOf(note.attributedTo.id), peer.origin])) return null;
  if (note.context) {
    const roomId = localRoomId(runtime, note.context);
    if (roomId) {
      // A member on that partner, in a room hosted here: never passed on by anyone but its own instance.
      if (relayed || originOf(note.id) !== peer.origin) return null;
      const member = await prisma.chatRemoteMember.findFirst({
        where: { chatId: roomId, person: { apId: note.attributedTo.id, peerId: peer.id } },
        include: { person: true },
      });
      if (!member) return null;
      return { chatId: roomId, note, sender: member.person, card, peer, hostedHere: true };
    }
    // The copy of a room that partner hosts: whoever it says wrote, as its host passes it on.
    const copy = await prisma.chat.findUnique({ where: { remoteApId: note.context } });
    // Its room's update not here yet (one tried again after a failure can come later): this waits for it.
    if (!copy && originOf(note.context) === peer.origin) throw new RetryLater("That room isn't here yet");
    if (!copy || copy.hostPeerId !== peer.id) return null;
    // Its host's own people kept as known here, pictures and all; anyone else's, as the message names them.
    const sender =
      originOf(note.attributedTo.id) === peer.origin
        ? await personOn(peer, note.attributedTo)
        : await prisma.remotePerson.findUnique({ where: { apId: note.attributedTo.id } });
    return { chatId: copy.id, note, sender, card, peer, hostedHere: false };
  }
  // Direct messages: from someone on that partner, to one of this instance's people.
  if (relayed || originOf(note.attributedTo.id) !== peer.origin || originOf(note.id) !== peer.origin) return null;
  const userIds = [...new Set(note.to.flatMap((to) => localUserId(runtime, to) ?? []))];
  if (userIds.length !== 1) return null;
  const user = await prisma.user.findUnique({ where: { id: userIds[0] }, select: { id: true } });
  const sender = user ? await personOn(peer, note.attributedTo) : null;
  if (!user || !sender) return null;
  const chatId = await directChatWith(user.id, sender);
  return { chatId, note, sender, card, peer, hostedHere: false };
}

/** The direct messages between one of this instance's people and someone on a partner, started if there are none. */
export async function directChatWith(userId: string, person: RemotePerson): Promise<string> {
  const directKey = `r:${userId}:${person.apId}`;
  const found = await prisma.chat.findUnique({ where: { directKey }, select: { id: true } });
  if (found) {
    await prisma.chatRemoteMember.createMany({
      data: [{ chatId: found.id, personId: person.id }],
      skipDuplicates: true,
    });
    return found.id;
  }
  try {
    const created = await prisma.chat.create({
      data: {
        kind: "DIRECT",
        directKey,
        members: { create: [{ userId }] },
        remoteMembers: { create: [{ personId: person.id }] },
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    // Started from both sides at the same moment.
    return (await prisma.chat.findUniqueOrThrow({ where: { directKey }, select: { id: true } })).id;
  }
}

/** A message from a partner member of a room hosted here, sent on to its other partners. */
export async function relayToRoom(chatId: string, messageId: string, fromPeerId: string, tx?: Db): Promise<void> {
  const db = tx ?? prisma;
  const runtime = await live();
  const chat = await chatWithRemote(chatId, db);
  if (!runtime || !chat) return;
  const message = await db.chatMessage.findUnique({ where: { id: messageId }, include: { attachments: true } });
  if (!message) return;
  const room = roomUrl(runtime, chat.id);
  const note = await noteOf(runtime, message, room, [room], db);
  for (const peer of peersIn(chat)) {
    if (peer.id !== fromPeerId) await send(runtime, peer, room, { type: "Announce", to: [room], object: note }, tx);
  }
}

/** A room a partner hosts, as it says it is now: the copy here follows, with only those of this instance's people it
 *  names in it; with none of them, it goes. Returns the copy's id and who here was taken out of it. */
export async function roomFrom(
  actorId: URL,
  group: IncomingGroup,
): Promise<{ chatId: string; removed: string[]; peer: Peer } | null> {
  const peer = await senderPeer(actorId);
  const runtime = await getRuntime();
  if (!peer || originOf(group.id) !== peer.origin) return null;
  const locals = new Set(group.members.flatMap((member) => localUserId(runtime, member.id) ?? []));
  const users = await prisma.user.findMany({ where: { id: { in: [...locals] } }, select: { id: true } });
  const existing = await prisma.chat.findUnique({ where: { remoteApId: group.id }, include: { members: true } });
  if (existing && existing.hostPeerId !== peer.id) return null;
  const updated = group.updated ?? new Date();
  // Only what's newer than what's applied: an older update, tried again late, would put back who was taken out.
  const newer = existing
    ? { id: existing.id, OR: [{ hostUpdatedAt: null }, { hostUpdatedAt: { lt: updated } }] }
    : null;
  const memberIds = users.map((user) => user.id);
  if (!memberIds.length) {
    if (!existing || !newer) return null;
    const { count } = await prisma.chat.deleteMany({ where: newer });
    return count ? { chatId: existing.id, removed: existing.members.map((member) => member.userId), peer } : null;
  }
  const data = {
    name: (group.name ?? "Room").slice(0, 80),
    description: group.summary?.slice(0, 300) ?? null,
    hostMembers: group.members.slice(0, 1000).map(cardOf) as unknown as Prisma.InputJsonValue,
    hostUpdatedAt: updated,
  };
  let chatId: string;
  if (existing && newer) {
    const { count } = await prisma.chat.updateMany({ where: newer, data });
    if (!count) return null;
    chatId = existing.id;
  } else {
    try {
      chatId = (
        await prisma.chat.create({
          data: { kind: "ROOM", isPublic: false, remoteApId: group.id, hostPeerId: peer.id, ...data },
          select: { id: true },
        })
      ).id;
    } catch {
      // Made by another update at the same moment: this one goes again, against it.
      throw new RetryLater("That room was being made");
    }
  }
  const before = existing?.members.map((member) => member.userId) ?? [];
  const removed = before.filter((id) => !memberIds.includes(id));
  await prisma.chatMember.deleteMany({ where: { chatId, userId: { in: removed } } });
  await prisma.chatMember.createMany({
    data: memberIds.map((userId) => ({ chatId, userId })),
    skipDuplicates: true,
  });
  return { chatId, removed, peer };
}

/** What a partner deleted: the copy of a room it hosts, or a message, if it was its to delete -- its own person's, or
 *  any in a room it hosts. Returns the message's chat (and whether the room's hosted here, for passing it on). */
export async function deletionFrom(
  actorId: URL,
  objectId: string,
): Promise<
  | { kind: "room"; chatId: string; members: string[] }
  | { kind: "message"; chatId: string; messageId: string; peer: Peer; hostedHere: boolean }
  | null
> {
  const peer = await senderPeer(actorId);
  if (!peer) return null;
  const room = await prisma.chat.findUnique({ where: { remoteApId: objectId }, include: { members: true } });
  if (room) {
    if (room.hostPeerId !== peer.id) return null;
    await prisma.chat.delete({ where: { id: room.id } });
    return { kind: "room", chatId: room.id, members: room.members.map((member) => member.userId) };
  }
  const message = await prisma.chatMessage.findUnique({ where: { apId: objectId }, include: { chat: true } });
  if (!message) {
    // Its message may still be on the way (one tried again after a failure comes later): it's dropped when it comes.
    if (/^https?:\/\//i.test(objectId) && objectId.length <= 500) {
      const value = { origin: peer.origin } as Prisma.InputJsonValue;
      const expiresAt = new Date(Date.now() + TOMBSTONE_MS);
      await prisma.federationKv.upsert({
        where: { key: tombstoneKey(objectId) },
        create: { key: tombstoneKey(objectId), value, expiresAt },
        update: { value, expiresAt },
      });
    }
    return null;
  }
  const card = message.remoteSenderCard as PersonCard | null;
  const theirs = card?.origin === peer.origin;
  if (!theirs && message.chat.hostPeerId !== peer.id) return null;
  return {
    kind: "message",
    chatId: message.chatId,
    messageId: message.id,
    peer,
    hostedHere: !message.chat.hostPeerId && message.chat.kind === "ROOM",
  };
}

/** Someone on a partner leaving a room hosted here. Returns the room, for telling its partners. */
export async function leavingFrom(actorId: URL, personId: string, targetId: string): Promise<string | null> {
  const peer = await senderPeer(actorId);
  const runtime = await getRuntime();
  const roomId = peer ? localRoomId(runtime, targetId) : null;
  if (!peer || !roomId) return null;
  const { count } = await prisma.chatRemoteMember.deleteMany({
    where: { chatId: roomId, person: { apId: personId, peerId: peer.id } },
  });
  return count ? roomId : null;
}
