import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import JSZip from "jszip";
import sharp from "sharp";
import type { ManifoldToplevel } from "manifold-3d";
import { normalizeFileName } from "../files/names";
import {
  LIMITS,
  MAX_PLATES,
  STUDIO_FILAMENT_SLOT_LIMIT,
  featureById,
  isBody,
  plateOf,
  studioPlates,
  topLevel,
  type MeshData,
  type PartMeasure,
  type StudioDocument,
  type StudioPlate,
  type StudioPrintSetup,
  type Vec3,
} from "../studio/document.generated";
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
  type EvaluatedBody,
} from "../studio/geometry.generated";
import { decodeMesh, encodeMesh } from "../studio/meshAsset.generated";
import type { PrintCheck, PrintCheckOptions } from "../studio/printCheck.generated";
import { boundsOnBed, footprintOnBed } from "../studio/printLayout.generated";
import { binaryStl } from "../studio/stl.generated";
import { bright, tracePicture, type Traced, type TraceSettings } from "../studio/trace.generated";
import { loadStudioThreeMf, readThreeMfBuildPlates, type ThreeMfBuildPlate } from "./modelPreviewRender";
import { loadTriangles, renderTrianglesRgba, type RenderCamera } from "./modelImageRender";
import { loadFontsFor } from "./studioFonts";
import {
  STUDIO_3MF_DEFAULT_COLOR,
  studioThreeMfBed,
  writeStudioThreeMf,
  type StudioExportTarget,
} from "./studioThreeMf";

// Studio's heavy work, off the main thread: measuring and picturing a design for an assistant, finding a body's loose
// parts to separate them, and making the design's own copy of a library model it imports. Runs in a worker thread
// (studioInspect.ts); keep it free of config/db imports.

export const STUDIO_VIEWS = ["iso", "top", "front", "right", "back", "left", "bottom"] as const;
export type StudioView = (typeof STUDIO_VIEWS)[number];
export type StudioExportFormat = "auto" | "3mf" | "stl" | "stl-zip";

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
      render: { views: StudioView[]; size: number; color: string; plate?: string } | null;
    }
  | { kind: "import"; srcPath: string; ext: string; destPath: string }
  | { kind: "import-3mf"; srcPath: string; destDir: string; plate?: { index: number | null } }
  | { kind: "list-3mf-plates"; srcPath: string }
  | { kind: "trace"; picturePath: string; settings: TraceSettings }
  | { kind: "describe"; document: StudioDocument; assetDir: string; featureId: string }
  | { kind: "parts"; document: StudioDocument; assetDir: string; featureId: string }
  | {
      kind: "export";
      document: StudioDocument;
      assetDir: string;
      name: string;
      format: StudioExportFormat;
      plate?: string;
      target?: StudioExportTarget;
    }
  | { kind: "bounds"; document: StudioDocument; assetDir: string; ids: string[] }
  | { kind: "check"; document: StudioDocument; assetDir: string; options: PrintCheckOptions }
  | { kind: "between"; document: StudioDocument; assetDir: string; a: string; b: string };

export type StudioBodyStats = { id: string; bounds: { min: Vec3; max: Vec3 }; volume: number; triangles: number };

export type StudioImportedBody = {
  name: string | null;
  color?: string;
  solid: boolean;
  triangles: number;
  size: Vec3;
  parts: number;
  position: Vec3;
  file: string;
};

export type StudioWorkerResult =
  | {
      status: "ok";
      bodies: StudioBodyStats[];
      errors: { id: string; message: string }[];
      /** Base64 PNGs, one per view asked for. */
      images: { view: StudioView; png: string }[];
    }
  | { status: "imported"; solid: boolean; triangles: number; size: Vec3; parts: number }
  | { status: "project"; plates: { name: string | null; bodies: StudioImportedBody[] }[]; mixedColors: boolean }
  | { status: "source-plates"; plates: ThreeMfBuildPlate[] }
  | { status: "described"; body: BodyDescription }
  | { status: "measured"; parts: PartMeasure[] }
  | { status: "bounds"; bounds: Record<string, { min: Vec3; max: Vec3 }> }
  | { status: "checked"; check: PrintCheck }
  | { status: "between"; between: ReturnType<typeof measureBetween> }
  | { status: "traced"; traced: Traced }
  | { status: "exported"; bytes: Uint8Array; format: "stl" | "3mf" | "zip" }
  | { status: "empty" }
  /** A file that can't come in, and why, in words for whoever asked. */
  | { status: "refused"; reason: string; code?: string }
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
  const estimate = estimateTriangles(input.document, new Set([input.featureId]));
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
  const estimate = estimateTriangles(input.document, new Set([input.featureId]));
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

/** Combine the triangles and color once when several views show the same bodies. */
function studioPngRenderer(parts: { body: EvaluatedBody; color?: string }[], size: number, color: string) {
  const triangles = new Float32Array(parts.reduce((sum, part) => sum + part.body.mesh.indices.length * 3, 0));
  const faceColors = parts.some((part) => part.color) ? new Uint8Array(triangles.length / 3) : null;
  let offset = 0;
  for (const part of parts) {
    const world = worldTriangles(part.body);
    triangles.set(world, offset);
    if (faceColors) {
      const rgb = Number.parseInt((part.color ?? color).slice(1), 16);
      const end = (offset + world.length) / 3;
      for (let i = offset / 3; i < end; i += 3) {
        faceColors[i] = (rgb >> 16) & 255;
        faceColors[i + 1] = (rgb >> 8) & 255;
        faceColors[i + 2] = rgb & 255;
      }
    }
    offset += world.length;
  }
  return (view: StudioView) => {
    const pixels = triangles.length
      ? renderTrianglesRgba(triangles, CAMERAS[view], { size, color, ambient: 0.3, fill: 0.15 }, faceColors)
      : Buffer.alloc(size * size * 4);
    return sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
      .png()
      .toBuffer();
  };
}

async function inspect(input: Extract<StudioWorkerInput, { kind: "inspect" }>): Promise<StudioWorkerResult> {
  const requestedPlate = input.render?.plate;
  const ids = requestedPlate
    ? topLevel(input.document)
        .filter((feature) => isBody(feature) && feature.visible && plateOf(feature) === requestedPlate)
        .map((feature) => feature.id)
    : undefined;
  const estimate = estimateTriangles(input.document, ids && new Set(ids));
  if (estimate > (requestedPlate ? LIMITS.sourcePlateTriangles : MAX_TRIANGLES))
    return { status: "too-complex", triangles: Math.round(estimate) };
  const wasm = await manifold();
  const { bodies, errors } = evaluateDesign(wasm, input.document, ids, meshesIn(input.assetDir));
  const images: { view: StudioView; png: string }[] = [];
  if (input.render) {
    const hasBodies = (plate: StudioPlate) =>
      bodies.some((body) => {
        const feature = featureById(input.document, body.id);
        return feature?.visible && plateOf(feature) === plate.id;
      });
    const plates = studioPlates(input.document);
    const renderPlate =
      input.render.plate ?? (plates.find((plate) => !plate.hidden && hasBodies(plate)) ?? plates.find(hasBodies))?.id;
    const parts = bodies.flatMap((body) => {
      const feature = featureById(input.document, body.id);
      if (!feature?.visible || !isBody(feature) || plateOf(feature) !== renderPlate) return [];
      return [{ body, color: feature.color }];
    });
    const { size, color } = input.render;
    const renderPng = studioPngRenderer(parts, size, color);
    for (const view of input.render.views) {
      const png = await renderPng(view);
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

async function importThreeMf(input: Extract<StudioWorkerInput, { kind: "import-3mf" }>): Promise<StudioWorkerResult> {
  const maxBody = input.plate ? LIMITS.sourceBodyTriangles : LIMITS.meshTriangles;
  const project = await loadStudioThreeMf(
    input.srcPath,
    input.plate ? LIMITS.sourcePlateTriangles : MAX_TRIANGLES,
    LIMITS.features,
    maxBody,
    input.plate,
  );
  if (project === "too-complex")
    return {
      status: "refused",
      reason: input.plate
        ? `This plate exceeds Studio's limits of ${LIMITS.features} objects or ${LIMITS.sourcePlateTriangles.toLocaleString("en")} triangles`
        : "The 3MF exceeds Studio's object or triangle limit",
      ...(input.plate && { code: "studio_import_plate_limit" }),
    };
  if (project === "body-too-complex")
    return {
      status: "refused",
      reason: `Each imported body can have up to ${maxBody.toLocaleString("en")} triangles`,
      ...(input.plate && { code: "studio_import_body_limit" }),
    };
  if (project === "missing-parts")
    return { status: "refused", reason: "The 3MF references missing model parts", code: "studio_import_missing_parts" };
  if (project === "unsupported")
    return { status: "refused", reason: "The 3MF has no readable printable bodies", code: "studio_import_no_bodies" };
  if (project.plates.length > MAX_PLATES)
    return { status: "refused", reason: `Studio takes up to ${MAX_PLATES} plates` };
  const wasm = await manifold();
  let next = 0;
  const plates = project.plates.map(({ name: plateName, parts }) => ({
    name: plateName,
    bodies: parts.map(({ name, color, triangles }): StudioImportedBody => {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < triangles.length; i++) {
        const axis = i % 3;
        min[axis] = Math.min(min[axis], triangles[i]);
        max[axis] = Math.max(max[axis], triangles[i]);
      }
      const position: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
      const prepared = prepareMesh(wasm, triangles);
      const file = `${next++}.tpsm`;
      fs.writeFileSync(path.join(input.destDir, file), encodeMesh(prepared.mesh));
      return {
        name,
        color,
        position,
        file,
        solid: prepared.solid,
        size: prepared.size,
        triangles: prepared.mesh.indices.length / 3,
        parts: prepared.parts,
      };
    }),
  }));
  return { status: "project", plates, mixedColors: project.mixedColors };
}

async function sourcePlates(srcPath: string): Promise<StudioWorkerResult> {
  const plates = await readThreeMfBuildPlates(srcPath, true);
  if (typeof plates === "string")
    return {
      status: "refused",
      reason:
        plates === "too-complex" ? "The 3MF archive is too large to read" : "The 3MF has no readable build plates",
      code: plates === "too-complex" ? "studio_import_archive_limit" : "studio_import_no_plates",
    };
  return { status: "source-plates", plates };
}

/** Whether the design will print as it's placed, for studio_check_print. */
async function check(input: Extract<StudioWorkerInput, { kind: "check" }>): Promise<StudioWorkerResult> {
  const unloaded = studioPlates(input.document).find((plate) => plate.source && !plate.hidden);
  if (unloaded)
    return { status: "refused", reason: `Open ${unloaded.name} before checking the whole design for printing.` };
  const estimate = estimateTriangles(input.document);
  if (estimate > MAX_TRIANGLES) return { status: "too-complex", triangles: Math.round(estimate) };
  return {
    status: "checked",
    check: checkDesign(await manifold(), input.document, input.options, meshesIn(input.assetDir)),
  };
}

/** How two bodies stand to each other, for studio_measure. */
async function between(input: Extract<StudioWorkerInput, { kind: "between" }>): Promise<StudioWorkerResult> {
  const estimate = estimateTriangles(input.document, new Set([input.a, input.b]));
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
  const estimate = estimateTriangles(input.document, new Set(input.ids));
  if (estimate > LIMITS.sourcePlateTriangles) return { status: "too-complex", triangles: Math.round(estimate) };
  try {
    return {
      status: "bounds",
      bounds: measureBounds(await manifold(), input.document, input.ids, meshesIn(input.assetDir)),
    };
  } catch (error) {
    return { status: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}

function bodyFitsPrinterBed(body: EvaluatedBody, bed: Vec3, outline?: StudioPrintSetup["outline"]): boolean {
  if (!boundsOnBed(body.bounds, bed)) return false;
  if (!outline || boundsOnBed(body.bounds, bed, outline)) return true;
  // A part can fit even when its bounding box crosses a corner or notch in the outline.
  const triangles = worldTriangles(body);
  for (let i = 0; i < triangles.length; i += 9) {
    const footprint = [
      [triangles[i], triangles[i + 1]],
      [triangles[i + 3], triangles[i + 4]],
      [triangles[i + 6], triangles[i + 7]],
    ] satisfies [number, number][];
    if (!footprintOnBed(footprint, bed, outline)) return false;
  }
  return true;
}

async function exportDesign(input: Extract<StudioWorkerInput, { kind: "export" }>): Promise<StudioWorkerResult> {
  // One plate asked for by name goes out even when hidden; the whole design leaves hidden plates out.
  const platesInDesign = studioPlates(input.document).filter((plate) =>
    input.plate ? plate.id === input.plate : !plate.hidden,
  );
  const exported = new Set(platesInDesign.map((plate) => plate.id));
  const visible = topLevel(input.document).filter(
    (feature) => isBody(feature) && feature.visible && exported.has(plateOf(feature)),
  );
  if (!visible.length) return { status: "empty" };
  const ids = visible.map((feature) => feature.id);
  const estimate = estimateTriangles(input.document, new Set(ids));
  const hasOnePlate = new Set(visible.map(plateOf)).size === 1;
  const sourceProject = input.document.features.some(
    (feature) => feature.type === "mesh" && feature.source.build_plate !== undefined,
  );
  const maxBodyTriangles = sourceProject ? LIMITS.sourceBodyTriangles : LIMITS.meshTriangles;
  if (estimate > (hasOnePlate && sourceProject ? LIMITS.sourcePlateTriangles : MAX_TRIANGLES))
    return { status: "too-complex", triangles: Math.round(estimate) };
  const byId = new Map(visible.map((feature) => [feature.id, feature]));
  const { bodies, errors } = evaluateDesign(await manifold(), input.document, ids, meshesIn(input.assetDir));
  if (errors.length) return { status: "refused", reason: `${errors[0].id} couldn't be made: ${errors[0].message}` };
  const parts = bodies.flatMap((body) => {
    const feature = byId.get(body.id);
    return feature && isBody(feature)
      ? [{ body, name: feature.name || feature.id, color: feature.color, plateId: plateOf(feature) }]
      : [];
  });
  if (!parts.length) return { status: "empty" };
  const autoStl = input.format === "auto" && parts.length === 1 && !parts[0].color && platesInDesign.length === 1;
  if (input.format === "stl" || autoStl) {
    const bytes = binaryStl(parts.map(({ body }) => worldTriangles(body)));
    return bytes ? { status: "exported", bytes, format: "stl" } : { status: "empty" };
  }
  if (input.format === "stl-zip") {
    const zip = new JSZip();
    for (const [index, plate] of platesInDesign.entries()) {
      const onPlate = parts.filter((part) => part.plateId === plate.id);
      const bytes = binaryStl(onPlate.map(({ body }) => worldTriangles(body)));
      if (!bytes) continue;
      // The number keeps same-named plates distinct, even on case-insensitive file systems.
      const name = normalizeFileName(`${index + 1} - ${plate.name}.stl`).replace(/[:*?"<>|]+/g, "-");
      zip.file(name, bytes);
    }
    if (!Object.keys(zip.files).length) return { status: "empty" };
    const archive = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 1 },
    });
    return { status: "exported", format: "zip", bytes: archive };
  }
  const tooDetailed = parts.find(({ body }) => body.triangles > maxBodyTriangles);
  if (tooDetailed)
    return {
      status: "refused",
      reason: `${tooDetailed.name} exceeds Studio's limit of ${maxBodyTriangles.toLocaleString("en")} triangles per 3MF body. Simplify or split it before exporting.`,
    };
  const recipe = input.target?.printer?.recipe;
  if (recipe) {
    const { size, outline } = studioThreeMfBed(input.target, input.document.print_setup);
    const bad = parts.find(({ body }) => !bodyFitsPrinterBed(body, size, outline));
    if (bad) return { status: "refused", reason: `${bad.name} is outside the build volume for ${recipe.preset}.` };
  }
  const plates = [];
  for (const plate of platesInDesign) {
    const onPlate = parts.filter((part) => part.plateId === plate.id);
    if (!onPlate.length) continue;
    const thumbnail = await studioPngRenderer(onPlate, 256, STUDIO_3MF_DEFAULT_COLOR)("iso");
    plates.push({ ...plate, thumbnail });
  }
  const bytes = await writeStudioThreeMf(
    input.name,
    parts,
    plates,
    input.target,
    input.document.print_setup,
    input.document.print_profile,
  );
  if (!bytes)
    return {
      status: "refused",
      reason: `This slicer export supports up to ${STUDIO_FILAMENT_SLOT_LIMIT} filament slots. Reduce the number of colors before exporting.`,
    };
  return {
    status: "exported",
    format: "3mf",
    bytes,
  };
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
  const made = async (
    design: Exclude<StudioWorkerInput, { kind: "import" | "import-3mf" | "list-3mf-plates" | "trace" }>,
  ) => {
    // The design's text needs its fonts in this thread too.
    await loadFontsFor(design.document);
    return design.kind === "describe"
      ? describe(design)
      : design.kind === "parts"
        ? findParts(design)
        : design.kind === "export"
          ? exportDesign(design)
          : design.kind === "bounds"
            ? findBounds(design)
            : design.kind === "check"
              ? check(design)
              : design.kind === "between"
                ? between(design)
                : inspect(design);
  };
  const job =
    input.kind === "import"
      ? importMesh(input)
      : input.kind === "import-3mf"
        ? importThreeMf(input)
        : input.kind === "list-3mf-plates"
          ? sourcePlates(input.srcPath)
          : input.kind === "trace"
            ? trace(input)
            : made(input);
  job.then(reply, (error: unknown) =>
    reply({ status: "error", error: error instanceof Error ? (error.stack ?? error.message) : String(error) }),
  );
}
