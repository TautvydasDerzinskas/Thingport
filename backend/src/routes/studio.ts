import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { STUDIO_ENABLED } from "../config";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { listAiConnections } from "../services/aiConnectionService";
import { saveStudioDesignToLibrary } from "../services/studioLibrary";
import { getStudioAssistantPrefs } from "../services/settingsService";
import { ASSET_ID } from "../studio/document.generated";
import {
  assistantThread,
  clearAssistantThread,
  MAX_PICTURES,
  startAssistantRun,
  stopAssistantRun,
} from "../services/studioAssistant";
import {
  createStudioDesign,
  deleteStudioDesign,
  getStudioDesign,
  getStudioDesignVersion,
  listStudioDesigns,
  listStudioLibrary,
  addStudioPicture,
  runStudioCommand,
  studioAssetPath,
  studioPicturePath,
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

// The AIs an admin offers for the assistant, for the prompt's picker: which model, and where it runs, never a key. While
// the assistant is off, none are listed.
router.get(
  "/studio/ai-models",
  ...studio,
  asyncHandler(async (_req, res) => {
    const prefs = await getStudioAssistantPrefs();
    const offered = new Set(prefs.aiConnectionIds);
    const connections = prefs.enabled
      ? (await listAiConnections()).filter((connection) => offered.has(connection.id))
      : [];
    res.json({
      enabled: prefs.enabled,
      models: connections.map((connection) => {
        let host = "";
        try {
          host = new URL(connection.baseUrl).host;
        } catch {}
        return {
          id: connection.id,
          model: connection.model,
          host,
          vision: connection.vision,
          is_default: connection.id === prefs.defaultAiConnectionId,
        };
      }),
    });
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

// A picture for the design: one to ask the assistant about, or to trace. The body is the file itself.
router.post(
  "/studio/designs/:id/pictures",
  ...studio,
  express.raw({ type: "image/*", limit: "25mb" }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length)
      throw new HttpError(415, "Send the picture itself, as an image/* body", "studio_bad_picture");
    res.status(201).json(await addStudioPicture(req.userId!, req.params.id, req.body));
  }),
);

// A design's picture, as it was kept. Never changes.
router.get(
  "/studio/designs/:id/pictures/:pictureId",
  ...studio,
  asyncHandler(async (req, res) => {
    const file = await studioPicturePath(req.userId!, req.params.id, req.params.pictureId);
    if (!file) throw new HttpError(404, "Picture not found");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type("image/png").sendFile(file);
  }),
);

// The design as a model in the library: an STL of its visible bodies, the picture the page took of it, and what was
// asked about it as its description.
const saveSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    picture_id: z.string().regex(ASSET_ID).optional(),
  })
  .strict();

router.post(
  "/studio/designs/:id/save-to-library",
  ...studio,
  asyncHandler(async (req, res) => {
    const body = parseBody(saveSchema, req.body ?? {});
    const model = await saveStudioDesignToLibrary(req.userId!, req.params.id, {
      name: body.name,
      pictureId: body.picture_id,
    });
    res.status(201).json({ model });
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

// Studio's assistant: the conversation about a design and the run going on, a prompt to start one, and stopping it.
router.get(
  "/studio/designs/:id/assistant",
  ...studio,
  asyncHandler(async (req, res) => {
    res.json(await assistantThread(req.userId!, req.params.id));
  }),
);

const promptSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    ai_connection_id: z.string().min(1).nullable().optional(),
    // What's selected in the view, by feature id, so "round this" has a "this".
    selected: z.array(z.string().min(1).max(100)).max(50).optional(),
    // Pictures the design keeps (POST .../pictures), for an AI that sees them.
    pictures: z.array(z.string().regex(ASSET_ID)).max(MAX_PICTURES).optional(),
  })
  .strict();

router.post(
  "/studio/designs/:id/assistant",
  ...studio,
  asyncHandler(async (req, res) => {
    const body = parseBody(promptSchema, req.body);
    const run = await startAssistantRun(req.userId!, req.params.id, {
      prompt: body.prompt,
      aiConnectionId: body.ai_connection_id ?? null,
      selected: body.selected,
      pictures: body.pictures,
    });
    res.status(202).json({ run });
  }),
);

router.post(
  "/studio/designs/:id/assistant/stop",
  ...studio,
  asyncHandler(async (req, res) => {
    res.json({ run: await stopAssistantRun(req.userId!, req.params.id) });
  }),
);

router.delete(
  "/studio/designs/:id/assistant",
  ...studio,
  asyncHandler(async (req, res) => {
    await clearAssistantThread(req.userId!, req.params.id);
    res.status(204).end();
  }),
);

export default router;
