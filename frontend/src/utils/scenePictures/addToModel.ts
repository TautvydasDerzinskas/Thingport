import { printsApi } from "../../api/prints";
import { canPicture, pictureFilename, type Shot } from "./scenes";

const FULL = { width: 1600, height: 1200 };

/** Renders `shots` of a saved model and adds them after its pictures: from the 3D file and plate `at` gives (its
 *  place among the model's 3D files, and the plate's number in a 3MF), else its first 3D file. Returns how many were
 *  added; 0 when the model has no file to picture. */
export async function addScenePictures(
  modelId: string,
  shots: Shot[],
  at: { file: number; plate: number } | null = null,
): Promise<number> {
  const model = await printsApi.get(modelId);
  const pictured = model.plates.filter((p) => canPicture(p));
  const plate = (at && pictured[at.file]) || pictured[0];
  if (!plate || !shots.length) return 0;
  const { ScenePictureRenderer, loadSceneModel, colourModel } = await import("./render");
  const renderer = new ScenePictureRenderer();
  const scene = await loadSceneModel(
    printsApi.fileUrl(plate.url),
    plate.filename,
    at && plate === pictured[at.file] ? at.plate : null,
  ).catch((error) => {
    renderer.dispose();
    throw error;
  });
  try {
    colourModel(scene, scene.hasColour ? "own" : "white");
    const files: File[] = [];
    for (const [index, shot] of shots.entries()) {
      const blob = await renderer.render(scene, shot, FULL.width, FULL.height);
      files.push(new File([blob], pictureFilename(model.title || model.name, shot, index), { type: "image/jpeg" }));
    }
    await printsApi.addPreviewImages(modelId, files);
    return files.length;
  } finally {
    scene.dispose();
    renderer.dispose();
  }
}
