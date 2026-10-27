// The tile in three dimensions, drawn with Thingport's own Three.js.
//
// A part per filament, each in its own colour, so what is on screen is what will come off a printer with those
// spools loaded. Normals are welded only across shallow angles, so a domed module looks domed while the edge of
// the plate stays an edge.
//
// It draws when something changes rather than every frame, so a still window costs nothing.

/** Where the camera starts, and the views the buttons jump to: around, up, and how close. */
const HOME = { around: -90, up: 52, zoom: 1 };
export const VIEWS = {
  home: HOME,
  front: { around: -90, up: 89.9, zoom: 1.05 },
  angle: { around: -60, up: 24, zoom: 1 },
  back: { around: -90, up: -89.9, zoom: 1.05 },
};

/** Where two triangles meeting at a shallower angle than this are smoothed over. */
const CREASE = Math.cos((38 * Math.PI) / 180);

/**
 * Corner normals that smooth a curve but keep an edge.
 *
 * Every triangle at a corner is averaged in only where it faces roughly the same way as the one being shaded, so
 * a dome's facets blend and the side of a module meeting its top does not.
 */
export function creasedNormals(vertices, triangles) {
  const positions = new Float32Array(triangles.length * 3);
  const normals = new Float32Array(triangles.length * 3);
  const faces = new Float32Array((triangles.length / 3) * 3);
  const byVertex = new Map();

  for (let face = 0; face < triangles.length / 3; face++) {
    const [a, b, c] = [triangles[face * 3], triangles[face * 3 + 1], triangles[face * 3 + 2]];
    const ax = vertices[a * 3];
    const ay = vertices[a * 3 + 1];
    const az = vertices[a * 3 + 2];
    const ux = vertices[b * 3] - ax;
    const uy = vertices[b * 3 + 1] - ay;
    const uz = vertices[b * 3 + 2] - az;
    const vx = vertices[c * 3] - ax;
    const vy = vertices[c * 3 + 1] - ay;
    const vz = vertices[c * 3 + 2] - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    faces[face * 3] = nx / length;
    faces[face * 3 + 1] = ny / length;
    faces[face * 3 + 2] = nz / length;
    // Corners in the same place are the same corner, whichever triangle wrote them.
    for (const index of [a, b, c]) {
      const key = `${Math.round(vertices[index * 3] * 1000)},${Math.round(vertices[index * 3 + 1] * 1000)},${Math.round(vertices[index * 3 + 2] * 1000)}`;
      const list = byVertex.get(key);
      if (list) list.push(face);
      else byVertex.set(key, [face]);
    }
  }

  for (let face = 0; face < triangles.length / 3; face++) {
    for (let corner = 0; corner < 3; corner++) {
      const index = triangles[face * 3 + corner];
      const at = (face * 3 + corner) * 3;
      positions[at] = vertices[index * 3];
      positions[at + 1] = vertices[index * 3 + 1];
      positions[at + 2] = vertices[index * 3 + 2];
      const key = `${Math.round(vertices[index * 3] * 1000)},${Math.round(vertices[index * 3 + 1] * 1000)},${Math.round(vertices[index * 3 + 2] * 1000)}`;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (const other of byVertex.get(key) ?? [face]) {
        const dot =
          faces[face * 3] * faces[other * 3] +
          faces[face * 3 + 1] * faces[other * 3 + 1] +
          faces[face * 3 + 2] * faces[other * 3 + 2];
        if (dot < CREASE) continue;
        nx += faces[other * 3];
        ny += faces[other * 3 + 1];
        nz += faces[other * 3 + 2];
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[at] = nx / length;
      normals[at + 1] = ny / length;
      normals[at + 2] = nz / length;
    }
  }
  return { positions, normals };
}

/**
 * A viewer on one canvas. `three` is what `library("three")` gives. Returns null where the browser has no WebGL,
 * and the window then shows the flat view instead.
 */
export function createViewer(three, canvas, { onPick } = {}) {
  let renderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);

  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(34, 1, 0.1, 8000);
  const key = new three.DirectionalLight(0xffffff, 2.1);
  key.position.set(-0.5, -0.8, 1.2);
  const rim = new three.DirectionalLight(0xffffff, 0.65);
  rim.position.set(0.9, 0.7, 0.5);
  scene.add(key, rim, new three.AmbientLight(0xffffff, 1.05), new three.HemisphereLight(0xffffff, 0x3c4048, 1.15));

  const group = new three.Group();
  scene.add(group);

  const orbit = { ...HOME };
  const centre = new three.Vector3();
  let radius = 40;
  let frame = 0;
  let disposed = false;

  function place() {
    const upright = (camera.fov * Math.PI) / 180;
    const across = 2 * Math.atan(Math.tan(upright / 2) * Math.max(0.2, camera.aspect));
    const distance = (radius * 1.05) / Math.sin(Math.min(upright, across) / 2) / Math.max(0.15, orbit.zoom);
    const around = (orbit.around * Math.PI) / 180;
    const up = (orbit.up * Math.PI) / 180;
    camera.position.set(
      centre.x + distance * Math.cos(up) * Math.cos(around),
      centre.y + distance * Math.cos(up) * Math.sin(around),
      centre.z + distance * Math.sin(up),
    );
    camera.up.set(0, 0, 1);
    camera.lookAt(centre);
    camera.near = Math.max(0.1, distance - radius * 4);
    camera.far = distance + radius * 6;
    camera.updateProjectionMatrix();
  }

  function draw() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(ratio);
    if (
      renderer.domElement.width !== Math.round(width * ratio) ||
      renderer.domElement.height !== Math.round(height * ratio)
    ) {
      renderer.setSize(width, height, false);
    }
    camera.aspect = width / height;
    place();
    renderer.render(scene, camera);
  }

  const redraw = () => {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  };
  const turn = (around, up) => {
    orbit.around = (orbit.around + around) % 360;
    orbit.up = Math.max(-89.9, Math.min(89.9, orbit.up + up));
    redraw();
  };
  const zoom = (factor) => {
    orbit.zoom = Math.max(0.2, Math.min(12, orbit.zoom * factor));
    redraw();
  };
  const look = (name) => {
    Object.assign(orbit, VIEWS[name] ?? HOME);
    redraw();
  };

  const raycaster = new three.Raycaster();
  const pointer = new three.Vector2();
  let last = null;
  const down = (event) => {
    if (event.button !== 0) return;
    place();
    const box = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(group.children, false)[0];
    onPick?.(hit?.object.userData.pick ?? null);
    canvas.setPointerCapture(event.pointerId);
    last = { x: event.clientX, y: event.clientY };
    canvas.style.cursor = "grabbing";
  };
  const move = (event) => {
    if (!last) return;
    turn(-(event.clientX - last.x) * 0.45, (event.clientY - last.y) * 0.4);
    last = { x: event.clientX, y: event.clientY };
  };
  const up = () => {
    last = null;
    canvas.style.cursor = "";
  };
  const wheel = (event) => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 1 / 1.12 : 1.12);
  };
  const keys = (event) => {
    const steps = { ArrowLeft: [10, 0], ArrowRight: [-10, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] };
    if (steps[event.key]) turn(...steps[event.key]);
    else if (event.key === "+" || event.key === "=") zoom(1.12);
    else if (event.key === "-" || event.key === "_") zoom(1 / 1.12);
    else if (event.key === "0" || event.key === "Home") look("home");
    else return;
    event.preventDefault();
  };
  const listeners = [
    ["pointerdown", down],
    ["pointermove", move],
    ["pointerup", up],
    ["pointercancel", up],
    ["keydown", keys],
  ];
  for (const [type, fn] of listeners) canvas.addEventListener(type, fn);
  canvas.addEventListener("wheel", wheel, { passive: false });
  const resize = new ResizeObserver(redraw);
  resize.observe(canvas);

  const empty = () => {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
  };

  return {
    /** Shows the model's parts, each in its filament's colour. */
    show(parts, { fit = true } = {}) {
      empty();
      const box = new three.Box3();
      for (const part of parts) {
        const { positions, normals } = creasedNormals(part.vertices, part.triangles);
        const geometry = new three.BufferGeometry();
        geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
        geometry.setAttribute("normal", new three.BufferAttribute(normals, 3));
        const mesh = new three.Mesh(
          geometry,
          new three.MeshStandardMaterial({
            color: new three.Color(part.colour ?? "#b9c2cf"),
            roughness: 0.62,
            metalness: 0.02,
          }),
        );
        mesh.userData.pick = { name: part.name, kind: part.kind, slot: part.slot, colour: part.colour };
        group.add(mesh);
        geometry.computeBoundingBox();
        box.union(geometry.boundingBox);
      }
      if (!box.isEmpty() && fit) {
        box.getCenter(centre);
        radius = Math.max(6, box.getSize(new three.Vector3()).length() / 2);
        look("home");
      } else redraw();
    },
    clear() {
      empty();
      redraw();
    },
    look,
    redraw,
    /** The canvas as a picture, for the cover of a saved model. */
    toBlob: (type = "image/png") =>
      new Promise((resolve) => {
        draw(); // the buffer only holds the picture right after a render
        canvas.toBlob(resolve, type);
      }),
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      canvas.removeEventListener("wheel", wheel);
      empty();
      renderer.dispose();
    },
  };
}
