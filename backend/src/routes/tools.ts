import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { parseBody } from "../utils/validate";
import {
  deleteOwnTool,
  deleteToolData,
  getToolData,
  listToolData,
  listTools,
  parseToolManifest,
  saveOwnTool,
  setToolData,
  syncToolModelsSoon,
  toolFetch,
  toolFetchSchema,
  toolModelsOf,
  type ToolUser,
} from "../services/toolsService";

// The tools a user may open, their own, and what a tool's script calls back for: the data it keeps, its models and
// the hosts it declares. Its other calls (collections, models, search) go to the API's own routes, as the user.
const router = Router();
router.use(requireAuth);

const userOf = (req: Request): ToolUser => ({ id: req.userId!, role: req.userRole! });

// Who may use tools comes along, so the sidebar knows whether to show them and the page whether to offer "New tool".
router.get(
  "/tools",
  asyncHandler(async (req, res) => {
    const user = userOf(req);
    res.json(await listTools(user));
    syncToolModelsSoon(user);
  }),
);

// The metadata comes as JSON or YAML text, as a tool's file holds it.
const saveSchema = z.object({
  slug: z.string(),
  metadata: z.string().max(200_000),
  script: z.string(),
  html: z.string().nullable().optional(),
  /** Its labels by language, as the editor's Labels panel keeps them; checked in the service. */
  locales: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});
router.put(
  "/tools",
  asyncHandler(async (req, res) => {
    const body = parseBody(saveSchema, req.body);
    res.json(
      await saveOwnTool(userOf(req), {
        slug: body.slug,
        manifest: parseToolManifest(body.metadata),
        script: body.script,
        html: body.html,
        locales: body.locales,
      }),
    );
  }),
);

router.delete(
  "/tools/:id",
  asyncHandler(async (req, res) => {
    await deleteOwnTool(req.userId!, String(req.params.id));
    res.status(204).end();
  }),
);

// The user's copies of the models the tool brings, by the keys its metadata gives them.
router.get(
  "/tools/:id/models",
  asyncHandler(async (req, res) => {
    res.json({ models: await toolModelsOf(userOf(req), String(req.params.id)) });
  }),
);

router.get(
  "/tools/:id/storage",
  asyncHandler(async (req, res) => {
    res.json({ keys: await listToolData(userOf(req), String(req.params.id)) });
  }),
);

router.get(
  "/tools/:id/storage/:key",
  asyncHandler(async (req, res) => {
    res.json(await getToolData(userOf(req), String(req.params.id), String(req.params.key)));
  }),
);

router.put(
  "/tools/:id/storage/:key",
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ value: z.unknown() }), req.body);
    await setToolData(userOf(req), String(req.params.id), String(req.params.key), body.value);
    res.status(204).end();
  }),
);

router.delete(
  "/tools/:id/storage/:key",
  asyncHandler(async (req, res) => {
    await deleteToolData(userOf(req), String(req.params.id), String(req.params.key));
    res.status(204).end();
  }),
);

// A tool's request to one of the hosts its metadata declares, made by the server.
router.post(
  "/tools/:id/fetch",
  asyncHandler(async (req, res) => {
    res.json(await toolFetch(userOf(req), String(req.params.id), parseBody(toolFetchSchema, req.body)));
  }),
);

export default router;
