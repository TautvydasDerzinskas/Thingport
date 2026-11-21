import { studioApi } from "../../api/studio";

// A library model's 3D file as a new Studio design, named after the model: from the Open dialog's Library tab, and from
// a model's own page. Kept apart from the editor, whose bundle can load after the import.

export type StudioModelRequest = {
  model: { id: string; title: string };
  fileId: string;
  filename: string;
};

/** Navigation state for a new import, followed by the mesh ID for the editor's multipart hint. */
export type StudioArrival = { openModel?: StudioModelRequest; imported?: string };

/** The new design's id, and its mesh's. A design that couldn't take the file isn't left behind, empty. */
export async function openModelAsDesign(model: { id: string; title: string }, fileId: string, untitled: string) {
  const design = await studioApi.create(model.title.slice(0, 120) || untitled);
  try {
    const result = await studioApi.run(design.id, "import_model", {
      model_id: model.id,
      file_id: fileId,
      defer_plates: true,
    });
    return { id: design.id, mesh: result.created.length === 1 ? result.created[0] : null };
  } catch (error) {
    await studioApi.remove(design.id).catch(() => undefined);
    throw error;
  }
}
