import { studioApi } from "../../api/studio";

// A library model's 3D file as a new Studio design, named after the model: from the Open dialog's Library tab, and from
// a model's own page. Kept apart from the page, which is loaded only when it's opened.

/** The new design's id. A design that couldn't take the file isn't left behind, empty. */
export async function openModelAsDesign(model: { id: string; title: string }, fileId: string, untitled: string) {
  const design = await studioApi.create(model.title.slice(0, 120) || untitled);
  try {
    await studioApi.run(design.id, "import_model", { model_id: model.id, file_id: fileId });
  } catch (error) {
    await studioApi.remove(design.id).catch(() => undefined);
    throw error;
  }
  return design.id;
}
