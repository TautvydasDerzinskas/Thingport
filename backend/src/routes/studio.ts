import express, { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { attachmentDisposition, HttpError } from "../utils/fileUtils";
import { normalizeFileName } from "../files/names";
import { parseBody } from "../utils/validate";
import { listAiConnections } from "../services/aiConnectionService";
import { exportStudioDesign } from "../services/studioExport";
import { saveStudioDesignToLibrary } from "../services/studioLibrary";
import { getStudioAssistantPrefs } from "../services/settingsService";
import {
  getStudioSettings,
  setStudioSettings,
  STUDIO_PROMPT_LAYOUTS,
  STUDIO_UNITS,
  studioGridSchema,
  type StudioSettings,
} from "../services/studioSettingsService";
import { ASSET_ID, studioPlates } from "../studio/document.generated";
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

// Always on now. The web app still asks, so that a frontend newer than its backend hides Studio rather than offer a
// page with nothing behind it.
router.get("/studio/status", requireAuth, (_req, res) => {
  res.json({ enabled: true });
});

// The person's own Studio settings: where the assistant shows, and the units new designs start in.
const studioSettingsOut = (settings: StudioSettings) => ({
  prompt_layout: settings.promptLayout,
  units: settings.units,
  grid: settings.grid,
});
router.get(
  "/studio/settings",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(studioSettingsOut(await getStudioSettings(req.userId!)));
  }),
);

const studioSettingsSchema = z
  .object({
    prompt_layout: z.enum(STUDIO_PROMPT_LAYOUTS).optional(),
    units: z.enum(STUDIO_UNITS).optional(),
    grid: studioGridSchema.partial().optional(),
  })
  .strict();
router.patch(
  "/studio/settings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(studioSettingsSchema, req.body);
    res.json(
      studioSettingsOut(
        await setStudioSettings(req.userId!, { promptLayout: body.prompt_layout, units: body.units, grid: body.grid }),
      ),
    );
  }),
);

// The AIs an admin offers for the assistant, for the prompt's picker: which model, and where it runs, never a key. While
// the assistant is off, none are listed.
router.get(
  "/studio/ai-models",
  requireAuth,
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
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : undefined;
    const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0);
    res.json(await listStudioLibrary(req.userId!, q, offset));
  }),
);

router.get(
  "/studio/designs",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listStudioDesigns(req.userId!));
  }),
);

const createSchema = z.object({ name: z.string().trim().max(120).optional() });

router.post(
  "/studio/designs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(createSchema, req.body ?? {});
    res.status(201).json(await createStudioDesign(req.userId!, body.name, "user"));
  }),
);

router.get(
  "/studio/designs/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getStudioDesign(req.userId!, req.params.id));
  }),
);

router.get(
  "/studio/designs/:id/version",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ version: await getStudioDesignVersion(req.userId!, req.params.id) });
  }),
);

// A design's copy of a mesh it imported. Never changes: a new import is a new asset.
router.get(
  "/studio/designs/:id/assets/:assetId",
  requireAuth,
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
  requireAuth,
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
  requireAuth,
  asyncHandler(async (req, res) => {
    const file = await studioPicturePath(req.userId!, req.params.id, req.params.pictureId);
    if (!file) throw new HttpError(404, "Picture not found");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.type("image/png").sendFile(file);
  }),
);

const exportSchema = z.object({
  format: z.enum(["auto", "3mf", "stl", "stl-zip"]),
  slicer: z.string().regex(/^[a-z0-9-]{1,40}$/),
  printer: z.string().regex(/^[a-z0-9-]{1,120}$/),
  nozzle: z.string().regex(/^(?:-|[A-Za-z]{0,3}\d+(?:\.\d+)?)$/),
  plate: z.string().regex(/^(?:-|plate-[1-9]\d*)$/),
});

router.get(
  "/studio/designs/:id/export/:format/:slicer/:printer/:nozzle/:plate/:filename",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { format, slicer, printer, nozzle, plate } = parseBody(exportSchema, req.params);
    if ((printer === "-") !== (nozzle === "-") || (printer !== "-" && slicer === "-"))
      throw new HttpError(400, "Choose a slicer, printer and nozzle together.");
    const design = await getStudioDesign(req.userId!, req.params.id);
    const file = await exportStudioDesign(req.userId!, design, {
      format,
      slicer: slicer === "-" ? undefined : slicer,
      printer: printer === "-" ? undefined : { id: printer, nozzle },
      plate: plate === "-" ? undefined : plate,
    });
    const plateName = plate === "-" ? null : studioPlates(design.document).find((entry) => entry.id === plate)?.name;
    const title = plateName ? `${design.name} - ${plateName}` : design.name;
    // With its extension, so the whole name keeps within the limit and the cut comes off the title.
    const name = normalizeFileName(`${title}.${file.format}`).replace(/[:*?"<>|]+/g, "-");
    res.set("Cache-Control", "private, no-store");
    res.set("Content-Disposition", attachmentDisposition(name));
    res.type(file.mime).send(Buffer.from(file.bytes));
  }),
);

// The design as a model in the library: a 3MF of its visible bodies, the picture the page took of it, and what was
// asked about it as its description.
const saveSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    picture_id: z.string().regex(ASSET_ID).optional(),
  })
  .strict();

router.post(
  "/studio/designs/:id/save-to-library",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(saveSchema, req.body ?? {});
    const model = await saveStudioDesignToLibrary(req.userId!, req.params.id, {
      name: body.name,
      pictureId: body.picture_id,
    });
    res.status(201).json({ model });
  }),
);

const deleteSchema = z.object({ expected_version: z.number().int().min(0).max(2_147_483_647).optional() });

router.delete(
  "/studio/designs/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(deleteSchema, req.body ?? {});
    await deleteStudioDesign(req.userId!, req.params.id, body.expected_version);
    res.status(204).end();
  }),
);

const commandSchema = z.object({ command: z.string().min(1), args: z.record(z.string(), z.unknown()).optional() });

router.post(
  "/studio/designs/:id/commands",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(commandSchema, req.body);
    res.json(await runStudioCommand(req.userId!, req.params.id, body.command, body.args ?? {}, "user"));
  }),
);

// Studio's assistant: the conversation about a design and the run going on, a prompt to start one, and stopping it.
router.get(
  "/studio/designs/:id/assistant",
  requireAuth,
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
    active_plate: z
      .string()
      .regex(/^plate-[1-9]\d*$/)
      .max(32)
      .optional(),
    // Pictures the design keeps (POST .../pictures), for an AI that sees them.
    pictures: z.array(z.string().regex(ASSET_ID)).max(MAX_PICTURES).optional(),
  })
  .strict();

router.post(
  "/studio/designs/:id/assistant",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(promptSchema, req.body);
    const run = await startAssistantRun(req.userId!, req.params.id, {
      prompt: body.prompt,
      aiConnectionId: body.ai_connection_id ?? null,
      selected: body.selected,
      activePlate: body.active_plate,
      pictures: body.pictures,
    });
    res.status(202).json({ run });
  }),
);

router.post(
  "/studio/designs/:id/assistant/stop",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ run: await stopAssistantRun(req.userId!, req.params.id) });
  }),
);

router.delete(
  "/studio/designs/:id/assistant",
  requireAuth,
  asyncHandler(async (req, res) => {
    await clearAssistantThread(req.userId!, req.params.id);
    res.status(204).end();
  }),
);

export default router;
