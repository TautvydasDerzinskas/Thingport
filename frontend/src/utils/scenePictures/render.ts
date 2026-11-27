// Renders a model as if photographed on a surface: a photo-scanned surface at its real size under the model, lit by a
// panorama of a real room, with a soft shadow, a contact shadow where the model touches and the far table out of focus.
// One WebGL context for a dialog's whole session; textures and rooms are loaded once and kept for it.
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { buildBambuModelGroup } from "../bambuThreeMf";
import { disposeObject3D, loadBambuThreeMFForViewer, loadObjectFromAsset } from "../modelLoaders";
import { outlinePoints, placeCamera } from "./frame";
import {
  angleById,
  lightUrl,
  sceneById,
  surfaceUrl,
  FILAMENT_COLOURS,
  type ColourChoice,
  type SceneDef,
  type Shot,
} from "./scenes";

export type ScenePlate = { index: number; name: string | null };

/** A model loaded for pictures: standing on y = 0, centred, with what's needed to frame it. */
export type SceneModel = {
  root: THREE.Object3D;
  radius: number;
  height: number;
  footprint: { x: number; z: number };
  /** Points over the model's surface, to keep all of it in the frame. */
  outline: THREE.Vector3[];
  /** Whether the file gives colours of its own (a 3MF's filaments, a glTF's materials). */
  hasColour: boolean;
  /** A 3MF's plates, to choose which to picture; empty for other files. */
  plates: ScenePlate[];
  plate: number | null;
  dispose: () => void;
};

/** Loads the file at `url` (its name gives the format); for a Bambu-style 3MF, the plate given or its first. */
export async function loadSceneModel(url: string, filename: string, plate: number | null = null): Promise<SceneModel> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  let root: THREE.Object3D | null = null;
  let plates: ScenePlate[] = [];
  let chosen: number | null = null;
  let hasColour = ext === "glb";
  if (ext === "3mf") {
    const bambu = await loadBambuThreeMFForViewer(url);
    if (bambu) {
      plates = bambu.plates.map((p) => ({ index: p.index, name: p.name ?? null }));
      chosen = plate ?? plates[0]?.index ?? null;
      root = buildBambuModelGroup(bambu.parsedData, chosen, bambu.filamentColors);
      hasColour = bambu.filamentColors.some(Boolean);
    }
  }
  root ??= await loadObjectFromAsset(ext, url);
  if (!root) throw new Error(`Can't picture a .${ext} file`);

  const wrapper = new THREE.Group();
  wrapper.add(root);
  wrapper.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrapper);
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  wrapper.updateMatrixWorld(true);
  wrapper.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = materials.map((m) => {
      // Printed plastic: a soft sheen, never metal. A copy, so the loader's shared materials stay as they were.
      const copy = new THREE.MeshStandardMaterial({
        color: (m as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color("#dddddd"),
        map: (m as THREE.MeshStandardMaterial).map ?? null,
        vertexColors: Boolean((m as THREE.MeshStandardMaterial).vertexColors),
        roughness: 0.38,
        metalness: 0,
      });
      copy.userData.ownColor = copy.color.clone();
      copy.userData.ownMap = copy.map;
      copy.userData.ownVertexColors = copy.vertexColors;
      return copy;
    });
    if (mesh.material.length === 1) mesh.material = mesh.material[0];
  });
  const sized = new THREE.Box3().setFromObject(wrapper);
  const size = sized.getSize(new THREE.Vector3());
  return {
    root: wrapper,
    radius: Math.max(sized.getBoundingSphere(new THREE.Sphere()).radius, 1),
    height: size.y,
    footprint: { x: size.x, z: size.z },
    outline: outlinePoints(wrapper),
    hasColour,
    plates,
    plate: chosen,
    dispose: () => disposeObject3D(wrapper),
  };
}

/** Paints the model one filament colour, or back in its own. */
export function colourModel(model: SceneModel, choice: ColourChoice): void {
  const hex = FILAMENT_COLOURS.find((c) => c.id === choice)?.hex;
  model.root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const material = m as THREE.MeshStandardMaterial;
      if (hex) material.color.set(hex);
      else if (material.userData.ownColor) material.color.copy(material.userData.ownColor);
      // A texture would tint the filament colour, so it's only shown in the model's own colours.
      material.map = hex ? null : (material.userData.ownMap ?? null);
      material.vertexColors = !hex && Boolean(material.userData.ownVertexColors);
      material.needsUpdate = true;
    }
  });
}

type Room = { panorama: THREE.DataTexture; env: THREE.Texture };
type Surface = { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture };

/** A soft dark patch under the model, so it rests on the surface rather than hovering over it. */
function contactShadow(model: SceneModel): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d")!;
  const gradient = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  gradient.addColorStop(0, "rgba(0,0,0,0.7)");
  gradient.addColorStop(0.55, "rgba(0,0,0,0.32)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(model.footprint.x * 1.25, model.footprint.z * 1.25),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = Math.max(model.radius * 0.002, 0.02);
  mesh.renderOrder = 1;
  return mesh;
}

export class ScenePictureRenderer {
  private renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private pmrem = new THREE.PMREMGenerator(this.renderer);
  private rooms = new Map<string, Promise<Room>>();
  private surfaces = new Map<string, Promise<Surface>>();
  private textureLoader = new THREE.TextureLoader();
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }

  private room(light: string): Promise<Room> {
    let room = this.rooms.get(light);
    if (!room) {
      const loading = new HDRLoader().loadAsync(lightUrl(light)).then((panorama) => {
        panorama.mapping = THREE.EquirectangularReflectionMapping;
        return { panorama, env: this.pmrem.fromEquirectangular(panorama).texture };
      });
      // A failed load isn't kept, so the next picture tries again.
      loading.catch(() => this.rooms.get(light) === loading && this.rooms.delete(light));
      this.rooms.set(light, loading);
      room = loading;
    }
    return room;
  }

  private surface(folder: string, sizeMm: number, tableMm: number): Promise<Surface> {
    const key = `${folder}:${tableMm}`;
    let surface = this.surfaces.get(key);
    if (!surface) {
      const loading = Promise.all(
        (["color", "normal", "rough"] as const).map((map) => this.textureLoader.loadAsync(surfaceUrl(folder, map))),
      ).then(([map, normal, rough]) => {
        map.colorSpace = THREE.SRGBColorSpace;
        for (const texture of [map, normal, rough]) {
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(tableMm / sizeMm, tableMm / sizeMm);
          texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        }
        return { map, normal, rough };
      });
      loading.catch(() => this.surfaces.get(key) === loading && this.surfaces.delete(key));
      this.surfaces.set(key, loading);
      surface = loading;
    }
    return surface;
  }

  /** Loads a scene's files ahead of rendering, so the first picture of it isn't the slow one. */
  preload(scene: SceneDef): Promise<unknown> {
    return Promise.all([
      this.room(scene.light),
      scene.surface ? this.surface(scene.surface.folder, scene.surface.sizeMm, 2400) : null,
    ]);
  }

  /** One picture of `model` for `shot`, as a JPEG. Pictures render one at a time on the shared context. */
  render(model: SceneModel, shot: Shot, width: number, height: number): Promise<Blob> {
    const job = this.queue.then(() => this.draw(model, shot, width, height));
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async draw(model: SceneModel, shot: Shot, width: number, height: number): Promise<Blob> {
    const def = sceneById(shot.scene);
    const angle = angleById(shot.angle);
    const { radius } = model;
    // The table reaches well past the frame whatever the model's size, so its edge never shows.
    const tableMm = Math.max(2400, radius * 60);
    const camera = new THREE.PerspectiveCamera(30, width / height, radius * 0.05, tableMm * 3);
    const target = placeCamera(camera, model, angle);
    // How much further back than the angle's distance the camera went to fit all of the model in.
    const pulledBack = camera.position.length() / (radius * angle.distance);
    const room = await this.room(def.light);
    const scene = new THREE.Scene();
    scene.environment = room.env;
    scene.environmentIntensity = 0.7;
    scene.environmentRotation.y = def.lightTurn;
    scene.backgroundRotation.y = def.lightTurn;
    const extras: THREE.Object3D[] = [];
    if (def.surface) {
      const maps = await this.surface(def.surface.folder, def.surface.sizeMm, tableMm);
      scene.background = room.panorama;
      scene.backgroundBlurriness = 0.35;
      scene.backgroundIntensity = 0.85;
      const table = new THREE.Mesh(
        new THREE.PlaneGeometry(tableMm, tableMm),
        new THREE.MeshStandardMaterial({
          map: maps.map,
          normalMap: maps.normal,
          roughnessMap: maps.rough,
          roughness: 1,
        }),
      );
      table.rotation.x = -Math.PI / 2;
      table.rotation.z = 0.35;
      table.receiveShadow = true;
      extras.push(table);
    } else {
      const backdrop = new THREE.Color("#e9e9ec");
      scene.background = backdrop;
      scene.fog = new THREE.Fog(backdrop, radius * 6 * pulledBack, radius * 16 * pulledBack);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(tableMm * 2, tableMm * 2),
        new THREE.MeshStandardMaterial({ color: "#f0f0f2", roughness: 0.9 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      extras.push(floor);
    }
    extras.push(contactShadow(model));
    const sun = new THREE.DirectionalLight("#fff6ea", def.surface ? 2.6 : 2.4);
    sun.position.set(radius * 2.5, radius * 6, radius * 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.blurSamples = 16;
    sun.shadow.bias = -0.0004;
    Object.assign(sun.shadow.camera, {
      left: -radius * 3,
      right: radius * 3,
      top: radius * 3,
      bottom: -radius * 3,
      near: radius * 0.05,
      far: radius * 20,
    });
    extras.push(sun);
    scene.add(model.root, ...extras);

    const passes = [
      new RenderPass(scene, camera),
      // Tuned on a 40 mm keyring (radius ~25 mm); the blur scales with the model so a big one isn't all smeared.
      new BokehPass(scene, camera, {
        focus: camera.position.distanceTo(target),
        aperture: 0.00025 * (25 / radius),
        maxblur: 0.008,
      }),
      new OutputPass(),
    ];
    const composer = new EffectComposer(this.renderer);
    try {
      this.renderer.setSize(width, height, false);
      composer.setSize(width, height);
      for (const pass of passes) composer.addPass(pass);
      composer.render();
    } finally {
      // The composer frees only its own targets: each pass frees what it made.
      for (const pass of passes) pass.dispose();
      composer.dispose();
      scene.remove(model.root);
      for (const extra of extras) {
        if (extra instanceof THREE.Mesh) {
          extra.geometry.dispose();
          const material = extra.material as THREE.MeshBasicMaterial;
          if (extra.renderOrder === 1) material.map?.dispose();
          material.dispose();
        }
        if (extra instanceof THREE.DirectionalLight) extra.shadow.dispose();
      }
    }
    return new Promise<Blob>((resolve, reject) =>
      this.renderer.domElement.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Render failed"))),
        "image/jpeg",
        0.9,
      ),
    );
  }

  dispose(): void {
    const ignore = () => undefined;
    for (const room of this.rooms.values())
      void room.then(({ panorama, env }) => {
        panorama.dispose();
        env.dispose();
      }, ignore);
    for (const surface of this.surfaces.values())
      void surface.then(({ map, normal, rough }) => [map, normal, rough].forEach((t) => t.dispose()), ignore);
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
