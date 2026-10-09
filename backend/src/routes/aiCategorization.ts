import { Router, type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../auth";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { asyncHandler } from "../utils/asyncHandler";
import { parseBody } from "../utils/validate";
import { printOutById, printOutsByIds } from "../services/printLoader";
import {
  acceptAiSuggestion,
  aiCategorizationCounts,
  cancelAiCategorizationRun,
  categorizePrint,
  currentAiCategorizationRun,
  rejectAiSuggestion,
  startAiCategorizationRun,
  type AiCategorizationRun,
} from "../services/aiCategorizationService";
import { aiCategorizationEnabled, getAiCategorizationSettings } from "../services/settingsService";

const router = Router();
router.use(requireAuth);

function runOut(run: AiCategorizationRun | null) {
  if (!run) return null;
  return {
    running: run.running,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    total: run.total,
    done: run.done,
    applied: run.applied,
    suggested: run.suggested,
    no_match: run.noMatch,
    failed: run.failed,
    cancelled: run.cancelled,
    last_error: run.lastError,
  };
}

function aiFailure(error: unknown): never {
  if (error instanceof HttpError) throw error;
  throw new HttpError(502, "AI provider failed", "ai_failed");
}

router.get(
  "/ai-categorization/status",
  asyncHandler(async (_req, res) => {
    const settings = await getAiCategorizationSettings();
    res.json({ enabled: aiCategorizationEnabled(settings), mode: settings.mode });
  }),
);

const recategorizeSchema = z.object({ force: z.boolean().optional() });
router.post(
  "/print/:id/recategorize",
  asyncHandler(async (req, res) => {
    const body = parseBody(recategorizeSchema, req.body);
    let outcome;
    try {
      outcome = await categorizePrint(req.userId!, req.params.id, body);
    } catch (error) {
      aiFailure(error);
    }
    res.json({ print: await printOutById(req.userId!, req.params.id), outcome });
  }),
);

router.post(
  "/print/:id/ai-suggestion/accept",
  asyncHandler(async (req, res) => {
    await acceptAiSuggestion(req.userId!, req.params.id);
    res.json({ print: await printOutById(req.userId!, req.params.id) });
  }),
);

router.post(
  "/print/:id/ai-suggestion/reject",
  asyncHandler(async (req, res) => {
    await rejectAiSuggestion(req.userId!, req.params.id);
    res.json({ print: await printOutById(req.userId!, req.params.id) });
  }),
);

router.get(
  "/ai-categorization/suggestions",
  asyncHandler(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50));
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0);
    const where = { userId: req.userId!, aiSuggestion: { not: Prisma.DbNull } };
    const [total, rows] = await Promise.all([
      prisma.print.count({ where }),
      prisma.print.findMany({ where, orderBy: { updatedAt: "desc" }, skip: offset, take: limit, select: { id: true } }),
    ]);
    const outs = await printOutsByIds(
      req.userId!,
      rows.map((row) => row.id),
    );
    res.json({
      total,
      items: rows.flatMap((row) => {
        const item = outs.get(row.id);
        return item ? [item] : [];
      }),
    });
  }),
);

const bulkSchema = z.object({ action: z.enum(["accept", "reject"]), print_ids: z.array(z.string()).max(500) });
router.post(
  "/ai-categorization/suggestions/bulk",
  asyncHandler(async (req, res) => {
    const body = parseBody(bulkSchema, req.body);
    let accepted = 0;
    let rejected = 0;
    let failed = 0;
    for (const printId of new Set(body.print_ids)) {
      try {
        if (body.action === "accept") {
          await acceptAiSuggestion(req.userId!, printId);
          accepted++;
        } else {
          await rejectAiSuggestion(req.userId!, printId);
          rejected++;
        }
      } catch {
        failed++;
      }
    }
    res.json({ accepted, rejected, failed });
  }),
);

router.get(
  "/ai-categorization/run",
  asyncHandler(async (req, res) => {
    res.json({
      counts: await aiCategorizationCounts(req.userId!),
      run: runOut(currentAiCategorizationRun(req.userId!)),
    });
  }),
);

const runSchema = z.object({ include_ai: z.boolean(), include_rule: z.boolean(), include_legacy: z.boolean() });
router.post(
  "/ai-categorization/run",
  asyncHandler(async (req, res) => {
    const settings = await getAiCategorizationSettings();
    if (!aiCategorizationEnabled(settings)) throw new HttpError(503, "AI categorization is disabled", "ai_disabled");
    const body = parseBody(runSchema, req.body);
    const run = startAiCategorizationRun(req.userId!, {
      includeAi: body.include_ai,
      includeRule: body.include_rule,
      includeLegacy: body.include_legacy,
    });
    if (!run) throw new HttpError(409, "AI categorization run is already active", "running");
    res.status(202).json({ run: runOut(run) });
  }),
);

router.post(
  "/ai-categorization/run/cancel",
  asyncHandler(async (req, res) => {
    res.json({ run: runOut(cancelAiCategorizationRun(req.userId!)) });
  }),
);

// These client actions have a small, documented error shape separate from the older API's
// `detail` convention, so callers can branch on a stable code without parsing text.
router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof HttpError && error.code) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  next(error);
});

export default router;
