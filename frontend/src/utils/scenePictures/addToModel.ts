import { printsApi } from "../../api/prints";
import { canPicture, pictureFilename, type Shot } from "./scenes";

const FULL = { width: 1600, height: 1200 };

/** Renders `shots` of a saved model from its first 3D file and adds them after its pictures. Returns how many were
 *  added; 0 when the model has no file to picture. */
export async function addScenePictures(modelId: string, shots: Shot[]): Promise<number> {
  const model = await printsApi.get(modelId);
  const plate = model.plates.find((p) => canPicture(p.filename));
  if (!plate || !shots.length) return 0;
  const { ScenePictureRenderer, loadSceneModel, colourModel } = await import("./render");
  const renderer = new ScenePictureRenderer();
  const scene = await loadSceneModel(printsApi.fileUrl(plate.url), plate.filename).catch((error) => {
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
