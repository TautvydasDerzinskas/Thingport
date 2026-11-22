import type { FileTree } from "./files";

// The cases table: what every way into the library makes of the same files today. A cell is a family of ways in
// (the sections below) and a shape of files (SHAPES), and `today` is everything its way in made of them, which
// cases.test.ts checks by running it. docs/STORAGE_DEVELOPMENT.md says how a pull request changes cells.
//
// `today` is what the code does, not what it should do: some cells pin faults, and `changes` names the step of the
// supporting-files work expected to change each one. A pull request that changes how files become models writes its
// cells' new outcomes (INTAKE_RECORD=<file> prints what every cell makes) and takes its step off them; any other cell
// that fails is a change it didn't mean.
//
// How an outcome reads, a line each:
//   "<model> (in <library folder>): <files>, <n> photos": the files are its plates in order (P), then the prepared
//     print (PP), supporting files (S) and the LICENSE.txt Thingport writes (L), each by its folder and name, and
//     "(missing)" after one the disk doesn't hold ("pp" is a file kept as a prepared print the model doesn't use);
//   "✕ <answer>": what the way in refused, with its status and message;
//   "left: <files>": what it set aside and named: the consume folder's "Not imported", a zip job's failures.
// A file the way in took and no line names was dropped.

export type Family = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "L" | "Z";

export type Way =
  | "upload"
  | "upload-separate"
  | "mcp-upload"
  | "consume-files"
  | "consume-folders"
  | "add-plates"
  | "add-file"
  | "mcp-add"
  | "site"
  | "repair"
  | "copy"
  | "link"
  | "zip-link"
  | "zip-entries";

/** The files of each shape, by path. */
export const SHAPES = {
  /** One model file. */
  "1": { "Benchy.stl": null },
  /** Several, in the order picked. */
  "2": { "Lid.stl": null, "Base.3mf": null },
  /** Model files and documents. */
  "3": { "Frog.stl": null, "Assembly.pdf": null, "notes.txt": null },
  /** Folders that each hold a model, with documents and pictures in subfolders. */
  "4": { "Frog/frog.stl": null, "Frog/docs/guide.pdf": null, "Frog/photos/a.jpg": null, "Vase/vase.stl": null },
  /** One design spread over sibling folders. */
  "4b": {
    "Model/STL/body.stl": null,
    "Model/STL/lid.stl": null,
    "Model/Images/photo.jpg": null,
    "Model/readme.pdf": null,
  },
  /** Documents only. */
  "5": { "Manual.pdf": null, "readme.txt": null },
  /** An OpenSCAD script only. */
  "6": { "box.scad": null },
  /** CAD sources only (not STEP, which is a model file). */
  "7": { "Bracket.f3d": null, "Clamp.iges": null },
  /** Sliced files only: a sliced 3MF and a G-code. */
  "8": { "Benchy.gcode.3mf": null, "Tower.gcode": null },
  /** A model file with three sliced files. */
  "9": { "Benchy.stl": null, "Benchy.gcode.3mf": null, "Benchy_PLA.gcode": null, "Benchy_PETG.gcode": null },
  /** Pictures only. */
  "10": { "photo.png": null, "art.svg": null },
  /** A model file and a picture. */
  "10b": { "Vase.stl": null, "photo.jpg": null },
  /** A zip holding a folder of model files, another zip and a licence. */
  "11": { "Design.zip": { "stl/body.stl": null, "source.zip": { "body.f3d": null }, "LICENSE.txt": null } },
  /** A glTF scene: the scene, the buffer it names and a texture. */
  "12": { "scene.gltf": null, "scene.bin": null, "textures/wood.png": null },
  /** A model file and its creator's licence. */
  "13": { "Frog.stl": null, "LICENSE.txt": null },
  /** A model file and the system files a copy from another computer brings. */
  "14": { "Frog.stl": null, "__MACOSX/._Frog.stl": null, ".DS_Store": null, "Thumbs.db": null, "desktop.ini": null },
  /** A model file and one whose name ends in a space, which some tools leave and no file system shows. */
  "15": { "Benchy.stl": null, "part.STL ": null },
} satisfies Record<string, FileTree>;

/** What a link (family L) points at. A page lists links to its other files, in this order. */
export const LINKS = {
  mesh: { "Benchy.stl": null },
  laser: { "Sign.lbrn2": null },
  "sliced-3mf": { "Benchy.gcode.3mf": null },
  gcode: { "Benchy.gcode": null },
  bgcode: { "Benchy.bgcode": null },
  script: { "box.scad": null },
  cad: { "Bracket.f3d": null },
  document: { "Manual.pdf": null },
  picture: { "photo.png": null },
  gltf: { "scene.gltf": null },
  zip: { "Design.zip": { "Frog.stl": null, "Assembly.pdf": null } },
  page: { "index.html": null, "Manual.pdf": null, "Benchy.stl": null },
} satisfies Record<string, FileTree>;

/** The steps of the supporting-files work expected to change cells, by name. */
export const STEP = {
  whole: "a new model is stored whole or not at all",
  addFiles: "add, rename and remove a model's files, one request each",
  manage: "manage supporting files on the model page and in Edit model",
  alone: "keep designs that are only scripts, CAD or sliced files",
  siteFiles: "imports keep a site's other files",
  serverPlans: "the server plans how folders, zips and the consume folder become models",
} as const;

export type Case = {
  family: Family;
  /** A key of SHAPES, or of LINKS for family L. */
  shape: string;
  way: Way;
  today: string[];
  changes?: (typeof STEP)[keyof typeof STEP][];
};

// One cell a line, so a pull request's diff here is exactly the cells it changes.
// prettier-ignore
export const CASES: Case[] = [
  // A: one model from the user's own files. An upload (several files go as one model, as the web app's
  // "one model" choice and the SDK's models.create send them) and MCP upload_model.
  { family: "A", shape: "1", way: "upload", today: ["Benchy: P Benchy.stl"] },
  { family: "A", shape: "2", way: "upload", today: ["Lid: P Lid.stl, P Base.3mf"] },
  { family: "A", shape: "3", way: "upload", today: ["Frog: P Frog.stl, S Assembly.pdf, S notes.txt"] },
  { family: "A", shape: "5", way: "upload", today: ["Manual: P Manual.pdf, P readme.txt"], changes: [STEP.alone] },
  { family: "A", shape: "6", way: "upload", today: ["✕ 400 A generator script needs a model to go with: it holds no shape of its own"], changes: [STEP.alone] },
  { family: "A", shape: "7", way: "upload", today: ["Bracket: P Bracket.f3d, P Clamp.iges"], changes: [STEP.alone] },
  { family: "A", shape: "8", way: "upload", today: ["Benchy.gcode: P Benchy.gcode.3mf, PP Tower.gcode"], changes: [STEP.alone] },
  { family: "A", shape: "9", way: "upload", today: ["Benchy: P Benchy.stl, P Benchy.gcode.3mf, PP Benchy_PETG.gcode"], changes: [STEP.whole] },
  { family: "A", shape: "10", way: "upload", today: ["photo: P photo.png, P art.svg"], changes: [STEP.alone] },
  { family: "A", shape: "10b", way: "upload", today: ["Vase: P Vase.stl, S photo.jpg"], changes: [STEP.alone] },
  { family: "A", shape: "11", way: "upload", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "A", shape: "12", way: "upload", today: ["scene: P scene.glb"] },
  { family: "A", shape: "13", way: "upload", today: ["Frog: P Frog.stl, S LICENSE.txt"], changes: [STEP.addFiles] },
  { family: "A", shape: "14", way: "upload", today: ["Frog: P Frog.stl"] },
  { family: "A", shape: "15", way: "upload", today: ["Benchy: P Benchy.stl, P part.STL"] },
  { family: "A", shape: "1", way: "mcp-upload", today: ["Benchy: P Benchy.stl"] },
  { family: "A", shape: "2", way: "mcp-upload", today: ["Lid: P Lid.stl, P Base.3mf"] },
  { family: "A", shape: "3", way: "mcp-upload", today: ["Frog: P Frog.stl, S Assembly.pdf, S notes.txt"] },
  { family: "A", shape: "5", way: "mcp-upload", today: ["Manual: P Manual.pdf, P readme.txt"], changes: [STEP.alone] },
  { family: "A", shape: "6", way: "mcp-upload", today: ["✕ A generator script needs a model to go with: it holds no shape of its own"], changes: [STEP.alone] },
  { family: "A", shape: "7", way: "mcp-upload", today: ["Bracket: P Bracket.f3d, P Clamp.iges"], changes: [STEP.alone] },
  { family: "A", shape: "8", way: "mcp-upload", today: ["Benchy.gcode: P Benchy.gcode.3mf, PP Tower.gcode"], changes: [STEP.alone] },
  { family: "A", shape: "9", way: "mcp-upload", today: ["Benchy: P Benchy.stl, P Benchy.gcode.3mf, PP Benchy_PETG.gcode"], changes: [STEP.whole] },
  { family: "A", shape: "10", way: "mcp-upload", today: ["photo: P photo.png, P art.svg"], changes: [STEP.alone] },
  { family: "A", shape: "10b", way: "mcp-upload", today: ["Vase: P Vase.stl, S photo.jpg"], changes: [STEP.alone] },
  { family: "A", shape: "11", way: "mcp-upload", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "A", shape: "12", way: "mcp-upload", today: ["scene: P scene.glb"] },
  { family: "A", shape: "13", way: "mcp-upload", today: ["Frog: P Frog.stl, S LICENSE.txt"], changes: [STEP.addFiles] },
  { family: "A", shape: "14", way: "mcp-upload", today: ["Frog: P Frog.stl, P ._Frog.stl, S .DS_Store, S Thumbs.db, S desktop.ini"], changes: [STEP.serverPlans] },
  { family: "A", shape: "15", way: "mcp-upload", today: ["Benchy: P Benchy.stl, P part.STL"] },

  // B: a model per folder: the consume folder in folder mode, with each design in a folder of its own. The
  // web app's folder upload plans its folders in the browser: uploadTree.test.ts.
  { family: "B", shape: "1", way: "consume-folders", today: ["Design: P Benchy.stl"] },
  { family: "B", shape: "2", way: "consume-folders", today: ["Design: P Base.3mf, P Lid.stl"] },
  { family: "B", shape: "3", way: "consume-folders", today: ["Design: P Frog.stl, S Assembly.pdf, S notes.txt"] },
  { family: "B", shape: "4", way: "consume-folders", today: ["Frog: P frog.stl", "a (in Frog/photos): P a.jpg", "Vase: P vase.stl", "left: Frog/docs/guide.pdf"], changes: [STEP.serverPlans] },
  { family: "B", shape: "4b", way: "consume-folders", today: ["photo (in Model/Images): P photo.jpg", "STL (in Model): P body.stl, P lid.stl", "left: Model/readme.pdf"], changes: [STEP.alone] },
  { family: "B", shape: "5", way: "consume-folders", today: ["left: Design/Manual.pdf, Design/readme.txt"] },
  { family: "B", shape: "6", way: "consume-folders", today: ["left: Design/box.scad"], changes: [STEP.serverPlans] },
  { family: "B", shape: "7", way: "consume-folders", today: ["Bracket (in Design): P Bracket.f3d", "left: Design/Clamp.iges"], changes: [STEP.serverPlans] },
  { family: "B", shape: "8", way: "consume-folders", today: ["Design: P Benchy.gcode.3mf, PP Tower.gcode"], changes: [STEP.serverPlans] },
  { family: "B", shape: "9", way: "consume-folders", today: ["Design: P Benchy.gcode.3mf, P Benchy.stl, PP Benchy_PLA.gcode"], changes: [STEP.whole] },
  { family: "B", shape: "10", way: "consume-folders", today: ["art (in Design): P art.svg", "photo (in Design): P photo.png"], changes: [STEP.alone] },
  { family: "B", shape: "10b", way: "consume-folders", today: ["Design: P Vase.stl, 1 photo"] },
  { family: "B", shape: "11", way: "consume-folders", today: ["stl (in Design/Design): P body.stl", "source (in Design/Design): P source.zip", "left: Design/Design/LICENSE.txt"], changes: [STEP.serverPlans] },
  { family: "B", shape: "12", way: "consume-folders", today: ["Design: P scene.glb"] },
  { family: "B", shape: "13", way: "consume-folders", today: ["Design: P Frog.stl, S LICENSE.txt"], changes: [STEP.addFiles] },
  { family: "B", shape: "14", way: "consume-folders", today: ["Design: P Frog.stl"] },
  { family: "B", shape: "15", way: "consume-folders", today: ["Design: P Benchy.stl, P part.STL"] },

  // C: a model per file: an upload of separate files (the web app sends one request per file instead,
  // planned in the browser: uploadTree.test.ts), and the consume folder in file mode.
  { family: "C", shape: "1", way: "upload-separate", today: ["Benchy: P Benchy.stl"] },
  { family: "C", shape: "2", way: "upload-separate", today: ["Lid: P Lid.stl", "Base: P Base.3mf"] },
  { family: "C", shape: "3", way: "upload-separate", today: ["Frog: P Frog.stl", "Assembly: P Assembly.pdf", "notes: P notes.txt"], changes: [STEP.alone] },
  { family: "C", shape: "5", way: "upload-separate", today: ["Manual: P Manual.pdf", "readme: P readme.txt"], changes: [STEP.alone] },
  { family: "C", shape: "6", way: "upload-separate", today: ["✕ 400 A generator script needs a model to go with: it holds no shape of its own"], changes: [STEP.alone] },
  { family: "C", shape: "7", way: "upload-separate", today: ["Bracket: P Bracket.f3d", "Clamp: P Clamp.iges"], changes: [STEP.alone] },
  { family: "C", shape: "8", way: "upload-separate", today: ["Benchy.gcode: P Benchy.gcode.3mf", "Tower: P Tower.gcode"] },
  { family: "C", shape: "9", way: "upload-separate", today: ["Benchy: P Benchy.stl", "Benchy.gcode: P Benchy.gcode.3mf", "Benchy_PLA: P Benchy_PLA.gcode", "Benchy_PETG: P Benchy_PETG.gcode"] },
  { family: "C", shape: "10", way: "upload-separate", today: ["photo: P photo.png", "art: P art.svg"], changes: [STEP.alone] },
  { family: "C", shape: "10b", way: "upload-separate", today: ["Vase: P Vase.stl", "photo: P photo.jpg"], changes: [STEP.alone] },
  { family: "C", shape: "11", way: "upload-separate", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "C", shape: "12", way: "upload-separate", today: ["✕ 400 scene.gltf needs scene.bin, which wasn't uploaded with it"], changes: [STEP.serverPlans] },
  { family: "C", shape: "13", way: "upload-separate", today: ["Frog: P Frog.stl", "LICENSE: P LICENSE.txt"], changes: [STEP.alone] },
  { family: "C", shape: "14", way: "upload-separate", today: ["Frog: P Frog.stl"] },
  { family: "C", shape: "15", way: "upload-separate", today: ["Benchy: P Benchy.stl", "part: P part.STL"] },
  { family: "C", shape: "1", way: "consume-files", today: ["Benchy: P Benchy.stl"] },
  { family: "C", shape: "2", way: "consume-files", today: ["Base: P Base.3mf", "Lid: P Lid.stl"] },
  { family: "C", shape: "3", way: "consume-files", today: ["Frog: P Frog.stl", "left: Assembly.pdf, notes.txt"] },
  { family: "C", shape: "5", way: "consume-files", today: ["left: Manual.pdf, readme.txt"] },
  { family: "C", shape: "6", way: "consume-files", today: ["left: box.scad"], changes: [STEP.serverPlans] },
  { family: "C", shape: "7", way: "consume-files", today: ["Bracket: P Bracket.f3d", "left: Clamp.iges"], changes: [STEP.serverPlans] },
  { family: "C", shape: "8", way: "consume-files", today: ["Benchy.gcode: P Benchy.gcode.3mf", "left: Tower.gcode"], changes: [STEP.serverPlans] },
  { family: "C", shape: "9", way: "consume-files", today: ["Benchy.gcode: P Benchy.gcode.3mf", "Benchy: P Benchy.stl", "left: Benchy_PETG.gcode, Benchy_PLA.gcode"], changes: [STEP.serverPlans] },
  { family: "C", shape: "10", way: "consume-files", today: ["art: P art.svg", "photo: P photo.png"], changes: [STEP.alone] },
  { family: "C", shape: "10b", way: "consume-files", today: ["Vase: P Vase.stl", "photo: P photo.jpg"], changes: [STEP.alone] },
  { family: "C", shape: "11", way: "consume-files", today: ["body (in Design/stl): P body.stl", "source (in Design): P source.zip", "left: Design/LICENSE.txt"], changes: [STEP.serverPlans] },
  { family: "C", shape: "12", way: "consume-files", today: ["scene: P scene.glb"] },
  { family: "C", shape: "13", way: "consume-files", today: ["Frog: P Frog.stl", "left: LICENSE.txt"] },
  { family: "C", shape: "14", way: "consume-files", today: ["Frog: P Frog.stl"] },
  { family: "C", shape: "15", way: "consume-files", today: ["Benchy: P Benchy.stl", "part: P part.STL"] },
  { family: "C", shape: "4", way: "consume-files", today: ["frog (in Frog): P frog.stl", "a (in Frog/photos): P a.jpg", "vase (in Vase): P vase.stl", "left: Frog/docs/guide.pdf"], changes: [STEP.serverPlans] },

  // D: added to a model that has Base.stl: Edit model's Add files and the SDK's addFiles (POST /print/:id/plates),
  // one file at a time (POST /print/:id/files), and MCP add_model_files.
  { family: "D", shape: "1", way: "add-plates", today: ["Base: P Base.stl, P Benchy.stl"] },
  { family: "D", shape: "2", way: "add-plates", today: ["Base: P Base.stl, P Lid.stl, P Base.3mf"] },
  { family: "D", shape: "3", way: "add-plates", today: ["Base: P Base.stl, P Frog.stl, P Assembly.pdf, P notes.txt"], changes: [STEP.addFiles] },
  { family: "D", shape: "5", way: "add-plates", today: ["Base: P Base.stl, P Manual.pdf, P readme.txt"], changes: [STEP.addFiles] },
  { family: "D", shape: "6", way: "add-plates", today: ["Base: P Base.stl, P box.scad"], changes: [STEP.addFiles] },
  { family: "D", shape: "7", way: "add-plates", today: ["Base: P Base.stl, P Bracket.f3d, P Clamp.iges"], changes: [STEP.addFiles] },
  { family: "D", shape: "8", way: "add-plates", today: ["Base: P Base.stl, P Benchy.gcode.3mf, P Tower.gcode"], changes: [STEP.addFiles] },
  { family: "D", shape: "9", way: "add-plates", today: ["Base: P Base.stl, P Benchy.stl, P Benchy.gcode.3mf, P Benchy_PLA.gcode, P Benchy_PETG.gcode"], changes: [STEP.addFiles] },
  { family: "D", shape: "10", way: "add-plates", today: ["Base: P Base.stl, P photo.png, P art.svg"], changes: [STEP.addFiles] },
  { family: "D", shape: "11", way: "add-plates", today: ["Base: P Base.stl, P Design.zip"], changes: [STEP.addFiles] },
  { family: "D", shape: "12", way: "add-plates", today: ["Base: P Base.stl, P scene.gltf, P scene.bin, P wood.png"], changes: [STEP.addFiles] },
  { family: "D", shape: "13", way: "add-plates", today: ["Base: P Base.stl, P Frog.stl, P LICENSE.txt"], changes: [STEP.addFiles] },
  { family: "D", shape: "14", way: "add-plates", today: ["Base: P Base.stl, P Frog.stl, P ._Frog.stl, P .DS_Store, P Thumbs.db, P desktop.ini"], changes: [STEP.manage] },
  { family: "D", shape: "15", way: "add-plates", today: ["Base: P Base.stl, P Benchy.stl, P part.STL"] },
  { family: "D", shape: "1", way: "add-file", today: ["Base: P Base.stl, S Benchy.stl"], changes: [STEP.addFiles] },
  { family: "D", shape: "2", way: "add-file", today: ["Base: P Base.stl, S Base.3mf, S Lid.stl"], changes: [STEP.addFiles] },
  { family: "D", shape: "3", way: "add-file", today: ["Base: P Base.stl, S Assembly.pdf, S Frog.stl, S notes.txt"], changes: [STEP.addFiles] },
  { family: "D", shape: "5", way: "add-file", today: ["Base: P Base.stl, S Manual.pdf, S readme.txt"] },
  { family: "D", shape: "6", way: "add-file", today: ["Base: P Base.stl, S box.scad"] },
  { family: "D", shape: "7", way: "add-file", today: ["Base: P Base.stl, S Bracket.f3d, S Clamp.iges"] },
  { family: "D", shape: "8", way: "add-file", today: ["Base: P Base.stl, PP Tower.gcode"], changes: [STEP.addFiles] },
  { family: "D", shape: "9", way: "add-file", today: ["Base: P Base.stl, PP Benchy_PETG.gcode, S Benchy.stl"], changes: [STEP.addFiles] },
  { family: "D", shape: "10", way: "add-file", today: ["Base: P Base.stl, S art.svg, S photo.png"] },
  { family: "D", shape: "11", way: "add-file", today: ["Base: P Base.stl, S Design.zip"] },
  { family: "D", shape: "12", way: "add-file", today: ["Base: P Base.stl, S scene.bin, S scene.gltf, S wood.png"], changes: [STEP.addFiles] },
  { family: "D", shape: "13", way: "add-file", today: ["Base: P Base.stl, S Frog.stl, S LICENSE.txt"], changes: [STEP.addFiles] },
  { family: "D", shape: "14", way: "add-file", today: ["Base: P Base.stl, S .DS_Store, S ._Frog.stl, S Frog.stl, S Thumbs.db, S desktop.ini"], changes: [STEP.addFiles] },
  { family: "D", shape: "15", way: "add-file", today: ["Base: P Base.stl, S Benchy.stl, S part.STL"], changes: [STEP.addFiles] },
  { family: "D", shape: "1", way: "mcp-add", today: ["Base: P Base.stl, P Benchy.stl"] },
  { family: "D", shape: "2", way: "mcp-add", today: ["Base: P Base.stl, P Lid.stl, P Base.3mf"] },
  { family: "D", shape: "3", way: "mcp-add", today: ["Base: P Base.stl, P Frog.stl, S Assembly.pdf, S notes.txt"] },
  { family: "D", shape: "5", way: "mcp-add", today: ["Base: P Base.stl, S Manual.pdf, S readme.txt"] },
  { family: "D", shape: "6", way: "mcp-add", today: ["Base: P Base.stl, S box.scad"] },
  { family: "D", shape: "7", way: "mcp-add", today: ["Base: P Base.stl, S Bracket.f3d, S Clamp.iges"] },
  { family: "D", shape: "8", way: "mcp-add", today: ["Base: P Base.stl, PP Tower.gcode"], changes: [STEP.addFiles] },
  { family: "D", shape: "9", way: "mcp-add", today: ["Base: P Base.stl, P Benchy.stl, PP Benchy_PETG.gcode"], changes: [STEP.addFiles] },
  { family: "D", shape: "10", way: "mcp-add", today: ["Base: P Base.stl, S art.svg, S photo.png"] },
  { family: "D", shape: "11", way: "mcp-add", today: ["Base: P Base.stl, S Design.zip"] },
  { family: "D", shape: "12", way: "mcp-add", today: ["Base: P Base.stl, P scene.glb"] },
  { family: "D", shape: "13", way: "mcp-add", today: ["Base: P Base.stl, P Frog.stl, S LICENSE.txt"], changes: [STEP.addFiles] },
  { family: "D", shape: "14", way: "mcp-add", today: ["Base: P Base.stl, P Frog.stl, P ._Frog.stl, S .DS_Store, S Thumbs.db, S desktop.ini"], changes: [STEP.addFiles] },
  { family: "D", shape: "15", way: "mcp-add", today: ["Base: P Base.stl, P Benchy.stl, P part.STL"] },

  // E: a site's page, one model per page: a Thing on Thingiverse, which lists its files by name.
  { family: "E", shape: "1", way: "site", today: ["Thing: P Benchy.stl, 2 photos"] },
  { family: "E", shape: "2", way: "site", today: ["Thing: P Lid.stl, P Base.3mf, 2 photos"] },
  { family: "E", shape: "3", way: "site", today: ["Thing: P Frog.stl, 2 photos"], changes: [STEP.siteFiles] },
  { family: "E", shape: "5", way: "site", today: ["✕ 400 None of this Thing's files could be downloaded."], changes: [STEP.alone] },
  { family: "E", shape: "6", way: "site", today: ["✕ 400 A generator script needs a model to go with: it holds no shape of its own"], changes: [STEP.alone] },
  { family: "E", shape: "7", way: "site", today: ["✕ 400 None of this Thing's files could be downloaded."], changes: [STEP.alone] },
  { family: "E", shape: "8", way: "site", today: ["Thing: P Benchy.gcode.3mf, 2 photos"], changes: [STEP.alone] },
  { family: "E", shape: "9", way: "site", today: ["Thing: P Benchy.stl, P Benchy.gcode.3mf, 2 photos"], changes: [STEP.siteFiles] },
  { family: "E", shape: "10", way: "site", today: ["✕ 400 None of this Thing's files could be downloaded."] },
  { family: "E", shape: "10b", way: "site", today: ["Thing: P Vase.stl, 2 photos"], changes: [STEP.siteFiles] },
  { family: "E", shape: "11", way: "site", today: ["✕ 400 None of this Thing's files could be downloaded."], changes: [STEP.siteFiles] },
  { family: "E", shape: "12", way: "site", today: ["✕ 400 None of this Thing's files could be downloaded."], changes: [STEP.siteFiles] },
  { family: "E", shape: "13", way: "site", today: ["Thing: P Frog.stl, 2 photos"], changes: [STEP.siteFiles] },
  { family: "E", shape: "14", way: "site", today: ["Thing: P Frog.stl, P ._Frog.stl, 2 photos"], changes: [STEP.siteFiles] },
  { family: "E", shape: "15", way: "site", today: ["Thing: P Benchy.stl, P part.STL, 2 photos"] },

  // F: repair: a model imported from its site with its licence, and a text file and a sliced print its owner added,
  // whose plates' files and LICENSE.txt are gone from the disk, downloaded again (Repair, "Download the missing files
  // again").
  { family: "F", shape: "1", way: "repair", today: ["Thing: P Benchy.stl, L LICENSE.txt, PP My print.gcode, S My notes.txt, 2 photos"] },
  { family: "F", shape: "2", way: "repair", today: ["Thing: P Lid.stl, P Base.3mf, L LICENSE.txt, PP My print.gcode, S My notes.txt, 2 photos"] },
  { family: "F", shape: "3", way: "repair", today: ["Thing: P Frog.stl, L LICENSE.txt, PP My print.gcode, S My notes.txt, 2 photos"], changes: [STEP.siteFiles] },
  { family: "F", shape: "8", way: "repair", today: ["Thing: P Benchy.gcode.3mf, L LICENSE.txt, PP My print.gcode, S My notes.txt, 2 photos"], changes: [STEP.alone] },
  { family: "F", shape: "9", way: "repair", today: ["Thing: P Benchy.stl, P Benchy.gcode.3mf, L LICENSE.txt, PP My print.gcode, S My notes.txt, 2 photos"], changes: [STEP.siteFiles] },
  { family: "F", shape: "12", way: "repair", today: ["✕ import: 400 None of this Thing's files could be downloaded."], changes: [STEP.siteFiles] },
  { family: "F", shape: "13", way: "repair", today: ["Thing: P Frog.stl, L LICENSE.txt, PP My print.gcode, S My notes.txt, 2 photos"], changes: [STEP.siteFiles] },
  { family: "F", shape: "14", way: "repair", today: ["Thing: P Frog.stl, P ._Frog.stl, L LICENSE.txt, PP My print.gcode, S My notes.txt, 2 photos"], changes: [STEP.siteFiles] },

  // G: a copy of another user's model from their public collection; the model is their upload of the files.
  { family: "G", shape: "1", way: "copy", today: ["Benchy: P Benchy.stl"] },
  { family: "G", shape: "2", way: "copy", today: ["Lid: P Lid.stl, P Base.3mf"] },
  { family: "G", shape: "3", way: "copy", today: ["Frog: P Frog.stl, S Assembly.pdf, S notes.txt"] },
  { family: "G", shape: "5", way: "copy", today: ["Manual: P Manual.pdf, P readme.txt"], changes: [STEP.alone] },
  { family: "G", shape: "6", way: "copy", today: ["✕ upload: 400 A generator script needs a model to go with: it holds no shape of its own"], changes: [STEP.alone] },
  { family: "G", shape: "7", way: "copy", today: ["Bracket: P Bracket.f3d, P Clamp.iges"], changes: [STEP.alone] },
  { family: "G", shape: "8", way: "copy", today: ["Benchy.gcode: P Benchy.gcode.3mf, PP Tower.gcode"] },
  { family: "G", shape: "9", way: "copy", today: ["Benchy: P Benchy.stl, P Benchy.gcode.3mf, PP Benchy_PETG.gcode"], changes: [STEP.whole] },
  { family: "G", shape: "10", way: "copy", today: ["photo: P photo.png, P art.svg"], changes: [STEP.alone] },
  { family: "G", shape: "10b", way: "copy", today: ["Vase: P Vase.stl, S photo.jpg"], changes: [STEP.alone] },
  { family: "G", shape: "11", way: "copy", today: ["Design: P Design.zip"] },
  { family: "G", shape: "12", way: "copy", today: ["scene: P scene.glb"] },
  { family: "G", shape: "13", way: "copy", today: ["Frog: P Frog.stl, S LICENSE.txt"], changes: [STEP.addFiles] },
  { family: "G", shape: "14", way: "copy", today: ["Frog: P Frog.stl"] },
  { family: "G", shape: "15", way: "copy", today: ["Benchy: P Benchy.stl, P part.STL"] },

  // L: a link to one file, or to a page that links files: POST /import, as the web app, MCP import_model, the
  // queue and the bookmarklet send it.
  { family: "L", shape: "mesh", way: "link", today: ["Benchy: P Benchy.stl"] },
  { family: "L", shape: "laser", way: "link", today: ["Sign: P Sign.lbrn2"] },
  { family: "L", shape: "sliced-3mf", way: "link", today: ["Benchy.gcode: P Benchy.gcode.3mf"] },
  { family: "L", shape: "gcode", way: "link", today: ["✕ 415 Unsupported file type: .gcode"], changes: [STEP.alone] },
  { family: "L", shape: "bgcode", way: "link", today: ["✕ 415 Unsupported file type: .bgcode"], changes: [STEP.alone] },
  { family: "L", shape: "script", way: "link", today: ["✕ 415 Unsupported file type: .scad"], changes: [STEP.alone] },
  { family: "L", shape: "cad", way: "link", today: ["✕ 415 Unsupported file type: .f3d"], changes: [STEP.alone] },
  { family: "L", shape: "document", way: "link", today: ["✕ 415 Unsupported file type: .pdf"], changes: [STEP.alone] },
  { family: "L", shape: "picture", way: "link", today: ["✕ 415 Unsupported file type: .png"], changes: [STEP.alone] },
  { family: "L", shape: "gltf", way: "link", today: ["✕ 415 Unsupported file type: .gltf"] },
  { family: "L", shape: "zip", way: "link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "L", shape: "page", way: "link", today: ["Benchy: P Benchy.stl"] },

  // Z: a link to a zip holding the shape's files: imported as it is (POST /import), or with every entry
  // ticked (POST /import/zip, as Grab's "Choose files" sends it).
  { family: "Z", shape: "1", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "2", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "3", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "5", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "6", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "7", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "8", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "9", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "10", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "10b", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "11", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "12", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "13", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "14", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "15", way: "zip-link", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "1", way: "zip-entries", today: ["Benchy: P Benchy.stl"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "2", way: "zip-entries", today: ["Base: P Base.3mf", "Lid: P Lid.stl"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "3", way: "zip-entries", today: ["Assembly: P Assembly.pdf", "Frog: P Frog.stl", "notes: P notes.txt"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "5", way: "zip-entries", today: ["Manual: P Manual.pdf", "readme: P readme.txt"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "6", way: "zip-entries", today: ["left: 1 of 1 entries failed"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "7", way: "zip-entries", today: ["Bracket: P Bracket.f3d", "Clamp: P Clamp.iges"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "8", way: "zip-entries", today: ["Benchy.gcode: P Benchy.gcode.3mf", "Tower: P Tower.gcode"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "9", way: "zip-entries", today: ["Benchy.gcode: P Benchy.gcode.3mf", "Benchy: P Benchy.stl", "Benchy_PETG: P Benchy_PETG.gcode", "Benchy_PLA: P Benchy_PLA.gcode"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "10", way: "zip-entries", today: ["art: P art.svg", "photo: P photo.png"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "10b", way: "zip-entries", today: ["Vase: P Vase.stl", "photo: P photo.jpg"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "11", way: "zip-entries", today: ["Design: P Design.zip"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "12", way: "zip-entries", today: ["scene: P scene.bin", "scene (2): P scene.gltf", "wood (in textures): P wood.png"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "13", way: "zip-entries", today: ["Frog: P Frog.stl", "LICENSE: P LICENSE.txt"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "14", way: "zip-entries", today: ["Frog: P Frog.stl"], changes: [STEP.serverPlans] },
  { family: "Z", shape: "15", way: "zip-entries", today: ["Benchy: P Benchy.stl", "part: P part.STL"], changes: [STEP.serverPlans] },
];

export const caseName = (cell: Case) => `${cell.family}${cell.shape} ${cell.way}`;

/** A family B design is a folder: a shape's files go in one, named Design, unless the shape is its folders. */
function inFolder(tree: FileTree, folder: string): FileTree {
  return Object.fromEntries(Object.entries(tree).map(([name, inner]) => [`${folder}/${name}`, inner]));
}

export function treeOf(cell: Case): FileTree {
  if (cell.family === "L") return LINKS[cell.shape as keyof typeof LINKS];
  const shape: FileTree = SHAPES[cell.shape as keyof typeof SHAPES];
  if (cell.family === "Z") return { "Design.zip": shape };
  if (cell.family === "B" && !["4", "4b"].includes(cell.shape)) return inFolder(shape, "Design");
  return shape;
}
