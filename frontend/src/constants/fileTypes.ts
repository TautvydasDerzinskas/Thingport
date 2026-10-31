export const MODEL_EXTS = new Set(["stl", "3mf", "step", "stp", "obj", "glb"]);

export const LIGHTBURN_EXTS = new Set(["lbrn", "lbrn2"]);

/** What a plain upload accepts as one model per file. */
export const UPLOAD_EXTS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "bmp",
  "gif",
  "svg",
  "stl",
  "step",
  "stp",
  "3mf",
  "obj",
  "glb",
  // The server packs it into a .glb with the .bin and textures uploaded beside it (utils/uploadTree.ts).
  "gltf",
  "f3d",
  "lbrn",
  "lbrn2",
  "zip",
];
