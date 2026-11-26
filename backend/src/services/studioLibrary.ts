import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  exportableProfiles,
  picturablePlates,
  profileOfPlate,
  profileSettings,
  studioProfileName,
} from "../studio/document.generated";
import { printPreset, type StudioPrintProfile } from "../studio/printProfile.generated";
import { HttpError } from "../utils/fileUtils";
import { notifyUpload } from "./modelNotifications";
import { printOutById } from "./printLoader";
import { STUDIO_PROFILE_PREFIX, type StoredProfile } from "./printProfileService";
import { inspectStudioDesign } from "./studioInspect";
import { exportStudioDesign, studioExportFilename } from "./studioExport";
import { getStudioDesign, studioAssetDir, studioPicturePath, type StudioDesignOut } from "./studioService";
import { addUploadedFiles, addUploadedPreviewImages, createUploadedModel, type UploadedFile } from "./uploadService";

// Each included profile becomes a separate 3MF in the library. A save is a snapshot of the design.
// What a picture of the design is drawn in when the server makes one, as for studio_view_design.
const RENDER_COLOR = "#4f8fd8";
const PICTURE_PX = 1024;

/** The prompts the design was asked about, oldest first, in Markdown: one as it is, several as a list. */
async function promptsOf(designId: string): Promise<string | null> {
  const asked = await prisma.studioMessage.findMany({
    where: { designId, role: "user" },
    orderBy: { createdAt: "asc" },
    select: { text: true },
  });
  const prompts = asked.map((message) => message.text.trim()).filter(Boolean);
  if (!prompts.length) return null;
  if (prompts.length === 1) return prompts[0];
  return prompts.map((prompt) => `- ${prompt.replace(/\n+/g, " ")}`).join("\n");
}

/** The profile's name on the model's page: the one given, else the preset's with the material. */
function profileTitle(profile: StudioPrintProfile, given?: string | null): string {
  const name = given?.trim() || profile.name?.trim();
  if (name) return name;
  const preset = printPreset(profile.preset)?.title ?? "Studio profile";
  return profile.material ? `${preset} ${profile.material}` : preset;
}

async function creatorName(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return user?.displayName?.trim() || null;
}

export type StudioLibraryInput = {
  /** The new model's name; the design's when left out. */
  name?: string;
  /** One of the design's pictures to show a new model by. */
  pictureId?: string | null;
  /** A model of the user's to add the profiles to, instead of making a new model. */
  modelId?: string | null;
  /** The name on the model page when saving a single profile. */
  profileName?: string | null;
  /** The shown plate a new model is pictured by when there's no `pictureId`, and whose picture is the 3MF's
   *  thumbnail. The first shown plate with bodies when left out. */
  picturePlateId?: string | null;
};

/** A picture of one of the design's plates from the front right, above, as studio_view_design takes it; null when
 *  it has nothing to draw. */
export async function studioPlatePicture(
  userId: string,
  design: StudioDesignOut,
  plateId: string,
  size: number,
): Promise<Buffer | null> {
  const pictured = await inspectStudioDesign(
    `${design.id}:${design.version}`,
    design.document,
    studioAssetDir(userId, design.id),
    { views: ["iso"], size, color: RENDER_COLOR, plate: plateId },
  );
  if (pictured.status === "too-complex")
    throw new HttpError(422, "The plate is too heavy to picture here", "studio_too_complex");
  return pictured.status === "ok" && pictured.images[0] ? Buffer.from(pictured.images[0].png, "base64") : null;
}

export async function saveStudioDesignToLibrary(userId: string, designId: string, input: StudioLibraryInput) {
  const design = await getStudioDesign(userId, designId);
  const { document } = design;
  const profiles = exportableProfiles(document);
  const profile = document.print_profile;
  if (input.modelId && !document.profiles && !profile)
    throw new HttpError(
      400,
      "Set a print profile for the design before adding it to a model",
      "studio_profile_required",
    );
  if (input.modelId && !(await prisma.print.findFirst({ where: { id: input.modelId, userId }, select: { id: true } })))
    throw new HttpError(404, "That model isn't in your library", "studio_model_not_found");
  if (!profiles.length)
    throw new HttpError(400, "There's nothing to export: no visible printable body", "studio_save_empty");

  const pictures = picturablePlates(document);
  const picturePlate = input.picturePlateId ?? undefined;
  if (picturePlate && !pictures.includes(picturePlate))
    throw new HttpError(
      400,
      "Picture the design by a plate that's shown and has a visible body",
      "studio_picture_plate_invalid",
    );
  const resolvedPicturePlate = picturePlate ?? pictures[0];
  const pictureProfileId = resolvedPicturePlate && profileOfPlate(document, resolvedPicturePlate);
  const name = (input.name ?? design.name).trim() || design.name;
  const creator = document.profiles || profile ? await creatorName(userId) : null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-studio-"));
  try {
    const files: UploadedFile[] = [];
    for (const [index, group] of profiles.entries()) {
      const settings = profileSettings(document, group.id).print_profile;
      const given = profiles.length === 1 ? input.profileName?.trim() : undefined;
      const title = document.profiles
        ? given || studioProfileName(group)
        : settings
          ? profileTitle(settings, given)
          : null;
      const made = await exportStudioDesign(userId, design, {
        format: "3mf",
        profile: group.id,
        thumbnailPlate: pictureProfileId === group.id ? resolvedPicturePlate : undefined,
      });
      const exportPath = path.join(dir, `${index + 1}.3mf`);
      await fs.writeFile(exportPath, made.bytes);
      const stored: StoredProfile | null = title
        ? { studio: { title, description: settings?.reason ?? null, creator, designId: design.id } }
        : null;
      const base = (document.profiles || input.modelId) && title ? title : name;
      files.push({
        path: exportPath,
        originalname: studioExportFilename(base, "3mf"),
        mimetype: made.mime,
        ...(stored
          ? {
              profile: {
                id: `${STUDIO_PROFILE_PREFIX}${crypto.randomBytes(8).toString("hex")}`,
                stored: stored as unknown as Prisma.JsonObject,
              },
            }
          : {}),
      });
    }

    if (input.modelId) {
      await addUploadedFiles(
        userId,
        input.modelId,
        files.map((file) => ({ ...file, kind: "plate" })),
      );
      return printOutById(userId, input.modelId);
    }

    let picture: Buffer | null = null;
    if (input.pictureId) {
      const pictureFile = await studioPicturePath(userId, design.id, input.pictureId);
      if (!pictureFile) throw new HttpError(400, "That picture isn't this design's", "studio_picture_not_found");
      picture = await fs.readFile(pictureFile);
    } else {
      // Without a picture the library draws its own render of the 3MF, so a failed one isn't the end of it.
      if (resolvedPicturePlate)
        picture = await studioPlatePicture(userId, design, resolvedPicturePlate, PICTURE_PX).catch(() => null);
    }

    const meta = {
      title: name,
      notes: await promptsOf(design.id),
      tags: [],
      // What made it, for the model and for achievements: this design, which may change or go after.
      createdWith: { kind: "studio" as const, ref: design.id },
    };
    const print = await createUploadedModel(userId, meta, files);
    if (picture) await addUploadedPreviewImages(print.id, [picture]);
    await notifyUpload(userId, [{ id: print.id, name }], { names: [] }, "created").catch((error: unknown) =>
      console.error("[studio] the saved model's notification failed", error),
    );
    return printOutById(userId, print.id);
  } finally {
    await fs.rm(dir, { force: true, recursive: true });
  }
}
