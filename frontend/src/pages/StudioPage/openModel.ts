import { studioApi } from "../../api/studio";

// A library model's 3D files as a new Studio design, named after the model: from the Open dialog's Library tab, and from
// a model's own page. Kept apart from the editor, whose bundle can load after the import.

type StudioModel = { id: string; title: string };
export type StudioModelRequest = { model: StudioModel } & ({ fileId: string; filename: string } | { allFiles: true });

/** Navigation state for a new import, followed by the mesh ID for the editor's multipart hint. */
export type StudioArrival = { openModel?: StudioModelRequest; imported?: string };

/** The new design's id and mesh's. A failed import can clean up the original empty design. */
export async function openModelAsDesign(model: StudioModel, fileId: string | undefined, untitled: string) {
  const design = await studioApi.create(model.title.slice(0, 120) || untitled);
  try {
    const result = await studioApi.run(design.id, "import_model", {
      model_id: model.id,
      ...(fileId === undefined ? { all_files: true } : { file_id: fileId, defer_plates: true }),
    });
    return { id: design.id, mesh: fileId && result.created.length === 1 ? result.created[0] : null };
  } catch (error) {
    await studioApi.remove(design.id, { expected_version: design.version }).catch(() => undefined);
    throw error;
  }
}
