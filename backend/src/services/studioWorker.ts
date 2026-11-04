import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import sharp from "sharp";
import type { ManifoldToplevel } from "manifold-3d";
import { LIMITS, type MeshData, type PartMeasure, type StudioDocument, type Vec3 } from "../studio/document.generated";
import {
  checkDesign,
  describeBody,
  estimateTriangles,
  evaluateDesign,
  measureBetween,
  measureBounds,
  measureParts,
  prepareMesh,
  worldTriangles,
  type BodyDescription,
} from "../studio/geometry.generated";
import { decodeMesh, encodeMesh } from "../studio/meshAsset.generated";
import type { PrintCheck, PrintCheckOptions } from "../studio/printCheck.generated";
import { binaryStl } from "../studio/stl.generated";
import { bright, tracePicture, type Traced, type TraceSettings } from "../studio/trace.generated";
import { loadTriangles, renderTrianglesRgba, type RenderCamera } from "./modelImageRender";
import { loadFontsFor } from "./studioFonts";

// Studio's heavy work, off the main thread: measuring and picturing a design for an assistant, finding a body's loose
// parts to separate them, and making the design's own copy of a library model it imports. Runs in a worker thread
// (studioInspect.ts); keep it free of config/db imports.

export const STUDIO_VIEWS = ["iso", "top", "front", "right", "back", "left", "bottom"] as const;
export type StudioView = (typeof STUDIO_VIEWS)[number];

// Z is up. The front is -Y, so "iso" looks from the front right, above, as the page opens.
const CAMERAS: Record<StudioView, RenderCamera> = {
  iso: { toCamera: [1, -1.6, 1.1], up: [0, 0, 1] },
  top: { toCamera: [0, 0, 1], up: [0, 1, 0] },
  front: { toCamera: [0, -1, 0], up: [0, 0, 1] },
  right: { toCamera: [1, 0, 0], up: [0, 0, 1] },
  back: { toCamera: [0, 1, 0], up: [0, 0, 1] },
  left: { toCamera: [-1, 0, 0], up: [0, 0, 1] },
  bottom: { toCamera: [0, 0, -1], up: [0, -1, 0] },
};

// Past this the design isn't made at all: it would take the server too long. A design in the browser has no such cap.
const MAX_TRIANGLES = 2_000_000;

export type StudioWorkerInput =
  | {
      kind: "inspect";
      document: StudioDocument;
      /** Where the design's imported meshes are, as <asset id>.tpsm. */
      assetDir: string;
      render: { views: StudioView[]; size: number; color: string } | null;
    }
  | { kind: "import"; srcPath: string; ext: string; destPath: string }
  | { kind: "trace"; picturePath: string; settings: TraceSettings }
  | { kind: "describe"; document: StudioDocument; assetDir: string; featureId: string }
  | { kind: "parts"; document: StudioDocument; assetDir: string; featureId: string }
  | { kind: "stl"; document: StudioDocument; assetDir: string }
  | { kind: "bounds"; document: StudioDocument; assetDir: string; ids: string[] }
  | { kind: "check"; document: StudioDocument; assetDir: string; options: PrintCheckOptions }
  | { kind: "between"; document: StudioDocument; assetDir: string; a: string; b: string };

export type StudioBodyStats = { id: string; bounds: { min: Vec3; max: Vec3 }; volume: number; triangles: number };

export type StudioWorkerResult =
  | {
      status: "ok";
      bodies: StudioBodyStats[];
      errors: { id: string; message: string }[];
      /** Base64 PNGs, one per view asked for. */
      images: { view: StudioView; png: string }[];
    }
  | { status: "imported"; solid: boolean; triangles: number; size: Vec3; parts: number }
  | { status: "described"; body: BodyDescription }
  | { status: "measured"; parts: PartMeasure[] }
  | { status: "bounds"; bounds: Record<string, { min: Vec3; max: Vec3 }> }
  | { status: "checked"; check: PrintCheck }
  | { status: "between"; between: ReturnType<typeof measureBetween> }
  | { status: "traced"; traced: Traced }
  /** The visible bodies as a binary STL; null when there are none. */
  | { status: "stl"; stl: Uint8Array | null; triangles: number }
  /** A file that can't come in, and why, in words for whoever asked. */
  | { status: "refused"; reason: string }
  | { status: "too-complex"; triangles: number }
  | { status: "error"; error: string };

async function manifold(): Promise<ManifoldToplevel> {
  const { default: Module } = await import("manifold-3d/manifold.js");
  const wasm = await Module();
  wasm.setup();
  return wasm;
}

/** The design's imported meshes, read from its folder as they're asked for. */
function meshesIn(assetDir: string) {
  const meshes = new Map<string, MeshData | null>();
  return (assetId: string) => {
    if (!meshes.has(assetId)) {
      try {
        meshes.set(assetId, decodeMesh(fs.readFileSync(path.join(assetDir, `${assetId}.tpsm`))));
      } catch {
        meshes.set(assetId, null);
      }
    }
    return meshes.get(assetId) ?? undefined;
  };
}

async function describe(input: Extract<StudioWorkerInput, { kind: "describe" }>): Promise<StudioWorkerResult> {
  const estimate = estimateTriangles(input.document);
  if (estimate > MAX_TRIANGLES) return { status: "too-complex", triangles: Math.round(estimate) };
  try {
    return {
      status: "described",
      body: describeBody(await manifold(), input.document, input.featureId, meshesIn(input.assetDir)),
    };
  } catch (error) {
    return { status: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}

async function findParts(input: Extract<StudioWorkerInput, { kind: "parts" }>): Promise<StudioWorkerResult> {
  const estimate = estimateTriangles(input.document);
  if (estimate > MAX_TRIANGLES) return { status: "too-complex", triangles: Math.round(estimate) };
  try {
    return {
      status: "measured",
      parts: measureParts(await manifold(), input.document, input.featureId, meshesIn(input.assetDir)),
    };
  } catch (error) {
    return { status: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}

async function inspect(input: Extract<StudioWorkerInput, { kind: "inspect" }>): Promise<StudioWorkerResult> {
  const estimate = estimateTriangles(input.document);
  if (estimate > MAX_TRIANGLES) return { status: "too-complex", triangles: Math.round(estimate) };
  const wasm = await manifold();
  const { bodies, errors } = evaluateDesign(wasm, input.document, undefined, meshesIn(input.assetDir));
  const visible = new Set(input.document.features.filter((feature) => feature.visible).map((feature) => feature.id));
  const images: { view: StudioView; png: string }[] = [];
  if (input.render) {
    const parts = bodies.filter((body) => visible.has(body.id)).map(worldTriangles);
    const triangles = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      triangles.set(part, offset);
      offset += part.length;
    }
    const { size, color } = input.render;
    for (const view of input.render.views) {
      const pixels =
        triangles.length > 0
          ? renderTrianglesRgba(triangles, CAMERAS[view], { size, color, ambient: 0.3, fill: 0.15 })
          : Buffer.alloc(size * size * 4);
      const png = await sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
        .png()
        .toBuffer();
      images.push({ view, png: png.toString("base64") });
    }
  }
  return {
    status: "ok",
    bodies: bodies.map(({ id, bounds, volume, triangles }) => ({ id, bounds, volume, triangles })),
    errors,
    images,
  };
}

async function importMesh(input: Extract<StudioWorkerInput, { kind: "import" }>): Promise<StudioWorkerResult> {
  const loaded = await loadTriangles(input.srcPath, input.ext, false);
  if (typeof loaded === "string")
    return {
      status: "refused",
      reason: loaded === "too-complex" ? "The file is too large to read" : "Studio can't read this file",
    };
  const count = loaded.triangles.length / 9;
  if (count === 0) return { status: "refused", reason: "The file has no triangles in it" };
  if (count > LIMITS.meshTriangles)
    return {
      status: "refused",
      reason: `It has ${count.toLocaleString("en")} triangles; Studio takes up to ${LIMITS.meshTriangles.toLocaleString("en")}`,
    };
  // The loader turns print files Y-up for three.js; Studio is Z-up, as the files themselves are.
  const zUp = new Float32Array(loaded.triangles.length);
  for (let i = 0; i < zUp.length; i += 3) {
    zUp[i] = loaded.triangles[i];
    zUp[i + 1] = -loaded.triangles[i + 2];
    zUp[i + 2] = loaded.triangles[i + 1];
  }
  const { mesh, solid, size, parts } = prepareMesh(await manifold(), zUp);
  fs.mkdirSync(path.dirname(input.destPath), { recursive: true });
  fs.writeFileSync(input.destPath, encodeMesh(mesh));
  return { status: "imported", solid, triangles: mesh.indices.length / 3, size, parts };
}

/** Whether the design will print as it's placed, for studio_check_print. */
async function check(input: Extract<StudioWorkerInput, { kind: "check" }>): Promise<StudioWorkerResult> {
  const estimate = estimateTriangles(input.document);
  if (estimate > MAX_TRIANGLES) return { status: "too-complex", triangles: Math.round(estimate) };
  return {
    status: "checked",
    check: checkDesign(await manifold(), input.document, input.options, meshesIn(input.assetDir)),
  };
}

/** How two bodies stand to each other, for studio_measure. */
async function between(input: Extract<StudioWorkerInput, { kind: "between" }>): Promise<StudioWorkerResult> {
  const estimate = estimateTriangles(input.document);
  if (estimate > MAX_TRIANGLES) return { status: "too-complex", triangles: Math.round(estimate) };
  try {
    return {
      status: "between",
      between: measureBetween(await manifold(), input.document, input.a, input.b, meshesIn(input.assetDir)),
    };
  } catch (error) {
    return { status: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Bodies' extents in the world, for align and lay_flat. */
async function findBounds(input: Extract<StudioWorkerInput, { kind: "bounds" }>): Promise<StudioWorkerResult> {
  const estimate = estimateTriangles(input.document);
  if (estimate > MAX_TRIANGLES) return { status: "too-complex", triangles: Math.round(estimate) };
  try {
    return {
      status: "bounds",
      bounds: measureBounds(await manifold(), input.document, input.ids, meshesIn(input.assetDir)),
    };
  } catch (error) {
    return { status: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The design's visible bodies as one STL, as the page's Download STL makes it. */
async function stl(input: Extract<StudioWorkerInput, { kind: "stl" }>): Promise<StudioWorkerResult> {
  const estimate = estimateTriangles(input.document);
  if (estimate > MAX_TRIANGLES) return { status: "too-complex", triangles: Math.round(estimate) };
  const visible = new Set(input.document.features.filter((feature) => feature.visible).map((feature) => feature.id));
  const { bodies, errors } = evaluateDesign(await manifold(), input.document, undefined, meshesIn(input.assetDir));
  if (errors.length) return { status: "refused", reason: `${errors[0].id} couldn't be made: ${errors[0].message}` };
  const parts = bodies.filter((body) => visible.has(body.id)).map(worldTriangles);
  return { status: "stl", stl: binaryStl(parts), triangles: parts.reduce((sum, part) => sum + part.length / 9, 0) };
}

async function trace(input: Extract<StudioWorkerInput, { kind: "trace" }>): Promise<StudioWorkerResult> {
  const { data, info } = await sharp(input.picturePath).raw().toBuffer({ resolveWithObject: true });
  // As red, green, blue and alpha, whether it's grey, grey with alpha, colour, or colour with alpha.
  const { width, height, channels } = info;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const at = i * channels;
    const grey = channels < 3;
    rgba[i * 4] = data[at];
    rgba[i * 4 + 1] = grey ? data[at] : data[at + 1];
    rgba[i * 4 + 2] = grey ? data[at] : data[at + 2];
    rgba[i * 4 + 3] = channels === 2 ? data[at + 1] : channels === 4 ? data[at + 3] : 255;
  }
  try {
    return { status: "traced", traced: tracePicture(bright(rgba, width, height), input.settings) };
  } catch (error) {
    return { status: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}

if (parentPort) {
  const input = workerData as StudioWorkerInput;
  const reply = (result: StudioWorkerResult) =>
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port, not window.postMessage.
    parentPort!.postMessage(result);
  const made = async (design: Exclude<StudioWorkerInput, { kind: "import" | "trace" }>) => {
    // The design's text needs its fonts in this thread too.
    await loadFontsFor(design.document);
    return design.kind === "describe"
      ? describe(design)
      : design.kind === "parts"
        ? findParts(design)
        : design.kind === "stl"
          ? stl(design)
          : design.kind === "bounds"
            ? findBounds(design)
            : design.kind === "check"
              ? check(design)
              : design.kind === "between"
                ? between(design)
                : inspect(design);
  };
  const job = input.kind === "import" ? importMesh(input) : input.kind === "trace" ? trace(input) : made(input);
  job.then(reply, (error: unknown) =>
    reply({ status: "error", error: error instanceof Error ? (error.stack ?? error.message) : String(error) }),
  );
}
