import { Prisma, type Chat, type ChatMember, type ChatMessage } from "@prisma/client";
import { prisma } from "../db";
import type { UserCardOut } from "../dto";
import { createKeyedLock } from "../utils/concurrency";
import { HttpError } from "../utils/fileUtils";
import { createNotification } from "./notificationService";
import { getSocialSettings } from "./settingsService";
import { userCards } from "./socialService";

// Chats, while an admin has them on under social features: direct messages between two of the instance's users, and
// rooms an admin makes, public (anyone may read and join) or private (only the users the admin picked). Nothing is
// pushed: the web app polls, often while a chat is open and now and then for the unread count, and that poll is also
// what shows someone online.

export const MESSAGE_MAX_LENGTH = 4000;
export const ROOM_NAME_MAX_LENGTH = 80;
export const ROOM_DESCRIPTION_MAX_LENGTH = 300;
export const MESSAGE_PAGE_SIZE = 50;
const MAX_CHATS = 200;
const MAX_PEOPLE = 50;
const MAX_ROOM_MEMBERS = 500;

/** Seen this recently, someone shows as online: a little over two of the unread poll's rounds. */
const ONLINE_MS = 2 * 60_000;
const SEEN_WRITE_MS = 30_000;
/** A chat open in front of its member keeps their viewedAt this fresh; a message finding it so doesn't notify. */
const READING_MS = 15_000;
/** How far back a poll for new messages looks again before the last one it has: a message written just before another,
 *  but saved just after it, would otherwise be skipped. The app keeps each message once. */
const POLL_OVERLAP_MS = 5_000;
const PREVIEW_LENGTH = 140;

export type Viewer = { id: string; isAdmin: boolean };

export type ChatPersonOut = UserCardOut & { online: boolean };

export type ChatMessageOut = {
  id: string;
  chat_id: string;
  /** Null once their account is gone. */
  sender: UserCardOut | null;
  /** Empty once deleted. */
  body: string;
  deleted: boolean;
  created_at: string;
};

export type ChatOut = {
  id: string;
  kind: "direct" | "room";
  /** A room's; null for direct messages, which go by the other person's name. */
  name: string | null;
  description: string | null;
  is_public: boolean;
  /** Direct messages: who with, null once their account is gone. */
  other: ChatPersonOut | null;
  member_count: number;
  /** The viewer is a member: they can write, and are notified. */
  joined: boolean;
  /** The viewer may read its messages: a member, or anyone for a public room. */
  readable: boolean;
  favorite: boolean;
  muted: boolean;
  unread: number;
  last_message: ChatMessageOut | null;
  last_message_at: string;
  /** An admin's, for a room: edit it, pick its members, delete it. */
  can_manage: boolean;
};

export type ChatDetailOut = ChatOut & {
  /** A room's members, by name; for direct messages, the two of them. */
  members: ChatPersonOut[];
};

export type ChatUnreadOut = {
  /** Unread messages in every chat the viewer is in, muted ones left out. */
  unread: number;
  /** The newest of them, for saying who wrote. */
  latest: { chat_id: string; message_id: string; title: string; body: string; created_at: string } | null;
};

/** 404s while chats, or social features, are off: what was said stays, unseen until they're back on. */
export async function assertChatsOn(): Promise<void> {
  const { enabled, chats } = await getSocialSettings();
  if (!enabled || !chats) throw new HttpError(404, "Chats are off", "chats_off");
}

const isOnline = (lastSeenAt: Date | null, now = Date.now()) =>
  Boolean(lastSeenAt && now - lastSeenAt.getTime() < ONLINE_MS);

async function people(userIds: string[]): Promise<Map<string, ChatPersonOut>> {
  const unique = [...new Set(userIds)];
  if (!unique.length) return new Map();
  const [cards, seen] = await Promise.all([
    userCards(unique),
    prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, lastSeenAt: true } }),
  ]);
  const now = Date.now();
  const seenOf = new Map(seen.map((user) => [user.id, user.lastSeenAt]));
  return new Map(
    [...cards].map(([id, card]) => [id, { ...card, online: isOnline(seenOf.get(id) ?? null, now) }] as const),
  );
}

/** Records that `userId` has Thingport in front of them, at most every SEEN_WRITE_MS. */
export async function touchSeen(userId: string): Promise<void> {
  const now = new Date();
  await prisma.user.updateMany({
    where: { id: userId, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - SEEN_WRITE_MS) } }] },
    data: { lastSeenAt: now },
  });
}

function messageOut(message: ChatMessage, senders: Map<string, UserCardOut>): ChatMessageOut {
  return {
    id: message.id,
    chat_id: message.chatId,
    sender: message.senderId ? (senders.get(message.senderId) ?? null) : null,
    body: message.deletedAt ? "" : message.body,
    deleted: message.deletedAt !== null,
    created_at: message.createdAt.toISOString(),
  };
}

async function messageOuts(messages: ChatMessage[]): Promise<ChatMessageOut[]> {
  const senders = await userCards(messages.flatMap((message) => message.senderId ?? []));
  return messages.map((message) => messageOut(message, senders));
}

/** Unread messages per chat for `userId`: others' messages after their lastReadAt, deleted ones aside. */
async function unreadCounts(userId: string, chatIds: string[]): Promise<Map<string, number>> {
  if (!chatIds.length) return new Map();
  const rows = await prisma.$queryRaw<{ chatId: string; unread: number }[]>`
    SELECT m."chatId", COUNT(*)::int AS unread
    FROM "ChatMessage" m
    JOIN "ChatMember" cm ON cm."chatId" = m."chatId" AND cm."userId" = ${userId}
    WHERE m."chatId" IN (${Prisma.join(chatIds)})
      AND m."createdAt" > cm."lastReadAt"
      AND m."deletedAt" IS NULL
      AND m."senderId" IS DISTINCT FROM ${userId}
    GROUP BY m."chatId"`;
  return new Map(rows.map((row) => [row.chatId, row.unread]));
}

/** Each chat's latest message, in one query however many chats. */
async function lastMessages(chatIds: string[]): Promise<Map<string, ChatMessage>> {
  if (!chatIds.length) return new Map();
  const rows = await prisma.$queryRaw<ChatMessage[]>`
    SELECT DISTINCT ON ("chatId") *
    FROM "ChatMessage"
    WHERE "chatId" IN (${Prisma.join(chatIds)})
    ORDER BY "chatId", "createdAt" DESC, id DESC`;
  return new Map(rows.map((row) => [row.chatId, row]));
}

type ChatRow = Chat & { members: ChatMember[]; _count: { members: number } };

const CHAT_INCLUDE = (viewerId: string) =>
  ({
    // Only the viewer's own row: a room's members are read when it's opened.
    members: { where: { userId: viewerId } },
    _count: { select: { members: true } },
  }) satisfies Prisma.ChatInclude;

/** What `viewer` sees of each chat, in the order given. */
async function chatOuts(viewer: Viewer, chats: ChatRow[]): Promise<ChatOut[]> {
  if (!chats.length) return [];
  const ids = chats.map((chat) => chat.id);
  const directIds = chats.filter((chat) => chat.kind === "DIRECT").map((chat) => chat.id);
  const [unread, latest, others] = await Promise.all([
    unreadCounts(viewer.id, ids),
    lastMessages(ids),
    directIds.length
      ? prisma.chatMember.findMany({
          where: { chatId: { in: directIds }, userId: { not: viewer.id } },
          select: { chatId: true, userId: true },
        })
      : [],
  ]);
  const [persons, latestOuts] = await Promise.all([
    people(others.map((member) => member.userId)),
    messageOuts([...latest.values()]),
  ]);
  const otherOf = new Map(others.map((member) => [member.chatId, member.userId]));
  const latestOf = new Map(latestOuts.map((message) => [message.chat_id, message]));
  return chats.map((chat) => {
    const own = chat.members[0];
    const room = chat.kind === "ROOM";
    const otherId = otherOf.get(chat.id);
    return {
      id: chat.id,
      kind: room ? "room" : "direct",
      name: room ? chat.name : null,
      description: chat.description,
      is_public: room && chat.isPublic,
      other: otherId ? (persons.get(otherId) ?? null) : null,
      member_count: chat._count.members,
      joined: Boolean(own),
      readable: Boolean(own) || (room && chat.isPublic),
      favorite: own?.favorite ?? false,
      muted: own?.muted ?? false,
      unread: unread.get(chat.id) ?? 0,
      last_message: latestOf.get(chat.id) ?? null,
      last_message_at: chat.lastMessageAt.toISOString(),
      can_manage: room && viewer.isAdmin,
    };
  });
}

/** The chats `viewer` sees: those they're in -- direct messages once there's something in them, or they started
 *  them -- every public room, and for an admin every room, so they can manage the private ones they're not in. */
function visibleWhere(viewer: Viewer): Prisma.ChatWhereInput {
  const member = { members: { some: { userId: viewer.id } } } satisfies Prisma.ChatWhereInput;
  return {
    OR: [
      { kind: "DIRECT", ...member, OR: [{ createdById: viewer.id }, { messages: { some: {} } }] },
      { kind: "ROOM", ...(viewer.isAdmin ? {} : { OR: [member, { isPublic: true }] }) },
    ],
  };
}

export async function listChats(viewer: Viewer): Promise<ChatOut[]> {
  const chats = await prisma.chat.findMany({
    where: visibleWhere(viewer),
    include: CHAT_INCLUDE(viewer.id),
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: MAX_CHATS,
  });
  return chatOuts(viewer, chats);
}

/** A chat `viewer` may see, with their membership; 404 otherwise, as for one that doesn't exist. */
async function visibleChat(viewer: Viewer, chatId: string): Promise<ChatRow> {
  const chat = await prisma.chat.findFirst({ where: { id: chatId }, include: CHAT_INCLUDE(viewer.id) });
  if (!chat) throw new HttpError(404, "Chat not found");
  const member = chat.members.length > 0;
  const visible = member || (chat.kind === "ROOM" && (chat.isPublic || viewer.isAdmin));
  if (!visible) throw new HttpError(404, "Chat not found");
  return chat;
}

const readable = (chat: ChatRow) => chat.members.length > 0 || (chat.kind === "ROOM" && chat.isPublic);

export async function getChat(viewer: Viewer, chatId: string): Promise<ChatDetailOut> {
  const chat = await visibleChat(viewer, chatId);
  const [out] = await chatOuts(viewer, [chat]);
  // A private room's members are for its members and the admins managing it.
  const memberIds = (
    await prisma.chatMember.findMany({
      where: { chatId },
      orderBy: { joinedAt: "asc" },
      take: MAX_ROOM_MEMBERS,
      select: { userId: true },
    })
  ).map((member) => member.userId);
  const persons = await people(memberIds);
  const members = memberIds.flatMap((id) => persons.get(id) ?? []);
  return { ...out, members: members.toSorted((a, b) => a.display_name.localeCompare(b.display_name)) };
}

export type MessagePage = {
  /** Oldest first. */
  messages: ChatMessageOut[];
  /** Before the first of them, there's more to page back through. Only for a page read backwards. */
  has_more: boolean;
  /** Messages deleted since `since`, for a poll to take out what it already shows. */
  deleted_ids: string[];
  /** The server's time, for the next poll's `since`. */
  now: string;
  /** Direct messages: when the other person last read them, for "Seen". */
  other_read_at: string | null;
};

/**
 * A chat's messages: the latest page; or with `before`, the page before that message; or with `after`, a poll for what
 * came since (a little before it, POLL_OVERLAP_MS). `since` adds the ids deleted since then. `seen` says the chat is
 * open in front of a member, which reads it.
 */
export async function listMessages(
  viewer: Viewer,
  chatId: string,
  options: { before?: string; after?: string; since?: Date; limit?: number; seen?: boolean },
): Promise<MessagePage> {
  const chat = await visibleChat(viewer, chatId);
  if (!readable(chat)) throw new HttpError(403, "Only this room's members can read it", "not_member");
  const now = new Date();
  const limit = Math.min(Math.max(options.limit ?? MESSAGE_PAGE_SIZE, 1), 100);
  const anchorId = options.after ?? options.before;
  const anchor = anchorId
    ? await prisma.chatMessage.findFirst({ where: { id: anchorId, chatId }, select: { id: true, createdAt: true } })
    : null;

  let messages: ChatMessage[];
  let hasMore = false;
  if (options.after && anchor) {
    messages = await prisma.chatMessage.findMany({
      where: { chatId, createdAt: { gte: new Date(anchor.createdAt.getTime() - POLL_OVERLAP_MS) } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200,
    });
  } else {
    // A poll whose last message is gone starts again from the latest page.
    const before = options.after ? null : anchor;
    const rows = await prisma.chatMessage.findMany({
      where: {
        chatId,
        ...(before
          ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    hasMore = rows.length > limit;
    messages = rows.slice(0, limit).toReversed();
  }

  const [deleted, other] = await Promise.all([
    options.since
      ? prisma.chatMessage.findMany({
          where: { chatId, deletedAt: { gte: new Date(options.since.getTime() - POLL_OVERLAP_MS) } },
          select: { id: true },
          take: 500,
        })
      : [],
    chat.kind === "DIRECT"
      ? prisma.chatMember.findFirst({ where: { chatId, userId: { not: viewer.id } }, select: { lastReadAt: true } })
      : null,
  ]);
  if (options.seen && chat.members.length) await markRead(viewer.id, chatId, now);
  return {
    messages: await messageOuts(messages),
    has_more: hasMore,
    deleted_ids: deleted.map((message) => message.id),
    now: now.toISOString(),
    other_read_at: other?.lastReadAt.toISOString() ?? null,
  };
}

async function markRead(userId: string, chatId: string, at: Date): Promise<void> {
  await prisma.chatMember.updateMany({ where: { chatId, userId }, data: { lastReadAt: at, viewedAt: at } });
  // What told them about this chat has been read with it.
  await prisma.notification.updateMany({
    where: { userId, readAt: null, type: "chat", group: { path: ["chatId"], equals: chatId } },
    data: { readAt: at },
  });
}

async function memberOf(viewer: Viewer, chatId: string): Promise<ChatRow> {
  const chat = await visibleChat(viewer, chatId);
  if (!chat.members.length) throw new HttpError(403, "Join this room to write in it", "not_member");
  return chat;
}

export async function postMessage(viewer: Viewer, chatId: string, text: string): Promise<ChatMessageOut> {
  const body = text.trim();
  if (!body) throw new HttpError(400, "A message needs something in it");
  if (body.length > MESSAGE_MAX_LENGTH)
    throw new HttpError(400, `A message is at most ${MESSAGE_MAX_LENGTH} characters`);
  const chat = await memberOf(viewer, chatId);
  if (chat.kind === "DIRECT" && chat._count.members < 2) {
    throw new HttpError(409, "This person's account is gone", "recipient_gone");
  }
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({ data: { chatId, senderId: viewer.id, body } });
    await tx.chat.update({ where: { id: chatId }, data: { lastMessageAt: created.createdAt } });
    return created;
  });
  void notifyMessage(chat, message).catch((err) => console.error("Failed to notify about a chat message:", err));
  return (await messageOuts([message]))[0];
}

/** Their own message, or for an admin any message in a room. Its text goes; that there was one stays. */
export async function deleteMessage(viewer: Viewer, chatId: string, messageId: string): Promise<void> {
  const chat = await visibleChat(viewer, chatId);
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, chatId } });
  if (!message) throw new HttpError(404, "Message not found");
  const own = message.senderId === viewer.id && chat.members.length > 0;
  if (!own && !(chat.kind === "ROOM" && viewer.isAdmin)) throw new HttpError(403, "Only its sender can delete it");
  if (message.deletedAt) return;
  await prisma.chatMessage.update({ where: { id: messageId }, data: { body: "", deletedAt: new Date() } });
  // A notification quoting it stops quoting it.
  await prisma.notification.updateMany({
    where: { type: "chat", group: { path: ["messageId"], equals: messageId } },
    data: { body: "Message deleted" },
  });
}

export async function updateMembership(
  viewer: Viewer,
  chatId: string,
  patch: { favorite?: boolean; muted?: boolean },
): Promise<ChatOut> {
  await memberOf(viewer, chatId);
  await prisma.chatMember.update({ where: { chatId_userId: { chatId, userId: viewer.id } }, data: patch });
  const [out] = await chatOuts(viewer, [await visibleChat(viewer, chatId)]);
  return out;
}

export async function joinRoom(viewer: Viewer, chatId: string): Promise<ChatOut> {
  const chat = await visibleChat(viewer, chatId);
  if (chat.kind !== "ROOM" || !chat.isPublic) throw new HttpError(403, "Only a public room can be joined");
  // What was said before they came isn't news to them.
  await prisma.chatMember.createMany({ data: [{ chatId, userId: viewer.id }], skipDuplicates: true });
  const [out] = await chatOuts(viewer, [await visibleChat(viewer, chatId)]);
  return out;
}

export async function leaveRoom(viewer: Viewer, chatId: string): Promise<void> {
  const chat = await memberOf(viewer, chatId);
  if (chat.kind !== "ROOM") throw new HttpError(400, "Direct messages can't be left");
  await prisma.chatMember.delete({ where: { chatId_userId: { chatId, userId: viewer.id } } });
  await dropNotifications(chatId, [viewer.id]);
}

const directKey = (a: string, b: string) => [a, b].toSorted().join(":");

/** The viewer's direct messages with `userId`, started if they have none. */
export async function openDirect(viewer: Viewer, userId: string): Promise<ChatOut> {
  if (userId === viewer.id) throw new HttpError(400, "That's you");
  const other = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!other) throw new HttpError(404, "User not found");
  const key = directKey(viewer.id, userId);
  let chat = await prisma.chat.findUnique({ where: { directKey: key }, include: CHAT_INCLUDE(viewer.id) });
  if (!chat) {
    try {
      chat = await prisma.chat.create({
        data: {
          kind: "DIRECT",
          directKey: key,
          createdById: viewer.id,
          members: { create: [{ userId: viewer.id }, { userId }] },
        },
        include: CHAT_INCLUDE(viewer.id),
      });
    } catch (err) {
      // The other person started it at the same moment.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      chat = await prisma.chat.findUniqueOrThrow({ where: { directKey: key }, include: CHAT_INCLUDE(viewer.id) });
    }
  }
  const [out] = await chatOuts(viewer, [chat]);
  return out;
}

/** The instance's other users, by any part of their name, or by their whole email -- part of one would let anyone
 *  spell out the others' a letter at a time. Everyone, by name, for no query. Never their emails. */
export async function searchPeople(viewer: Viewer, query: string): Promise<ChatPersonOut[]> {
  const term = query.trim().slice(0, 200);
  const users = await prisma.user.findMany({
    where: {
      id: { not: viewer.id },
      ...(term
        ? {
            OR: [
              { displayName: { contains: term, mode: "insensitive" } },
              { email: { equals: term, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    take: MAX_PEOPLE,
    select: { id: true },
  });
  const persons = await people(users.map((user) => user.id));
  return users.flatMap((user) => persons.get(user.id) ?? []);
}

export type RoomInput = {
  name: string;
  description?: string | null;
  is_public: boolean;
  /** A private room's members besides the admin making it. Left out of a public one, which people join. */
  member_ids?: string[];
};

async function existingUserIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true } });
  return users.map((user) => user.id);
}

function roomText(input: { name?: string; description?: string | null }) {
  const name = input.name?.trim();
  if (input.name !== undefined && !name) throw new HttpError(400, "A room needs a name");
  return {
    ...(name !== undefined ? { name: name.slice(0, ROOM_NAME_MAX_LENGTH) } : {}),
    ...(input.description !== undefined
      ? { description: input.description?.trim().slice(0, ROOM_DESCRIPTION_MAX_LENGTH) || null }
      : {}),
  };
}

/** An admin's new room, with them in it. */
export async function createRoom(admin: Viewer, input: RoomInput): Promise<ChatOut> {
  const members = input.is_public
    ? [admin.id]
    : [admin.id, ...(await existingUserIds(input.member_ids ?? []))].filter((id, i, all) => all.indexOf(id) === i);
  const chat = await prisma.chat.create({
    data: {
      kind: "ROOM",
      ...roomText(input),
      isPublic: input.is_public,
      createdById: admin.id,
      members: { create: members.map((userId) => ({ userId })) },
    },
    include: CHAT_INCLUDE(admin.id),
  });
  const [out] = await chatOuts(admin, [chat]);
  return out;
}

/** Changes what's given. `member_ids` sets a private room's members (a public room's are whoever joined); a room made
 *  private keeps whoever was in it unless they're given. */
export async function updateRoom(admin: Viewer, chatId: string, patch: Partial<RoomInput>): Promise<ChatOut> {
  const chat = await prisma.chat.findFirst({ where: { id: chatId, kind: "ROOM" } });
  if (!chat) throw new HttpError(404, "Room not found");
  const isPublic = patch.is_public ?? chat.isPublic;
  await prisma.$transaction(async (tx) => {
    await tx.chat.update({
      where: { id: chatId },
      data: { ...roomText(patch), ...(patch.is_public !== undefined ? { isPublic: patch.is_public } : {}) },
    });
    if (isPublic || !patch.member_ids) return;
    const wanted = await existingUserIds(patch.member_ids);
    const removed = await tx.chatMember.findMany({
      where: { chatId, userId: { notIn: wanted } },
      select: { userId: true },
    });
    await tx.chatMember.deleteMany({ where: { chatId, userId: { notIn: wanted } } });
    await tx.chatMember.createMany({ data: wanted.map((userId) => ({ chatId, userId })), skipDuplicates: true });
    await dropNotifications(
      chatId,
      removed.map((member) => member.userId),
      tx,
    );
  });
  return (await chatOuts(admin, [await visibleChat(admin, chatId)]))[0];
}

/** With everything said in it. */
export async function deleteRoom(chatId: string): Promise<Chat> {
  const chat = await prisma.chat.findFirst({ where: { id: chatId, kind: "ROOM" } });
  if (!chat) throw new HttpError(404, "Room not found");
  await prisma.chat.delete({ where: { id: chatId } });
  await dropNotifications(chatId);
  return chat;
}

/** Notifications about a chat someone can no longer open: for `userIds`, or everyone. */
async function dropNotifications(chatId: string, userIds?: string[], tx: Prisma.TransactionClient = prisma) {
  if (userIds && !userIds.length) return;
  await tx.notification.deleteMany({
    where: {
      type: "chat",
      group: { path: ["chatId"], equals: chatId },
      ...(userIds ? { userId: { in: userIds } } : {}),
    },
  });
}

export async function unreadSummary(userId: string): Promise<ChatUnreadOut> {
  const [totals, latest] = await Promise.all([
    prisma.$queryRaw<{ unread: number }[]>`
      SELECT COUNT(*)::int AS unread
      FROM "ChatMessage" m
      JOIN "ChatMember" cm ON cm."chatId" = m."chatId" AND cm."userId" = ${userId} AND NOT cm.muted
      WHERE m."createdAt" > cm."lastReadAt" AND m."deletedAt" IS NULL AND m."senderId" IS DISTINCT FROM ${userId}`,
    prisma.$queryRaw<(ChatMessage & { kind: Chat["kind"]; name: string | null })[]>`
      SELECT m.*, c.kind, c.name
      FROM "ChatMessage" m
      JOIN "ChatMember" cm ON cm."chatId" = m."chatId" AND cm."userId" = ${userId} AND NOT cm.muted
      JOIN "Chat" c ON c.id = m."chatId"
      WHERE m."createdAt" > cm."lastReadAt" AND m."deletedAt" IS NULL AND m."senderId" IS DISTINCT FROM ${userId}
      ORDER BY m."createdAt" DESC, m.id DESC
      LIMIT 1`,
  ]);
  const newest = latest[0];
  if (!newest) return { unread: totals[0]?.unread ?? 0, latest: null };
  const sender = newest.senderId ? (await userCards([newest.senderId])).get(newest.senderId) : undefined;
  const { title, body } = notificationText(
    newest.kind,
    newest.name,
    sender?.display_name ?? "Deleted user",
    newest.body,
    1,
  );
  return {
    unread: totals[0]?.unread ?? 0,
    latest: { chat_id: newest.chatId, message_id: newest.id, title, body, created_at: newest.createdAt.toISOString() },
  };
}

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

function notificationText(
  kind: Chat["kind"],
  roomName: string | null,
  senderName: string,
  body: string,
  count: number,
) {
  if (kind === "DIRECT") {
    return {
      title: count === 1 ? `New message from ${senderName}` : `${count} new messages from ${senderName}`,
      body: preview(body),
    };
  }
  const room = roomName ?? "a room";
  return {
    title: count === 1 ? `New message in ${room}` : `${count} new messages in ${room}`,
    body: `${senderName}: ${preview(body)}`,
  };
}

/** `messageId` and `at` are the newest message it quotes. */
type ChatGroup = { key: "chat"; chatId: string; messageId: string; at: string; count: number };

function readChatGroup(value: unknown): ChatGroup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { key, chatId, messageId, at, count } = value as Record<string, unknown>;
  if (key !== "chat" || typeof chatId !== "string" || typeof messageId !== "string" || typeof count !== "number") {
    return null;
  }
  return { key, chatId, messageId, at: typeof at === "string" ? at : "", count };
}

// Two messages arriving together would otherwise both start a notification, or both miss the other's count.
const withUserLock = createKeyedLock();

/** One unread notification per chat for each member not reading it, counting what came since; muted chats never. */
async function notifyMessage(chat: Chat, message: ChatMessage): Promise<void> {
  const recipients = await prisma.chatMember.findMany({
    where: {
      chatId: chat.id,
      userId: { not: message.senderId ?? undefined },
      muted: false,
      OR: [{ viewedAt: null }, { viewedAt: { lt: new Date(Date.now() - READING_MS) } }],
    },
    select: { userId: true },
  });
  if (!recipients.length) return;
  const sender = message.senderId ? (await userCards([message.senderId])).get(message.senderId) : undefined;
  const senderName = sender?.display_name ?? "Deleted user";
  for (const { userId } of recipients) {
    await withUserLock(userId, async () => {
      const existing = await prisma.notification.findFirst({
        where: { userId, readAt: null, type: "chat", group: { path: ["chatId"], equals: chat.id } },
        orderBy: { createdAt: "desc" },
      });
      const folded = readChatGroup(existing?.group);
      const count = (folded?.count ?? 0) + 1;
      const at = message.createdAt.toISOString();
      const text = notificationText(chat.kind, chat.name, senderName, message.body, count);
      const group: ChatGroup = { key: "chat", chatId: chat.id, messageId: message.id, at, count };
      if (existing && folded) {
        // Two messages a moment apart can get here in either order: it goes on quoting the newer.
        const older = folded.at > at;
        await prisma.notification.update({
          where: { id: existing.id },
          data: older
            ? { title: text.title, group: { ...folded, count } }
            : // Up to the top of the list again, as the newest news.
              { ...text, group, createdAt: new Date() },
        });
        return;
      }
      await createNotification(userId, { type: "chat", ...text, internalPath: `/chats/${chat.id}`, group });
    });
  }
}
