import { parentPort, workerData } from "node:worker_threads";
import sharp from "sharp";
import type { StudioDocument, Vec3 } from "../studio/document.generated";
import { estimateTriangles, evaluateDesign, worldTriangles } from "../studio/geometry.generated";
import { renderTrianglesRgba, type RenderCamera } from "./modelImageRender";

// Makes a Studio design's solids for an assistant, off the main thread: what each body measures and, when asked,
// pictures of it. Runs in a worker thread (studioInspect.ts); keep it free of config/db imports.

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

export type StudioWorkerInput = {
  document: StudioDocument;
  render: { views: StudioView[]; size: number; color: string } | null;
};

export type StudioBodyStats = { id: string; bounds: { min: Vec3; max: Vec3 }; volume: number; triangles: number };

export type StudioWorkerResult =
  | {
      status: "ok";
      bodies: StudioBodyStats[];
      errors: { id: string; message: string }[];
      /** Base64 PNGs, one per view asked for. */
      images: { view: StudioView; png: string }[];
    }
  | { status: "too-complex"; triangles: number }
  | { status: "error"; error: string };

async function run(input: StudioWorkerInput): Promise<StudioWorkerResult> {
  const estimate = estimateTriangles(input.document);
  if (estimate > MAX_TRIANGLES) return { status: "too-complex", triangles: Math.round(estimate) };
  const { default: Module } = await import("manifold-3d/manifold.js");
  const wasm = await Module();
  wasm.setup();
  const { bodies, errors } = evaluateDesign(wasm, input.document);
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

if (parentPort) {
  const reply = (result: StudioWorkerResult) =>
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port, not window.postMessage.
    parentPort!.postMessage(result);
  run(workerData as StudioWorkerInput).then(reply, (error: unknown) =>
    reply({ status: "error", error: error instanceof Error ? (error.stack ?? error.message) : String(error) }),
  );
}
