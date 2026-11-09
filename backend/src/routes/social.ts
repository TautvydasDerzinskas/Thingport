import { Router, type Response } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../db";
import { createLog } from "../services/auditLog";
import { copyPrintToLibrary } from "../services/modelCopyService";
import { printOutById } from "../services/printLoader";
import { getSocialSettings, setSocialSettings } from "../services/settingsService";
import {
  EMPTY_EXPLORE,
  exploreOverview,
  exploreUser,
  exploreUserCollections,
  exploreUserModels,
  PERSON_COLLECTIONS_PAGE,
  SHARED_WITH_YOU_PAGE,
  sharedWithYou,
  socialStatus,
} from "../services/socialService";
import { sendRemoteMedia } from "../federation/media";
import {
  instancesOut,
  remoteCollection,
  remoteModel,
  remoteOverview,
  remotePerson,
  remotePersonCollections,
  remotePersonModels,
  REMOTE_SHARED_PAGE,
  remoteSharedWithYou,
} from "../federation/remoteExplore";
import { remoteCopyStatus, startRemoteCopy } from "../federation/remoteCopy";
import { sendRemoteZip, streamRemoteFile } from "../federation/remoteFiles";
import { syncStale } from "../federation/remoteIndex";
import { isFederationLive } from "../federation/settings";
import { licenseAllowsFromQuery, parseSortMode, splitList } from "../services/printQuery";
import { MAX_SHARES, remoteShareOut, sharingOf, updateSharing } from "../services/collectionSharing";
import { personByHandle } from "../federation/sharedCollections";
import { searchPeople } from "../services/chatService";

const router = Router();

/** `limit` and `offset` from a list's query, checked. */
function pageQuery(query: Record<string, unknown>, defaultLimit: number): { limit: number; offset: number } {
  const limit = Number(query.limit ?? defaultLimit);
  const offset = Number(query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "Invalid limit");
  if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, "Invalid offset");
  return { limit, offset };
}

/** A page of a list, its count in the headers as GET /prints gives it. */
function sendPage(res: Response, items: unknown[], offset: number, total: number): void {
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Has-More", offset + items.length < total ? "true" : "false");
  res.json(items);
}
router.use(requireAuth);

// For everyone: whether the sidebar offers Explore and Chats, and whether a collection's form offers making it public.
router.get(
  "/social",
  asyncHandler(async (_req, res) => {
    res.json(await socialStatus());
  }),
);

router.get(
  "/social/settings",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await getSocialSettings());
  }),
);

const socialSettingsSchema = z.object({ enabled: z.boolean(), chats: z.boolean() }).partial();
router.patch(
  "/social/settings",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const patch = parseBody(socialSettingsSchema, req.body);
    const settings = await setSocialSettings(patch);
    res.json(settings);
    void createLog({ userId: req.userId!, action: "social_settings_changed", details: patch });
  }),
);

/** Explore is gone with social features: what's public then stays where its owner put it, unseen. */
async function assertSocialOn(): Promise<void> {
  if (!(await getSocialSettings()).enabled) throw new HttpError(404, "Social features are off", "social_off");
}

// Index older than this when someone opens Explore: read again in the background, for the next look.
const EXPLORE_FRESH_MS = 2 * 60 * 1000;

/** Explore, with partners' people, models and collections beside this instance's own while connected instances are
 *  on: ?scope=all (the default), here, or a partner's id for only theirs. `elsewhere` is read-only for now. */
router.get(
  "/explore",
  asyncHandler(async (req, res) => {
    await assertSocialOn();
    const scope = typeof req.query.scope === "string" ? req.query.scope : "all";
    const live = await isFederationLive();
    const local = !live || scope === "all" || scope === "here" ? await exploreOverview(req.userId!) : EMPTY_EXPLORE;
    if (!live) {
      res.json({
        ...local,
        elsewhere: {
          people: [],
          recent_models: [],
          recent_collections: [],
          shared_with_you: [],
          shared_with_you_total: 0,
        },
        instances: [],
      });
      return;
    }
    void syncStale(EXPLORE_FRESH_MS).catch(() => {});
    const [elsewhere, instances] = await Promise.all([
      scope === "here"
        ? Promise.resolve({
            people: [],
            recent_models: [],
            recent_collections: [],
            shared_with_you: [],
            shared_with_you_total: 0,
          })
        : remoteOverview(scope === "all" ? null : scope, req.userId!),
      instancesOut(),
    ]);
    res.json({ ...local, elsewhere, instances });
  }),
);

/** Someone on a partner instance, a model or a collection of theirs, and their pictures: from what this instance keeps
 *  of what partners share (federation/remoteExplore.ts), while connected instances are on. */
async function assertElsewhere(): Promise<void> {
  await assertSocialOn();
  if (!(await isFederationLive())) throw new HttpError(404, "Connected instances are off", "federation_off");
}

// What partners' people shared with the viewer, past the first page Explore came with: ?scope=all (the default) or
// a partner's id, as Explore's.
router.get(
  "/explore/elsewhere/shared",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    const scope = typeof req.query.scope === "string" && req.query.scope !== "all" ? req.query.scope : null;
    const { limit, offset } = pageQuery(req.query, REMOTE_SHARED_PAGE);
    const page = await remoteSharedWithYou(scope, req.userId!, limit, offset);
    sendPage(res, page.collections, offset, page.total);
  }),
);

router.get(
  "/explore/elsewhere/person/:id",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    const page = await remotePerson(req.params.id);
    if (!page) throw new HttpError(404, "Not found");
    res.json(page);
  }),
);

router.get(
  "/explore/elsewhere/person/:id/models",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    const { limit, offset } = pageQuery(req.query, 24);
    const page = await remotePersonModels(req.params.id, limit, offset);
    if (!page) throw new HttpError(404, "Not found");
    sendPage(res, page.models, offset, page.total);
  }),
);

router.get(
  "/explore/elsewhere/person/:id/collections",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    const { limit, offset } = pageQuery(req.query, PERSON_COLLECTIONS_PAGE);
    const page = await remotePersonCollections(req.params.id, limit, offset);
    if (!page) throw new HttpError(404, "Not found");
    sendPage(res, page.collections, offset, page.total);
  }),
);

router.get(
  "/explore/elsewhere/model/:id",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    const model = await remoteModel(req.params.id, req.userId!);
    if (!model) throw new HttpError(404, "Not found");
    res.json(model);
  }),
);

// A partner's model's files, through this instance: one as it comes, by its key and with its name last (for slicers),
// or all of them zipped.
router.get(
  "/explore/elsewhere/model/:id/files/:file/:filename",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    await streamRemoteFile(req, res, req.params.id, req.params.file);
  }),
);

router.get(
  "/explore/elsewhere/model/:id/files.zip",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    await sendRemoteZip(req, res, req.params.id, req.userId!);
  }),
);

// Copying a partner's model into the user's library runs in the background; GET says how it's going.
router.post(
  "/explore/elsewhere/model/:id/copy",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    res.json(await startRemoteCopy(req.userId!, req.params.id));
  }),
);

router.get(
  "/explore/elsewhere/model/:id/copy",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    res.json(await remoteCopyStatus(req.userId!, req.params.id));
  }),
);

router.get(
  "/explore/elsewhere/collection/:id",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    const { limit, offset } = pageQuery(req.query, 30);
    const page = await remoteCollection(req.params.id, limit, offset, req.userId!);
    if (!page) throw new HttpError(404, "Not found");
    res.json(page);
  }),
);

router.get(
  "/explore/elsewhere/media/:token",
  asyncHandler(async (req, res) => {
    await assertElsewhere();
    await sendRemoteMedia(req.params.token, res, req.userId!);
  }),
);

router.get(
  "/explore/user/:id",
  asyncHandler(async (req, res) => {
    await assertSocialOn();
    const page = await exploreUser(req.userId!, req.params.id);
    if (!page) throw new HttpError(404, "User not found");
    res.json(page);
  }),
);

// A user's public collections past the first page their page came with.
router.get(
  "/explore/user/:id/collections",
  asyncHandler(async (req, res) => {
    await assertSocialOn();
    const { limit, offset } = pageQuery(req.query, PERSON_COLLECTIONS_PAGE);
    const page = await exploreUserCollections(req.userId!, req.params.id, limit, offset);
    if (!page) throw new HttpError(404, "User not found");
    sendPage(res, page.collections, offset, page.total);
  }),
);

// Collections their owners shared with the viewer, past the first page Explore came with.
router.get(
  "/explore/shared",
  asyncHandler(async (req, res) => {
    await assertSocialOn();
    const { limit, offset } = pageQuery(req.query, SHARED_WITH_YOU_PAGE);
    const page = await sharedWithYou(req.userId!, limit, offset);
    // With when each was last shared or added to, as Explore's first page says, to order partners' beside them.
    const items = page.collections.map((collection) => ({ ...collection, shared_at: page.at[collection.id] ?? null }));
    sendPage(res, items, offset, page.total);
  }),
);

// People to share a collection with: the instance's other users, by any part of their name or their whole email, as
// a new chat finds them; then, while connected instances are on, partners' people, and someone on a partner by their
// exact handle (name@host), asked of that partner if it's nobody this instance knows. Never their emails.
router.get(
  "/social/people",
  asyncHandler(async (req, res) => {
    await assertSocialOn();
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    const people = await searchPeople({ id: req.userId!, isAdmin: false }, q);
    if (q.includes("@") && (await isFederationLive())) {
      const named = await personByHandle(q, req.userId!);
      if (named && !people.some((person) => person.id === named.id)) {
        people.push({ ...remoteShareOut(named), online: false });
      }
    }
    res.json({ people });
  }),
);

// Who the viewer's own collection is shared with, and whether it is: the whole list, kept while it's private or
// public too.
router.get(
  "/collection/:id/sharing",
  asyncHandler(async (req, res) => {
    res.json(await sharingOf(req.userId!, req.params.id));
  }),
);

const sharingSchema = z.object({
  visibility: z.enum(["private", "shared", "public"]).optional(),
  add_user_ids: z.array(z.string().min(1)).max(MAX_SHARES).optional(),
  remove_user_ids: z.array(z.string().min(1)).max(MAX_SHARES).optional(),
  add_remote_person_ids: z.array(z.string().min(1)).max(MAX_SHARES).optional(),
  remove_remote_person_ids: z.array(z.string().min(1)).max(MAX_SHARES).optional(),
});

// Changes it: its visibility, people added to the list and taken off it (the rest stay). Those who can see it now
// and couldn't are notified. Refused while social features are off.
router.patch(
  "/collection/:id/sharing",
  asyncHandler(async (req, res) => {
    const body = parseBody(sharingSchema, req.body);
    const sharing = await updateSharing(req.userId!, req.params.id, body);
    res.json(sharing);
    const collection = await prisma.collection.findUnique({ where: { id: req.params.id }, select: { name: true } });
    void createLog({
      userId: req.userId!,
      action: "collection_sharing_changed",
      targetId: req.params.id,
      details: {
        name: collection?.name ?? null,
        visibility: sharing.visibility,
        ...(body.add_user_ids?.length || body.add_remote_person_ids?.length
          ? { added: (body.add_user_ids?.length ?? 0) + (body.add_remote_person_ids?.length ?? 0) }
          : {}),
        ...(body.remove_user_ids?.length || body.remove_remote_person_ids?.length
          ? { removed: (body.remove_user_ids?.length ?? 0) + (body.remove_remote_person_ids?.length ?? 0) }
          : {}),
      },
    });
  }),
);

// A user's own models, once they made them public: answered like GET /prints, a page with its count in the headers.
router.get(
  "/explore/user/:id/models",
  asyncHandler(async (req, res) => {
    await assertSocialOn();
    const { limit, offset } = pageQuery(req.query, 24);
    const page = await exploreUserModels(
      req.userId!,
      req.params.id,
      {
        generative: req.query.generative === "1" || req.query.generative === "true",
        excludeProviders: splitList(req.query.hide_providers),
        licenseAllows: licenseAllowsFromQuery(splitList(req.query.license_allows)),
        licensed: req.query.licensed === "1" || req.query.licensed === "true",
      },
      { sort: parseSortMode(req.query.orderBy), limit, offset },
    );
    if (!page) throw new HttpError(404, "This user's models aren't public");
    res.setHeader("X-Has-More", page.hasMore ? "true" : "false");
    res.setHeader("X-Next-Offset", String(page.nextOffset));
    res.setHeader("X-Total-Count", String(page.total));
    res.json(page.prints);
  }),
);

// Another user's model, from one of their public collections, into the user's library. A model they already have isn't
// copied again: that one comes back. Filing one into a collection goes through the collection's own routes, which copy
// it first.
router.post(
  "/print/:id/copy",
  asyncHandler(async (req, res) => {
    const { print, copied } = await copyPrintToLibrary(req.userId!, req.params.id);
    res.json({ print: await printOutById(req.userId!, print.id), copied });
  }),
);

export default router;
