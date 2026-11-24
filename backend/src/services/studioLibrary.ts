import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { slicerProfile } from "../adapter";
import { printerTarget } from "../printers/targets";
import { picturablePlates } from "../studio/document.generated";
import { printPreset, type StudioPrintProfile } from "../studio/printProfile.generated";
import { HttpError } from "../utils/fileUtils";
import { notifyUpload } from "./modelNotifications";
import { printOutById } from "./printLoader";
import { STUDIO_PROFILE_PREFIX, type StoredProfile } from "./printProfileService";
import { inspectStudioDesign } from "./studioInspect";
import { exportStudioDesign, type StudioExportOptions } from "./studioExport";
import { getStudioDesign, studioAssetDir, studioPicturePath, type StudioDesignOut } from "./studioService";
import { addUploadedFiles, addUploadedPreviewImages, createUploadedModel, type UploadedFile } from "./uploadService";

// A Studio design saved to the user's library: its visible bodies as one 3MF, as a model of its own (with a picture of
// it, and what the user asked Studio's assistant about it as its description) or as one more print profile of a model
// the user already has. The design's print profile goes into the 3MF, made for its slicer and printer where the slicer
// is one of Bambu Studio's family, and the 3MF's plate is a print profile on the model's page, as an imported one is.
// Each save is a copy as the design was then; changing the design later doesn't change it.

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

/** Exported for the profile's slicer and printer when the slicer reads Bambu Studio's projects; any other slicer gets
 *  the plain 3MF, which Open adapted turns into its own when it's opened. A printer the slicer has no preset for is
 *  left out rather than refused. */
function exportOptionsFor(profile: StudioPrintProfile | undefined): StudioExportOptions {
  const slicer = profile?.slicer ? slicerProfile(profile.slicer) : null;
  if (!slicer || slicer.reads !== "bambu") return { format: "3mf" };
  const printer =
    profile?.printer && slicer.targetsPrinter && printerTarget(slicer.id, profile.printer.id, profile.printer.nozzle);
  return {
    format: "3mf",
    slicer: slicer.id,
    ...(printer && printer.choice.nozzle === profile!.printer!.nozzle ? { printer: profile!.printer! } : {}),
  };
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
  /** A model of the user's to add the design to as one more print profile, instead of making a new model. */
  modelId?: string | null;
  /** The profile's name on the model's page. */
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

/**
 * Saves the design to the library: as a new model, or with `modelId` as a print profile added to that model, which
 * needs the design to have a print profile. `pictureId` is one of the design's pictures to show a new model by (the
 * page's view, as the person saw it); without one the server pictures it. `name` defaults to the design's.
 */
export async function saveStudioDesignToLibrary(userId: string, designId: string, input: StudioLibraryInput) {
  const design = await getStudioDesign(userId, designId);
  const profile = design.document.print_profile;
  if (input.modelId && !profile)
    throw new HttpError(
      400,
      "Set a print profile for the design before adding it to a model",
      "studio_profile_required",
    );
  if (input.modelId && !(await prisma.print.findFirst({ where: { id: input.modelId, userId }, select: { id: true } })))
    throw new HttpError(404, "That model isn't in your library", "studio_model_not_found");

  const picturePlate = input.picturePlateId ?? undefined;
  if (picturePlate && !picturablePlates(design.document).includes(picturePlate))
    throw new HttpError(
      400,
      "Picture the design by a plate that's shown and has a visible body",
      "studio_picture_plate_invalid",
    );
  // One default plate for both the package thumbnail and the model picture.
  const resolvedPicturePlate = picturePlate ?? picturablePlates(design.document)[0];
  const made = await exportStudioDesign(userId, design, {
    ...exportOptionsFor(profile),
    thumbnailPlate: resolvedPicturePlate,
  });
  const title = profile ? profileTitle(profile, input.profileName) : null;
  const stored: StoredProfile | null =
    profile && title
      ? {
          studio: {
            title,
            description: profile.reason ?? null,
            creator: await creatorName(userId),
            designId: design.id,
          },
        }
      : null;
  const file = (base: string, exportPath: string): UploadedFile => ({
    path: exportPath,
    originalname: `${base}.${made.format}`,
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

  const exportPath = path.join(os.tmpdir(), `thingport-studio-${crypto.randomBytes(8).toString("hex")}.${made.format}`);
  await fs.writeFile(exportPath, made.bytes);
  try {
    if (input.modelId) {
      await addUploadedFiles(userId, input.modelId, [{ ...file(title!, exportPath), kind: "plate" }]);
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

    const name = (input.name ?? design.name).trim() || design.name;
    const meta = {
      title: name,
      notes: await promptsOf(design.id),
      tags: [],
      // What made it, for the model and for achievements: this design, which may change or go after.
      createdWith: { kind: "studio" as const, ref: design.id },
    };
    const print = await createUploadedModel(userId, meta, [file(name, exportPath)]);
    if (picture) await addUploadedPreviewImages(print.id, [picture]);
    await notifyUpload(userId, [{ id: print.id, name }], { names: [] }, "created").catch((error: unknown) =>
      console.error("[studio] the saved model's notification failed", error),
    );
    return printOutById(userId, print.id);
  } finally {
    await fs.rm(exportPath, { force: true });
  }
}
