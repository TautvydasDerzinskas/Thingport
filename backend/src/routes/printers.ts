import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { printerBrands, printerCoverFile, printerSummaries } from "../printers/catalogue";
import {
  addAccountPrinters,
  listUserPrinters,
  printerAccounts,
  printerSuggestions,
  putUserPrinter,
  removeUserPrinter,
  setPrinterDeclined,
  UnknownPrinterError,
} from "../services/userPrinters";

// The printer catalogue (assets/printers) and the printers a user prints on, for Configuration > Printers and the
// adapted copies made for them.
const router = Router();

const PRINTER_ID = /^[a-z0-9-]{1,120}$/;

function printerIdOf(value: unknown): string {
  const id = String(value ?? "");
  if (!PRINTER_ID.test(id)) throw new HttpError(404, "No such printer");
  return id;
}

// A catalogue printer's picture: the slicers' own, public like the catalogue it comes from, so an <img> needs no token.
router.get("/printers/:id/cover.webp", (req, res, next) => {
  const id = String(req.params.id);
  const file = PRINTER_ID.test(id) ? printerCoverFile(id) : null;
  if (!file) return next();
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "public, max-age=604800");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ detail: "Not found" });
  });
});

// Every printer the catalogue has, with its bed, height and nozzles: what Add printer lists. It changes only with
// Thingport's own updates.
router.get("/printers/catalogue", requireAuth, (_req, res) => {
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.json({ brands: printerBrands(), printers: printerSummaries() });
});

router.get(
  "/me/printers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [printers, suggestions] = await Promise.all([listUserPrinters(req.userId!), printerSuggestions(req.userId!)]);
    res.json({ printers, suggestions, accounts: await printerAccounts(req.userId!, printers.length) });
  }),
);

const putSchema = z.object({ nozzle: z.string().trim().max(10).nullable().optional() }).strict();
router.put(
  "/me/printers/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = printerIdOf(req.params.id);
    const body = parseBody(putSchema, req.body ?? {});
    try {
      res.json(await putUserPrinter(req.userId!, id, body.nozzle));
    } catch (err) {
      if (err instanceof UnknownPrinterError) throw new HttpError(404, "No such printer");
      throw err;
    }
  }),
);

router.delete(
  "/me/printers/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    await removeUserPrinter(req.userId!, printerIdOf(req.params.id));
    res.status(204).end();
  }),
);

// A suggestion turned down stays listed, as declined; DELETE takes that back.
router.put(
  "/me/printers/:id/declined",
  requireAuth,
  asyncHandler(async (req, res) => {
    await setPrinterDeclined(req.userId!, printerIdOf(req.params.id), true);
    res.status(204).end();
  }),
);
router.delete(
  "/me/printers/:id/declined",
  requireAuth,
  asyncHandler(async (req, res) => {
    await setPrinterDeclined(req.userId!, printerIdOf(req.params.id), false);
    res.status(204).end();
  }),
);

// Asked for by the user: reads the printers their accounts on printer makers' sites have, and adds them. Each
// account's answer is in `accounts`, one that turned the sign-in down or couldn't say among them, so the answer is a
// 200 whichever answered.
router.post(
  "/me/printers/accounts",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await addAccountPrinters(req.userId!));
  }),
);

export default router;
