// Each provider's own API routes, mounted under /api by app.ts. Not in the registry: routes reach the services that
// read it.

import { Router } from "express";
import makeronlineRoutes from "./makeronline/routes";
import printablesRoutes from "./printables/routes";

const router = Router();
router.use(makeronlineRoutes);
router.use(printablesRoutes);

export default router;
