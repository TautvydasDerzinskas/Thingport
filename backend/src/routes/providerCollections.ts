import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import {
  BROWSABLE_PROVIDERS,
  getProviderAccounts,
  listProviderCollections,
  lookupProviderCollection,
  savePrintablesPush,
  setProviderAccount,
  type BrowsableProvider,
} from "../services/providerCollectionsService";
import { assertPrintablesPushOn, wantedPrintablesListings } from "../services/providerListingsService";
import { assertProviderEnabled } from "../services/providerSettingsService";

const router = Router();
router.use(requireAuth);

function parseProvider(raw: unknown): BrowsableProvider {
  if (typeof raw === "string" && (BROWSABLE_PROVIDERS as readonly string[]).includes(raw)) {
    return raw as BrowsableProvider;
  }
  throw new HttpError(400, `Pick one of ${BROWSABLE_PROVIDERS.join(", ")}`);
}

router.get(
  "/provider-collections/accounts",
  asyncHandler(async (req, res) => {
    res.json(await getProviderAccounts(req.userId!));
  }),
);

const accountSchema = z.object({ value: z.string().max(300).nullable() });

router.put(
  "/provider-collections/accounts/:provider",
  asyncHandler(async (req, res) => {
    const body = parseBody(accountSchema, req.body);
    res.json(await setProviderAccount(req.userId!, parseProvider(req.params.provider), body.value));
  }),
);

router.get(
  "/provider-collections",
  asyncHandler(async (req, res) => {
    res.json(await listProviderCollections(req.userId!, parseProvider(req.query.provider)));
  }),
);

router.get(
  "/provider-collections/lookup",
  asyncHandler(async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!url) throw new HttpError(400, "url is required");
    res.json(await lookupProviderCollection(req.userId!, url));
  }),
);

// Thingport Grab, on a visit to Printables: which lists to read in full this time.
router.get(
  "/provider-collections/printables/wanted",
  asyncHandler(async (req, res) => {
    // Refused while turned off, so Grab doesn't read anything only to have it refused.
    await assertProviderEnabled("printables");
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
  "/provider-collections/printables/push",
  asyncHandler(async (req, res) => {
    await assertProviderEnabled("printables");
    await savePrintablesPush(req.userId!, parseBody(pushSchema, req.body));
    res.json({ ok: true });
  }),
);

export default router;
