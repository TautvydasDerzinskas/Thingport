import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "../db";
import { ICONS } from "../config";
import { HttpError } from "../utils/fileUtils";
import { rasterIconPng } from "./imageProcessing";

export const ICON_MAX_BYTES = 1024 * 1024;
const MAX_ICONS = 200;
// Pictures are scaled down to this, which stays sharp on a high-density screen at the largest size icons show.
const RASTER_SIZE = 256;
// The public file name: the random id and its extension.
export const ICON_FILE = /^([a-f0-9]{32})\.(png|svg)$/;

export type IconOut = { id: string; name: string; url: string; created_at: string };

const urlOf = (icon: { id: string; ext: string }) => `/api/icons/${icon.id}.${icon.ext}`;
const out = (icon: { id: string; name: string; ext: string; createdAt: Date }): IconOut => ({
  id: icon.id,
  name: icon.name,
  url: urlOf(icon),
  created_at: icon.createdAt.toISOString(),
});

export async function listIcons(userId: string): Promise<IconOut[]> {
  const icons = await prisma.userIcon.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return icons.map(out);
}

function isSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 1024).toString("utf8").trimStart().toLowerCase();
  return (head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--")) && head.includes("<svg");
}

/**
 * Keeps an uploaded image as an icon. An SVG is stored as it came, since it's only ever served as an image under a
 * policy that stops its scripts; anything else is decoded and saved as a PNG no bigger than it needs to be.
 */
export async function saveIcon(userId: string, file: { buffer: Buffer; originalname: string }): Promise<IconOut> {
  if (file.buffer.length > ICON_MAX_BYTES) throw new HttpError(413, "The icon is larger than 1 MB");
  if ((await prisma.userIcon.count({ where: { userId } })) >= MAX_ICONS)
    throw new HttpError(400, `You can keep up to ${MAX_ICONS} icons`);
  let ext: "png" | "svg";
  let data: Buffer;
  if (isSvg(file.buffer)) {
    ext = "svg";
    data = file.buffer;
  } else {
    try {
      data = await rasterIconPng(file.buffer, RASTER_SIZE);
    } catch {
      throw new HttpError(400, "Not an image");
    }
    ext = "png";
  }
  const id = crypto.randomBytes(16).toString("hex");
  const name = path.parse(file.originalname || "").name.slice(0, 80) || "icon";
  await fs.writeFile(path.join(ICONS, `${id}.${ext}`), data);
  return out(await prisma.userIcon.create({ data: { id, userId, name, ext } }));
}

export async function deleteIcon(userId: string, id: string): Promise<void> {
  const icon = await prisma.userIcon.findFirst({ where: { id, userId } });
  if (!icon) throw new HttpError(404, "Icon not found");
  await prisma.userIcon.delete({ where: { id } });
  await fs.rm(path.join(ICONS, `${icon.id}.${icon.ext}`), { force: true });
}

/** The files of a user who's being deleted; their rows go with the account. */
export async function removeUserIcons(userId: string): Promise<void> {
  const icons = await prisma.userIcon.findMany({ where: { userId } });
  await Promise.all(icons.map((icon) => fs.rm(path.join(ICONS, `${icon.id}.${icon.ext}`), { force: true })));
}

/** Where an icon's file is, for a valid public name; whether it exists is for the caller to find out. */
export function iconPath(file: string): string | null {
  return ICON_FILE.test(file) ? path.join(ICONS, file) : null;
}
