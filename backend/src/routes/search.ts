import { Router } from "express";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { search } from "../services/searchService";

const router = Router();
router.use(requireAuth);

// ---- GET /search?q=... -----------------------------------------------------------------------
// Backs the global search box in the top bar (models primary, collections + tags secondary --
// see searchService.ts). A blank/whitespace-only `q` just returns empty results rather than
// erroring -- the frontend already debounces and gates on a minimum length before calling this,
// but there's no reason to make that a hard requirement here too.
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json(await search(req.userId!, q));
  }),
);

export default router;
