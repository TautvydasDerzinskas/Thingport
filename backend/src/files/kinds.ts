import path from "node:path";
import table from "./kinds.json";
import { isJunk, normalizeFileName, splitName, type NormalName } from "./names";

// One table of what each file is, by its name alone (kinds.json, published as docs/features/file-kinds.md by
// npm run kinds:sync). The extension sets the code used before it are views of it, in LEGACY, so each still holds
// exactly what it did.

export type Kind =
  | "mesh"
  | "laser"
  | "sliced"
  | "cad"
  | "script"
  | "picture"
  | "document"
  | "licence"
  | "archive"
  | "scene-part"
  | "cg-scene"
  | "program"
  | "junk"
  | "other";

export type KindRow = {
  kind: Kind;
  /** What the docs page calls it. */
  label: string;
  about: string;
  /** Lower case, with the dot; a compound extension (".gcode.3mf") whole. */
  extensions?: readonly string[];
  /** Whole names, for a kind told by its name rather than its extension. */
  names?: readonly string[];
};

export const KINDS: readonly KindRow[] = table as KindRow[];

const BY_EXTENSION = new Map(KINDS.flatMap((row) => (row.extensions ?? []).map((ext) => [ext, row.kind] as const)));
const BY_NAME = new Map(
  KINDS.flatMap((row) => (row.names ?? []).map((name) => [name.toLowerCase(), row.kind] as const)),
);

/** What a file is, by its name as it's kept: junk first, then a whole name, then its extension. */
export function kindOf(name: NormalName): Kind {
  if (isJunk(name)) return "junk";
  return BY_NAME.get(name.toLowerCase()) ?? BY_EXTENSION.get(splitName(name).ext.toLowerCase()) ?? "other";
}

/** A stored file's kind. A name kept before the naming rule goes through it first, which changes no other name. */
export function kindOfStored(name: string): Kind {
  return kindOf(normalizeFileName(name));
}

/** A kind's extensions. */
export function extensionsOf(kind: Kind): readonly string[] {
  return KINDS.find((row) => row.kind === kind)?.extensions ?? [];
}

/** The extension a glTF scene has, which is packed into a .glb with the files it names. */
export const PACKED_SCENE_EXTENSION = ".gltf";

const without = (exts: readonly string[], ...left: string[]) => exts.filter((ext) => !left.includes(ext));
const mesh = without(extensionsOf("mesh"), PACKED_SCENE_EXTENSION);
const photo = without(extensionsOf("picture"), ".gif", ".svg");

/**
 * The extension sets of the code before the table, each as a view of it, holding exactly what it held (pinned by
 * tests/files/kinds.test.ts). Where one strays from a kind it says how, so the next pull requests can see what they
 * change by using a kind instead.
 */
export const LEGACY = {
  /** A model file Thingport renders: every mesh but a .gltf, which is packed first. */
  renderable: new Set(mesh),
  /** What a link import takes: meshes, laser files and a zip. */
  importAllowed: new Set([...mesh, ...extensionsOf("laser"), ".zip"]),
  /** What a site's import makes plates of: the same, less the zip. */
  multiFilePlate: new Set([...mesh, ...extensionsOf("laser")]),
  /** What a site's zip is opened for: plates and scripts. */
  zipFolder: new Set([...mesh, ...extensionsOf("laser"), ...extensionsOf("script")]),
  /** The script a model is generated from. */
  parametricSource: new Set(extensionsOf("script")),
  /** What an upload makes a model of on its own: pictures, meshes, laser files, a zip, and of CAD only F3D. */
  uploadable: new Set([...extensionsOf("picture"), ...extensionsOf("mesh"), ".f3d", ...extensionsOf("laser"), ".zip"]),
  /** A sliced file, a prepared print. */
  prepared: extensionsOf("sliced"),
  /** A picture kept as a photo: a raster one, not a GIF. */
  photo: new Set(photo),
  /** What the library importer makes plates of: renderable meshes, F3D and laser files. */
  libraryPlate: new Set([...mesh, ".f3d", ...extensionsOf("laser")]),
  /** What the library importer keeps as photos: rasters and GIFs. */
  libraryImage: new Set([...photo, ".gif"]),
} as const;

/** What a file is to its model: one of its plates, a file kept beside them, or its prepared print. */
export type FileRole = "plate" | "supporting" | "prepared";

/** What the web app can do with a file, worked out here so it never offers what the server or Bridge can't. */
export type Caps = {
  /** The 3D viewer shows it, and a card can draw it. */
  preview3d: boolean;
  /** Open in slicer offers it: a mesh, laser or sliced file whose extension Bridge opens. */
  openInSlicer: boolean;
  /** Studio opens it as a new design. */
  openInStudio: boolean;
  /** Customize generates the model again from it: an OpenSCAD script. */
  customize: boolean;
  /** How the app shows it in place, where it can do so safely; null for one it only downloads (SVG and HTML among
   *  them, which could run in the page). */
  view: FileView | null;
};

/** How a file is shown in place: the browser's PDF viewer, a picture, Markdown, plain text (a script as code), or a
 *  table. */
export type FileView = "pdf" | "image" | "markdown" | "text" | "table";

/**
 * What Thingport Bridge opens: `isModelFile` in bridge/cmd/thingport-bridge/main.go, pinned by tests/files/kinds.test.ts.
 * An installed Bridge never updates itself, so nothing it refuses is offered, a .gco among them. It reads only the last
 * extension, so a .gcode.3mf goes as a .3mf.
 */
export const BRIDGE_OPENS: ReadonlySet<string> = new Set([
  ".stl",
  ".3mf",
  ".step",
  ".stp",
  ".obj",
  ".glb",
  ".gltf",
  ".f3d",
  ".lbrn",
  ".lbrn2",
  ".gcode",
  ".bgcode",
]);

const FOR_SLICERS: ReadonlySet<Kind> = new Set(["mesh", "laser", "sliced"]);

/** What shows in place, by extension: raster pictures only, as an SVG could run script in the page. */
const VIEWS: Readonly<Record<string, FileView>> = {
  ".pdf": "pdf",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".md": "markdown",
  ".txt": "text",
  ".scad": "text",
  ".csv": "table",
  ".tsv": "table",
};

/** What a file can do, by its kind, its name and what it is to its model. The 3D viewer reads a name's last extension, as
 *  Bridge does, so a sliced .gcode.3mf plate is drawn as the 3MF it also is. Junk can do nothing. */
export function capsOf(kind: Kind, name: string, role: FileRole): Caps {
  const ext = path.extname(name).toLowerCase();
  const drawn = kind !== "junk" && role === "plate" && LEGACY.renderable.has(ext);
  return {
    preview3d: drawn,
    openInSlicer: role !== "supporting" && FOR_SLICERS.has(kind) && BRIDGE_OPENS.has(ext),
    openInStudio: drawn,
    customize: kind === "script",
    view: kind === "junk" ? null : (VIEWS[ext] ?? null),
  };
}

// The pictures a browser shows by its own type.
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** How a file is sent to be shown in place: a PDF or a picture as its own type, anything else as plain text, which no
 *  browser runs. Null for one that only downloads. */
export function inlineTypeOf(name: string): { type: string; view: FileView } | null {
  const view = capsOf(kindOfStored(name), name, "supporting").view;
  if (!view) return null;
  if (view === "pdf") return { type: "application/pdf", view };
  if (view === "image") {
    const type = IMAGE_TYPES[path.extname(name).toLowerCase()];
    return type ? { type, view } : null;
  }
  return { type: "text/plain; charset=utf-8", view };
}
