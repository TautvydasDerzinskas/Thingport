import type { Chat, ChatAttachment, ChatMessage, Peer, Prisma, RemotePerson } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "../db";
import { getSocialSettings } from "../services/settingsService";
import { originOf } from "./addresses";
import { enqueueActivity } from "./delivery";
import { avatarIcon } from "./publish";
import { AP_PREFIX, getRuntime, type Runtime } from "./runtime";
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
export type IncomingGroup = { id: string; name: string | null; summary: string | null; members: IncomingPerson[] };

const personUrl = (runtime: Runtime, userId: string) => `${runtime.origin}${AP_PREFIX}/actors/${userId}`;
const messageUrl = (runtime: Runtime, id: string) => `${runtime.origin}${AP_PREFIX}/messages/${id}`;
export const roomUrl = (runtime: Runtime, chatId: string) => `${runtime.origin}${AP_PREFIX}/rooms/${chatId}`;
const modelUrl = (runtime: Runtime, printId: string) => `${runtime.origin}${AP_PREFIX}/models/${printId}`;

/** The id of one of this instance's people, from their actor's address here; null for anything else. */
function localUserId(runtime: Runtime, url: string): string | null {
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

async function live(): Promise<Runtime | null> {
  return (await isFederationLive()) ? getRuntime() : null;
}

function htmlOf(text: string): string {
  const escaped = text.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
  return `<p>${escaped.replace(/\r?\n/g, "<br>")}</p>`;
}

async function send(
  runtime: Runtime,
  peer: Pick<Peer, "id" | "origin" | "inboxUrl">,
  activity: Record<string, unknown>,
): Promise<void> {
  if (!peer.inboxUrl) return;
  await enqueueActivity({
    origin: peer.origin,
    inboxUrl: peer.inboxUrl,
    peerId: peer.id,
    activity: {
      "@context": AS,
      id: `${runtime.origin}${AP_PREFIX}/activities/${crypto.randomUUID()}`,
      actor: runtime.actorUrl.href,
      ...activity,
    },
  });
}

/** One of this instance's people, as a Note names them. */
async function localPerson(runtime: Runtime, userId: string): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true } });
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
async function noteOf(runtime: Runtime, message: StoredMessage, context: string | null, to: string[]) {
  const card = message.remoteSenderCard as PersonCard | null;
  const attributedTo =
    message.senderId && !card
      ? await localPerson(runtime, message.senderId)
      : card
        ? { id: card.id, type: "Person", name: card.name, preferredUsername: card.handle?.split("@")[0] }
        : null;
  return {
    id: message.apId ?? messageUrl(runtime, message.id),
    type: "Note",
    attributedTo,
    to,
    ...(context ? { context } : {}),
    content: htmlOf(message.body),
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

async function chatWithRemote(chatId: string): Promise<ChatWithRemote | null> {
  return prisma.chat.findUnique({
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

const activePeer = (peer: Peer | null | undefined): peer is Peer => Boolean(peer && peer.status === "ACTIVE");

// ---------------------------------------------------------------------------------------------------------------------
// Sending

/** A message written here, sent on to wherever else it's read: the other person's instance, every partner with members
 *  in a room hosted here, or the host of a room hosted elsewhere. */
export async function messageWritten(chatId: string, messageId: string): Promise<void> {
  const runtime = await live();
  const chat = await chatWithRemote(chatId);
  if (!runtime || !chat) return;
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, include: { attachments: true } });
  if (!message || message.deletedAt || !message.senderId) return;
  const id = messageUrl(runtime, message.id);
  const sent = { ...message, apId: id };
  if (chat.hostPeerId) {
    if (!activePeer(chat.hostPeer) || !chat.remoteApId) return;
    const note = await noteOf(runtime, sent, chat.remoteApId, [chat.remoteApId]);
    await send(runtime, chat.hostPeer, { type: "Create", to: [chat.remoteApId], object: note });
  } else if (chat.kind === "DIRECT") {
    const other = chat.remoteMembers[0]?.person;
    if (!other || !activePeer(other.peer)) return;
    const note = await noteOf(runtime, sent, null, [other.apId]);
    await send(runtime, other.peer, { type: "Create", to: [other.apId], object: note });
  } else {
    const room = roomUrl(runtime, chat.id);
    const note = await noteOf(runtime, sent, room, [room]);
    for (const peer of peersIn(chat)) await send(runtime, peer, { type: "Create", to: [room], object: note });
  }
  await prisma.chatMessage.updateMany({ where: { id: message.id, apId: null }, data: { apId: id } });
}

const peersIn = (chat: ChatWithRemote): Peer[] => {
  const peers = new Map(chat.remoteMembers.map(({ person }) => [person.peer.id, person.peer]));
  return [...peers.values()].filter(activePeer);
};

/** A message deleted here, deleted wherever else it's kept. `exceptPeerId`: the partner it was deleted from, already
 *  without it. */
export async function messageDeleted(chatId: string, messageId: string, exceptPeerId?: string): Promise<void> {
  const runtime = await live();
  const chat = await chatWithRemote(chatId);
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { apId: true, senderId: true },
  });
  if (!runtime || !chat || !message) return;
  // One written here and deleted before it went out still has the address it went out under.
  const apId = message.apId ?? (message.senderId ? messageUrl(runtime, messageId) : null);
  if (!apId) return;
  const peers = chat.hostPeerId ? (activePeer(chat.hostPeer) ? [chat.hostPeer] : []) : peersIn(chat);
  for (const peer of peers) {
    if (peer.id !== exceptPeerId) await send(runtime, peer, { type: "Delete", object: apId });
  }
}

/** A room hosted here, as its partners with members are told it: its name, description and everyone in it. `formerPeerIds`
 *  are told too, so those whose people are no longer in it drop their copy. */
export async function roomChanged(chatId: string, formerPeerIds: string[] = []): Promise<void> {
  const runtime = await live();
  const chat = await chatWithRemote(chatId);
  if (!runtime || !chat || chat.kind !== "ROOM" || chat.hostPeerId) return;
  const locals = await prisma.chatMember.findMany({ where: { chatId }, select: { userId: true } });
  const members = [
    ...(await Promise.all(locals.map(({ userId }) => localPerson(runtime, userId)))),
    ...chat.remoteMembers.map(({ person }) => ({
      id: person.apId,
      type: "Person",
      name: person.displayName,
      preferredUsername: person.username ?? undefined,
    })),
  ];
  const group = {
    id: roomUrl(runtime, chat.id),
    type: "Group",
    name: chat.name ?? "Room",
    summary: chat.description ?? undefined,
    attachment: members,
  };
  const peers = new Map(peersIn(chat).map((peer) => [peer.id, peer]));
  if (formerPeerIds.length) {
    for (const peer of await prisma.peer.findMany({ where: { id: { in: formerPeerIds }, status: "ACTIVE" } })) {
      peers.set(peer.id, peer);
    }
  }
  for (const peer of peers.values()) {
    const theirs = chat.remoteMembers
      .filter(({ person }) => person.peerId === peer.id)
      .map(({ person }) => person.apId);
    await send(runtime, peer, { type: "Update", to: theirs.length ? theirs : [group.id], object: group });
  }
}

/** A room hosted here deleted: its partners drop their copies. */
export async function roomDeleted(chatId: string, peerIds: string[]): Promise<void> {
  const runtime = await live();
  if (!runtime || !peerIds.length) return;
  for (const peer of await prisma.peer.findMany({ where: { id: { in: peerIds }, status: "ACTIVE" } })) {
    await send(runtime, peer, { type: "Delete", object: roomUrl(runtime, chatId) });
  }
}

/** Someone here left a room hosted elsewhere: its host takes them out. */
export async function roomLeft(chat: Chat, userId: string): Promise<void> {
  const runtime = await live();
  if (!runtime || !chat.hostPeerId || !chat.remoteApId) return;
  const host = await prisma.peer.findUnique({ where: { id: chat.hostPeerId } });
  if (!activePeer(host)) return;
  await send(runtime, host, { type: "Remove", object: personUrl(runtime, userId), target: chat.remoteApId });
}

// ---------------------------------------------------------------------------------------------------------------------
// Receiving: what a partner sent, verified by Fedify against its compared key. Each only for an ACTIVE partner, with
// chats on here.

async function senderPeer(actorId: URL): Promise<Peer | null> {
  const peer = await prisma.peer.findFirst({ where: { actorUrl: actorId.href, status: "ACTIVE" } });
  if (!peer) return null;
  const { enabled, chats } = await getSocialSettings();
  return enabled && chats ? peer : null;
}

/** Someone on `peer`, as a message or room names them: who the index has, or kept from now on as the message said,
 *  unlisted (they may share nothing there). Only someone on that partner's own origin. */
export async function personOn(peer: Peer, person: IncomingPerson): Promise<RemotePerson | null> {
  if (originOf(person.id) !== peer.origin) return null;
  const card = cardOf(person);
  const found = await prisma.remotePerson.findUnique({ where: { apId: person.id } });
  if (found) {
    if (found.peerId !== peer.id) return null;
    if (found.listed) return found;
    return prisma.remotePerson.update({
      where: { id: found.id },
      data: {
        displayName: card.name,
        username: card.handle?.split("@")[0] ?? null,
        avatarUrl: person.icon && originOf(person.icon) === peer.origin ? person.icon : found.avatarUrl,
      },
    });
  }
  try {
    return await prisma.remotePerson.create({
      data: {
        peerId: peer.id,
        apId: person.id,
        displayName: card.name,
        username: card.handle?.split("@")[0] ?? null,
        avatarUrl: person.icon && originOf(person.icon) === peer.origin ? person.icon : null,
        listed: false,
      },
    });
  } catch {
    // Kept by a message that came at the same moment.
    return prisma.remotePerson.findUnique({ where: { apId: person.id } });
  }
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
export async function relayToRoom(chatId: string, messageId: string, fromPeerId: string): Promise<void> {
  const runtime = await live();
  const chat = await chatWithRemote(chatId);
  if (!runtime || !chat) return;
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, include: { attachments: true } });
  if (!message) return;
  const room = roomUrl(runtime, chat.id);
  const note = await noteOf(runtime, message, room, [room]);
  for (const peer of peersIn(chat)) {
    if (peer.id !== fromPeerId) await send(runtime, peer, { type: "Announce", to: [room], object: note });
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
  const memberIds = users.map((user) => user.id);
  if (!memberIds.length) {
    if (!existing) return null;
    await prisma.chat.delete({ where: { id: existing.id } });
    return { chatId: existing.id, removed: existing.members.map((member) => member.userId), peer };
  }
  const data = {
    name: (group.name ?? "Room").slice(0, 80),
    description: group.summary?.slice(0, 300) ?? null,
    hostMembers: group.members.slice(0, 500).map(cardOf) as unknown as Prisma.InputJsonValue,
  };
  const chat = existing
    ? await prisma.chat.update({ where: { id: existing.id }, data })
    : await prisma.chat.create({
        data: { kind: "ROOM", isPublic: false, remoteApId: group.id, hostPeerId: peer.id, ...data },
      });
  const before = existing?.members.map((member) => member.userId) ?? [];
  const removed = before.filter((id) => !memberIds.includes(id));
  await prisma.chatMember.deleteMany({ where: { chatId: chat.id, userId: { in: removed } } });
  await prisma.chatMember.createMany({
    data: memberIds.map((userId) => ({ chatId: chat.id, userId })),
    skipDuplicates: true,
  });
  return { chatId: chat.id, removed, peer };
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
  if (!message) return null;
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
