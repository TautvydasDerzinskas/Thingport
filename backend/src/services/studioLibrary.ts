import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { notifyUpload } from "./modelNotifications";
import { printOutById } from "./printLoader";
import { inspectStudioDesign } from "./studioInspect";
import { exportStudioDesign } from "./studioExport";
import { getStudioDesign, studioAssetDir, studioPicturePath } from "./studioService";
import { addUploadedPreviewImages, createUploadedModel } from "./uploadService";

// A Studio design saved to the user's library as a model of its own: its visible bodies as one 3MF, a picture of it,
// and what the user asked Studio's assistant about it as its description. Each save is a new model, a copy as the
// design was then; changing the design later doesn't change it.

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

/**
 * Saves the design to the library. `pictureId` is one of the design's pictures to show it by (the page's view, as the
 * person saw it); without one the server pictures it. `name` defaults to the design's.
 */
export async function saveStudioDesignToLibrary(
  userId: string,
  designId: string,
  input: { name?: string; pictureId?: string | null },
) {
  const design = await getStudioDesign(userId, designId);
  const assetDir = studioAssetDir(userId, design.id);
  const made = await exportStudioDesign(userId, design, { format: "3mf" });

  let picture: Buffer | null = null;
  if (input.pictureId) {
    const file = await studioPicturePath(userId, design.id, input.pictureId);
    if (!file) throw new HttpError(400, "That picture isn't this design's", "studio_picture_not_found");
    picture = await fs.readFile(file);
  } else {
    const pictured = await inspectStudioDesign(`${design.id}:${design.version}`, design.document, assetDir, {
      views: ["iso"],
      size: PICTURE_PX,
      color: RENDER_COLOR,
    });
    // Without a picture the library draws its own render of the 3MF, so a failed one isn't the end of it.
    if (pictured.status === "ok" && pictured.images[0]) picture = Buffer.from(pictured.images[0].png, "base64");
  }

  const name = (input.name ?? design.name).trim() || design.name;
  const exportPath = path.join(os.tmpdir(), `thingport-studio-${crypto.randomBytes(8).toString("hex")}.${made.format}`);
  await fs.writeFile(exportPath, made.bytes);
  try {
    const meta = {
      title: name,
      notes: await promptsOf(design.id),
      tags: [],
      // What made it, for the model and for achievements: this design, which may change or go after.
      createdWith: { kind: "studio" as const, ref: design.id },
    };
    const print = await createUploadedModel(userId, meta, [
      { path: exportPath, originalname: `${name}.${made.format}`, mimetype: made.mime },
    ]);
    if (picture) await addUploadedPreviewImages(print.id, [picture]);
    await notifyUpload(userId, [{ id: print.id, name }], { names: [] }, "created").catch((error: unknown) =>
      console.error("[studio] the saved model's notification failed", error),
    );
    return printOutById(userId, print.id);
  } finally {
    await fs.rm(exportPath, { force: true });
  }
}
