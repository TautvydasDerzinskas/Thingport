import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseBody } from "../utils/validate";
import {
  assertCustomWidgetsEnabled,
  deleteCustomWidget,
  installCommunityWidget,
  listCommunityWidgets,
  listCustomWidgets,
  parseManifest,
  saveOwnWidget,
  widgetFetch,
  widgetFetchSchema,
} from "../services/customWidgetsService";
import { getCustomWidgetsEnabled } from "../services/settingsService";

// The user's custom dashboard widgets: their own, and the ones installed from the community repository.
const router = Router();
router.use(requireAuth);

// Whether they're on, so a dashboard can say so; with them off, the list is empty and everything else refuses.
router.get(
  "/widgets",
  asyncHandler(async (req, res) => {
    const enabled = await getCustomWidgetsEnabled();
    res.json({ enabled, widgets: enabled ? await listCustomWidgets(req.userId!) : [] });
  }),
);

// The metadata comes as JSON or YAML text, as a widget's file holds it.
const saveSchema = z.object({
  slug: z.string(),
  metadata: z.string().max(200_000),
  script: z.string(),
  html: z.string().nullable().optional(),
});
router.put(
  "/widgets",
  asyncHandler(async (req, res) => {
    await assertCustomWidgetsEnabled();
    const body = parseBody(saveSchema, req.body);
    res.json(
      await saveOwnWidget(req.userId!, {
        slug: body.slug,
        manifest: parseManifest(body.metadata),
        script: body.script,
        html: body.html,
      }),
    );
  }),
);

router.delete(
  "/widgets/:id",
  asyncHandler(async (req, res) => {
    await deleteCustomWidget(req.userId!, String(req.params.id));
    res.status(204).end();
  }),
);

router.get(
  "/widgets/community",
  asyncHandler(async (req, res) => {
    await assertCustomWidgetsEnabled();
    res.json({ widgets: await listCommunityWidgets(req.userId!) });
  }),
);

// Installs a community widget, or takes its update: a copy of the repository's files as they are now.
router.post(
  "/widgets/community/:slug/install",
  asyncHandler(async (req, res) => {
    await assertCustomWidgetsEnabled();
    res.json(await installCommunityWidget(req.userId!, String(req.params.slug)));
  }),
);

// A widget's request to one of the hosts its metadata declares, made by the server.
router.post(
  "/widgets/:id/fetch",
  asyncHandler(async (req, res) => {
    await assertCustomWidgetsEnabled();
    res.json(await widgetFetch(req.userId!, String(req.params.id), parseBody(widgetFetchSchema, req.body)));
  }),
);

export default router;
