import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { MODEL_PREVIEWS } from "../config";
import { prisma } from "../db";
import { withStorageLock } from "../utils/storageLock";
import { buildPlateGlbName, PREVIEW_FORMAT_VERSION } from "./modelAssets";
import {
  isSmaller,
  packInWorker,
  PERMANENT_FAILURE_PREFIX,
  recentlyFailed,
  renderInWorker,
  scheduleRender,
  SIMPLIFY_TARGET_TRIANGLES,
  UNSUPPORTED_MARKER,
} from "./modelPreviewJobs";
import type { PlateSummary } from "./modelPreviewRender";

type BuildPlateManifest = {
  version: string;
  plates: (PlateSummary & { thumbnail: boolean })[];
};

const plateManifests = new Map<string, Promise<BuildPlateManifest | null>>();
const BUILD_PLATE_CACHE_VERSION = 1;
const CACHE_SIZE_MANIFESTS = 64;
const inFlight = new Set<string>();

async function buildPlateVersion(srcPath: string, simplify: boolean): Promise<string | null> {
  const stat = await fs.stat(srcPath, { bigint: true }).catch(() => null);
  if (!stat) return null;
  return createHash("sha256")
    .update(
      `${BUILD_PLATE_CACHE_VERSION}/${PREVIEW_FORMAT_VERSION}/${stat.dev}/${stat.ino}/${stat.size}/${stat.mtimeNs}/${stat.ctimeNs}/${simplify}`,
    )
    .digest("hex")
    .slice(0, 24);
}

export async function getBuildPlateManifest(srcPath: string, simplify: boolean): Promise<BuildPlateManifest | null> {
  const version = await buildPlateVersion(srcPath, simplify);
  if (!version) return null;
  let pending = plateManifests.get(version);
  if (!pending) {
    pending = scheduleRender("glb", async () => {
      const result = await renderInWorker({ kind: "plates", srcPath });
      if (
        result.status === "error" ||
        result.status === "limit" ||
        (await buildPlateVersion(srcPath, simplify)) !== version
      )
        throw new Error("Could not read a current build plate manifest");
      if (result.status !== "plates" || result.plates.length < 2 || result.plates.length > 64) return null;
      const plates = result.plates.filter(
        (plate): plate is BuildPlateManifest["plates"][number] =>
          plate.index !== null && Number.isSafeInteger(plate.index) && plate.index >= 0 && plate.index <= 9999,
      );
      return plates.length === result.plates.length ? { version, plates } : null;
    }).catch(() => {
      if (plateManifests.get(version) === pending) plateManifests.delete(version);
      return null;
    });
    plateManifests.set(version, pending);
    if (plateManifests.size > CACHE_SIZE_MANIFESTS) plateManifests.delete(plateManifests.keys().next().value!);
  }
  return pending;
}

/** The single-build-plate cache uses the model file id prefix so model and cache cleanup also remove it. */
export function buildPlatePreview(
  plateId: string,
  srcPath: string,
  version: string,
  buildPlate: number,
  simplify: boolean,
): { status: "ready"; file: string } | { status: "generating" | "failed" } {
  const file = path.join(MODEL_PREVIEWS, buildPlateGlbName(plateId, buildPlate, version));
  const error = `${file}.error`;
  const pending = `${file}.pending`;
  if (fsSync.existsSync(file)) return { status: "ready", file };
  if (inFlight.has(file)) return { status: "generating" };
  if (recentlyFailed(error) || fsSync.existsSync(pending)) return { status: "failed" };
  inFlight.add(file);
  void scheduleRender("glb", async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    const packed = `${tmp}.packed`;
    let ownsMarker = false;
    try {
      if ((await buildPlateVersion(srcPath, simplify)) !== version) return;
      ownsMarker = await fs.writeFile(pending, "", { flag: "wx" }).then(
        () => true,
        (err: NodeJS.ErrnoException) => {
          if (err.code === "EEXIST") return false;
          throw err;
        },
      );
      if (!ownsMarker) return;
      const outcome = await renderInWorker({
        kind: "glb",
        srcPath,
        destPath: tmp,
        options: { buildPlate, simplifyTo: simplify ? SIMPLIFY_TARGET_TRIANGLES : null },
      });
      if (outcome.status !== "ok") {
        const permanent = outcome.status === "too-complex" || outcome.status === "limit";
        const marker =
          outcome.status === "unsupported"
            ? UNSUPPORTED_MARKER
            : permanent
              ? `${PERMANENT_FAILURE_PREFIX}${outcome.status}`
              : outcome.status;
        await fs.writeFile(error, marker);
        return;
      }
      const ready = (await packInWorker(tmp, packed)) && (await isSmaller(packed, tmp)) ? packed : tmp;
      await withStorageLock(async () => {
        if ((await buildPlateVersion(srcPath, simplify)) !== version) return;
        if (!(await prisma.plate.findUnique({ where: { id: plateId }, select: { id: true } }))) return;
        await fs.rename(ready, file);
      });
    } catch (err) {
      console.error(`Build plate preview failed for ${plateId}, plate ${buildPlate}:`, err);
      await fs.writeFile(error, String(err)).catch(() => undefined);
    } finally {
      if (ownsMarker)
        await Promise.all([tmp, packed, pending].map((entry) => fs.rm(entry, { force: true }).catch(() => undefined)));
      inFlight.delete(file);
    }
  });
  return { status: "generating" };
}
