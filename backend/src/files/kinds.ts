import table from "./kinds.json";
import { isJunk, splitName, type NormalName } from "./names";

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
