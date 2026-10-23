import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseBody } from "../utils/validate";
import {
  addSampleWidgets,
  assertWidgetSourceEnabled,
  deleteCustomWidget,
  enabledWidgetSources,
  installCommunityWidget,
  listCommunityWidgets,
  listCustomWidgets,
  parseManifest,
  saveOwnWidget,
  widgetFetch,
  widgetFetchSchema,
} from "../services/customWidgetsService";
import { getWidgetSources } from "../services/settingsService";

// The user's custom dashboard widgets: their own, and the ones installed from the community repository.
const router = Router();
router.use(requireAuth);

// Which sources are on, so a dashboard can say so; a source turned off is left out of the list, and refused.
router.get(
  "/widgets",
  asyncHandler(async (req, res) => {
    const [sources, enabled] = await Promise.all([getWidgetSources(), enabledWidgetSources()]);
    if (sources.community) await addSampleWidgets(req.userId!);
    res.json({ sources, widgets: await listCustomWidgets(req.userId!, enabled) });
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
    await assertWidgetSourceEnabled("own");
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
    await assertWidgetSourceEnabled("community");
    res.json({ widgets: await listCommunityWidgets(req.userId!) });
  }),
);

// Installs a community widget, or takes its update: a copy of the repository's files as they are now.
router.post(
  "/widgets/community/:slug/install",
  asyncHandler(async (req, res) => {
    await assertWidgetSourceEnabled("community");
    res.json(await installCommunityWidget(req.userId!, String(req.params.slug)));
  }),
);

// A widget's request to one of the hosts its metadata declares, made by the server; refused if its source is off.
router.post(
  "/widgets/:id/fetch",
  asyncHandler(async (req, res) => {
    res.json(await widgetFetch(req.userId!, String(req.params.id), parseBody(widgetFetchSchema, req.body)));
  }),
);

export default router;
