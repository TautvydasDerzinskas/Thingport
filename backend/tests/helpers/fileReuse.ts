import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Express } from "express";
import request from "supertest";
import sharp from "sharp";
import { createPrint } from "../../src/services/printCreation";
import { saveFileFromTemp } from "../../src/services/printFileService";
import { MIN_SHARE_BYTES } from "../../src/services/fileReuse";
import { prisma } from "../../src/db";
import { STORAGE } from "../../src/config";

// The helpers the file reuse suites share. Each suite keeps its own temp folder and passes it in.

export const nonce = () => crypto.randomBytes(12).toString("hex");
export const sha = (bytes: Buffer | string) => crypto.createHash("sha256").update(bytes).digest("hex");

/** The file a clone or copy from an open handle (handlePath) reads, by its name now: the /proc link on Linux; macOS
 *  has no such link, so lsof tells. macOS reports the real path, under /private, so it's named as the suites name it. */
export function openedPath(src: unknown): string {
  const fdPath = String(src);
  if (process.platform === "linux") return fs.readlinkSync(fdPath);
  const fd = fdPath.match(/^\/dev\/fd\/(\d+)$/)?.[1];
  if (!fd) throw new Error(`Not an open file's path: ${fdPath}`);
  const listing = execFileSync("lsof", ["-a", "-p", String(process.pid), "-d", fd, "-Fn"], { encoding: "utf8" });
  const real = listing
    .split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
  if (!real) throw new Error(`lsof doesn't know ${fdPath}`);
  for (const root of [STORAGE, os.tmpdir()]) {
    const realRoot = fs.realpathSync(root);
    if (real.startsWith(realRoot + path.sep)) return root + real.slice(realRoot.length);
  }
  return real;
}

/** Bytes no other test has stored, past the sharing minimum, so only the copies made here can match them. */
export function uniqueBytes(): Buffer {
  return Buffer.from(`${nonce()}\n${"padding ".repeat(MIN_SHARE_BYTES / 8)}\n`);
}

/** A noisy picture, so its PNG or JPEG is past the sharing minimum and no other test's matches it. */
export async function uniqueImage(format: "png" | "jpeg" = "png"): Promise<Buffer> {
  const raw = crypto.randomBytes(96 * 96 * 3);
  const image = sharp(raw, { raw: { width: 96, height: 96, channels: 3 } });
  return format === "png" ? image.png().toBuffer() : image.jpeg().toBuffer();
}

export function tempFile(dir: string, contents: Buffer | string): string {
  const abs = path.join(dir, `temp-${nonce()}`);
  fs.writeFileSync(abs, contents);
  return abs;
}

export async function register(app: Express, prefix: string, name: string) {
  const email = `${prefix}-${name}-${Date.now()}@example.com`;
  const res = await request(app).post("/api/register").send({ displayName: name, email, password: "password123" });
  return { id: res.body.user.id as string, token: res.body.token as string, email };
}

/** A model of the user's, with a plate of its own so it has a folder. */
export async function makePrint(dir: string, userId: string, label: string) {
  const source = tempFile(dir, `solid ${nonce()}\nendsolid\n`);
  const { print, plates } = await createPrint(userId, { title: `${label} ${nonce()}` }, label, [
    { filename: "own.stl", tempFilePath: source },
  ]);
  return { print, plate: plates[0] };
}

/** `contents` uploaded as a supporting file by the print's owner, as a temp upload is. */
export async function upload(
  dir: string,
  userId: string,
  printId: string,
  filename: string,
  contents: Buffer | string,
) {
  await saveFileFromTemp(userId, printId, tempFile(dir, contents), filename, null);
  return prisma.printFile.findFirstOrThrow({ where: { printId, filename }, orderBy: { createdAt: "desc" } });
}
