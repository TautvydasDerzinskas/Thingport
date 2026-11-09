import type { NextFunction, Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { assertNotToolCollections, assertNotToolModels } from "../services/toolsService";

// The models and collection a tool brings (services/toolsService.ts) can be opened, searched, downloaded, printed and
// favourited, but not changed: the tool needs them as they are, and they go when it's uninstalled. Checked here, once,
// for every route that would change one, rather than in each; editing and deleting a model are also refused by
// printEditService, for the MCP tools.

// What may still be done to a tool's model: things about the user's use of it, not the model itself. A copy is the
// copier's own model, which leaves this one as it was.
const PRINT_ALLOWED = [/^favorite$/i, /^download$/i, /^quality$/i, /^plate\/[^/]+\/normalize$/i, /^copy$/i];

/** A path's id as the route's parameter gets it: decoded, as Express decodes parameters, so `%61` can't stand for
 *  `a` past the lock. Null for an encoding Express refuses, which never reaches a route. */
function param(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

export const toolLocks = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const body = (req.body ?? {}) as Record<string, unknown>;
  // As the routes match it: Express takes `/collection/x/` for `/collection/x`, so a trailing slash mustn't get past,
  // and `/Collection/x` too, so neither may another letter case (the ids keep theirs).
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, "") : req.path;
  const route = path.toLowerCase();

  const print = /^\/print\/([^/]+)(?:\/(.+))?$/i.exec(path);
  const printId = print ? param(print[1]) : null;
  if (print && printId && !PRINT_ALLOWED.some((allowed) => allowed.test(print[2] ?? ""))) {
    await assertNotToolModels([printId]);
  }
  if (route === "/prints/tags") await assertNotToolModels(ids(body.print_ids));

  // The collection itself and what's in it; a bookmark of it is the user's own.
  const collection = /^\/collection\/([^/]+)(?:\/(items(?:\/.*)?))?$/i.exec(path);
  const collectionId = collection ? param(collection[1]) : null;
  if (collection && collectionId && (collection[2] || req.method === "PATCH" || req.method === "DELETE"))
    await assertNotToolCollections([collectionId]);
  if (route === "/collections/delete") await assertNotToolCollections(ids(body.ids));
  if (route === "/collections/merge")
    await assertNotToolCollections([
      ...ids(body.ids),
      ...(typeof body.primary_id === "string" ? [body.primary_id] : []),
    ]);
  next();
});
