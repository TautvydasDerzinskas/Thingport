// What Thingport Grab reads on a visit to Printables with the user's own login (push.ts). Mounted by providers/routes.ts.

import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../auth";
import { assertProviderEnabled } from "../../services/providerSettingsService";
import { asyncHandler } from "../../utils/asyncHandler";
import { parseBody } from "../../utils/validate";
import manifest from "../_generated/printables/manifest";
import { assertPrintablesPushOn, wantedPrintablesListings } from "./listings";
import { savePrintablesPush } from "./push";

const router = Router();
router.use(requireAuth);

// Thingport Grab, on a visit to Printables: which lists to read in full this time.
router.get(
  `/provider-collections/${manifest.id}/wanted`,
  asyncHandler(async (req, res) => {
    // Refused while turned off, so Grab doesn't read anything only to have it refused.
    await assertProviderEnabled(manifest.id);
    await assertPrintablesPushOn(req.userId!);
    res.json({ keys: await wantedPrintablesListings(req.userId!) });
  }),
);

const MAX_PUSHED_LISTINGS = 10;
const id = z.string().regex(/^\d+$/).max(20);
const thumbnails = z.array(z.string().url().max(1000)).max(12);
const ids = z.array(id).max(5000);
const pushSchema = z.object({
  user: z.object({ id, handle: z.string().min(1).max(100) }),
  collections: z
    .array(
      z.object({
        id,
        name: z.string().max(300),
        model_count: z.number().int().min(0),
        thumbnails,
        private: z.boolean(),
      }),
    )
    .max(1000)
    .optional(),
  likes: z.object({ model_count: z.number().int().min(0), thumbnails, ids: ids.optional() }).optional(),
  // Grab sends a few per push (the stalest wanted ones); more is a malformed request.
  listings: z
    .record(id, ids)
    .refine((listings) => Object.keys(listings).length <= MAX_PUSHED_LISTINGS, {
      message: `At most ${MAX_PUSHED_LISTINGS} collections per push`,
    })
    .optional(),
});

// Thingport Grab, on a visit to Printables: what it read there with the user's own login.
router.put(
  `/provider-collections/${manifest.id}/push`,
  asyncHandler(async (req, res) => {
    await assertProviderEnabled(manifest.id);
    await savePrintablesPush(req.userId!, parseBody(pushSchema, req.body));
    res.json({ ok: true });
  }),
);

export default router;
