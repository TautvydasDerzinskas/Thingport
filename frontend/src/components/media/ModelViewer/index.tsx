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
  objectFromMesh,
  paletteForTheme,
} from "../../../utils/modelLoaders";
import { objectHasOwnColor } from "../../../utils/ownColor";
import type { Mesh as SdkMesh } from "../../../sdk/threeMf";
import {
  buildBambuModelGroup,
  loadCachedBambuGlb,
  type Parsed3MFData,
  type PlateSummary,
} from "../../../utils/bambuThreeMf";
import { createOrientationGizmo } from "./orientationGizmo";
import BrandMark from "../../BrandMark";

// Partly adapted (with modifications) from github.com/maziggy/bambuddy, AGPL-3.0-only.

export type RenderStyle = "solid" | "wire" | "xray";
export type CameraView = "top" | "front" | "side" | "bottom" | "topFront";

/** A camera preset is a one-off action (clicking "Top" twice re-frames twice), not state. */
export type ModelViewerHandle = {
  setCameraView: (view: CameraView) => void;
  /** Scales the camera's distance to the orbit target: below 1 zooms in, above 1 zooms out. */
  zoom: (factor: number) => void;
};

type ModelViewerProps = {
  /** Where to fetch the model from; left out when `mesh` carries it already. */
  url?: string;
  ext: string;
  /** Geometry already in memory -- the customizer's engine hands back what it just made -- drawn instead of
   *  fetching `url`. Its colours, where it has them, are the model's own and are shown as they are. */
  mesh?: SdkMesh | null;
  /** Fired once the model is on screen, saying whether it brought colours of its own. */
  onOwnColorChange?: (ownColor: boolean) => void;
  viewKey?: string;
  theme: ResolvedTheme;
  /** Overrides the theme-derived material color while keeping the rest of the palette. */
  colorOverride?: string;
  /** For a multi-plate Bambu 3MF: which internal plate to render (null renders all). */
  selectedPlateId?: number | null;
  /** Server pre-rendered GLB, tried before parsing a 3MF client-side. */
  previewGlbUrl?: string | null;
  /** Fired once a 3MF's internal plates are known. `getThumbnail` reuses the fetched bytes. */
  onPlatesDetected?: (plates: PlateSummary[], getThumbnail: (index: number) => Promise<string | null>) => void;
  renderStyle?: RenderStyle;
  showBuildPlate?: boolean;
  /** Draw a default bed under formats that carry no bed size (STL/OBJ/STEP, non-Bambu 3MF). */
  buildPlateForMeshes?: boolean;
  autoRotate?: boolean;
  /** Camera preset to frame the model from on load. Unset keeps per-format defaults. */
  initialCameraView?: CameraView;
  /** The small axis cube in the corner. */
  showOrientationGizmo?: boolean;
  /** Behind the model; "transparent" lets the surrounding card show through. */
  background?: string;
};

// Appearance props that change without reloading the model.
type Appearance = Required<Pick<ModelViewerProps, "renderStyle" | "showBuildPlate" | "autoRotate">> & {
  colorOverride?: string;
};

const XRAY_OPACITY = 0.3;

// Bambu X1/P1/A1's 256x256mm bed -- the stand-in for formats with no bed size of their own.
const DEFAULT_BED_SIZE = 256;

type ViewErrorKey = "unsupported" | "failed" | "tooComplex";

// Poll for the server's 3MF preview rather than parsing in the browser: the models that take the
// server longest are the ones that exhaust browser memory.
const SERVER_PREVIEW_POLL_MS = 3000;
const SERVER_PREVIEW_WAIT_MS = 10 * 60 * 1000;

const BAMBU_PLATE_COLOR = 0x00ae42;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Bambu Studio's three-quarter view for multi-plate 3MF; mostly front-on for everything else.
const BAMBU_VIEW_DIRECTION = new THREE.Vector3(0.7, 0.5, 0.7).normalize();
const FRONT_VIEW_DIRECTION = new THREE.Vector3(0.9, 0.7, 2.1).normalize();

// Top/bottom keep a hair of +Z so OrbitControls' up vector isn't parallel to the view direction.
const CAMERA_VIEW_DIRECTIONS: Record<CameraView, THREE.Vector3> = {
  top: new THREE.Vector3(0, 1, 0.0001).normalize(),
  front: new THREE.Vector3(0, 0, 1),
  side: new THREE.Vector3(1, 0, 0),
  bottom: new THREE.Vector3(0, -1, 0.0001).normalize(),
  topFront: new THREE.Vector3(0, 1, 1).normalize(),
};

/** Frames the camera on a bounding box using its circumscribed sphere against both vertical and
 *  horizontal FOV, so the model is never cropped at any aspect or orbit angle. */
function fitCameraToBox(
  camera: THREE.PerspectiveCamera,
  controls: any,
  box: THREE.Box3,
  direction: THREE.Vector3 = BAMBU_VIEW_DIRECTION,
  padding = 1.15,
  /** Scenery size (the bed diagonal) the far plane must not clip. */
  sceneryExtent = 0,
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
    url = "",
    ext,
    mesh,
    onOwnColorChange,
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
    showOrientationGizmo = true,
    background = "action.hover",
  },
  ref,
) {
  const { t } = useTranslation(["library"]);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const appearanceRef = useRef<Appearance>({ colorOverride, renderStyle, showBuildPlate, autoRotate });
  appearanceRef.current = { colorOverride, renderStyle, showBuildPlate, autoRotate };
  // Read when the scene is built rather than depended on: a new mesh arrives with a new `viewKey`.
  const meshRef = useRef(mesh);
  meshRef.current = mesh;
  const onOwnColorRef = useRef(onOwnColorChange);
  onOwnColorRef.current = onOwnColorChange;
  const sceneApiRef = useRef<{
    applyAppearance: () => void;
    setCameraView: (view: CameraView) => void;
    zoom: (factor: number) => void;
  } | null>(null);
  // Lets plate switches rebuild the already-parsed group instead of refetching the file.
  const rebuildBambuPlateRef = useRef<((plateId: number | null) => void) | null>(null);
  const [viewError, setViewError] = useState<ViewErrorKey | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [waitingForServer, setWaitingForServer] = useState(false);

  useEffect(() => {
    let disposed = false;
    let activeObject: THREE.Object3D | null = null;
    const mount = mountRef.current;
    if (!mount) return;
    const palette = paletteForTheme(theme);
    setViewError(null);
    setIsLoading(true);
    setWaitingForServer(false);
    const reportError = (key: ViewErrorKey) => {
      if (!disposed) {
        setViewError(key);
        setIsLoading(false);
      }
    };

    const scene = new THREE.Scene();
    const initialWidth = mount.clientWidth || 300;
    const initialHeight = mount.clientHeight || 300;
    // A dialog never fires a window resize, so set the real aspect now or framing is wrong.
    const camera = new THREE.PerspectiveCamera(45, initialWidth / initialHeight, 0.1, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(initialWidth, initialHeight);
    // Keeps saturated filament colours from clipping to white under RoomEnvironment's IBL.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environment.texture;

    // Direction for the front view; turned with the camera's azimuth each frame so the lighting
    // stays put relative to the viewer while orbiting or spinning.
    const KEY_LIGHT_DIRECTION = new THREE.Vector3(60, 260, 90).normalize();
    let keyLightDistance = 280;
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.copy(KEY_LIGHT_DIRECTION).multiplyScalar(keyLightDistance);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);
    scene.add(keyLight.target);

    camera.position.set(150, 150, 150);

    let controls: any;
    let teardown: (() => void) | undefined;
    // v2: views saved before the Z-up -> Y-up conversion would orbit the wrong point.
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

    // The tinted plane is unlit and can't receive shadows, so a separate shadow catcher sits above it.
    let buildVolume = { x: DEFAULT_BED_SIZE, y: DEFAULT_BED_SIZE };
    const gridHelper = new THREE.GridHelper(buildVolume.x, Math.ceil(buildVolume.x / 16), 0x444444, 0x333333);
    gridHelper.visible = false;
    scene.add(gridHelper);
    const plateMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(buildVolume.x, buildVolume.y),
      new THREE.MeshBasicMaterial({
        color: BAMBU_PLATE_COLOR,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    plateMesh.rotation.x = -Math.PI / 2;
    plateMesh.position.y = -0.5;
    plateMesh.visible = false;
    scene.add(plateMesh);
    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(buildVolume.x, buildVolume.y),
      new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false }),
    );
    // The planes are too close for the depth buffer to separate, so without a fixed draw order and
    // no depth writes they z-fight and the shadow flickers as the camera moves.
    shadowCatcher.renderOrder = 1;
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

      // Covers the plate's diagonal so the rotating shadow frustum never clips it, which flickers.
      const shadowExtent = Math.hypot(buildVolume.x, buildVolume.y) * 0.55;
      keyLightDistance = shadowExtent * 3;
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

    // X-ray disables depth writes and backface culling so inner walls show through.
    const applyAppearance = (obj: THREE.Object3D | null) => {
      if (!obj) return;
      const { colorOverride: color, renderStyle: style } = appearanceRef.current;
      const xray = style === "xray";
      obj.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.castShadow = style === "solid";
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat) => {
          const typed = mat as THREE.MeshStandardMaterial;
          // A model that brought its own colours keeps them; the reader's colour is for the ones that didn't.
          if (color && mat.userData.ownColor !== true) typed.color?.set(color);
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

    let lastFitBox: THREE.Box3 | null = null;
    // null keeps the per-format default view.
    let presetDirection: THREE.Vector3 | null = initialCameraView ? CAMERA_VIEW_DIRECTIONS[initialCameraView] : null;

    let bambuParsed: Parsed3MFData | null = null;
    let bambuFilamentColors: string[] = [];
    let currentPlateId: number | null = selectedPlateId;
    // A cached GLB already contains every plate, so switching plates is a visibility toggle.
    let cachedGlbRoot: THREE.Group | null = null;

    // Box3.setFromObject ignores visibility, which would measure every plate of a cached GLB.
    const visibleBox = (root: THREE.Object3D): THREE.Box3 => {
      root.updateMatrixWorld(true);
      const box = new THREE.Box3();
      root.traverseVisible((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
        box.union(child.geometry.boundingBox!.clone().applyMatrix4(child.matrixWorld));
      });
      return box;
    };

    // An empty box must still clear loading, or the spinner sticks. `refitCamera` frames a newly
    // shown plate instead of restoring the saved view.
    const bedExtent = () => (buildPlateLaidOut ? Math.hypot(buildVolume.x, buildVolume.y) : 0);
    const fitCamera = (box: THREE.Box3, defaultDirection: THREE.Vector3) =>
      fitCameraToBox(camera, controls, box, presetDirection ?? defaultDirection, undefined, bedExtent());

    const finalizeGroupPlacement = (
      group: THREE.Object3D,
      centerOnBuildPlate: boolean,
      refitCamera = false,
      defaultDirection = BAMBU_VIEW_DIRECTION,
    ) => {
      const box = visibleBox(group);
      if (box.isEmpty()) {
        setIsLoading(false);
        return;
      }
      // Relative offsets: the reused cached-GLB root still carries the previous plate's offset.
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
      onOwnColorRef.current?.(objectHasOwnColor(group));
      activeObject = group;
      scene.add(group);
      finalizeGroupPlacement(group, centerOnBuildPlate, refitCamera);
    };

    const showCachedGlbPlate = (plateId: number | null, centerOnBuildPlate: boolean, refitCamera = false) => {
      if (!cachedGlbRoot) return;
      const targetName = plateId != null ? `plate-${plateId}` : null;
      let matched = false;
      cachedGlbRoot.children.forEach((child) => {
        const visible = !targetName || child.name === targetName;
        child.visible = visible;
        if (visible) matched = true;
      });
      if (!matched)
        cachedGlbRoot.children.forEach((child) => {
          child.visible = true;
        });
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
        // Only a user's own drag/zoom is worth saving; auto-rotate fires "change" every frame.
        controls.addEventListener("end", saveView);

        const showMeshObject = (obj: THREE.Object3D) => {
          applyThemeToObject(obj, palette);
          applyAppearance(obj);
          activeObject = obj;
          onOwnColorRef.current?.(objectHasOwnColor(obj));
          scene.add(obj);
          const box = visibleBox(obj);
          if (buildPlateForMeshes && !box.isEmpty()) {
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

        // Returns false when the caller should parse the raw file in the browser instead.
        const tryLoadCachedGlb = async (): Promise<boolean> => {
          if (!previewGlbUrl) return false;
          const deadline = Date.now() + SERVER_PREVIEW_WAIT_MS;
          let outcome = await loadCachedBambuGlb(previewGlbUrl);
          while (outcome.status === "generating") {
            if (disposed) return true;
            if (Date.now() > deadline) {
              reportError("failed");
              return true;
            }
            setWaitingForServer(true);
            await new Promise((resolve) => setTimeout(resolve, SERVER_PREVIEW_POLL_MS));
            if (disposed) return true;
            outcome = await loadCachedBambuGlb(previewGlbUrl);
          }
          if (disposed) return true;
          setWaitingForServer(false);
          if (outcome.status === "failed") {
            reportError("tooComplex");
            return true;
          }
          if (outcome.status !== "ready") return false;
          const cached = outcome.glb;
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
          // Geometry the caller already holds: nothing to fetch or parse.
          if (meshRef.current) {
            const obj = objectFromMesh(meshRef.current);
            if (disposed) {
              disposeObject3D(obj);
              return;
            }
            showMeshObject(obj);
          } else if (e === "3mf") {
            if (disposed) return;
            const usedCache = await tryLoadCachedGlb();
            if (!usedCache && !disposed) {
              const result = await loadBambuThreeMFForViewer(url);
              if (!result) {
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

      // StrictMode can dispose this instance before we get here.
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
      // Its box can change size without the window doing so, e.g. a dashboard card when the layout changes.
      const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
      resizeObserver?.observe(mount);
      const gizmo = showOrientationGizmo ? createOrientationGizmo(renderer) : null;
      teardown = () => {
        window.removeEventListener("resize", onResize);
        resizeObserver?.disconnect();
        gizmo?.dispose();
      };

      // Eased toward over a few frames so button zooms don't jump.
      let zoomTargetDistance: number | null = null;
      const zoomOffset = new THREE.Vector3();
      const stepZoom = () => {
        if (zoomTargetDistance === null || !controls) return;
        zoomOffset.subVectors(camera.position, controls.target);
        const current = zoomOffset.length();
        const next = THREE.MathUtils.lerp(current, zoomTargetDistance, 0.25);
        if (Math.abs(next - zoomTargetDistance) < zoomTargetDistance * 0.001) zoomTargetDistance = null;
        camera.position.copy(controls.target).addScaledVector(zoomOffset.normalize(), next);
        // fitCameraToBox sized near/far for the fitted distance; shift them so zooming out doesn't clip.
        camera.near = Math.max(next / 1000, 0.01);
        camera.far += next - current;
        camera.updateProjectionMatrix();
      };
      // A drag or wheel zoom takes over from an unfinished button zoom.
      controls?.addEventListener("start", () => {
        zoomTargetDistance = null;
      });

      const animate = () => {
        if (disposed) return;
        stepZoom();
        if (controls) controls.autoRotate = appearanceRef.current.autoRotate;
        controls?.update();
        if (controls) {
          // Aim at the plate centre: the shadow frustum is centred on the light's target.
          keyLight.target.position.set(plateMesh.position.x, 0, plateMesh.position.z);
          keyLight.position
            .copy(KEY_LIGHT_DIRECTION)
            .applyAxisAngle(Y_AXIS, controls.getAzimuthalAngle())
            .multiplyScalar(keyLightDistance)
            .add(keyLight.target.position);
        }
        renderer.render(scene, camera);
        gizmo?.render(camera, controls?.target ?? new THREE.Vector3(), width, height);
        requestAnimationFrame(animate);
      };
      animate();

      sceneApiRef.current = {
        applyAppearance: () => {
          applyAppearance(activeObject);
          syncBuildPlateVisibility();
        },
        zoom: (factor) => {
          if (!controls) return;
          const from = zoomTargetDistance ?? camera.position.distanceTo(controls.target);
          zoomTargetDistance = THREE.MathUtils.clamp(from * factor, controls.minDistance, controls.maxDistance);
        },
        setCameraView: (view) => {
          zoomTargetDistance = null;
          presetDirection = CAMERA_VIEW_DIRECTIONS[view];
          if (lastFitBox && controls) {
            fitCameraToBox(camera, controls, lastFitBox, CAMERA_VIEW_DIRECTIONS[view], undefined, bedExtent());
          }
        },
      };

      rebuildBambuPlateRef.current = (plateId) => {
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
    // Only the initial plate/camera view are read here; later changes go through the lighter effects
    // below so they don't re-parse the model (onPlatesDetected is also an unmemoized prop).
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ext, viewKey, theme, previewGlbUrl]);

  useEffect(() => {
    rebuildBambuPlateRef.current?.(selectedPlateId ?? null);
  }, [selectedPlateId]);

  useEffect(() => {
    sceneApiRef.current?.applyAppearance();
  }, [colorOverride, renderStyle, showBuildPlate, autoRotate]);

  useImperativeHandle(
    ref,
    () => ({
      setCameraView: (view) => sceneApiRef.current?.setCameraView(view),
      zoom: (factor) => sceneApiRef.current?.zoom(factor),
    }),
    [],
  );

  return (
    <Box
      ref={mountRef}
      sx={{
        width: "100%",
        height: "100%",
        bgcolor: background,
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
            bgcolor: background,
          }}
        >
          <Stack alignItems="center" spacing={1.5}>
            <BrandMark theme={theme} size="lg" />
            <CircularProgress size={22} />
            {waitingForServer && (
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, textAlign: "center" }}>
                {t("library:modelViewer.previewPreparing")}
              </Typography>
            )}
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
              : viewError === "tooComplex"
                ? t("library:modelViewer.previewTooComplex")
                : t("library:modelViewer.previewFailed")}
          </Typography>
        </Box>
      )}
    </Box>
  );
});

export default ModelViewer;
