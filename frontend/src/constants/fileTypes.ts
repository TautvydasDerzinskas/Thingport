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

/** What the upload picker offers beside them: documents and sources a model keeps as supporting files, uploaded with its
 *  model files. On its own, one of these can't be a model, and the upload says so. */
export const SUPPORTING_PICK_EXTS = [
  "pdf",
  "txt",
  "md",
  "csv",
  "doc",
  "docx",
  "odt",
  "rtf",
  "xls",
  "xlsx",
  "ods",
  "gcode",
  "bgcode",
  "gco",
  "scad",
  "fcstd",
  "blend",
  "skp",
  "dxf",
  "dwg",
  "iges",
  "igs",
  "sldprt",
];
