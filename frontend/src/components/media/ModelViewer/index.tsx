import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { type ResolvedTheme } from "../../../constants/settingsOptions";
import {
  applyThemeToObject,
  disposeObject3D,
  loadBambuThreeMFForViewer,
  loadObjectFromAsset,
  paletteForTheme,
} from "../../../utils/modelLoaders";
import { buildBambuModelGroup, loadCachedBambuGlb, type Parsed3MFData, type PlateSummary } from "../../../utils/bambuThreeMf";
import { createOrientationGizmo } from "./orientationGizmo";
import BrandMark from "../../BrandMark";

// This viewer's lighting/tone-mapping setup, build-plate + grid + shadow-catcher rendering, and
// fitCameraToBox below are ported from maziggy/bambuddy (https://github.com/maziggy/bambuddy,
// frontend/src/components/ModelViewer.tsx, AGPL-3.0-only). Thingport uses this file under the
// same license -- see LICENSE at the repo root. Multi-plate parsing itself lives in
// ../../../utils/bambuThreeMf.ts, ported from the same source.

export type RenderStyle = "solid" | "wire" | "xray";
export type CameraView = "top" | "front" | "side";

/** Imperative controls for a mounted viewer -- a camera preset is a one-off action (clicking
 *  "Top" twice should re-frame twice), not state, so it's a method rather than a prop. */
export type ModelViewerHandle = {
  setCameraView: (view: CameraView) => void;
};

type ModelViewerProps = {
  url: string;
  ext: string;
  viewKey?: string;
  theme: ResolvedTheme;
  /** Overrides the theme-derived material color (e.g. the fixed "red plate" look used by the
   *  model detail page's 3D preview modal) while keeping the rest of the palette intact. */
  colorOverride?: string;
  /** For a multi-plate Bambu Studio 3MF: which internal plate to render (null renders every
   *  plate's build items together). Ignored for every other format. */
  selectedPlateId?: number | null;
  /** Server pre-rendered GLB for this plate (see backend/src/services/modelPreviewCache.ts) --
   *  when present, tried first for a 3MF instead of parsing the raw file client-side. Null/
   *  undefined (not yet generated, or a non-3MF) falls back to the existing live parse. */
  previewGlbUrl?: string | null;
  /** Fired once after a 3MF's internal plates are known -- empty for a single-plate/non-Bambu
   *  file. `getThumbnail` is bound to the already-fetched file bytes, so a caller building a
   *  plate picker doesn't need to refetch the (often tens of MB) file itself. */
  onPlatesDetected?: (plates: PlateSummary[], getThumbnail: (index: number) => Promise<string | null>) => void;
  /** Solid (default), wireframe, or see-through "X-ray" materials. */
  renderStyle?: RenderStyle;
  /** Whether the build plate + grid is drawn, for formats that have one (see buildPlateForMeshes). */
  showBuildPlate?: boolean;
  /** STL/OBJ/STEP (and a non-Bambu 3MF) carry no bed size, so by default they get no plate.
   *  Set to draw a standard DEFAULT_BED_SIZE bed under them anyway (grown to fit a bigger model). */
  buildPlateForMeshes?: boolean;
  /** Slowly orbits the camera around the model. */
  autoRotate?: boolean;
  /** Camera preset to frame the model from on load and on plate switches (until setCameraView
   *  picks another). Unset keeps the per-format defaults and restores a saved view if any. */
  initialCameraView?: CameraView;
};

// Appearance props that change without reloading the model: read through a ref by the setup
// effect (for whatever it builds next) and pushed onto the live scene by their own effect.
type Appearance = Required<Pick<ModelViewerProps, "renderStyle" | "showBuildPlate" | "autoRotate">> & {
  colorOverride?: string;
};

const XRAY_OPACITY = 0.3;

// Bambu X1/P1/A1's 256x256mm bed -- the stand-in for formats with no bed size of their own.
const DEFAULT_BED_SIZE = 256;

type ViewErrorKey = "unsupported" | "failed";

const BAMBU_PLATE_COLOR = 0x00ae42;

// Bambu Studio's own three-quarter view (used for multi-plate 3MF); mostly-front-on with a
// slight elevation/side offset for depth for every other format (STL/OBJ/STEP), so a single
// uploaded model loads facing the viewer rather than from a corner.
const BAMBU_VIEW_DIRECTION = new THREE.Vector3(0.7, 0.5, 0.7).normalize();
const FRONT_VIEW_DIRECTION = new THREE.Vector3(0.9, 0.7, 2.1).normalize();

// Axis-aligned presets for the preview toolbar. +Z is "front", matching the default views above.
// Top keeps a hair of +Z so OrbitControls' up vector isn't parallel to the view direction.
const CAMERA_VIEW_DIRECTIONS: Record<CameraView, THREE.Vector3> = {
  top: new THREE.Vector3(0, 1, 0.0001).normalize(),
  front: new THREE.Vector3(0, 0, 1),
  side: new THREE.Vector3(1, 0, 0),
};

/** Frame the camera on a bounding box, solving for distance against both the vertical and
 *  (aspect-derived) horizontal field of view so the model fills the frame -- with margin from
 *  `padding` -- at any viewport shape and from any direction, without ever cropping on orbit
 *  (the box's circumscribed sphere, not just its "tallest axis", sets the distance). Ported from
 *  bambuddy's fitCameraToBox, generalized with a `direction` param so it can also replace this
 *  viewer's old ad-hoc radius*k heuristic for the non-3MF formats. */
function fitCameraToBox(
  camera: THREE.PerspectiveCamera,
  controls: any,
  box: THREE.Box3,
  direction: THREE.Vector3 = BAMBU_VIEW_DIRECTION,
  padding = 1.15,
  /** Size of scenery around the model (the build plate's diagonal) that must not be cut off by
   *  the far plane -- the camera frames the model, so a bed much larger than it would otherwise
   *  end in a hard clipped edge a few model-lengths behind it. */
  sceneryExtent = 0
): void {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.001);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distance = padding * Math.max(radius / Math.sin(vFov / 2), radius / Math.sin(hFov / 2));
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(distance / 1000, 0.01);
  camera.far = distance + Math.max(radius * 4, sceneryExtent);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

const ModelViewer = forwardRef<ModelViewerHandle, ModelViewerProps>(function ModelViewer(
  {
    url,
    ext,
    viewKey,
    theme,
    colorOverride,
    selectedPlateId = null,
    previewGlbUrl,
    onPlatesDetected,
    renderStyle = "solid",
    showBuildPlate = true,
    autoRotate = false,
    buildPlateForMeshes = false,
    initialCameraView,
  },
  ref
) {
  const { t } = useTranslation(["library"]);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const appearanceRef = useRef<Appearance>({ colorOverride, renderStyle, showBuildPlate, autoRotate });
  appearanceRef.current = { colorOverride, renderStyle, showBuildPlate, autoRotate };
  // Set by the setup effect once its scene exists; cleared on teardown.
  const sceneApiRef = useRef<{
    applyAppearance: () => void;
    setCameraView: (view: CameraView) => void;
  } | null>(null);
  // Bridges the setup effect below to the selectedPlateId effect further down, so switching
  // plates rebuilds the already-parsed group in place instead of refetching/reparsing the file.
  const rebuildBambuPlateRef = useRef<((plateId: number | null) => void) | null>(null);
  const [viewError, setViewError] = useState<ViewErrorKey | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let activeObject: THREE.Object3D | null = null;
    const mount = mountRef.current;
    if (!mount) return;
    const palette = paletteForTheme(theme);
    setViewError(null);
    setIsLoading(true);
    const reportError = (key: ViewErrorKey) => {
      if (!disposed) {
        setViewError(key);
        setIsLoading(false);
      }
    };

    const scene = new THREE.Scene();
    const initialWidth = mount.clientWidth || 300;
    const initialHeight = mount.clientHeight || 300;
    // Real aspect from the start: opening this in a dialog/modal never fires a window "resize"
    // event (only the listener registered further down would catch that), so leaving this at the
    // constructor's placeholder 1:1 until some future resize left every framing calculation
    // (centerSceneOn, fitCameraToBox) solving for the wrong aspect for the entire session.
    const camera = new THREE.PerspectiveCamera(45, initialWidth / initialHeight, 0.1, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(initialWidth, initialHeight);
    // Filmic tone mapping + sub-1.0 exposure keeps a saturated filament colour's lit side from
    // clipping to white against RoomEnvironment's bright IBL -- ported from bambuddy.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    // Image-based lighting from a generated room: soft gradients and a hint of reflection across
    // curved surfaces, which flat ambient + a couple of directional lights can't produce (every
    // same-facing surface got an identical colour, flattening models into silhouettes).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environment.texture;

    // One mostly-overhead key light for the contact shadow and a highlight direction; the
    // environment supplies the fill.
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(60, 260, 90);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    camera.position.set(150, 150, 150);

    let controls: any;
    let teardown: (() => void) | undefined;
    // Bumped to v2 when the Z-up -> Y-up axis conversion was added: a view saved under v1 has a
    // camera position/target computed for the old (unrotated) layout, so restoring it now would
    // orbit around a point nowhere near where the model actually sits.
    const storageKey = viewKey ? `ps-view-v2-${viewKey}` : null;

    const loadSavedView = () => {
      if (!storageKey || typeof window === "undefined") return false;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!Array.isArray(data?.position) || !Array.isArray(data?.target)) return false;
        camera.position.fromArray(data.position);
        controls?.target.fromArray(data.target);
        controls?.update();
        return true;
      } catch (err) {
        console.warn("Failed to load saved view", err);
        return false;
      }
    };

    const saveView = () => {
      if (!storageKey || typeof window === "undefined" || !controls) return;
      try {
        const payload = { position: camera.position.toArray(), target: controls.target.toArray() };
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {}
    };

    // Build-plate group: grid + tinted plane + a dedicated shadow-catcher plane just above it
    // (the tinted plane is unlit MeshBasicMaterial and can't receive shadows itself). Sized/
    // repositioned from the asset's own build volume once known -- only a Bambu 3MF carries a
    // real one; STL/OBJ/STEP get a DEFAULT_BED_SIZE stand-in only with buildPlateForMeshes.
    let buildVolume = { x: DEFAULT_BED_SIZE, y: DEFAULT_BED_SIZE };
    const gridHelper = new THREE.GridHelper(buildVolume.x, Math.ceil(buildVolume.x / 16), 0x444444, 0x333333);
    gridHelper.visible = false;
    scene.add(gridHelper);
    const plateMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(buildVolume.x, buildVolume.y),
      new THREE.MeshBasicMaterial({ color: BAMBU_PLATE_COLOR, transparent: true, opacity: 0.15, side: THREE.DoubleSide })
    );
    plateMesh.rotation.x = -Math.PI / 2;
    plateMesh.position.y = -0.5;
    plateMesh.visible = false;
    scene.add(plateMesh);
    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(buildVolume.x, buildVolume.y),
      new THREE.ShadowMaterial({ opacity: 0.22 })
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = -0.49;
    shadowCatcher.receiveShadow = true;
    shadowCatcher.visible = false;
    scene.add(shadowCatcher);

    let buildPlateLaidOut = false;
    const syncBuildPlateVisibility = () => {
      const visible = buildPlateLaidOut && appearanceRef.current.showBuildPlate;
      gridHelper.visible = visible;
      plateMesh.visible = visible;
      shadowCatcher.visible = visible;
    };

    const layoutBuildPlate = () => {
      buildPlateLaidOut = true;
      syncBuildPlateVisibility();

      const shadowExtent = Math.max(buildVolume.x, buildVolume.y) * 0.75;
      keyLight.shadow.camera.left = -shadowExtent;
      keyLight.shadow.camera.right = shadowExtent;
      keyLight.shadow.camera.top = shadowExtent;
      keyLight.shadow.camera.bottom = -shadowExtent;
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = shadowExtent * 6;
      keyLight.shadow.camera.updateProjectionMatrix();

      gridHelper.geometry.dispose();
      const gridSize = Math.max(buildVolume.x, buildVolume.y);
      const replacement = new THREE.GridHelper(gridSize, Math.ceil(gridSize / 16), 0x444444, 0x333333);
      gridHelper.geometry = replacement.geometry;
      replacement.geometry = new THREE.BufferGeometry();

      plateMesh.geometry.dispose();
      plateMesh.geometry = new THREE.PlaneGeometry(buildVolume.x, buildVolume.y);
      shadowCatcher.geometry.dispose();
      shadowCatcher.geometry = new THREE.PlaneGeometry(buildVolume.x, buildVolume.y);
    };

    // Color / render style for everything under `obj`. Colors only change with a colorOverride
    // (otherwise the theme palette or per-filament colors stay); X-ray also turns off depth
    // writes and backface culling so inner walls show through. Shadows are for solid only.
    const applyAppearance = (obj: THREE.Object3D | null) => {
      if (!obj) return;
      const { colorOverride: color, renderStyle: style } = appearanceRef.current;
      const xray = style === "xray";
      obj.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        child.castShadow = style === "solid";
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
          const typed = mat as THREE.MeshStandardMaterial;
          if (color) typed.color?.set(color);
          if (typed.userData.baseSide === undefined) typed.userData.baseSide = typed.side;
          typed.wireframe = style === "wire";
          typed.transparent = xray;
          typed.opacity = xray ? XRAY_OPACITY : 1;
          typed.depthWrite = !xray;
          typed.side = xray ? THREE.DoubleSide : typed.userData.baseSide;
          typed.needsUpdate = true;
        });
      });
    };

    // Last framed bounds, so camera presets can re-frame without re-measuring.
    let lastFitBox: THREE.Box3 | null = null;
    // Active camera preset direction; null keeps the per-format default (3/4 view for Bambu 3MF,
    // raised front for everything else).
    let presetDirection: THREE.Vector3 | null = initialCameraView ? CAMERA_VIEW_DIRECTIONS[initialCameraView] : null;

    // 3MF-only state: kept around so a selectedPlateId change (switching plates) rebuilds the
    // group locally instead of refetching/reparsing the whole file.
    let bambuParsed: Parsed3MFData | null = null;
    let bambuFilamentColors: string[] = [];
    let currentPlateId: number | null = selectedPlateId;
    // Set instead of bambuParsed when a cached GLB (server pre-render) loads successfully --
    // its meshes are already built/merged/colored, so switching plates is just a visibility
    // toggle on its child groups rather than rebuilding geometry from raw parsed data.
    let cachedGlbRoot: THREE.Group | null = null;

    // World-space bounds of only the *visible* meshes under `root`. Box3.setFromObject ignores
    // visibility, which for a cached GLB (every plate's meshes loaded, all but one hidden) would
    // measure the whole multi-plate grid Bambu Studio lays plates out on, not the active plate.
    const visibleBox = (root: THREE.Object3D): THREE.Box3 => {
      root.updateMatrixWorld(true);
      const box = new THREE.Box3();
      root.traverseVisible(child => {
        if (!(child instanceof THREE.Mesh)) return;
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
        box.union(child.geometry.boundingBox!.clone().applyMatrix4(child.matrixWorld));
      });
      return box;
    };

    // Shared tail for both the live-parse and cached-GLB paths: position the (already-built)
    // group on the build plate, frame the camera, and clear loading -- an empty box (e.g. a
    // plate with no visible geometry) must still clear loading rather than leaving the spinner
    // stuck forever, regardless of which path produced it. `refitCamera` is set on a plate
    // switch so the newly shown plate is framed, rather than restoring the previous saved view.
    const bedExtent = () => (buildPlateLaidOut ? Math.hypot(buildVolume.x, buildVolume.y) : 0);
    const fitCamera = (box: THREE.Box3, defaultDirection: THREE.Vector3) =>
      fitCameraToBox(camera, controls, box, presetDirection ?? defaultDirection, undefined, bedExtent());

    const finalizeGroupPlacement = (
      group: THREE.Object3D,
      centerOnBuildPlate: boolean,
      refitCamera = false,
      defaultDirection = BAMBU_VIEW_DIRECTION
    ) => {
      const box = visibleBox(group);
      if (box.isEmpty()) {
        setIsLoading(false);
        return;
      }
      // Offsets are relative (+=): the cached-GLB root is reused across plate switches, so its
      // position already carries the previous plate's offset, which the world-space box includes.
      const center = box.getCenter(new THREE.Vector3());
      group.position.y -= box.min.y;
      if (centerOnBuildPlate) {
        group.position.x += buildVolume.x / 2 - center.x;
        group.position.z += buildVolume.y / 2 - center.z;
      }
      plateMesh.position.set(buildVolume.x / 2, plateMesh.position.y, buildVolume.y / 2);
      shadowCatcher.position.set(buildVolume.x / 2, shadowCatcher.position.y, buildVolume.y / 2);
      gridHelper.position.set(buildVolume.x / 2, 0, buildVolume.y / 2);

      const finalBox = visibleBox(group);
      lastFitBox = finalBox;
      if (refitCamera || !loadSavedView()) fitCamera(finalBox, defaultDirection);
      setIsLoading(false);
    };

    const renderBambuGroup = (centerOnBuildPlate: boolean, refitCamera = false) => {
      if (!bambuParsed) return;
      if (activeObject) {
        scene.remove(activeObject);
        disposeObject3D(activeObject);
      }
      const group = buildBambuModelGroup(bambuParsed, currentPlateId, bambuFilamentColors);
      applyAppearance(group);
      activeObject = group;
      scene.add(group);
      finalizeGroupPlacement(group, centerOnBuildPlate, refitCamera);
    };

    // Cached-GLB equivalent of renderBambuGroup: the group (and every plate's meshes) is already
    // in the scene from the initial load below -- switching plates is just showing the matching
    // "plate-{id}" child group and hiding the rest, no rebuild/refetch.
    const showCachedGlbPlate = (plateId: number | null, centerOnBuildPlate: boolean, refitCamera = false) => {
      if (!cachedGlbRoot) return;
      const targetName = plateId != null ? `plate-${plateId}` : null;
      let matched = false;
      cachedGlbRoot.children.forEach(child => {
        const visible = !targetName || child.name === targetName;
        child.visible = visible;
        if (visible) matched = true;
      });
      // Requested plate id isn't one of this file's plates (shouldn't normally happen) -- show
      // everything rather than an empty scene.
      if (!matched) cachedGlbRoot.children.forEach(child => { child.visible = true; });
      finalizeGroupPlacement(cachedGlbRoot, centerOnBuildPlate, refitCamera);
    };

    (async () => {
      try {
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.enablePan = true;
        controls.target.set(0, 50, 0);
        // "end" (a finished drag/zoom), not "change": auto-rotate and programmatic framing move
        // the camera every frame, and only the user's own view is worth restoring next time.
        controls.addEventListener("end", saveView);

        // Shared by every non-Bambu path (STL/OBJ/STEP, plain 3MF): theme it, add it, and either
        // set it on a stand-in bed or just frame it as-is.
        const showMeshObject = (obj: THREE.Object3D) => {
          applyThemeToObject(obj, palette);
          applyAppearance(obj);
          activeObject = obj;
          scene.add(obj);
          const box = visibleBox(obj);
          if (buildPlateForMeshes && !box.isEmpty()) {
            // Grow past the default for a model that wouldn't fit on it (10% margin).
            const size = box.getSize(new THREE.Vector3());
            buildVolume = {
              x: Math.max(DEFAULT_BED_SIZE, Math.ceil(size.x * 1.1)),
              y: Math.max(DEFAULT_BED_SIZE, Math.ceil(size.z * 1.1)),
            };
            layoutBuildPlate();
            finalizeGroupPlacement(obj, true, false, FRONT_VIEW_DIRECTION);
            return;
          }
          setIsLoading(false);
          if (box.isEmpty()) return;
          lastFitBox = box;
          if (!loadSavedView()) fitCamera(box, FRONT_VIEW_DIRECTION);
        };

        const e = (ext || "").toLowerCase();

        // Tries the server pre-rendered GLB cache for a 3MF; returns true if it was used (scene
        // already fully set up), false if there's no cache yet (or it failed to load) and the
        // caller should fall back to the live parser exactly as if this function didn't exist.
        const tryLoadCachedGlb = async (): Promise<boolean> => {
          if (!previewGlbUrl) return false;
          const cached = await loadCachedBambuGlb(previewGlbUrl);
          if (!cached || disposed) return false;
          cachedGlbRoot = cached.rootGroup;
          buildVolume = cached.buildVolume;
          layoutBuildPlate();
          applyAppearance(cachedGlbRoot);
          activeObject = cachedGlbRoot;
          scene.add(cachedGlbRoot);
          if (currentPlateId == null && cached.plates.length > 0) currentPlateId = cached.plates[0].index;
          onPlatesDetected?.(cached.plates, cached.getPlateThumbnail);
          showCachedGlbPlate(currentPlateId, true);
          return true;
        };

        try {
          if (e === "3mf") {
            if (disposed) return;
            const usedCache = await tryLoadCachedGlb();
            if (!usedCache && !disposed) {
              const result = await loadBambuThreeMFForViewer(url);
              if (!result) {
                // Not a 3MF the Bambu-aware parser could make sense of -- fall back to the
                // generic loader chain (simple parse, then three.js's own ThreeMFLoader).
                const obj = await loadObjectFromAsset(e, url);
                if (!obj) {
                  reportError("unsupported");
                  return;
                }
                if (disposed) {
                  disposeObject3D(obj);
                  return;
                }
                showMeshObject(obj);
              } else if (!disposed) {
                bambuParsed = result.parsedData;
                bambuFilamentColors = result.filamentColors;
                buildVolume = result.buildVolume;
                layoutBuildPlate();
                if (currentPlateId == null && result.plates.length > 0) currentPlateId = result.plates[0].index;
                onPlatesDetected?.(result.plates, result.getPlateThumbnail);
                renderBambuGroup(true);
              }
            }
          } else {
            const obj = await loadObjectFromAsset(e, url);
            if (!obj) {
              reportError("unsupported");
              return;
            }
            if (disposed) {
              disposeObject3D(obj);
              return;
            }
            showMeshObject(obj);
          }
        } catch (err) {
          console.error("Viewer asset load failed:", err);
          reportError("failed");
        }
      } catch (err) {
        console.error("Viewer init failed:", err);
      }

      // A StrictMode double-invoke (or a fast prop change) can dispose this instance before we
      // get here -- bail rather than wiring up a resize listener/gizmo/render loop for a
      // renderer that's already been torn down.
      if (disposed) return;

      let width = mount.clientWidth || 300;
      let height = mount.clientHeight || 300;
      const onResize = () => {
        if (!mount) return;
        width = mount.clientWidth || 300;
        height = mount.clientHeight || 300;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      window.addEventListener("resize", onResize);
      const gizmo = createOrientationGizmo(renderer);
      teardown = () => {
        window.removeEventListener("resize", onResize);
        gizmo.dispose();
      };

      const animate = () => {
        if (disposed) return;
        // Read per frame so a toggle made while the model was still loading isn't lost.
        if (controls) controls.autoRotate = appearanceRef.current.autoRotate;
        controls?.update();
        renderer.render(scene, camera);
        gizmo.render(camera, controls?.target ?? new THREE.Vector3(), width, height);
        requestAnimationFrame(animate);
      };
      animate();

      sceneApiRef.current = {
        applyAppearance: () => {
          applyAppearance(activeObject);
          syncBuildPlateVisibility();
        },
        setCameraView: view => {
          presetDirection = CAMERA_VIEW_DIRECTIONS[view];
          if (lastFitBox && controls) {
            fitCameraToBox(camera, controls, lastFitBox, CAMERA_VIEW_DIRECTIONS[view], undefined, bedExtent());
          }
        },
      };

      rebuildBambuPlateRef.current = plateId => {
        if (plateId === currentPlateId) return;
        currentPlateId = plateId;
        if (cachedGlbRoot) showCachedGlbPlate(plateId, true, true);
        else renderBambuGroup(true, true);
      };
    })();

  return () => {
    disposed = true;
    try {
      teardown?.();
      mount.removeChild(renderer.domElement);
    } catch {}
    if (activeObject) {
      disposeObject3D(activeObject);
    }
    try {
      controls?.removeEventListener("end", saveView);
      controls?.dispose();
    } catch {}
    try {
      environment.texture.dispose();
      pmrem.dispose();
    } catch {}
    try {
      renderer.forceContextLoss?.();
    } catch {}
    renderer.dispose();
    rebuildBambuPlateRef.current = null;
    sceneApiRef.current = null;
  };
  // initialCameraView is read once, like selectedPlateId: later presets go through
  // setCameraView, and a parent tracking the active preset in state must not trigger a reload.
  // colorOverride and the other appearance props are read via appearanceRef and applied live by
  // the appearance effect below, so changing them never reloads the model.
  // selectedPlateId and onPlatesDetected are deliberately excluded: this effect does the full
  // parse/scene setup, reading selectedPlateId only once as the initial plate. Switching plates
  // afterward is handled by the separate lightweight effect below via rebuildBambuPlateRef,
  // without re-parsing/re-fetching the model -- including either dependency here would re-run
  // the full setup on every plate click (or every render, since onPlatesDetected is an
  // unmemoized callback prop).
  // oxlint-disable-next-line react/exhaustive-effect-dependencies
  // oxlint-disable-next-line react-hooks/exhaustive-deps
}, [url, ext, viewKey, theme, previewGlbUrl]);

  // Switching the selected plate rebuilds the already-parsed group in place (no refetch).
  useEffect(() => {
    rebuildBambuPlateRef.current?.(selectedPlateId ?? null);
  }, [selectedPlateId]);

  useEffect(() => {
    sceneApiRef.current?.applyAppearance();
  }, [colorOverride, renderStyle, showBuildPlate, autoRotate]);

  useImperativeHandle(ref, () => ({
    setCameraView: view => sceneApiRef.current?.setCameraView(view),
  }), []);

  return (
    <Box
      ref={mountRef}
      sx={{
        width: "100%",
        height: "100%",
        bgcolor: "action.hover",
        borderRadius: 1,
        overflow: "hidden",
        position: "relative",
      }}
    >
      {isLoading && !viewError && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "action.hover",
          }}
        >
          <Stack alignItems="center" spacing={1.5}>
            <BrandMark theme={theme} size="lg" />
            <CircularProgress size={22} />
          </Stack>
        </Box>
      )}
      {viewError && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            px: 2,
            textAlign: "center",
            bgcolor: "rgba(0, 0, 0, 0.55)",
          }}
        >
          <Typography variant="body2" fontWeight={600} color="error.light">
            {viewError === "unsupported"
              ? t("library:modelViewer.previewUnsupported")
              : t("library:modelViewer.previewFailed")}
          </Typography>
        </Box>
      )}
    </Box>
  );
});

export default ModelViewer;
