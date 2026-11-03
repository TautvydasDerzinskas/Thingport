import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import type { ManifoldToplevel } from "manifold-3d";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { alpha, useTheme } from "@mui/material/styles";
import HomeOutlinedIcon from "@mui/icons-material/HomeOutlined";
import { library } from "../../sdk/libraries";
import { paletteForTheme } from "../../utils/modelLoaders";
import {
  featureById,
  inputsOf,
  isBody,
  planeAxes,
  shapeOutline,
  sketchPointToWorld,
  topLevel,
  type BodyFeature,
  type SketchFeature,
  type SketchShape,
  type StudioDocument,
  type Transform,
  type Vec2,
} from "../../studio/document";
import { evaluateDesign } from "../../studio/geometry";
import { designMeshes } from "./meshAssets";
import { createViewCube, type ViewCube, type ViewCubeStyle } from "./viewCube";

// The design in 3D: Z up, on a bed of 10 mm squares. It only shows the document and reports what the pointer did; the
// page turns that into commands, so nothing changes here that an assistant couldn't change the same way.
//
// The mouse works as in most CAD: the left button selects (a click, or a box dragged over empty space), the right
// button turns the view, the middle one (or Shift with the right) moves it, the wheel zooms.

/** "select" only picks; the others also put the gizmo on the one body selected. */
export type StudioMode = "select" | "translate" | "rotate" | "scale";
export type SketchTool = "rectangle" | "circle" | "polygon";
export type CameraView = "iso" | "top" | "front" | "right";

export type StudioViewportHandle = {
  fit: () => void;
  view: (view: CameraView) => void;
  /** Drops a shape half drawn, or a selection box; false when there wasn't one. */
  cancelDrawing: () => boolean;
};

type Props = {
  designId: string;
  document: StudioDocument;
  selected: readonly string[];
  mode: StudioMode;
  /** The sketch being drawn on, and with what. */
  sketch: { id: string; tool: SketchTool } | null;
  onSelect: (id: string | null, additive: boolean) => void;
  /** What a selection box took in. */
  onBoxSelect: (ids: string[], additive: boolean) => void;
  onTransform: (id: string, transform: Transform) => void;
  onShape: (sketchId: string, shape: SketchShape) => void;
  onContextMenu: (id: string, at: { top: number; left: number }) => void;
  /** The bodies that couldn't be made, by id, each time that changes. */
  onErrors: (errors: Record<string, string>) => void;
};

const BED = 300;
// A click moves the pointer less than this; more is a drag.
const CLICK_PX = 4;
// Where a polygon's last click closes it, near its first point.
const CLOSE_PX = 10;
const CREASE = (30 * Math.PI) / 180;
const SNAP_MM = 1;
const CAMERA_MS = 280;
// A hair off straight up or down, so the camera's up (Z) is never along the way it looks.
const off = (direction: THREE.Vector3) =>
  Math.abs(direction.z) > 0.9999
    ? new THREE.Vector3(0, -0.001 * Math.sign(direction.z), direction.z).normalize()
    : direction;
const DIRECTIONS: Record<CameraView, THREE.Vector3> = {
  iso: new THREE.Vector3(1, -1.6, 1.1).normalize(),
  top: off(new THREE.Vector3(0, 0, 1)),
  front: new THREE.Vector3(0, -1, 0),
  right: new THREE.Vector3(1, 0, 0),
};

let manifold: Promise<ManifoldToplevel> | null = null;
const loadManifold = () => (manifold ??= library("manifold") as unknown as Promise<ManifoldToplevel>);

const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What a body's shape depends on, apart from its own place: when it's unchanged the body isn't made again. */
function shapeKey(doc: StudioDocument, feature: BodyFeature): string {
  const parts: unknown[] = [];
  const visit = (id: string) => {
    const input = featureById(doc, id);
    if (!input) return;
    inputsOf(input).forEach(visit);
    parts.push(input);
  };
  inputsOf(feature).forEach(visit);
  const { transform: _transform, name: _name, visible: _visible, ...shape } = feature;
  parts.push(shape);
  return JSON.stringify(parts);
}

function applyTransform(object: THREE.Object3D, { position, rotation, scale }: Transform) {
  object.position.set(...position);
  // The document turns about the world X, then Y, then Z: three's "ZYX" order.
  object.rotation.set(...(rotation.map(THREE.MathUtils.degToRad) as [number, number, number]), "ZYX");
  object.scale.set(...scale);
}

const round = (value: number, step: number) => Math.round(value / step) * step;
const tidy = (value: number) => Number(value.toFixed(3)) + 0;

type BodyObject = { key: string; group: THREE.Group; mesh: THREE.Mesh; edges: THREE.LineSegments };
type Drawing =
  { tool: "rectangle" | "circle"; start: Vec2; end: Vec2 } | { tool: "polygon"; points: Vec2[]; hover: Vec2 | null };
type Pointer = { x: number; y: number; button: number; boxing: boolean };

const StudioViewport = forwardRef<StudioViewportHandle, Props>(function StudioViewport(props, ref) {
  const theme = useTheme();
  const { t, i18n } = useTranslation("app");
  const host = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const cubeHost = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  // The scene, built once; the effects below keep it in step with the props.
  const stage = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    orbit: OrbitControls;
    gizmo: TransformControls;
    cube: ViewCube;
    bodies: Map<string, BodyObject>;
    errors: Map<string, string>;
    sketches: THREE.Group;
    bed: THREE.Group;
    sketchGrid: THREE.Group;
    preview: THREE.Group;
    drawing: Drawing | null;
    pointer: Pointer | null;
    hovered: string | null;
    render: () => void;
    /** Moves the camera there, gliding unless motion is to be kept down. */
    moveCamera: (position: THREE.Vector3, target: THREE.Vector3) => void;
    generation: number;
  } | null>(null);

  // --- Colours, from the theme ---
  const colors = {
    model: paletteForTheme(theme.palette.mode).color,
    accent: new THREE.Color(theme.palette.primary.main),
    edge: new THREE.Color(theme.palette.text.primary),
    grid: new THREE.Color(theme.palette.text.secondary),
    x: new THREE.Color(theme.palette.error.main),
    y: new THREE.Color(theme.palette.success.main),
    sketch: new THREE.Color(theme.palette.text.secondary),
  };
  const colorKey = `${theme.palette.mode}|${theme.palette.primary.main}`;
  const cubeStyle = (): ViewCubeStyle => ({
    labels: {
      top: t("studio.viewCube.top"),
      bottom: t("studio.viewCube.bottom"),
      front: t("studio.viewCube.front"),
      back: t("studio.viewCube.back"),
      left: t("studio.viewCube.left"),
      right: t("studio.viewCube.right"),
    },
    face: theme.palette.background.paper,
    line: theme.palette.mode === "dark" ? theme.palette.grey[600] : theme.palette.grey[400],
    text: theme.palette.text.primary,
    accent: theme.palette.primary.main,
  });

  // --- The scene ---
  useEffect(() => {
    const container = canvasHost.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.outline = "none";

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(150, -200, 300);
    scene.add(key);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 50_000);
    camera.up.set(0, 0, 1);
    camera.position.copy(DIRECTIONS.iso).multiplyScalar(420);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0, 0);
    // The left button selects; the right turns the view (Shift with it moves it), the middle moves it.
    orbit.mouseButtons = { LEFT: -1 as THREE.MOUSE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

    let frame = 0;
    let cube: ViewCube | null = null;
    const render = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(scene, camera);
        cube?.sync(camera);
      });
    };
    orbit.addEventListener("change", render);

    let glide = 0;
    const moveCamera = (position: THREE.Vector3, target: THREE.Vector3) => {
      cancelAnimationFrame(glide);
      const fromTarget = orbit.target.clone();
      const fromOffset = camera.position.clone().sub(fromTarget);
      const toOffset = position.clone().sub(target);
      const finish = () => {
        orbit.target.copy(target);
        camera.position.copy(position);
        orbit.update();
        render();
      };
      if (reducedMotion()) return finish();
      // Round the design, not through it: the direction turns, the distance and the centre slide.
      const turn = new THREE.Quaternion().setFromUnitVectors(
        fromOffset.clone().normalize(),
        toOffset.clone().normalize(),
      );
      const fromLength = fromOffset.length();
      const toLength = toOffset.length();
      const started = performance.now();
      const step = (now: number) => {
        const linear = Math.min(1, (now - started) / CAMERA_MS);
        const eased = linear < 0.5 ? 4 * linear ** 3 : 1 - (-2 * linear + 2) ** 3 / 2;
        if (linear >= 1) return finish();
        const along = new THREE.Quaternion().slerp(turn, eased);
        const offset = fromOffset.clone().normalize().applyQuaternion(along);
        offset.multiplyScalar(fromLength + (toLength - fromLength) * eased);
        orbit.target.lerpVectors(fromTarget, target, eased);
        camera.position.copy(orbit.target).add(offset);
        orbit.update();
        render();
        glide = requestAnimationFrame(step);
      };
      glide = requestAnimationFrame(step);
    };

    cube = createViewCube(cubeHost.current!, {
      style: cubeStyle(),
      // Seen from that side, as far away as now.
      onPick: (direction) => {
        const distance = camera.position.distanceTo(orbit.target);
        moveCamera(orbit.target.clone().addScaledVector(off(direction), distance), orbit.target.clone());
      },
      onOrbit: (dx, dy) => {
        // As OrbitControls turns it: about Z, and up and down short of straight over the top.
        const toYUp = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
        const offset = camera.position.clone().sub(orbit.target).applyQuaternion(toYUp);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta -= dx * 0.01;
        spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * 0.01, 0.001, Math.PI - 0.001);
        offset.setFromSpherical(spherical).applyQuaternion(toYUp.invert());
        camera.position.copy(orbit.target).add(offset);
        camera.lookAt(orbit.target);
        orbit.update();
        render();
      },
    });

    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setTranslationSnap(SNAP_MM);
    gizmo.setRotationSnap(THREE.MathUtils.degToRad(5));
    gizmo.setScaleSnap(0.05);
    gizmo.addEventListener("change", render);
    gizmo.addEventListener("dragging-changed", (event) => {
      orbit.enabled = !event.value;
      const object = gizmo.object;
      if (event.value || !object) return;
      const id = object.userData.featureId as string;
      const rotation = new THREE.Euler().setFromQuaternion(object.quaternion, "ZYX");
      latest.current.onTransform(id, {
        position: object.position.toArray().map((v) => tidy(round(v, 0.01))) as Transform["position"],
        rotation: [rotation.x, rotation.y, rotation.z].map((v) =>
          tidy(round(THREE.MathUtils.radToDeg(v), 0.01)),
        ) as Transform["rotation"],
        scale: object.scale.toArray().map((v) => tidy(Math.max(0.001, round(v, 0.001)))) as Transform["scale"],
      });
    });
    scene.add(gizmo.getHelper());

    const bed = new THREE.Group();
    const sketches = new THREE.Group();
    const sketchGrid = new THREE.Group();
    const preview = new THREE.Group();
    scene.add(bed, sketches, sketchGrid, preview);

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    stage.current = {
      renderer,
      scene,
      camera,
      orbit,
      gizmo,
      cube,
      bodies: new Map(),
      errors: new Map(),
      sketches,
      bed,
      sketchGrid,
      preview,
      drawing: null,
      pointer: null,
      hovered: null,
      render,
      moveCamera,
      generation: 0,
    };
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(glide);
      cube?.dispose();
      gizmo.detach();
      gizmo.dispose();
      orbit.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => m.dispose());
        }
      });
      scene.environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      stage.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The cube's labels and colours follow the theme and the language.
  useEffect(() => {
    stage.current?.cube.setStyle(cubeStyle());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorKey, i18n.language]);

  // The bed: a grid of 10 mm squares, X and Y drawn in their axis colours.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    clear(s.bed);
    const grid = new THREE.GridHelper(BED, BED / 10, colors.grid, colors.grid);
    grid.rotation.x = Math.PI / 2;
    (grid.material as THREE.LineBasicMaterial).transparent = true;
    (grid.material as THREE.LineBasicMaterial).opacity = theme.palette.mode === "dark" ? 0.18 : 0.22;
    s.bed.add(grid);
    const axis = (to: THREE.Vector3, color: THREE.Color) =>
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), to]),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
      );
    s.bed.add(axis(new THREE.Vector3(BED / 2, 0, 0.01), colors.x), axis(new THREE.Vector3(0, BED / 2, 0.01), colors.y));
    s.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorKey]);

  // --- Bodies: made again only when their shape changed; moving one only moves it ---
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const doc = props.document;
    const generation = ++s.generation;
    const bodies = topLevel(doc).filter(isBody);
    const wanted = new Map(bodies.map((feature) => [feature.id, shapeKey(doc, feature)]));
    for (const [id, body] of s.bodies) {
      if (wanted.get(id) === body.key) continue;
      // Gone, or changed shape: it's made again below, if it's still there.
      if (s.gizmo.object === body.group) s.gizmo.detach();
      s.scene.remove(body.group);
      body.mesh.geometry.dispose();
      body.edges.geometry.dispose();
      s.bodies.delete(id);
    }
    for (const id of s.errors.keys()) if (!wanted.has(id)) s.errors.delete(id);
    const place = () => {
      for (const feature of bodies) {
        const body = s.bodies.get(feature.id);
        if (!body) continue;
        applyTransform(body.group, feature.transform);
        body.group.visible = feature.visible;
      }
      paint();
      attachGizmo();
      s.render();
    };
    const stale = bodies.filter((feature) => !s.bodies.has(feature.id)).map((feature) => feature.id);
    if (!stale.length) {
      place();
      return;
    }
    void Promise.all([loadManifold(), designMeshes(props.designId, doc)]).then(([wasm, meshes]) => {
      if (generation !== s.generation || !stage.current) return;
      const { bodies: made, errors } = evaluateDesign(wasm, doc, stale, meshes);
      for (const id of stale) s.errors.delete(id);
      for (const error of errors) s.errors.set(error.id, error.message);
      for (const body of made) {
        const indexed = new THREE.BufferGeometry();
        indexed.setAttribute("position", new THREE.BufferAttribute(body.mesh.positions, 3));
        indexed.setIndex(new THREE.BufferAttribute(body.mesh.indices, 1));
        const geometry = toCreasedNormals(indexed, CREASE);
        indexed.dispose();
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            metalness: 0.1,
            roughness: 0.65,
            // An open mesh has an inside to see through its gaps.
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          }),
        );
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 30),
          new THREE.LineBasicMaterial({ transparent: true }),
        );
        const group = new THREE.Group();
        group.userData.featureId = body.id;
        mesh.userData.featureId = body.id;
        group.add(mesh, edges);
        s.scene.add(group);
        s.bodies.set(body.id, { key: wanted.get(body.id)!, group, mesh, edges });
      }
      latest.current.onErrors(Object.fromEntries(s.errors));
      place();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.document]);

  // --- Sketches: their outlines on their planes ---
  const activeSketch = props.sketch?.id ?? null;
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    clear(s.sketches);
    const shown = props.document.features.filter(
      (feature): feature is SketchFeature =>
        feature.type === "sketch" &&
        (feature.id === activeSketch || (feature.visible && topLevel(props.document).includes(feature))),
    );
    for (const sketch of shown) {
      const lit = sketch.id === activeSketch || props.selected.includes(sketch.id);
      const { n } = planeAxes(sketch.plane);
      for (const shape of sketch.shapes) {
        const points = shapeOutline(shape).map((point) => {
          const [x, y, z] = sketchPointToWorld(sketch, point);
          // A hair in front of the plane, so the bed's lines don't cross it out.
          return new THREE.Vector3(x + n[0] * 0.02, y + n[1] * 0.02, z + n[2] * 0.02);
        });
        const material = shape.hole
          ? new THREE.LineDashedMaterial({ color: lit ? colors.accent : colors.sketch, dashSize: 1.5, gapSize: 1 })
          : new THREE.LineBasicMaterial({ color: lit ? colors.accent : colors.sketch });
        const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
        if (shape.hole) loop.computeLineDistances();
        loop.userData.featureId = sketch.id;
        s.sketches.add(loop);
      }
    }
    s.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.document, props.selected, activeSketch, colorKey]);

  // --- Selection in the accent colour; what's under the pointer a little of it ---
  const paint = () => {
    const s = stage.current;
    if (!s) return;
    const chosen = new Set(latest.current.selected);
    for (const [id, body] of s.bodies) {
      const on = chosen.has(id);
      const hover = !on && s.hovered === id;
      const material = body.mesh.material as THREE.MeshStandardMaterial;
      material.color.copy(colors.model).lerp(colors.accent, on ? 0.35 : hover ? 0.15 : 0);
      material.emissive.copy(colors.accent);
      material.emissiveIntensity = on ? 0.12 : hover ? 0.05 : 0;
      const edges = body.edges.material as THREE.LineBasicMaterial;
      edges.color.copy(on || hover ? colors.accent : colors.edge);
      edges.opacity = on ? 0.95 : hover ? 0.6 : theme.palette.mode === "dark" ? 0.22 : 0.18;
    }
    s.render();
  };

  // The gizmo sits on the one body selected, while moving, turning or scaling, and not while sketching.
  const attachGizmo = () => {
    const s = stage.current;
    if (!s) return;
    const { selected, sketch, mode } = latest.current;
    const body = mode !== "select" && selected.length === 1 && !sketch ? s.bodies.get(selected[0]) : undefined;
    if (body && body.group.visible && mode !== "select") {
      if (s.gizmo.object !== body.group) s.gizmo.attach(body.group);
      s.gizmo.setMode(mode);
      s.gizmo.setSpace(mode === "translate" ? "world" : "local");
    } else if (s.gizmo.object) {
      s.gizmo.detach();
    }
    s.render();
  };

  useEffect(() => {
    paint();
    attachGizmo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selected, props.mode, activeSketch, colorKey]);

  // --- Camera ---
  const frame = (direction: THREE.Vector3, box?: THREE.Box3) => {
    const s = stage.current;
    if (!s) return;
    let bounds = box;
    if (!bounds) {
      bounds = new THREE.Box3();
      for (const body of s.bodies.values()) if (body.group.visible) bounds.expandByObject(body.group);
      for (const line of s.sketches.children) bounds.expandByObject(line);
      if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-60, -60, 0), new THREE.Vector3(60, 60, 30));
    }
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad(s.camera.fov);
    const distance = Math.max(20, (sphere.radius / Math.sin(fov / 2)) * 1.15);
    s.camera.near = Math.max(0.1, distance / 1000);
    s.camera.far = distance * 100;
    s.camera.updateProjectionMatrix();
    s.moveCamera(sphere.center.clone().addScaledVector(direction, distance), sphere.center.clone());
  };

  const cancelBox = () => {
    const s = stage.current;
    if (!s?.pointer?.boxing) return false;
    s.pointer = null;
    if (boxRef.current) boxRef.current.style.display = "none";
    return true;
  };

  useImperativeHandle(ref, () => ({
    fit: () => {
      const s = stage.current;
      if (!s) return;
      frame(s.camera.position.clone().sub(s.orbit.target).normalize());
    },
    view: (view) => frame(DIRECTIONS[view]),
    cancelDrawing: () => {
      if (cancelBox()) return true;
      const s = stage.current;
      if (!s?.drawing) return false;
      s.drawing = null;
      clear(s.preview);
      s.render();
      return true;
    },
  }));

  // --- Sketch mode: the plane faces the camera, the left button draws ---
  const sketchFeature = activeSketch ? featureById(props.document, activeSketch) : undefined;
  const sketchPlaneKey =
    sketchFeature?.type === "sketch" ? `${sketchFeature.id}|${sketchFeature.plane}|${sketchFeature.offset}` : null;
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    clear(s.sketchGrid);
    clear(s.preview);
    s.drawing = null;
    const sketch = sketchFeature?.type === "sketch" ? sketchFeature : null;
    if (!sketch) {
      s.render();
      return;
    }
    const { u, v, n } = planeAxes(sketch.plane);
    const grid = new THREE.GridHelper(BED, BED / 5, colors.accent, colors.accent);
    (grid.material as THREE.LineBasicMaterial).transparent = true;
    (grid.material as THREE.LineBasicMaterial).opacity = 0.16;
    // GridHelper lies in XZ: turn its X and Z onto the plane's u and v.
    grid.matrixAutoUpdate = false;
    const origin = new THREE.Vector3(...sketchPointToWorld(sketch, [0, 0]));
    grid.matrix
      .makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...n), new THREE.Vector3(...v))
      .setPosition(origin);
    s.sketchGrid.add(grid);
    const facing: Record<SketchFeature["plane"], CameraView> = { XY: "top", XZ: "front", YZ: "right" };
    frame(
      DIRECTIONS[facing[sketch.plane]],
      new THREE.Box3().setFromCenterAndSize(origin, new THREE.Vector3(160, 160, 160)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketchPlaneKey]);

  // --- The pointer ---
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const canvas = s.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 1.5 };
    let hoverFrame = 0;

    const ndc = (event: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    const pick = (event: MouseEvent): string | null => {
      raycaster.setFromCamera(ndc(event), s.camera);
      const targets = [
        ...[...s.bodies.values()].filter((body) => body.group.visible).map((body) => body.mesh),
        ...s.sketches.children,
      ];
      const hit = raycaster.intersectObjects(targets, false)[0];
      return (hit?.object.userData.featureId as string | undefined) ?? null;
    };

    // --- Box selection: left to right takes what's wholly inside, right to left also what it touches ---
    const drawBox = (event: PointerEvent) => {
      const start = s.pointer!;
      const rect = canvas.getBoundingClientRect();
      const box = boxRef.current!;
      const crossing = event.clientX < start.x;
      Object.assign(box.style, {
        display: "block",
        left: `${Math.min(start.x, event.clientX) - rect.left}px`,
        top: `${Math.min(start.y, event.clientY) - rect.top}px`,
        width: `${Math.abs(event.clientX - start.x)}px`,
        height: `${Math.abs(event.clientY - start.y)}px`,
        borderStyle: crossing ? "dashed" : "solid",
      });
    };
    const boxSelect = (event: PointerEvent) => {
      const start = s.pointer!;
      const rect = canvas.getBoundingClientRect();
      const [left, right] = [Math.min(start.x, event.clientX), Math.max(start.x, event.clientX)];
      const [top, bottom] = [Math.min(start.y, event.clientY), Math.max(start.y, event.clientY)];
      const crossing = event.clientX < start.x;
      /** An object's outline on the screen, from the corners of its box in the world. */
      const onScreen = (object: THREE.Object3D) => {
        const world = new THREE.Box3().setFromObject(object);
        if (world.isEmpty()) return null;
        const xs: number[] = [];
        const ys: number[] = [];
        for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const point = new THREE.Vector3(
            corner & 1 ? world.max.x : world.min.x,
            corner & 2 ? world.max.y : world.min.y,
            corner & 4 ? world.max.z : world.min.z,
          ).project(s.camera);
          xs.push(rect.left + ((point.x + 1) / 2) * rect.width);
          ys.push(rect.top + ((1 - point.y) / 2) * rect.height);
        }
        return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
      };
      const taken = (object: THREE.Object3D) => {
        const area = onScreen(object);
        if (!area) return false;
        return crossing
          ? area.left < right && area.right > left && area.top < bottom && area.bottom > top
          : area.left >= left && area.right <= right && area.top >= top && area.bottom <= bottom;
      };
      const ids = new Set<string>();
      for (const [id, body] of s.bodies) if (body.group.visible && taken(body.group)) ids.add(id);
      for (const line of s.sketches.children) if (taken(line)) ids.add(line.userData.featureId as string);
      latest.current.onBoxSelect([...ids], event.shiftKey || event.metaKey || event.ctrlKey);
    };

    const activeSketchFeature = (): SketchFeature | null => {
      const id = latest.current.sketch?.id;
      const feature = id ? featureById(latest.current.document, id) : undefined;
      return feature?.type === "sketch" ? feature : null;
    };

    /** Where the pointer is on the sketch's plane, in its own [u, v] mm, snapped to the millimetre. */
    const onPlane = (event: PointerEvent | MouseEvent, sketch: SketchFeature): Vec2 | null => {
      const { u, v, n } = planeAxes(sketch.plane);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(...n),
        new THREE.Vector3(...sketchPointToWorld(sketch, [0, 0])),
      );
      raycaster.setFromCamera(ndc(event), s.camera);
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return null;
      return [
        tidy(round(hit.dot(new THREE.Vector3(...u)), SNAP_MM)),
        tidy(round(hit.dot(new THREE.Vector3(...v)), SNAP_MM)),
      ];
    };

    const shapeOf = (drawing: Drawing, closing = false): SketchShape | null => {
      if (drawing.tool === "polygon") {
        const points = closing || !drawing.hover ? drawing.points : [...drawing.points, drawing.hover];
        return points.length >= (closing ? 3 : 2) ? { type: "polygon", points } : null;
      }
      if (drawing.tool === "rectangle") {
        const [a, b] = [drawing.start, drawing.end];
        const width = Math.abs(b[0] - a[0]);
        const height = Math.abs(b[1] - a[1]);
        if (!width || !height) return null;
        return { type: "rectangle", center: [tidy((a[0] + b[0]) / 2), tidy((a[1] + b[1]) / 2)], width, height };
      }
      const radius = tidy(Math.hypot(drawing.end[0] - drawing.start[0], drawing.end[1] - drawing.start[1]));
      return radius ? { type: "circle", center: drawing.start, radius } : null;
    };

    const drawPreview = () => {
      clear(s.preview);
      const sketch = activeSketchFeature();
      if (!s.drawing || !sketch) return s.render();
      const shape = shapeOf(s.drawing);
      if (shape) {
        const points = shapeOutline(shape).map((point) => new THREE.Vector3(...sketchPointToWorld(sketch, point)));
        const LineType = shape.type === "polygon" && s.drawing.tool === "polygon" ? THREE.Line : THREE.LineLoop;
        s.preview.add(
          new LineType(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: colors.accent }),
          ),
        );
      }
      s.render();
    };

    const finishPolygon = () => {
      const sketch = activeSketchFeature();
      if (s.drawing?.tool !== "polygon" || !sketch) return;
      const shape = shapeOf(s.drawing, true);
      s.drawing = null;
      clear(s.preview);
      s.render();
      if (shape) latest.current.onShape(sketch.id, shape);
    };

    const onPointerDown = (event: PointerEvent) => {
      s.pointer = { x: event.clientX, y: event.clientY, button: event.button, boxing: false };
      const sketch = activeSketchFeature();
      const tool = latest.current.sketch?.tool;
      if (!sketch || !tool || event.button !== 0) return;
      const at = onPlane(event, sketch);
      if (!at) return;
      if (tool === "polygon") {
        if (s.drawing?.tool !== "polygon") s.drawing = { tool, points: [at], hover: null };
        else {
          // A click back on the first point closes it.
          const first = new THREE.Vector3(...sketchPointToWorld(sketch, s.drawing.points[0])).project(s.camera);
          const rect = canvas.getBoundingClientRect();
          const dx = ((first.x + 1) / 2) * rect.width + rect.left - event.clientX;
          const dy = ((1 - first.y) / 2) * rect.height + rect.top - event.clientY;
          if (s.drawing.points.length >= 3 && Math.hypot(dx, dy) < CLOSE_PX) return finishPolygon();
          const last = s.drawing.points[s.drawing.points.length - 1];
          if (last[0] !== at[0] || last[1] !== at[1]) s.drawing.points.push(at);
        }
      } else {
        s.drawing = { tool, start: at, end: at };
        canvas.setPointerCapture(event.pointerId);
      }
      drawPreview();
    };

    const hover = (event: PointerEvent) => {
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        const id = latest.current.sketch || s.gizmo.dragging ? null : pick(event);
        if (id === s.hovered) return;
        s.hovered = id;
        canvas.style.cursor = id ? "pointer" : "";
        paint();
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      const sketch = activeSketchFeature();
      if (s.drawing && sketch) {
        const at = onPlane(event, sketch);
        if (!at) return;
        if (s.drawing.tool === "polygon") s.drawing.hover = at;
        else s.drawing.end = at;
        return drawPreview();
      }
      const pointer = s.pointer;
      // A left drag that didn't start on a gizmo handle draws a selection box.
      if (pointer && pointer.button === 0 && !sketch && event.pointerType !== "touch" && !s.gizmo.dragging) {
        if (
          !pointer.boxing &&
          Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > CLICK_PX &&
          !s.gizmo.axis
        ) {
          pointer.boxing = true;
          canvas.setPointerCapture(event.pointerId);
        }
        if (pointer.boxing) return drawBox(event);
      }
      if (!pointer) hover(event);
    };

    const onPointerUp = (event: PointerEvent) => {
      const start = s.pointer;
      s.pointer = null;
      const sketch = activeSketchFeature();
      if (sketch && s.drawing && s.drawing.tool !== "polygon") {
        const shape = shapeOf(s.drawing);
        s.drawing = null;
        clear(s.preview);
        s.render();
        if (shape) latest.current.onShape(sketch.id, shape);
        return;
      }
      if (start?.boxing) {
        if (boxRef.current) boxRef.current.style.display = "none";
        s.pointer = start;
        boxSelect(event);
        s.pointer = null;
        return;
      }
      if (sketch || !start || s.gizmo.dragging) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_PX) return;
      // The right button turns the view: its menu opens on a click that didn't, when the button comes up.
      if (start.button === 2) {
        const id = pick(event);
        if (id) latest.current.onContextMenu(id, { top: event.clientY, left: event.clientX });
        return;
      }
      if (start.button !== 0) return;
      // A click on the gizmo's handles is the gizmo's.
      if (s.gizmo.axis) return;
      latest.current.onSelect(pick(event), event.shiftKey || event.metaKey || event.ctrlKey);
    };

    const onPointerLeave = () => {
      if (s.hovered === null) return;
      s.hovered = null;
      paint();
    };

    const onDoubleClick = () => finishPolygon();

    // macOS sends this as the right button goes down, before any drag: the menu waits for it to come up instead.
    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    const onKeyDown = (event: KeyboardEvent) => {
      if (s.drawing?.tool !== "polygon") return;
      if (event.key === "Enter") {
        event.preventDefault();
        finishPolygon();
      } else if (event.key === "Backspace" && s.drawing.points.length > 1) {
        event.preventDefault();
        s.drawing.points.pop();
        drawPreview();
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(hoverFrame);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorKey]);

  return (
    <Box ref={host} sx={{ position: "absolute", inset: 0 }}>
      <Box
        ref={canvasHost}
        sx={{ position: "absolute", inset: 0, cursor: props.sketch ? "crosshair" : "default", touchAction: "none" }}
      />
      <Box
        ref={boxRef}
        aria-hidden
        sx={{
          display: "none",
          position: "absolute",
          pointerEvents: "none",
          border: 1,
          borderColor: "primary.main",
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          borderRadius: 0.5,
        }}
      />
      <Box
        sx={{
          position: "absolute",
          top: 8,
          right: 8,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          zIndex: 1,
        }}
      >
        {/* For the mouse: the toolbar's Views menu and the button below do the same from the keyboard. */}
        <Box ref={cubeHost} aria-hidden title={t("studio.viewCube.label")} />
        <Tooltip title={t("studio.viewCube.home")} placement="left">
          <IconButton
            size="small"
            aria-label={t("studio.viewCube.home")}
            onClick={() => frame(DIRECTIONS.iso)}
            sx={{ mt: -0.5, mr: 0.5 }}
          >
            <HomeOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
});

/** Empties a group, freeing what its lines and meshes held. */
function clear(group: THREE.Group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    child.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => m.dispose());
      }
    });
  }
}

export default StudioViewport;
