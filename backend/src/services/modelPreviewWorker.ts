import fs from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { compressGlb } from "./glbCompression";
import { renderModelPreviewGlb, type RenderOptions } from "./modelPreviewRender";
import { renderModelImage, type ModelImageOptions } from "./modelImageRender";
import { checkModelQuality } from "./modelQualityCheck";
import type { QualityReport } from "./meshQuality";

// Worker entry point for one preview render, a GLB or a picture, one printability check, or packing a GLB smaller.
// Posts exactly one message, then exits.

export type ModelPreviewWorkerInput =
  | { kind: "glb"; srcPath: string; destPath: string; options: RenderOptions }
  | {
      kind: "image";
      srcPath: string;
      destPath: string;
      /** Where the picture in the model's own colours goes, for a model that carries any. */
      colorDestPath?: string;
      ext: string;
      image: ModelImageOptions;
    }
  | { kind: "quality"; srcPath: string; ext: string }
  /** A 3D preview made smaller (glbCompression.ts), written to `destPath`. */
  | { kind: "compress"; srcPath: string; destPath: string };
export type ModelPreviewWorkerResult =
  | { status: "ok"; colored?: boolean }
  | { status: "checked"; report: QualityReport }
  | { status: "too-complex" }
  | { status: "unsupported" }
  | { status: "error"; error: string };

async function run(): Promise<void> {
  const input = workerData as ModelPreviewWorkerInput;
  let result: ModelPreviewWorkerResult;
  try {
    if (input.kind === "quality") {
      const report = await checkModelQuality(input.srcPath, input.ext);
      result = typeof report === "string" ? { status: report } : { status: "checked", report };
    } else if (input.kind === "compress") {
      await fs.writeFile(input.destPath, await compressGlb(await fs.readFile(input.srcPath)));
      result = { status: "ok" };
    } else if (input.kind === "glb") {
      result = { status: await renderModelPreviewGlb(input.srcPath, input.destPath, input.options) };
    } else {
      const drawn = await renderModelImage(input.srcPath, input.destPath, input.ext, input.image, input.colorDestPath);
      result = typeof drawn === "string" ? { status: drawn } : drawn;
    }
  } catch (err) {
    result = { status: "error", error: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port, not window.postMessage.
  parentPort?.postMessage(result);
}

void run();
