import { Router, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../auth";
import { prisma } from "../db";
import { toUserOut } from "../dto";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import {
  BIO_MAX_LENGTH,
  COVER_MAX_BYTES,
  COVER_PRESETS,
  PROFILE_LINK_MAX_LENGTH,
  PROFILE_LINKS_MAX,
  coverPath,
  saveCoverUpload,
  updatePublicProfile,
} from "../services/publicProfileService";
import { AVATAR_MAX_BYTES, avatarPath, resolveAvatar, saveAvatarUpload } from "../services/avatarService";
import { avatarSvg, isAvatarStyle, type AvatarStyle } from "../services/avatarArt";

// The user's profile as the other users see it: avatar, bio, cover, links, and whether their models are on Explore.
// Avatars and uploaded covers are public, by an id no one can guess, like icons: an <img> or a CSS background shows
// them without a token, on another user's Explore page too.
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: COVER_MAX_BYTES + 1 } });
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: AVATAR_MAX_BYTES + 1 } });

/** One picture, as `file`, or a 413 or 400 that says what went wrong. */
const onePicture =
  (parser: multer.Multer): RequestHandler =>
  (req, res, next) =>
    parser.single("file")(req, res, (err: unknown) => {
      if (!(err instanceof multer.MulterError)) return next(err);
      next(
        err.code === "LIMIT_FILE_SIZE"
          ? new HttpError(413, "The picture is larger than 10 MB")
          : new HttpError(400, "Send one picture, as `file`"),
      );
    });

// An SVG opened on its own stays a picture: no scripts, nothing loaded from elsewhere.
const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const sendSvg = (res: Response, svg: string, maxAge: number) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", `public, max-age=${maxAge}`);
  res.setHeader("Content-Security-Policy", SVG_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(svg);
};
const DAY_SECONDS = 24 * 60 * 60;

// A Thingport avatar of any design, as the avatar designer previews each choice: ?hair=&hair_color=&glasses=&mouth=
// &background=.
router.get("/avatars/thingport.svg", (req, res) => {
  const style: Partial<Record<keyof AvatarStyle, number>> = {};
  for (const key of ["hair", "hair_color", "glasses", "mouth", "background"] as const)
    style[key] = Number(req.query[key]);
  if (!isAvatarStyle(style)) {
    res.status(400).json({ detail: "No such avatar" });
    return;
  }
  sendSvg(res, avatarSvg(style), DAY_SECONDS);
});

// A user's avatar, whichever they have. Its address changes with it (?v=), so a day's keeping is safe; a Gravatar
// changed on Gravatar's side shows within that day.
router.get(
  "/avatars/user/:id",
  asyncHandler(async (req, res) => {
    const avatar = await resolveAvatar(String(req.params.id));
    if (!avatar) throw new HttpError(404, "Not found");
    if (avatar.kind === "svg") return sendSvg(res, avatar.svg, DAY_SECONDS);
    res.setHeader("Cache-Control", `public, max-age=${DAY_SECONDS}`);
    if (avatar.kind === "redirect") return res.redirect(302, avatar.url);
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(avatar.path, (err) => {
      if (err && !res.headersSent) res.status(404).json({ detail: "Not found" });
    });
  }),
);

router.get("/avatars/:file", (req, res, next) => {
  const file = avatarPath(String(req.params.file));
  if (!file) return next();
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ detail: "Not found" });
  });
});

router.get("/covers/:file", (req, res, next) => {
  const file = coverPath(String(req.params.file));
  if (!file) return next();
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ detail: "Not found" });
  });
});

// The signed-in user as it is now: the copy the web app keeps from signing in can be older than a change made elsewhere.
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) throw new HttpError(401, "Invalid or expired token");
    res.json({ user: toUserOut(user) });
  }),
);

const positionY = z.number().int().min(0).max(100);

// Only web addresses: a profile's links are opened by the other users, and a javascript: one would run in their browser.
const webAddress = z
  .string()
  .trim()
  .max(PROFILE_LINK_MAX_LENGTH, `Keep each link to ${PROFILE_LINK_MAX_LENGTH} characters`)
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Each link must be a web address starting with http:// or https://");

const publicProfileSchema = z
  .object({
    bio: z.string().trim().max(BIO_MAX_LENGTH, `Keep the bio to ${BIO_MAX_LENGTH} characters`).nullable(),
    cover_preset: z.enum(COVER_PRESETS),
    cover_author_id: z.string().min(1),
    cover_position_y: positionY,
    links: z.array(webAddress).max(PROFILE_LINKS_MAX, `Up to ${PROFILE_LINKS_MAX} links`),
    models_public: z.boolean(),
    avatar_style: z
      .object({
        hair: z.number(),
        hair_color: z.number(),
        glasses: z.number(),
        mouth: z.number(),
        background: z.number(),
      })
      .refine(isAvatarStyle, "No such avatar"),
    avatar_author_id: z.string().min(1),
    avatar_auto: z.literal(true),
  })
  .partial()
  .refine((body) => !(body.cover_preset && body.cover_author_id), { message: "Choose one cover" })
  .refine((body) => [body.avatar_style, body.avatar_author_id, body.avatar_auto].filter(Boolean).length <= 1, {
    message: "Choose one avatar",
  });

router.patch(
  "/me/public-profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const patch = parseBody(publicProfileSchema, req.body);
    res.json({ user: toUserOut(await updatePublicProfile(req.userId!, patch)) });
  }),
);

router.post(
  "/me/cover",
  requireAuth,
  onePicture(upload),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    const position = positionY.safeParse(req.body?.position_y === undefined ? 50 : Number(req.body.position_y));
    if (!position.success) throw new HttpError(400, "position_y is a whole number from 0 to 100");
    res.json({ user: toUserOut(await saveCoverUpload(req.userId!, req.file.buffer, position.data)) });
  }),
);

router.post(
  "/me/avatar",
  requireAuth,
  onePicture(avatarUpload),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "No file uploaded");
    res.json({ user: toUserOut(await saveAvatarUpload(req.userId!, req.file.buffer)) });
  }),
);

export default router;
