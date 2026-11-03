import { studioApi } from "../../api/studio";

// A library model's 3D file as a new Studio design, named after the model: from the Open dialog's Library tab, and from
// a model's own page. Kept apart from the page, which is loaded only when it's opened.

/** What the Studio page is told by the page that opened it on a new design: the mesh it brought in, to say if it's in
 *  several parts. */
export type StudioArrival = { imported?: string };

/** The new design's id, and its mesh's. A design that couldn't take the file isn't left behind, empty. */
export async function openModelAsDesign(model: { id: string; title: string }, fileId: string, untitled: string) {
  const design = await studioApi.create(model.title.slice(0, 120) || untitled);
  try {
    const result = await studioApi.run(design.id, "import_model", { model_id: model.id, file_id: fileId });
    return { id: design.id, mesh: result.created[0] ?? null };
  } catch (error) {
    await studioApi.remove(design.id).catch(() => undefined);
    throw error;
  }
}
