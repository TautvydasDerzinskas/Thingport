import * as THREE from "three";

// The cube in the view's corner: it turns as the camera does, a click on a face, an edge or a corner looks at the
// design from there (26 ways in all), and dragging it turns the view. Its own small canvas, over the main one.

export type ViewCubeFace = "top" | "bottom" | "front" | "back" | "left" | "right";
export type ViewCubeStyle = {
  labels: Record<ViewCubeFace, string>;
  /** CSS colours, from the theme. */
  face: string;
  line: string;
  text: string;
  accent: string;
};

type Options = {
  style: ViewCubeStyle;
  /** Towards the camera, from the design: a face's normal, or two or three of them added up. */
  onPick: (direction: THREE.Vector3) => void;
  /** The pointer moved this far, in pixels, while dragging the cube. */
  onOrbit: (dx: number, dy: number) => void;
};

export type ViewCube = {
  sync: (camera: THREE.Camera) => void;
  setStyle: (style: ViewCubeStyle) => void;
  dispose: () => void;
};

const SIZE = 96;
// How far from an edge counts as the edge, as a share of the cube's side.
const BAND = 0.22;
const DRAG_PX = 3;

// Z is up and the front faces -Y, as in the design.
const FACES: { face: ViewCubeFace; normal: THREE.Vector3; up: THREE.Vector3 }[] = [
  { face: "top", normal: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) },
  { face: "bottom", normal: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, -1, 0) },
  { face: "front", normal: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1) },
  { face: "back", normal: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, 1) },
  { face: "right", normal: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
  { face: "left", normal: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 0, 1) },
];

function labelTexture(label: string, style: ViewCubeStyle): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = style.face;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = style.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Shrunk until it fits, as some languages' words are long.
  let font = 24;
  do ctx.font = `700 ${font--}px "Open Sans", system-ui, sans-serif`;
  while (ctx.measureText(label).width > size - 18 && font > 10);
  ctx.fillText(label, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Which part of the cube a point on it is: each axis is -1, 0 or 1, as the point is near that side or not. */
function regionAt(point: THREE.Vector3): THREE.Vector3 {
  const near = (value: number) => (Math.abs(value) >= 0.5 - BAND ? Math.sign(value) : 0);
  return new THREE.Vector3(near(point.x), near(point.y), near(point.z));
}

/** A box over that part, a hair outside the cube, to light it up. */
function regionBox(region: THREE.Vector3): { center: THREE.Vector3; size: THREE.Vector3 } {
  const parts = Math.abs(region.x) + Math.abs(region.y) + Math.abs(region.z);
  const axis = (value: number) =>
    value === 0
      ? { center: 0, size: 1 - 2 * BAND }
      : parts === 1
        ? { center: value * 0.505, size: 0.01 }
        : { center: value * (0.5 - BAND / 2 + 0.006), size: BAND + 0.012 };
  const [x, y, z] = [axis(region.x), axis(region.y), axis(region.z)];
  return { center: new THREE.Vector3(x.center, y.center, z.center), size: new THREE.Vector3(x.size, y.size, z.size) };
}

export function createViewCube(container: HTMLElement, options: Options): ViewCube {
  let style = options.style;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(SIZE, SIZE);
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.cursor = "pointer";
  canvas.style.touchAction = "none";
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-0.95, 0.95, 0.95, -0.95, 0.1, 10);
  camera.position.set(0, 0, 3);

  const faces = FACES.map(({ face, normal, up }) => {
    const right = new THREE.Vector3().crossVectors(up, normal);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeBasis(right, up, normal).setPosition(normal.clone().multiplyScalar(0.5));
    mesh.userData.face = face;
    scene.add(mesh);
    return mesh;
  });
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ transparent: true }),
  );
  scene.add(edges);
  const highlight = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55 }),
  );
  highlight.visible = false;
  scene.add(highlight);

  const render = () => renderer.render(scene, camera);

  const paint = () => {
    for (const mesh of faces) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.map = labelTexture(style.labels[mesh.userData.face as ViewCubeFace], style);
      material.needsUpdate = true;
    }
    (edges.material as THREE.LineBasicMaterial).color.set(style.line);
    (highlight.material as THREE.MeshBasicMaterial).color.set(style.accent);
    render();
  };
  paint();

  const raycaster = new THREE.Raycaster();
  const regionUnder = (event: PointerEvent): THREE.Vector3 | null => {
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(faces, false)[0];
    return hit ? regionAt(hit.point) : null;
  };
  const showRegion = (region: THREE.Vector3 | null) => {
    highlight.visible = Boolean(region);
    if (region) {
      const { center, size } = regionBox(region);
      highlight.position.copy(center);
      highlight.scale.copy(size);
    }
    render();
  };

  let down: { x: number; y: number; lastX: number; lastY: number; dragging: boolean } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    down = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragging: false };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!down) return showRegion(regionUnder(event));
    if (!down.dragging && Math.hypot(event.clientX - down.x, event.clientY - down.y) > DRAG_PX) {
      down.dragging = true;
      canvas.style.cursor = "grabbing";
      showRegion(null);
    }
    if (down.dragging) options.onOrbit(event.clientX - down.lastX, event.clientY - down.lastY);
    down.lastX = event.clientX;
    down.lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    const was = down;
    down = null;
    canvas.style.cursor = "pointer";
    if (!was || was.dragging) return;
    const region = regionUnder(event);
    if (region) options.onPick(region.clone().normalize());
  };
  const onPointerLeave = () => {
    if (!down) showRegion(null);
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);

  return {
    // The cube is seen as the design is: from the same side, the same way up.
    sync: (main) => {
      camera.quaternion.copy(main.quaternion);
      camera.position.set(0, 0, 3).applyQuaternion(main.quaternion);
      render();
    },
    setStyle: (next) => {
      style = next;
      paint();
    },
    dispose: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const material = object.material as THREE.MeshBasicMaterial;
          material.map?.dispose();
          material.dispose();
        }
      });
      renderer.dispose();
      canvas.remove();
    },
  };
}
