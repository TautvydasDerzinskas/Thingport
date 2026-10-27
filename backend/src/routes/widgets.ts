import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { asyncHandler } from "../utils/asyncHandler";
import { parseBody } from "../utils/validate";
import {
  assertWidgetSourceEnabled,
  communityWidgetScreenshot,
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
    res.json({ sources, widgets: await listCustomWidgets(req.userId!, enabled) });
  }),
);

// The metadata comes as JSON or YAML text, as a widget's file holds it; the labels as a map per language, as the
// widget's locales folder holds them.
const saveSchema = z.object({
  slug: z.string(),
  metadata: z.string().max(200_000),
  script: z.string(),
  html: z.string().nullable().optional(),
  locales: z.record(z.string(), z.record(z.string(), z.string())).optional(),
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
        locales: body.locales,
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

// A community widget's screenshot, by its place in its metadata: for an <img>, so the token may come as ?token=.
router.get(
  "/widgets/community/:slug/screenshots/:index",
  asyncHandler(async (req, res) => {
    await assertWidgetSourceEnabled("community");
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) throw new HttpError(400, "Not a screenshot");
    const image = await communityWidgetScreenshot(String(req.params.slug), index);
    res.set("Content-Type", image.type);
    res.set("Cache-Control", "private, max-age=3600");
    res.set("X-Content-Type-Options", "nosniff");
    res.send(image.body);
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
