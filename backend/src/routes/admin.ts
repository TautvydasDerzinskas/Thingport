import { Router } from "express";
import { prisma } from "../db";
import { requireAdmin, requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { asyncHandler } from "../utils/asyncHandler";
import { deleteAllPrintsForUser, getStorageUsage, listLogs, listUsersWithPrintCounts } from "../services/adminService";

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

router.get(
  "/admin/users",
  asyncHandler(async (_req, res) => {
    const users = await listUsersWithPrintCounts();
    res.json(
      users.map((u) => ({
        id: u.id,
        email: u.email,
        display_name: u.displayName,
        role: u.role,
        print_count: u.printCount,
        collection_count: u.collectionCount,
        makerworld_connected: u.makerworldConnected,
        created_at: u.createdAt,
      })),
    );
  }),
);

// Total disk use by models across the whole instance -- shown at the bottom of the Administration
// hub. See getStorageUsage for exactly what's counted.
router.get(
  "/admin/storage",
  asyncHandler(async (_req, res) => {
    const usage = await getStorageUsage();
    res.json({ model_bytes: usage.modelBytes, model_count: usage.modelCount });
  }),
);

function parseDateParam(raw: unknown): Date | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, "Invalid date");
  return parsed;
}

router.get(
  "/admin/logs",
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

// The two-part "select a user + type their email to confirm" flow lives entirely on the
// frontend (TriggersSection.tsx) -- this endpoint just does the (irreversible) deletion once
// asked, trusting the UI already got explicit confirmation from the admin.
router.post(
  "/admin/users/:id/delete-all-prints",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new HttpError(404, "User not found");
    const deleted = await deleteAllPrintsForUser(user.id);
    res.json({ ok: true, deleted });
  }),
);

export default router;
