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
  setProviderAccount,
  type BrowsableProvider,
} from "../services/providerCollectionsService";
import { isProviderId } from "../providers/index.generated";

const router = Router();
router.use(requireAuth);

function parseProvider(raw: unknown): BrowsableProvider {
  if (isProviderId(raw)) return raw;
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

export default router;
