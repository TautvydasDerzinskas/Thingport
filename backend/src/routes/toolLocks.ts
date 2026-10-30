import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { assertNotToolCollections, assertNotToolModels } from "../services/toolsService";

// The models and collection a tool brings (services/toolsService.ts) can be opened, searched, downloaded, printed and
// favourited, but not changed: the tool needs them as they are, and they go when it's uninstalled. Checked here, once,
// for every route that would change one, rather than in each; editing and deleting a model are also refused by
// printEditService, for the MCP tools.

// What may still be done to a tool's model: things about the user's use of it, not the model itself.
const PRINT_ALLOWED = [/^favorite$/, /^download$/, /^quality$/, /^plate\/[^/]+\/normalize$/];

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

export const toolLocks = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const body = (req.body ?? {}) as Record<string, unknown>;

  const print = /^\/print\/([^/]+)(?:\/(.+))?$/.exec(req.path);
  if (print && !PRINT_ALLOWED.some((allowed) => allowed.test(print[2] ?? ""))) await assertNotToolModels([print[1]]);
  if (req.path === "/prints/tags") await assertNotToolModels(ids(body.print_ids));

  // The collection itself and what's in it; a bookmark of it is the user's own.
  const collection = /^\/collection\/([^/]+)(?:\/(items(?:\/.*)?))?$/.exec(req.path);
  if (collection && (collection[2] || req.method === "PATCH" || req.method === "DELETE"))
    await assertNotToolCollections([collection[1]]);
  if (req.path === "/collections/delete") await assertNotToolCollections(ids(body.ids));
  if (req.path === "/collections/merge")
    await assertNotToolCollections([
      ...ids(body.ids),
      ...(typeof body.primary_id === "string" ? [body.primary_id] : []),
    ]);
  next();
});
