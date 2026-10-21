import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { getReleaseNotes } from "../services/releaseNotesService";

const router = Router();

const semver = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+$/);
const querySchema = z.object({
  // This backend's version when omitted.
  version: semver.optional(),
  // The version updated from: the notes then cover every release since.
  since: semver.optional(),
  // The frontend is versioned apart from the backend, and only it knows its own.
  frontend: semver.optional(),
});

router.get(
  "/release-notes",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { version, since, frontend } = parseBody(querySchema, req.query);
    const notes = await getReleaseNotes({ version, since, frontendVersion: frontend });
    if (!notes) throw new HttpError(404, "This instance's version is unknown");
    res.json(notes);
  }),
);

export default router;
