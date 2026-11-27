import type { Plate } from "../../api/prints";
import { plateCaps } from "../fileCaps";

// What "Generate pictures" places a model in: the backgrounds, the camera angles and the colours a model without
// colours of its own can be printed in. The files are in public/scenes (README there credits them).

export type SceneId = "oak-desk" | "workbench" | "plywood" | "white-oak" | "walnut" | "leather" | "wool" | "studio";
export type AngleId = "hero" | "side" | "top";

export type SceneDef = {
  id: SceneId;
  /** A photo-scanned surface, by its folder and its real width in millimetres; none for the studio's plain floor. */
  surface: { folder: string; sizeMm: number } | null;
  /** The room it's lit by, and how far the room is turned (radians) to light it from a good side. */
  light: string;
  lightTurn: number;
};

export const SCENES: SceneDef[] = [
  { id: "white-oak", surface: { folder: "white-oak", sizeMm: 500 }, light: "lebombo", lightTurn: 3.4 },
  { id: "oak-desk", surface: { folder: "oak-desk", sizeMm: 1500 }, light: "artist_workshop", lightTurn: 0.6 },
  { id: "walnut", surface: { folder: "walnut", sizeMm: 1000 }, light: "brown_photostudio_02", lightTurn: 1.2 },
  { id: "plywood", surface: { folder: "plywood", sizeMm: 500 }, light: "artist_workshop", lightTurn: 1.6 },
  { id: "workbench", surface: { folder: "workbench", sizeMm: 550 }, light: "artist_workshop", lightTurn: 2.2 },
  { id: "leather", surface: { folder: "leather", sizeMm: 400 }, light: "brown_photostudio_02", lightTurn: 2.6 },
  { id: "wool", surface: { folder: "wool", sizeMm: 270 }, light: "lebombo", lightTurn: 2.4 },
  { id: "studio", surface: null, light: "studio_small_09", lightTurn: 0 },
];

export type AngleDef = { id: AngleId; azimuth: number; elevation: number; distance: number };

/** Degrees round from the front and up from the surface; `distance` is in the model's radii. */
export const ANGLES: AngleDef[] = [
  { id: "hero", azimuth: 30, elevation: 32, distance: 3.2 },
  { id: "side", azimuth: -60, elevation: 14, distance: 3.4 },
  { id: "top", azimuth: 8, elevation: 76, distance: 2.9 },
];

/** Filament colours for a model whose file has none. These are the print's colour, not the app's, so not the theme's. */
export const FILAMENT_COLOURS = [
  { id: "white", hex: "#ecebe6" },
  { id: "grey", hex: "#8f9196" },
  { id: "black", hex: "#2a2a2c" },
  { id: "red", hex: "#c4302b" },
  { id: "orange", hex: "#e8742a" },
  { id: "yellow", hex: "#e8c234" },
  { id: "green", hex: "#3c9d52" },
  { id: "blue", hex: "#2f62c2" },
] as const;

export type FilamentColour = (typeof FILAMENT_COLOURS)[number]["id"];
/** "own" is the file's own colours, where it has any. */
export type ColourChoice = FilamentColour | "own";

export type Shot = { angle: AngleId; scene: SceneId };

/** Three pictures, each from its own angle on its own background. */
export const DEFAULT_SHOTS: Shot[] = [
  { angle: "hero", scene: "white-oak" },
  { angle: "side", scene: "leather" },
  { angle: "top", scene: "wool" },
];

export const MAX_SHOTS = 6;

const SCENE_IDS = new Set<string>(SCENES.map((scene) => scene.id));
const ANGLE_IDS = new Set<string>(ANGLES.map((angle) => angle.id));

export function sceneById(id: SceneId): SceneDef {
  return SCENES.find((scene) => scene.id === id) ?? SCENES[0];
}

export function angleById(id: AngleId): AngleDef {
  return ANGLES.find((angle) => angle.id === id) ?? ANGLES[0];
}

export function surfaceUrl(folder: string, map: "color" | "normal" | "rough" | "swatch"): string {
  return `${import.meta.env.BASE_URL}scenes/surfaces/${folder}/${map}.webp`;
}

export function swatchUrl(scene: SceneId): string {
  return surfaceUrl(scene, "swatch");
}

export function lightUrl(light: string): string {
  return `${import.meta.env.BASE_URL}scenes/light/${light}.hdr`;
}

/** The next picture to add: an angle and a background the list doesn't have yet, where there's one left. */
export function nextShot(shots: Shot[]): Shot {
  const angles = new Set(shots.map((shot) => shot.angle));
  const scenes = new Set(shots.map((shot) => shot.scene));
  const angle = ANGLES.find((a) => !angles.has(a.id))?.id ?? ANGLES[shots.length % ANGLES.length].id;
  const scene = SCENES.find((s) => !scenes.has(s.id))?.id ?? SCENES[shots.length % SCENES.length].id;
  return { angle, scene };
}

/** A shot list read back from storage: unknown ids dropped, at most MAX_SHOTS; the defaults when nothing's left. */
export function cleanShots(value: unknown): Shot[] {
  if (!Array.isArray(value)) return DEFAULT_SHOTS;
  const shots = value
    .filter(
      (shot): shot is Shot =>
        Boolean(shot) &&
        typeof shot === "object" &&
        ANGLE_IDS.has((shot as Shot).angle) &&
        SCENE_IDS.has((shot as Shot).scene),
    )
    .map(({ angle, scene }) => ({ angle, scene }))
    .slice(0, MAX_SHOTS);
  return shots.length ? shots : DEFAULT_SHOTS;
}

const STORAGE_KEY = "thingport_scene_picture_shots";

/** The shot list last used, so the next model starts from it. Per browser; storage can be missing or refuse. */
export function rememberedShots(): Shot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? cleanShots(JSON.parse(raw)) : DEFAULT_SHOTS;
  } catch {
    return DEFAULT_SHOTS;
  }
}

export function rememberShots(shots: Shot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanShots(shots)));
  } catch {
    // Remembering is a convenience only.
  }
}

/** A generated picture's file name: the model's name, then where and how it was taken. */
export function pictureFilename(modelName: string, shot: Shot, index: number): string {
  const base =
    modelName
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "model";
  return `${base}-${shot.scene}-${shot.angle}-${index + 1}.jpg`;
}

/** Whether a model file can be pictured: what the 3D viewer draws, as the server says (plateCaps). */
export function canPicture(plate: Pick<Plate, "filename" | "caps">): boolean {
  return plateCaps(plate).preview3d;
}

const ADD_ON_SAVE_KEY = "thingport_studio_add_pictures";

/** Whether Studio's Save offers generated pictures switched on: yes, unless the person turned them off last time. */
export function addPicturesOnSave(): boolean {
  try {
    return localStorage.getItem(ADD_ON_SAVE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function rememberAddPicturesOnSave(on: boolean): void {
  try {
    localStorage.setItem(ADD_ON_SAVE_KEY, on ? "1" : "0");
  } catch {
    // Remembering is a convenience only.
  }
}
