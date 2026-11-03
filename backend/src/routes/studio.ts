import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { STUDIO_ENABLED } from "../config";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { listAiConnections } from "../services/aiConnectionService";
import {
  createStudioDesign,
  deleteStudioDesign,
  getStudioDesign,
  getStudioDesignVersion,
  listStudioDesigns,
  listStudioLibrary,
  runStudioCommand,
  studioAssetPath,
} from "../services/studioService";

// Studio, the CAD page. Every change to a design comes in through POST .../commands, the same commands its MCP tools
// run (mcp/studioTools.ts). Each route takes requireAuth itself, rather than the whole router, so these don't turn away
// other routers' requests on the way past.

const router = Router();

/** While STUDIO_ENABLED is off, Studio's routes aren't there at all. */
function requireStudio(_req: Request, _res: Response, next: NextFunction) {
  next(STUDIO_ENABLED ? undefined : new HttpError(404, "Not found"));
}

const studio = [requireAuth, requireStudio];

router.get("/studio/status", requireAuth, (_req, res) => {
  res.json({ enabled: STUDIO_ENABLED });
});

// The AIs an admin added in Administration > AI, for the prompt's picker: which model, and where it runs, never a key.
router.get(
  "/studio/ai-models",
  ...studio,
  asyncHandler(async (_req, res) => {
    const connections = await listAiConnections();
    res.json(
      connections.map((connection) => {
        let host = "";
        try {
          host = new URL(connection.baseUrl).host;
        } catch {}
        return { id: connection.id, model: connection.model, host, is_default: connection.isDefault };
      }),
    );
  }),
);

// The user's models with a 3D file Studio can import, for the Open dialog's Library tab.
router.get(
  "/studio/library",
  ...studio,
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : undefined;
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0);
    res.json(await listStudioLibrary(req.userId!, q, offset));
  }),
);

router.get(
  "/studio/designs",
  ...studio,
  asyncHandler(async (req, res) => {
    res.json(await listStudioDesigns(req.userId!));
  }),
);

const createSchema = z.object({ name: z.string().trim().max(120).optional() });

router.post(
  "/studio/designs",
  ...studio,
  asyncHandler(async (req, res) => {
    const body = parseBody(createSchema, req.body ?? {});
    res.status(201).json(await createStudioDesign(req.userId!, body.name, "user"));
  }),
);

router.get(
  "/studio/designs/:id",
  ...studio,
  asyncHandler(async (req, res) => {
    res.json(await getStudioDesign(req.userId!, req.params.id));
  }),
);

router.get(
  "/studio/designs/:id/version",
  ...studio,
  asyncHandler(async (req, res) => {
    res.json({ version: await getStudioDesignVersion(req.userId!, req.params.id) });
  }),
);

// A design's copy of a mesh it imported. Never changes: a new import is a new asset.
router.get(
  "/studio/designs/:id/assets/:assetId",
  ...studio,
  asyncHandler(async (req, res) => {
    const file = await studioAssetPath(req.userId!, req.params.id, req.params.assetId);
    if (!file) throw new HttpError(404, "Mesh not found");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type("application/octet-stream").sendFile(file);
  }),
);

router.delete(
  "/studio/designs/:id",
  ...studio,
  asyncHandler(async (req, res) => {
    await deleteStudioDesign(req.userId!, req.params.id);
    res.status(204).end();
  }),
);

const commandSchema = z.object({ command: z.string().min(1), args: z.record(z.string(), z.unknown()).optional() });

router.post(
  "/studio/designs/:id/commands",
  ...studio,
  asyncHandler(async (req, res) => {
    const body = parseBody(commandSchema, req.body);
    res.json(await runStudioCommand(req.userId!, req.params.id, body.command, body.args ?? {}, "user"));
  }),
);

export default router;
