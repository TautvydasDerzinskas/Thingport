import { Router } from "express";
import { prisma } from "../db";
import { requireAdmin, requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { asyncHandler } from "../utils/asyncHandler";
import { z } from "zod";
import { parseBody } from "../utils/validate";
import { deleteAllPrintsForUser, getStorageUsage, listLogs, listUsersWithPrintCounts } from "../services/adminService";
import { createLog } from "../services/auditLog";
import { communityWidgetUsage, widgetsInUse } from "../services/customWidgetsService";
import { getToolsAccess, setToolsAccess, TOOLS_AUDIENCES } from "../services/settingsService";
import {
  adminToolCatalog,
  importToolModels,
  installRepoTool,
  ownToolsInUse,
  provisionEveryoneSoon,
  repoToolScreenshot,
  retryModelFetch,
  uninstallRepoTool,
} from "../services/toolsService";
import { listStorageFolder } from "../services/storageBrowserService";
import { deleteUser, permissionsOver, setUserRole } from "../services/userAdminService";
import { getHealthReport, HEALTH_COMPONENTS, testHealth } from "../services/systemHealthService";
import { INVITATION_TTL_DAYS, inviteUser } from "../services/invitationService";
import { listJobItems } from "../services/importJobService";
import {
  bulkRunState,
  clearFinishedJobs,
  deleteQueueJob,
  getQueueJob,
  listQueueJobs,
  pauseAll,
  pauseLinksJob,
  removeQueueItem,
  retryAllFailed,
  startAllPaused,
  startLinksJob,
} from "../services/importQueueService";
import { toAdminImportJobOut, toImportJobItemOut } from "../dto";
import { authorLinkingSummary, currentAuthorLinkingRun, startAuthorLinking } from "../services/authorLinkingService";
import {
  currentDescriptionRefetch,
  refetchableCounts,
  startDescriptionRefetch,
} from "../services/descriptionRefetchService";

// Mounted at /api/admin (app.ts), so these guards only see admin routes.
const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const users = await listUsersWithPrintCounts();
    const actor = users.find((u) => u.id === req.userId) ?? { id: req.userId!, isOwner: false };
    res.json(
      users.map((u) => {
        // What the viewing admin may do to this user; the endpoints below enforce the same rules.
        const allowed = permissionsOver(actor, u);
        return {
          id: u.id,
          email: u.email,
          display_name: u.displayName,
          role: u.role,
          is_owner: u.isOwner,
          can_promote: allowed.canPromote,
          can_demote: allowed.canDemote,
          can_delete: allowed.canDelete,
          print_count: u.printCount,
          collection_count: u.collectionCount,
          makerworld_connected: u.makerworldConnected,
          sign_in: { password: u.hasPassword, providers: u.signInProviders },
          created_at: u.createdAt,
        };
      }),
    );
  }),
);

// System Health: the last results, without testing anything; testing is the admin's call.
router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    res.json(await getHealthReport());
  }),
);

const healthTestSchema = z.object({ component: z.enum(HEALTH_COMPONENTS).optional() });

// One component, or all of them when none is named.
router.post(
  "/health/test",
  asyncHandler(async (req, res) => {
    res.json(await testHealth(parseBody(healthTestSchema, req.body ?? {}).component));
  }),
);

router.get(
  "/storage",
  asyncHandler(async (_req, res) => {
    const usage = await getStorageUsage();
    res.json({
      model_bytes: usage.modelBytes,
      model_count: usage.modelCount,
      total_bytes: usage.totalBytes,
      picture_bytes: usage.pictureBytes,
      other_generated_bytes: usage.otherGeneratedBytes,
    });
  }),
);

// One folder of the managed model files; no path is the top, with a folder per user.
router.get(
  "/storage/browse",
  asyncHandler(async (req, res) => {
    res.json(await listStorageFolder(typeof req.query.path === "string" ? req.query.path : ""));
  }),
);

function parseDateParam(raw: unknown): Date | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, "Invalid date");
  return parsed;
}

router.get(
  "/logs",
  asyncHandler(async (req, res) => {
    const userId = typeof req.query.user_id === "string" && req.query.user_id ? req.query.user_id : undefined;
    const from = parseDateParam(req.query.from);
    const to = parseDateParam(req.query.to);
    const logs = await listLogs({ userId, from, to });
    res.json(
      logs.map((l) => ({
        id: l.id,
        user_id: l.userId,
        user_display_name: l.userDisplayName,
        user_email: l.userEmail,
        action: l.action,
        target_id: l.targetId,
        details: l.details,
        created_at: l.createdAt,
      })),
    );
  }),
);

// Re-inviting an address sends a fresh link and retires the old one.
const inviteSchema = z.object({ email: z.string().trim().email("Enter a valid email address") });
router.post(
  "/invitations",
  asyncHandler(async (req, res) => {
    const body = parseBody(inviteSchema, req.body);
    const admin = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!admin) throw new HttpError(401, "Invalid or expired token");
    const invitation = await inviteUser({
      email: body.email,
      invitedById: admin.id,
      inviterName: admin.displayName,
      origin: req.get("origin") ?? null,
    });
    void createLog({ userId: admin.id, action: "user_invited", details: { email: invitation.email } });
    res.json({ email: invitation.email, expires_at: invitation.expiresAt, expires_in_days: INVITATION_TTL_DAYS });
  }),
);

const roleSchema = z.object({ role: z.enum(["ADMIN", "MEMBER"]) });

router.patch(
  "/users/:id/role",
  asyncHandler(async (req, res) => {
    await setUserRole(req.userId!, req.params.id, parseBody(roleSchema, req.body).role);
    res.json({ ok: true });
  }),
);

// Irreversible: the account, its models and every file of them. The UI handles the confirmation.
router.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    res.json(await deleteUser(req.userId!, req.params.id));
  }),
);

// Irreversible; the UI handles the confirmation.
router.post(
  "/users/:id/delete-all-prints",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new HttpError(404, "User not found");
    const deleted = await deleteAllPrintsForUser(user.id);
    res.json({ ok: true, deleted });
  }),
);

router.get(
  "/triggers/link-authors",
  asyncHandler(async (_req, res) => {
    res.json({ ...(await authorLinkingSummary()), run: currentAuthorLinkingRun() });
  }),
);

router.post(
  "/triggers/link-authors",
  asyncHandler(async (req, res) => {
    const run = startAuthorLinking(req.userId!);
    if (!run) throw new HttpError(409, "Linking is already running");
    res.json({ run });
  }),
);

router.get(
  "/triggers/refetch-descriptions",
  asyncHandler(async (_req, res) => {
    res.json({ counts: await refetchableCounts(), run: currentDescriptionRefetch() });
  }),
);

const refetchSchema = z.object({ user_id: z.string().min(1) });
// Overwrites the user's descriptions, edits included; the UI handles the confirmation.
router.post(
  "/triggers/refetch-descriptions",
  asyncHandler(async (req, res) => {
    const body = parseBody(refetchSchema, req.body);
    const user = await prisma.user.findUnique({ where: { id: body.user_id } });
    if (!user) throw new HttpError(404, "User not found");
    const run = startDescriptionRefetch(req.userId!, user);
    if (!run) throw new HttpError(409, "Descriptions are already being refetched");
    res.json({ run });
  }),
);

// ---- Import queue: every user's batch imports. Start/retry run as the job's owner, with the
// owner's saved MakerWorld cookie. ----

router.get(
  "/import-queue",
  asyncHandler(async (_req, res) => {
    const jobs = await listQueueJobs();
    res.json({ jobs: jobs.map(toAdminImportJobOut), bulk: bulkRunState() });
  }),
);

router.get(
  "/import-queue/jobs/:id/items",
  asyncHandler(async (req, res) => {
    const job = await getQueueJob(req.params.id);
    res.json((await listJobItems(job.id)).map(toImportJobItemOut));
  }),
);

router.post(
  "/import-queue/jobs/:id/start",
  asyncHandler(async (req, res) => {
    await startLinksJob(await getQueueJob(req.params.id), { manual: true });
    res.status(202).json({ ok: true });
  }),
);

router.post(
  "/import-queue/jobs/:id/retry",
  asyncHandler(async (req, res) => {
    await startLinksJob(await getQueueJob(req.params.id), { retryFailed: true, manual: true });
    res.status(202).json({ ok: true });
  }),
);

router.post(
  "/import-queue/jobs/:id/pause",
  asyncHandler(async (req, res) => {
    await pauseLinksJob(await getQueueJob(req.params.id));
    res.json({ ok: true });
  }),
);

router.delete(
  "/import-queue/jobs/:id",
  asyncHandler(async (req, res) => {
    await deleteQueueJob(req.params.id);
    res.json({ ok: true });
  }),
);

router.delete(
  "/import-queue/items/:id",
  asyncHandler(async (req, res) => {
    res.json(await removeQueueItem(req.params.id));
  }),
);

router.post(
  "/import-queue/start-all",
  asyncHandler(async (_req, res) => {
    res.status(202).json({ queued: await startAllPaused(), bulk: bulkRunState() });
  }),
);

router.post(
  "/import-queue/retry-failed",
  asyncHandler(async (_req, res) => {
    res.status(202).json({ queued: await retryAllFailed(), bulk: bulkRunState() });
  }),
);

router.post(
  "/import-queue/pause-all",
  asyncHandler(async (_req, res) => {
    res.json({ paused: await pauseAll(), bulk: bulkRunState() });
  }),
);

router.post(
  "/import-queue/clear-finished",
  asyncHandler(async (_req, res) => {
    res.json({ deleted: await clearFinishedJobs() });
  }),
);

// The custom widgets users have, and the community repository's with how many installed each.
router.get(
  "/widgets",
  asyncHandler(async (_req, res) => {
    res.json({ widgets: await widgetsInUse() });
  }),
);

router.get(
  "/widgets/community",
  asyncHandler(async (_req, res) => {
    res.json({ widgets: await communityWidgetUsage() });
  }),
);

// Tools: the repository's, with what's installed of each, and who may use them.
router.get(
  "/tools",
  asyncHandler(async (_req, res) => {
    res.json(await adminToolCatalog());
  }),
);

router.get(
  "/tools/own",
  asyncHandler(async (_req, res) => {
    res.json({ tools: await ownToolsInUse() });
  }),
);

router.get(
  "/tools/access",
  asyncHandler(async (_req, res) => {
    res.json(await getToolsAccess());
  }),
);

const toolsAccessSchema = z.object({
  audience: z.enum(TOOLS_AUDIENCES).optional(),
  userIds: z.array(z.string()).max(10_000).optional(),
  userTools: z.boolean().optional(),
});
router.post(
  "/tools/access",
  asyncHandler(async (req, res) => {
    const patch = parseBody(toolsAccessSchema, req.body);
    if (patch.userIds) {
      const known = await prisma.user.findMany({ where: { id: { in: patch.userIds } }, select: { id: true } });
      patch.userIds = known.map((user) => user.id);
    }
    res.json(await setToolsAccess(patch));
    void createLog({ userId: req.userId!, action: "tools_access_changed", details: patch });
    // The tools' models go to whoever may now use them, and from whoever no longer may.
    provisionEveryoneSoon();
  }),
);

// A repository tool's screenshot, by its place in its metadata: for an <img>, so the token may come as ?token=.
router.get(
  "/tools/:slug/screenshots/:index",
  asyncHandler(async (req, res) => {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) throw new HttpError(400, "Not a screenshot");
    const image = await repoToolScreenshot(String(req.params.slug), index);
    res.set("Content-Type", image.type);
    res.set("Cache-Control", "private, max-age=3600");
    res.set("X-Content-Type-Options", "nosniff");
    res.send(image.body);
  }),
);

// Installs a tool from the repository, or takes its update; the models it brings are fetched in the background,
// unless the admin asked for the tool without them.
const installSchema = z.object({ models: z.boolean().optional() });
router.post(
  "/tools/:slug/install",
  asyncHandler(async (req, res) => {
    const { models } = parseBody(installSchema, req.body ?? {});
    res.json(await installRepoTool(String(req.params.slug), req.userId!, { withModels: models ?? true }));
  }),
);

// The models of a tool installed without them.
router.post(
  "/tools/:slug/import-models",
  asyncHandler(async (req, res) => {
    res.json(await importToolModels(String(req.params.slug), req.userId!));
  }),
);

// Tries the models that didn't come again, e.g. once the provider's daily downloads are back.
router.post(
  "/tools/:slug/fetch-models",
  asyncHandler(async (req, res) => {
    await retryModelFetch(String(req.params.slug), req.userId!);
    res.status(202).json({ ok: true });
  }),
);

router.delete(
  "/tools/:slug",
  asyncHandler(async (req, res) => {
    await uninstallRepoTool(String(req.params.slug), req.userId!);
    res.status(204).end();
  }),
);

export default router;
