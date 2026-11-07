import { appendTokenToUrl, authHeaders } from "../utils/auth";
import { apiBase, readErrorMessage, UnauthorizedError } from "./client";
import type { UserCard } from "./social";

/** Someone on a partner instance, as a chat shows them. */
export type RemoteRef = {
  /** username@their-instance, when known. */
  handle: string | null;
  instance: { name: string; origin: string };
  /** Their page on Explore (`/explore/elsewhere/people/:id`), while they share something there. */
  profile_id: string | null;
};

/** Someone to chat with: never their email. `online` is having Thingport in front of them in the last couple of
 *  minutes; `remote` is set for someone on a partner instance, whose `id` is theirs here. */
export type ChatPerson = UserCard & { online: boolean; remote?: RemoteRef | null };
export type ChatSender = UserCard & { remote?: RemoteRef | null };

export type ChatAttachment = {
  id: string;
  /** What the model was called when it was sent. */
  name: string;
  /** The model as the user may open it: whose (null for their own) and its picture. Null once it's deleted, and in a
   *  chat list's last message, which only names it. */
  model: {
    id: string;
    name: string;
    thumb_url: string | null;
    owner: UserCard | null;
    /** A partner's model, sent from there: it opens on Explore. */
    remote?: boolean;
    /** Which partner it's on, for a partner's. */
    instance?: { name: string; origin: string } | null;
  } | null;
};

export type ChatMessage = {
  id: string;
  chat_id: string;
  /** Null once their account is gone. Someone elsewhere has `remote` set. */
  sender: ChatSender | null;
  /** Empty once deleted, and when the message is only models. */
  body: string;
  /** Models of the sender's that came with it. None once it's deleted. */
  attachments: ChatAttachment[];
  deleted: boolean;
  created_at: string;
};

export type Chat = {
  id: string;
  kind: "direct" | "room";
  /** A room's; null for direct messages, which go by the other person's name. */
  name: string | null;
  description: string | null;
  is_public: boolean;
  /** Direct messages: who with, null once their account is gone. */
  other: ChatPerson | null;
  member_count: number;
  /** How many instances its members are on: 1 unless partners' people are in it. */
  instances?: number;
  /** A room hosted on a partner instance: which. It's managed there. */
  hosted_by?: { name: string; origin: string } | null;
  /** A member: can write, and is notified. */
  joined: boolean;
  /** May read its messages: a member, or anyone for a public room. */
  readable: boolean;
  favorite: boolean;
  muted: boolean;
  unread: number;
  last_message: ChatMessage | null;
  last_message_at: string;
  /** An admin's, for a room: edit it, pick its members, delete it. */
  can_manage: boolean;
};

export type ChatDetail = Chat & { members: ChatPerson[] };

export type ChatUnread = {
  /** In every chat the user is in, muted ones left out. */
  unread: number;
  /** The newest unread message, as a notification would put it. */
  latest: { chat_id: string; message_id: string; title: string; body: string; created_at: string } | null;
};

export type MessagePage = {
  /** Oldest first. */
  messages: ChatMessage[];
  /** There's more before the first of them. */
  has_more: boolean;
  /** Deleted since `since`. */
  deleted_ids: string[];
  /** More were deleted than `deleted_ids` holds: read the chat again. */
  deleted_more: boolean;
  /** The server's time, for the next poll's `since`. */
  now: string;
  /** Direct messages: when the other person last read them. */
  other_read_at: string | null;
};

export type RoomInput = {
  name: string;
  description?: string | null;
  is_public: boolean;
  /** A private room's members; the admin making it is always one. */
  member_ids?: string[];
  /** People on partner instances in a private room. */
  remote_member_ids?: string[];
};

/** A room's changes. Members change by who's added and taken out: those not named stay, loaded or not. */
export type RoomPatch = Partial<Omit<RoomInput, "member_ids" | "remote_member_ids">> & {
  add_member_ids?: string[];
  remove_member_ids?: string[];
  add_remote_member_ids?: string[];
  remove_remote_member_ids?: string[];
};

// A partner's people's pictures come through this instance at addresses relative to the API: an <img> sends no header,
// so the session goes in the address, as on Explore.
const picture = (url: string | null) => (url ? appendTokenToUrl(`${apiBase()}${url}`) : null);
const personIn = <T extends ChatSender>(person: T): T =>
  person.remote ? { ...person, avatar_url: picture(person.avatar_url) } : person;
// Model pictures stay as they are: the card adds the session to those itself (ModelThumb), as to any file's.
const messageIn = (message: ChatMessage): ChatMessage => ({
  ...message,
  sender: message.sender && personIn(message.sender),
});
const chatIn = <T extends Chat>(chat: T): T => ({
  ...chat,
  other: chat.other && personIn(chat.other),
  last_message: chat.last_message && messageIn(chat.last_message),
});

/** Asked for something of Chats while an admin has them, or social features, off. */
export class ChatsOffError extends Error {
  constructor() {
    super("Chats are off");
  }
}

/** A request about a chat that's gone, or never was the user's to see. */
export class ChatNotFoundError extends Error {
  constructor(message = "Chat not found") {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: authHeaders(init.body ? { "Content-Type": "application/json" } : {}),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; detail?: string };
    if (body.code === "chats_off") throw new ChatsOffError();
    throw new ChatNotFoundError(body.detail);
  }
  if (!res.ok) throw new Error(await readErrorMessage(res, fallback));
  return res.json();
}

const get = <T>(path: string, fallback: string) => call<T>(path, {}, fallback);
const send = <T>(method: string, path: string, body: unknown, fallback: string) =>
  call<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, fallback);
const chatPath = (chatId: string) => `/chats/${encodeURIComponent(chatId)}`;

export const chatsApi = {
  list: () => get<{ chats: Chat[] }>("/chats", "Failed to load chats").then((res) => res.chats.map(chatIn)),

  /** `seen`: Thingport is in front of the user, which shows them online. */
  unread: (seen: boolean) => get<ChatUnread>(`/chats/unread${seen ? "?seen=1" : ""}`, "Failed to load unread chats"),

  /** Others by any part of their name or their whole email; everyone, by name, for an empty query. Partners' people
   *  come after this instance's, with `remote` set. */
  people: (query: string) =>
    get<{ people: ChatPerson[] }>(`/chats/people?q=${encodeURIComponent(query)}`, "Failed to find people").then((res) =>
      res.people.map(personIn),
    ),

  /** The user's direct messages with someone, started if there were none: someone here by id, or someone on a partner
   *  instance (a person with `remote`, or `{ remoteId }`). */
  openDirect: (who: string | ChatPerson | { remoteId: string }) => {
    const body =
      typeof who === "string"
        ? { user_id: who }
        : "remoteId" in who
          ? { remote_person_id: who.remoteId }
          : who.remote
            ? { remote_person_id: who.id }
            : { user_id: who.id };
    return send<Chat>("POST", "/chats/direct", body, "Failed to open the chat").then(chatIn);
  },

  get: (chatId: string) =>
    get<ChatDetail>(chatPath(chatId), "Failed to load the chat").then((chat) => ({
      ...chatIn(chat),
      members: chat.members.map(personIn),
    })),

  /**
   * The latest page; `before` the page before that message; `after` what came since it (a few seconds' overlap, so
   * keep each message once). `since` adds what was deleted since then. `seen`: the chat is open in front of the user,
   * which reads it.
   */
  messages: (chatId: string, options: { before?: string; after?: string; since?: string; seen?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (options.before) params.set("before", options.before);
    if (options.after) params.set("after", options.after);
    if (options.since) params.set("since", options.since);
    if (options.seen) params.set("seen", "1");
    const query = params.toString();
    return get<MessagePage>(`${chatPath(chatId)}/messages${query ? `?${query}` : ""}`, "Failed to load messages").then(
      (page) => ({ ...page, messages: page.messages.map(messageIn) }),
    );
  },

  /** Text, models from the user's own library (whoever can read the chat can then open them), or both. */
  send: (chatId: string, body: string, printIds: string[] = []) =>
    send<ChatMessage>(
      "POST",
      `${chatPath(chatId)}/messages`,
      { body, ...(printIds.length ? { print_ids: printIds } : {}) },
      "Failed to send the message",
    ).then(messageIn),

  deleteMessage: (chatId: string, messageId: string) =>
    send<{ ok: true }>(
      "DELETE",
      `${chatPath(chatId)}/messages/${encodeURIComponent(messageId)}`,
      undefined,
      "Failed to delete the message",
    ),

  updateMembership: (chatId: string, patch: { favorite?: boolean; muted?: boolean }) =>
    send<Chat>("PATCH", `${chatPath(chatId)}/membership`, patch, "Failed to update the chat").then(chatIn),

  join: (chatId: string) =>
    send<Chat>("POST", `${chatPath(chatId)}/join`, undefined, "Failed to join the room").then(chatIn),

  leave: (chatId: string) =>
    send<{ ok: true }>("POST", `${chatPath(chatId)}/leave`, undefined, "Failed to leave the room"),

  createRoom: (input: RoomInput) => send<Chat>("POST", "/chats/rooms", input, "Failed to create the room").then(chatIn),

  updateRoom: (chatId: string, patch: RoomPatch) =>
    send<Chat>("PATCH", `/chats/rooms/${encodeURIComponent(chatId)}`, patch, "Failed to save the room").then(chatIn),

  deleteRoom: (chatId: string) =>
    send<{ ok: true }>("DELETE", `/chats/rooms/${encodeURIComponent(chatId)}`, undefined, "Failed to delete the room"),
};
