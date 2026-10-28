// Each provider's own API routes, mounted under /api by app.ts. Not in the registry: routes reach the services that
// read it.

import { Router } from "express";
import makeronlineRoutes from "./makeronline/routes";
import owlcadRoutes, { bodyLimit as owlcadBodyLimit } from "./owlcad/routes";
import printablesRoutes from "./printables/routes";

const router = Router();
router.use(makeronlineRoutes);
router.use(owlcadRoutes);
router.use(printablesRoutes);

/** Paths of a provider's own whose bodies outgrow the global JSON parser's 100 kB. app.ts mounts these before it,
 *  since the first parser to see a request is the one that decides whether it is too large. */
export const providerBodyLimits = [owlcadBodyLimit];

export default router;
