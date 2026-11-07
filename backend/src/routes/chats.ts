import { Router, type Request } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseBody } from "../utils/validate";
import { createLog } from "../services/auditLog";
import {
  MAX_ATTACHMENTS,
  MESSAGE_MAX_LENGTH,
  ROOM_DESCRIPTION_MAX_LENGTH,
  ROOM_NAME_MAX_LENGTH,
  assertChatsOn,
  createRoom,
  deleteMessage,
  deleteRoom,
  getChat,
  joinRoom,
  leaveRoom,
  listChats,
  listMessages,
  openDirect,
  openRemoteDirect,
  postMessage,
  searchPeople,
  touchSeen,
  unreadSummary,
  updateMembership,
  updateRoom,
  type Viewer,
} from "../services/chatService";

const router = Router();
router.use(
  "/chats",
  requireAuth,
  asyncHandler(async (_req, _res, next) => {
    await assertChatsOn();
    next();
  }),
);

// An API token reads as its user, but never as an admin, and never counts as them having looked.
const viewerOf = (req: Request): Viewer => ({ id: req.userId!, isAdmin: req.userRole === "ADMIN" && !req.viaApiToken });
const lookedAt = (req: Request) => req.query.seen === "1" && !req.viaApiToken;

router.get(
  "/chats",
  asyncHandler(async (req, res) => {
    res.json({ chats: await listChats(viewerOf(req)) });
  }),
);

// Asked every half a minute while Thingport is open; `seen` also says the user has it in front of them.
router.get(
  "/chats/unread",
  asyncHandler(async (req, res) => {
    if (lookedAt(req)) await touchSeen(req.userId!);
    res.json(await unreadSummary(req.userId!));
  }),
);

const peopleQuerySchema = z.object({ q: z.string().max(200).optional() });
router.get(
  "/chats/people",
  asyncHandler(async (req, res) => {
    const { q } = parseBody(peopleQuerySchema, req.query);
    res.json({ people: await searchPeople(viewerOf(req), q ?? "") });
  }),
);

// Someone here by `user_id`, or someone on a partner instance by `remote_person_id` (as /chats/people gives them).
const directSchema = z.union([
  z.object({ user_id: z.string().min(1) }),
  z.object({ remote_person_id: z.string().min(1) }),
]);
router.post(
  "/chats/direct",
  asyncHandler(async (req, res) => {
    const body = parseBody(directSchema, req.body);
    res.json(
      "user_id" in body
        ? await openDirect(viewerOf(req), body.user_id)
        : await openRemoteDirect(viewerOf(req), body.remote_person_id),
    );
  }),
);

const roomSchema = z.object({
  name: z.string().trim().min(1).max(ROOM_NAME_MAX_LENGTH),
  description: z.string().max(ROOM_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  is_public: z.boolean(),
  member_ids: z.array(z.string()).max(500).optional(),
  remote_member_ids: z.array(z.string()).max(500).optional(),
});
// Members by who's added and who's taken out, never a whole list: the editor may have loaded only some of them.
const roomPatchSchema = roomSchema
  .omit({ member_ids: true, remote_member_ids: true })
  .partial()
  .extend({
    add_member_ids: z.array(z.string()).max(500).optional(),
    remove_member_ids: z.array(z.string()).max(500).optional(),
    add_remote_member_ids: z.array(z.string()).max(500).optional(),
    remove_remote_member_ids: z.array(z.string()).max(500).optional(),
  });

router.post(
  "/chats/rooms",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const input = parseBody(roomSchema, req.body);
    const room = await createRoom(viewerOf(req), input);
    res.json(room);
    void createLog({
      userId: req.userId!,
      action: "chat_room_created",
      targetId: room.id,
      details: { name: room.name, is_public: room.is_public },
    });
  }),
);

router.patch(
  "/chats/rooms/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch = parseBody(roomPatchSchema, req.body);
    const room = await updateRoom(viewerOf(req), req.params.id, patch);
    res.json(room);
    void createLog({
      userId: req.userId!,
      action: "chat_room_edited",
      targetId: room.id,
      details: { name: room.name, is_public: room.is_public, members: room.member_count },
    });
  }),
);

router.delete(
  "/chats/rooms/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const room = await deleteRoom(req.params.id);
    res.json({ ok: true });
    void createLog({
      userId: req.userId!,
      action: "chat_room_deleted",
      targetId: room.id,
      details: { name: room.name },
    });
  }),
);

router.get(
  "/chats/:id",
  asyncHandler(async (req, res) => {
    res.json(await getChat(viewerOf(req), req.params.id));
  }),
);

const messagesQuerySchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
router.get(
  "/chats/:id/messages",
  asyncHandler(async (req, res) => {
    const query = parseBody(messagesQuerySchema, req.query);
    res.json(await listMessages(viewerOf(req), req.params.id, { ...query, seen: lookedAt(req) }));
  }),
);

// Text, models from the sender's own library (print_ids), or both.
const messageSchema = z.object({
  body: z
    .string()
    .max(MESSAGE_MAX_LENGTH * 2)
    .default(""),
  print_ids: z.array(z.string()).max(MAX_ATTACHMENTS).optional(),
});
router.post(
  "/chats/:id/messages",
  asyncHandler(async (req, res) => {
    const { body, print_ids } = parseBody(messageSchema, req.body);
    res.json(await postMessage(viewerOf(req), req.params.id, body, print_ids));
  }),
);

router.delete(
  "/chats/:id/messages/:messageId",
  asyncHandler(async (req, res) => {
    await deleteMessage(viewerOf(req), req.params.id, req.params.messageId);
    res.json({ ok: true });
  }),
);

const membershipSchema = z.object({ favorite: z.boolean(), muted: z.boolean() }).partial();
router.patch(
  "/chats/:id/membership",
  asyncHandler(async (req, res) => {
    const patch = parseBody(membershipSchema, req.body);
    res.json(await updateMembership(viewerOf(req), req.params.id, patch));
  }),
);

router.post(
  "/chats/:id/join",
  asyncHandler(async (req, res) => {
    res.json(await joinRoom(viewerOf(req), req.params.id));
  }),
);

router.post(
  "/chats/:id/leave",
  asyncHandler(async (req, res) => {
    await leaveRoom(viewerOf(req), req.params.id);
    res.json({ ok: true });
  }),
);

export default router;
