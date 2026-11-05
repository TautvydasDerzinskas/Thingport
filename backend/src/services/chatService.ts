import { Prisma, type Chat, type ChatAttachment, type ChatMember, type ChatMessage } from "@prisma/client";
import { prisma } from "../db";
import type { UserCardOut } from "../dto";
import { createKeyedLock } from "../utils/concurrency";
import { HttpError } from "../utils/fileUtils";
import { createNotification } from "./notificationService";
import { getSocialSettings } from "./settingsService";
import { readablePrintOuts, userCards } from "./socialService";

// Chats, while an admin has them on under social features: direct messages between two of the instance's users, and
// rooms an admin makes, public (anyone may read and join) or private (only the users the admin picked). Nothing is
// pushed: the web app polls, often while a chat is open and now and then for the unread count, and that poll is also
// what shows someone online.

export const MESSAGE_MAX_LENGTH = 4000;
export const ROOM_NAME_MAX_LENGTH = 80;
export const ROOM_DESCRIPTION_MAX_LENGTH = 300;
export const MESSAGE_PAGE_SIZE = 50;
/** Models one message can carry. */
export const MAX_ATTACHMENTS = 5;
const POLL_PAGE_SIZE = 200;
const MAX_DELETED_IDS = 500;
const MAX_DIRECT_CHATS = 200;
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

export type ChatAttachmentOut = {
  id: string;
  /** What the model was called when it was sent. */
  name: string;
  /** The model as the viewer may open it: whose (null for their own), its picture. Null once it's deleted, and in a
   *  chat list's last message, which only names it. */
  model: { id: string; name: string; thumb_url: string | null; owner: UserCardOut | null } | null;
};

export type ChatMessageOut = {
  id: string;
  chat_id: string;
  /** Null once their account is gone. */
  sender: UserCardOut | null;
  /** Empty once deleted, and when the message is only models. */
  body: string;
  /** Models of the sender's that came with it, in order. None once it's deleted. */
  attachments: ChatAttachmentOut[];
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

/** Messages as `viewerId` sees them, with their models; without a viewer, the models are only named (a list's last
 *  message, polled often, where reading each model whole would cost too much). */
async function messageOuts(messages: ChatMessage[], viewerId?: string): Promise<ChatMessageOut[]> {
  const ids = messages.filter((message) => !message.deletedAt).map((message) => message.id);
  const [senders, attachments] = await Promise.all([
    userCards(messages.flatMap((message) => message.senderId ?? [])),
    ids.length
      ? prisma.chatAttachment.findMany({
          where: { messageId: { in: ids } },
          orderBy: [{ position: "asc" }, { id: "asc" }],
        })
      : ([] as ChatAttachment[]),
  ]);
  const printIds = [...new Set(attachments.flatMap((attachment) => attachment.printId ?? []))];
  const models = new Map(
    viewerId && printIds.length ? (await readablePrintOuts(viewerId, printIds)).map((out) => [out.id, out]) : [],
  );
  return messages.map((message) => ({
    id: message.id,
    chat_id: message.chatId,
    sender: message.senderId ? (senders.get(message.senderId) ?? null) : null,
    body: message.deletedAt ? "" : message.body,
    attachments: attachments
      .filter((attachment) => attachment.messageId === message.id)
      .map((attachment) => {
        const model = attachment.printId ? models.get(attachment.printId) : undefined;
        return {
          id: attachment.id,
          name: attachment.name,
          model: model
            ? { id: model.id, name: model.title || model.name, thumb_url: model.thumb_url, owner: model.owner ?? null }
            : null,
        };
      }),
    deleted: message.deletedAt !== null,
    created_at: message.createdAt.toISOString(),
  }));
}

// Writing a chat notification for someone, and everything that would make it stale -- their reading the chat, leaving
// it or being taken out, the room going -- take turns per user. Each checks what it needs inside its turn, so none can
// land between another's check and its write. Two messages arriving together would otherwise also both start a
// notification, or both miss the other's count.
const withUserLock = createKeyedLock();

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
    const canRead = Boolean(own) || (room && chat.isPublic);
    return {
      id: chat.id,
      kind: room ? "room" : "direct",
      name: room ? chat.name : null,
      description: chat.description,
      is_public: room && chat.isPublic,
      other: otherId ? (persons.get(otherId) ?? null) : null,
      member_count: chat._count.members,
      joined: Boolean(own),
      readable: canRead,
      favorite: own?.favorite ?? false,
      muted: own?.muted ?? false,
      unread: unread.get(chat.id) ?? 0,
      // An admin managing a private room they're not in sees that it's there, not what's said in it.
      last_message: canRead ? (latestOf.get(chat.id) ?? null) : null,
      last_message_at: chat.lastMessageAt.toISOString(),
      can_manage: room && viewer.isAdmin,
    };
  });
}

/**
 * The chats `viewer` sees: their direct messages once there's something in them (or they started them), every public
 * room, the private ones they're in, and for an admin every room, so they can manage those they're not in. Rooms are
 * all listed, as admins make them and there are few; direct messages the most recent MAX_DIRECT_CHATS, as an older one
 * is still there to open by finding its person.
 */
export async function listChats(viewer: Viewer): Promise<ChatOut[]> {
  const member = { members: { some: { userId: viewer.id } } } satisfies Prisma.ChatWhereInput;
  const order = [{ lastMessageAt: "desc" }, { id: "desc" }] satisfies Prisma.ChatOrderByWithRelationInput[];
  const [direct, rooms] = await Promise.all([
    prisma.chat.findMany({
      where: { kind: "DIRECT", ...member, OR: [{ createdById: viewer.id }, { messages: { some: {} } }] },
      include: CHAT_INCLUDE(viewer.id),
      orderBy: order,
      take: MAX_DIRECT_CHATS,
    }),
    prisma.chat.findMany({
      where: { kind: "ROOM", ...(viewer.isAdmin ? {} : { OR: [member, { isPublic: true }] }) },
      include: CHAT_INCLUDE(viewer.id),
      orderBy: order,
    }),
  ]);
  const chats = [...direct, ...rooms].toSorted(
    (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime() || b.id.localeCompare(a.id),
  );
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
  /** More were deleted than `deleted_ids` holds: the poll reads the chat again instead. */
  deleted_more: boolean;
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
    // Read apart, so however many fall in the overlap, a poll always gets past the last message it has.
    const [overlap, newer] = await Promise.all([
      prisma.chatMessage.findMany({
        where: {
          chatId,
          createdAt: { gte: new Date(anchor.createdAt.getTime() - POLL_OVERLAP_MS), lte: anchor.createdAt },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: POLL_PAGE_SIZE,
      }),
      prisma.chatMessage.findMany({
        where: {
          chatId,
          OR: [{ createdAt: { gt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { gt: anchor.id } }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: POLL_PAGE_SIZE,
      }),
    ]);
    const byId = new Map([...overlap, ...newer].map((message) => [message.id, message]));
    messages = [...byId.values()].toSorted(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
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
          take: MAX_DELETED_IDS + 1,
        })
      : [],
    chat.kind === "DIRECT"
      ? prisma.chatMember.findFirst({ where: { chatId, userId: { not: viewer.id } }, select: { lastReadAt: true } })
      : null,
  ]);
  if (options.seen && chat.members.length) await markRead(viewer.id, chatId, now);
  return {
    messages: await messageOuts(messages, viewer.id),
    has_more: hasMore,
    deleted_ids: deleted.slice(0, MAX_DELETED_IDS).map((message) => message.id),
    deleted_more: deleted.length > MAX_DELETED_IDS,
    now: now.toISOString(),
    other_read_at: other?.lastReadAt.toISOString() ?? null,
  };
}

async function markRead(userId: string, chatId: string, at: Date): Promise<void> {
  await withUserLock(userId, async () => {
    await prisma.chatMember.updateMany({ where: { chatId, userId }, data: { lastReadAt: at, viewedAt: at } });
    // What told them about this chat has been read with it.
    await prisma.notification.updateMany({
      where: { userId, readAt: null, type: "chat", group: { path: ["chatId"], equals: chatId } },
      data: { readAt: at },
    });
  });
}

async function memberOf(viewer: Viewer, chatId: string): Promise<ChatRow> {
  const chat = await visibleChat(viewer, chatId);
  if (!chat.members.length) throw new HttpError(403, "Join this room to write in it", "not_member");
  return chat;
}

/** A message: text, models from the sender's own library (whoever can read the chat can then open them), or both. */
export async function postMessage(
  viewer: Viewer,
  chatId: string,
  text: string,
  printIds: string[] = [],
): Promise<ChatMessageOut> {
  const body = text.trim();
  const wanted = [...new Set(printIds)];
  if (!body && !wanted.length) throw new HttpError(400, "A message needs something in it");
  if (body.length > MESSAGE_MAX_LENGTH)
    throw new HttpError(400, `A message is at most ${MESSAGE_MAX_LENGTH} characters`);
  if (wanted.length > MAX_ATTACHMENTS) throw new HttpError(400, `A message carries at most ${MAX_ATTACHMENTS} models`);
  const chat = await memberOf(viewer, chatId);
  if (chat.kind === "DIRECT" && chat._count.members < 2) {
    throw new HttpError(409, "This person's account is gone", "recipient_gone");
  }
  // Only their own: someone else's model, shared with them, could be made private again while still sent on.
  const models = wanted.length
    ? await prisma.print.findMany({
        where: { id: { in: wanted }, userId: viewer.id },
        select: { id: true, name: true, title: true },
      })
    : [];
  if (models.length !== wanted.length) {
    throw new HttpError(400, "Only models in your own library can be sent", "not_own_model");
  }
  const nameOf = new Map(models.map((model) => [model.id, model.title || model.name]));
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        chatId,
        senderId: viewer.id,
        body,
        attachments: {
          create: wanted.map((printId, position) => ({ printId, name: nameOf.get(printId) ?? "", position })),
        },
      },
    });
    // Only forward: two messages a moment apart can be saved in either order.
    await tx.chat.updateMany({
      where: { id: chatId, lastMessageAt: { lt: created.createdAt } },
      data: { lastMessageAt: created.createdAt },
    });
    return created;
  });
  void notifyMessage(chat, message).catch((err) => console.error("Failed to notify about a chat message:", err));
  return (await messageOuts([message], viewer.id))[0];
}

/** Their own message, or for an admin any message in a room. Its text goes; that there was one stays. */
export async function deleteMessage(viewer: Viewer, chatId: string, messageId: string): Promise<void> {
  const chat = await visibleChat(viewer, chatId);
  const message = await prisma.chatMessage.findFirst({ where: { id: messageId, chatId } });
  if (!message) throw new HttpError(404, "Message not found");
  const own = message.senderId === viewer.id && chat.members.length > 0;
  if (!own && !(chat.kind === "ROOM" && viewer.isAdmin)) throw new HttpError(403, "Only its sender can delete it");
  if (message.deletedAt) return;
  // Its models with it: whoever could open them through it no longer can.
  await prisma.$transaction([
    prisma.chatMessage.update({ where: { id: messageId }, data: { body: "", deletedAt: new Date() } }),
    prisma.chatAttachment.deleteMany({ where: { messageId } }),
  ]);
  await unquote(messageId);
}

/** A notification quoting a deleted message stops quoting it. */
async function unquote(messageId: string): Promise<void> {
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
  await forget(chatId, [viewer.id]);
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

/** A room's changes: what's given of RoomInput, and for a private room who's added and who's taken out. The
 *  members not named stay, so an editor that only loaded some of them can't take the others out. */
export type RoomPatch = Partial<Omit<RoomInput, "member_ids">> & {
  add_member_ids?: string[];
  remove_member_ids?: string[];
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

/** Changes what's given. A private room's members change by `add_member_ids` and `remove_member_ids` (a public room's
 *  are whoever joined); a room made private keeps whoever was in it. */
export async function updateRoom(admin: Viewer, chatId: string, patch: RoomPatch): Promise<ChatOut> {
  const chat = await prisma.chat.findFirst({ where: { id: chatId, kind: "ROOM" } });
  if (!chat) throw new HttpError(404, "Room not found");
  const isPublic = patch.is_public ?? chat.isPublic;
  const added = isPublic ? [] : await existingUserIds(patch.add_member_ids ?? []);
  const removed = await prisma.$transaction(async (tx) => {
    await tx.chat.update({
      where: { id: chatId },
      data: { ...roomText(patch), ...(patch.is_public !== undefined ? { isPublic: patch.is_public } : {}) },
    });
    if (isPublic) return [];
    const leaving = (
      await tx.chatMember.findMany({
        where: { chatId, userId: { in: patch.remove_member_ids ?? [], notIn: added } },
        select: { userId: true },
      })
    ).map((member) => member.userId);
    await tx.chatMember.deleteMany({ where: { chatId, userId: { in: leaving } } });
    await tx.chatMember.createMany({ data: added.map((userId) => ({ chatId, userId })), skipDuplicates: true });
    return leaving;
  });
  await forget(chatId, removed);
  return (await chatOuts(admin, [await visibleChat(admin, chatId)]))[0];
}

/** With everything said in it. */
export async function deleteRoom(chatId: string): Promise<Chat> {
  const chat = await prisma.chat.findFirst({ where: { id: chatId, kind: "ROOM" } });
  if (!chat) throw new HttpError(404, "Room not found");
  const members = await prisma.chatMember.findMany({ where: { chatId }, select: { userId: true } });
  await prisma.chat.delete({ where: { id: chatId } });
  await forget(
    chatId,
    members.map((member) => member.userId),
  );
  // And anyone who joined as it went.
  await prisma.notification.deleteMany({ where: { type: "chat", group: { path: ["chatId"], equals: chatId } } });
  return chat;
}

/** Drops what told `userIds` about a chat they can no longer open, once that's saved. In turn with a notification being
 *  written for them: one already being written is dropped after it, and one after this finds them gone (notifyMessage). */
async function forget(chatId: string, userIds: string[]): Promise<void> {
  for (const userId of userIds) {
    await withUserLock(userId, () =>
      prisma.notification.deleteMany({ where: { userId, type: "chat", group: { path: ["chatId"], equals: chatId } } }),
    );
  }
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
  const [senders, names] = await Promise.all([
    newest.senderId ? userCards([newest.senderId]) : new Map<string, UserCardOut>(),
    modelNamesOf(newest.id),
  ]);
  const sender = newest.senderId ? senders.get(newest.senderId) : undefined;
  const { title, body } = notificationText(
    newest.kind,
    newest.name,
    sender?.display_name ?? "Deleted user",
    newest.body,
    1,
    names,
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
  modelNames: string[] = [],
) {
  // A message that's only models says which.
  const said = body.trim()
    ? preview(body)
    : modelNames.length === 1
      ? `Sent "${modelNames[0]}"`
      : `Sent ${modelNames.length} models`;
  if (kind === "DIRECT") {
    return {
      title: count === 1 ? `New message from ${senderName}` : `${count} new messages from ${senderName}`,
      body: said,
    };
  }
  const room = roomName ?? "a room";
  return {
    title: count === 1 ? `New message in ${room}` : `${count} new messages in ${room}`,
    body: `${senderName}: ${said}`,
  };
}

const modelNamesOf = async (messageId: string) =>
  (
    await prisma.chatAttachment.findMany({
      where: { messageId },
      orderBy: { position: "asc" },
      select: { name: true },
    })
  ).map((attachment) => attachment.name);

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

/** One unread notification per chat for each member not reading it, counting what came since; muted chats never. */
async function notifyMessage(chat: Chat, message: ChatMessage): Promise<void> {
  const recipients = await prisma.chatMember.findMany({
    where: { chatId: chat.id, userId: { not: message.senderId ?? undefined }, muted: false },
    select: { userId: true },
  });
  if (!recipients.length) return;
  const [senders, names] = await Promise.all([
    message.senderId ? userCards([message.senderId]) : new Map<string, UserCardOut>(),
    modelNamesOf(message.id),
  ]);
  const senderName = (message.senderId && senders.get(message.senderId)?.display_name) || "Deleted user";
  for (const { userId } of recipients) await notifyRecipient(chat, message, userId, senderName, names);
  // Deleted while these were written: deleteMessage's own pass may have come before the last of them.
  const after = await prisma.chatMessage.findUnique({ where: { id: message.id }, select: { deletedAt: true } });
  if (!after || after.deletedAt) await unquote(message.id);
}

/** Tells one recipient, in their turn, unless that's no longer theirs to hear. Exported for tests, which run it after
 *  what notifyMessage's list of recipients didn't see coming. */
export async function notifyRecipient(
  chat: Chat,
  message: ChatMessage,
  userId: string,
  senderName: string,
  modelNames: string[] = [],
) {
  await withUserLock(userId, async () => {
    // Asked again in turn: since the recipients were read, they may have read the chat, muted it, left it or lost it,
    // and the message may be gone.
    const [member, current] = await Promise.all([
      prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: chat.id, userId } } }),
      prisma.chatMessage.findUnique({ where: { id: message.id }, select: { deletedAt: true } }),
    ]);
    const reading = member?.viewedAt && Date.now() - member.viewedAt.getTime() < READING_MS;
    if (!member || member.muted || reading || member.lastReadAt >= message.createdAt) return;
    if (!current || current.deletedAt) return;
    const existing = await prisma.notification.findFirst({
      where: { userId, readAt: null, type: "chat", group: { path: ["chatId"], equals: chat.id } },
      orderBy: { createdAt: "desc" },
    });
    const folded = readChatGroup(existing?.group);
    const count = (folded?.count ?? 0) + 1;
    const at = message.createdAt.toISOString();
    const text = notificationText(chat.kind, chat.name, senderName, message.body, count, modelNames);
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
