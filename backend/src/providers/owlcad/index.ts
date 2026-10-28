// OwlCAD's bundle: this folder, providers/owlcad/ at the repository's root (its manifest and links, which all three
// packages share), the app's frontend/src/providers/owlcad/ and Grab's extension/src/providers/owlcad/. Wired in by
// providers/registry.ts and providers/routes.ts here, frontend/src/providers/collectionTiles.ts in the app, and the
// tables in extension/src/providers/ in Grab.
//
// Outside them, and why:
// - prisma/schema.prisma: its waiting exports are GrabImport rows, which it shares with MakerOnline, told apart by
//   that table's `provider`, as the schema is one file.
// - services/importService.ts: `owlcadExportPath` on the import body, the 3MF Grab exported, since OwlCAD hands out
//   no link to a CAD project's geometry at all.
// - services/apiTokenScopes.ts: its waiting exports' path, as every scope is listed there for apps that read with a
//   token.
// - The app's text for it, under its id in frontend/src/i18n/locales/*.json, where all of the app's text is kept.
//
// Why a custom import rather than the shared pipeline: the pipeline downloads a provider's file from a link, and
// only half of OwlCAD's gallery has one. A library part is a GLB in Storage, converted here; a CAD project is a
// script with no file anywhere, so Grab runs OwlCAD's own editor to build one (grabExports.ts).

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { HttpError } from "../../utils/fileUtils";
import { detailsOf } from "../details";
import type { NewPlateInput } from "../../services/printCreation";
import type { CustomImport, ProviderDetails } from "../types";
import {
  fetchOwlcadItem,
  fetchOwlcadMesh,
  fetchOwlcadPart,
  fetchOwlcadProject,
  owlcadImportsServerSide,
  owlcadProjectMeshUrls,
  OwlcadError,
  resolveOwlcadModel,
  resolvedOwlcadModel,
  type OwlcadGalleryItem,
  type OwlcadModel,
} from "./api";
import { fitPartTriangles, glbTriangles, packedMeshTriangles, trianglesToStl } from "./geometry";
import manifest from "./manifest.generated";

const NAME = manifest.name;
const NEEDS_GRAB_CODE = manifest.errorCodes.needsGrab;
const NEEDS_GRAB =
  `${NAME} builds a CAD project's file in its own editor, so there is nothing to download: import it with ` +
  "Thingport Grab on owlcad.com.";
const MISSING = `This ${NAME} model could not be found, or isn't public.`;

/** A filename from the model's own name, falling back to its id. */
function fileBase(item: OwlcadGalleryItem): string {
  const name = (item.slug || item.name || item.id).trim();
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80) || item.id;
}

/** A plate's file on disk for the pipeline to take over, named as the import will keep it. Flat in the temp folder
 *  with a random prefix, as the shared pipeline's own downloads are, so what removes those removes these. */
async function writeTemp(bytes: Uint8Array | Buffer, filename: string): Promise<NewPlateInput> {
  const tempFilePath = path.join(os.tmpdir(), `thingport-owlcad-${randomBytes(8).toString("hex")}-${filename}`);
  await fs.writeFile(tempFilePath, bytes);
  return { filename, mime: "application/octet-stream", tempFilePath, sourceInstanceId: null };
}

/** Throws away what was written before something later failed, so a half-built import leaves nothing behind. */
async function discard(inputs: NewPlateInput[]): Promise<void> {
  await Promise.all(
    inputs.map((input) =>
      input.tempFilePath ? fs.rm(input.tempFilePath, { force: true }).catch(() => undefined) : undefined,
    ),
  );
}

/** A library part: one GLB in Storage, as the STL OwlCAD itself would place on the plate. */
async function partPlates(item: OwlcadGalleryItem): Promise<NewPlateInput[]> {
  const glb = await fetchOwlcadPart(item.storagePath!);
  const triangles = fitPartTriangles(glbTriangles(glb));
  if (!triangles.length) throw new HttpError(400, `This ${NAME} part has no geometry Thingport can import.`);
  return [await writeTemp(trianglesToStl(triangles), `${fileBase(item)}.stl`)];
}

/** A CAD project whose geometry is nothing but imported meshes needs no kernel: its meshes are its model. One whose
 *  document is a real script -- booleans, generators, modifiers -- has to go through Grab. */
async function projectPlates(item: OwlcadGalleryItem): Promise<NewPlateInput[] | null> {
  const project = await fetchOwlcadProject(item.id);
  const urls = project && owlcadProjectMeshUrls(project);
  if (!urls) return null;
  const inputs: NewPlateInput[] = [];
  try {
    for (const [index, url] of urls.entries()) {
      const triangles = packedMeshTriangles(await fetchOwlcadMesh(url));
      if (!triangles.length) continue;
      const suffix = urls.length > 1 ? `-${index + 1}` : "";
      inputs.push(await writeTemp(trianglesToStl(triangles), `${fileBase(item)}${suffix}.stl`));
    }
  } catch (err) {
    await discard(inputs);
    throw err;
  }
  if (!inputs.length) {
    await discard(inputs);
    return null;
  }
  return inputs;
}

/** The 3MF Grab exported from the editor, which its route has already written to a temp file. */
async function exportedPlates(item: OwlcadGalleryItem, exportPath: string): Promise<NewPlateInput[]> {
  const bytes = await fs.readFile(exportPath).catch(() => null);
  if (!bytes?.length) throw new HttpError(400, `Thingport Grab's ${NAME} export was empty.`);
  // OwlCAD's editor writes a core-spec 3MF in millimetres, one object per part.
  return [await writeTemp(bytes, `${fileBase(item)}.3mf`)];
}

/** Every plate of a model, whichever of the three ways it comes. Null when only Grab can build it. */
async function platesFor(item: OwlcadGalleryItem, exportPath: string | null): Promise<NewPlateInput[] | null> {
  if (exportPath) return exportedPlates(item, exportPath);
  if (owlcadImportsServerSide(item)) return partPlates(item);
  return projectPlates(item);
}

export const owlcadImport: CustomImport = {
  async importModel(userId, source, body, kit) {
    const item = await fetchOwlcadItem(source.externalId);
    if (!item) throw new HttpError(404, MISSING);
    const plates = await platesFor(item, body.owlcadExportPath ?? null);
    if (!plates) throw new HttpError(409, NEEDS_GRAB, NEEDS_GRAB_CODE);
    const resolved = resolvedOwlcadModel(item);
    return kit.createPrint(userId, source, body, resolved, plates, {});
  },
  /** Its models have no print profiles, so a model already in the library has nothing more to bring. */
  async addToExisting(existing) {
    return { ...existing, alreadyImported: true };
  },
};

/** Whether only Grab can build this model's file, for the routes that park one rather than fail it. */
export async function owlcadNeedsGrab(modelId: string): Promise<{ item: OwlcadGalleryItem; needsGrab: boolean }> {
  const item = await fetchOwlcadItem(modelId);
  if (!item) throw new HttpError(404, MISSING);
  if (owlcadImportsServerSide(item)) return { item, needsGrab: false };
  const project = await fetchOwlcadProject(modelId);
  // The same predicate the import itself uses, so Grab is never told an export is needless for a project the
  // import would then refuse with 409.
  return { item, needsGrab: !project || !owlcadProjectMeshUrls(project) };
}

export const owlcadDetails: ProviderDetails = {
  read: async (_userId, modelId) => detailsOf(await resolveOwlcadModel(modelId)),
  missingMessage: MISSING,
};

export type { OwlcadModel };
export { OwlcadError, NEEDS_GRAB, NEEDS_GRAB_CODE };
