// The keyring in three dimensions, drawn with Thingport's own Three.js.
//
// Each piece is its own mesh in its own colour, so a two-colour design looks here the way it will come off the
// printer, and a click can tell the letters from the border. Normals are welded only across shallow angles, so a
// rounded top looks rounded while the edge of the border stays an edge.
//
// It draws when something changes rather than every frame, so a still window costs nothing.

import { creasedGeometry } from "./meshNormals.js";

/** Where the camera starts, and the views the buttons jump to: around, up, and how close. */
const HOME = { around: -32, up: 34, zoom: 1 };
export const VIEWS = {
  home: HOME,
  front: { around: -90, up: 0, zoom: 1.08 },
  top: { around: -90, up: 89.9, zoom: 1.08 },
  side: { around: 0, up: 0, zoom: 1.08 },
};

/** Things of a known size to sit the keyring beside, so its size means something. Millimetres. */
export const SIZE_GUIDES = {
  none: null,
  card: { label: "Bank card", width: 85.6, height: 54 },
  phone: { label: "Phone", width: 71.5, height: 149.6 },
};

/**
 * A viewer on one canvas. `three` is what `library("three")` gives. Returns null where the browser has no WebGL,
 * and the window then shows the figures without a picture.
 */
export function createViewer(three, canvas, { onPick, onDrag } = {}) {
  let renderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);

  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(36, 1, 0.1, 5000);
  // Lit from the front and above, with a soft fill, so a flat keyring still reads as a solid.
  const key = new three.DirectionalLight(0xffffff, 2.2);
  key.position.set(-0.4, -0.9, 1.1);
  const rim = new three.DirectionalLight(0xffffff, 0.7);
  rim.position.set(0.8, 0.6, 0.4);
  scene.add(key, rim, new three.AmbientLight(0xffffff, 1.1), new three.HemisphereLight(0xffffff, 0x404458, 1.2));

  const group = new three.Group();
  const guideGroup = new three.Group();
  const handleGroup = new three.Group();
  scene.add(group, guideGroup, handleGroup);

  const orbit = { ...HOME };
  const centre = new three.Vector3();
  let radius = 20;
  let frame = 0;
  let disposed = false;
  let selected = null;
  let handles = [];
  let dragging = null;

  function place() {
    // Far enough back that the whole thing fits whichever way the window is shaped: a long keyring in a tall
    // window is held by the narrower of the two angles the camera sees, not by a fixed multiple of its size.
    const upright = (camera.fov * Math.PI) / 180;
    const across = 2 * Math.atan(Math.tan(upright / 2) * Math.max(0.2, camera.aspect));
    const distance = (radius * 1.06) / Math.sin(Math.min(upright, across) / 2) / Math.max(0.15, orbit.zoom);
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
    orbit.zoom = Math.max(0.15, Math.min(10, orbit.zoom * factor));
    redraw();
  };
  const look = (name) => {
    Object.assign(orbit, VIEWS[name] ?? HOME);
    redraw();
  };

  const raycaster = new three.Raycaster();
  const pointer = new three.Vector2();
  const at = (event) => {
    const box = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster;
  };

  /** Where the pointer meets the plane the handles live on, in model millimetres. */
  const onPlane = (event, z) => {
    const ray = at(event).ray;
    const plane = new three.Plane(new three.Vector3(0, 0, 1), -z);
    const hit = ray.intersectPlane(plane, new three.Vector3());
    return hit ? { x: hit.x, y: hit.y } : null;
  };

  let last = null;
  const down = (event) => {
    if (event.button !== 0) return;
    place();
    if (handles.length) {
      const hit = at(event).intersectObjects(handleGroup.children, false)[0];
      if (hit) {
        const handle = handles.find((h) => h.mesh === hit.object);
        if (handle) {
          dragging = { handle, z: handle.z };
          canvas.setPointerCapture(event.pointerId);
          canvas.style.cursor = "grabbing";
          onPick?.(handle.pick);
          return;
        }
      }
    }
    const part = at(event).intersectObjects(group.children, false)[0];
    if (part) onPick?.(part.object.userData.pick ?? null);
    else onPick?.(null);
    canvas.setPointerCapture(event.pointerId);
    last = { x: event.clientX, y: event.clientY };
    canvas.style.cursor = "grabbing";
  };
  const move = (event) => {
    if (dragging) {
      const point = onPlane(event, dragging.z);
      if (point) {
        dragging.handle.mesh.position.set(point.x, point.y, dragging.z);
        onDrag?.(dragging.handle.pick, point);
        redraw();
      }
      return;
    }
    if (!last) return;
    turn(-(event.clientX - last.x) * 0.5, (event.clientY - last.y) * 0.4);
    last = { x: event.clientX, y: event.clientY };
  };
  const up = () => {
    if (dragging) onDrag?.(dragging.handle.pick, null, true);
    dragging = null;
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

  const empty = (host) => {
    for (const child of [...host.children]) {
      host.remove(child);
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
  };

  /** One solid as geometry to draw: corner positions with the crease-aware normals, no index. */
  const build = (model) => {
    const { positions, normals } = creasedGeometry(model.vertices, model.triangles);
    const geometry = new three.BufferGeometry();
    geometry.setAttribute("position", new three.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new three.BufferAttribute(normals, 3));
    return geometry;
  };

  const shade = (colour, { selected: isSelected = false, hidden = false } = {}) =>
    new three.MeshStandardMaterial({
      color: new three.Color(colour),
      roughness: 0.6,
      metalness: 0.02,
      transparent: hidden,
      opacity: hidden ? 0.12 : 1,
      depthWrite: !hidden,
      emissive: new three.Color(isSelected ? 0x2a6bff : 0x000000),
      emissiveIntensity: isSelected ? 0.3 : 0,
    });

  return {
    /**
     * Shows the engine's solids. `colourOf` gives each one its colour, `hiddenOf` says which to ghost, and
     * `fit` recentres the camera — left off while someone is only nudging a ring about.
     */
    show(models, { colourOf, hiddenOf, fit = true } = {}) {
      empty(group);
      const box = new three.Box3();
      models.forEach((model, index) => {
        const geometry = build(model);
        const pick = { index, name: model.name, kind: model.kind, char: model.char };
        const mesh = new three.Mesh(
          geometry,
          shade(colourOf?.(model, index) ?? "#b9c2cf", {
            selected: selected === index,
            hidden: hiddenOf?.(model, index) ?? false,
          }),
        );
        mesh.userData.pick = pick;
        mesh.renderOrder = hiddenOf?.(model, index) ? 1 : 0;
        group.add(mesh);
        geometry.computeBoundingBox();
        if (!hiddenOf?.(model, index)) box.union(geometry.boundingBox);
      });
      if (box.isEmpty()) group.children.forEach((m) => box.union(m.geometry.boundingBox));
      if (!box.isEmpty() && fit) {
        box.getCenter(centre);
        radius = Math.max(4, box.getSize(new three.Vector3()).length() / 2);
      }
      if (fit) look("home");
      else redraw();
    },

    /** Marks one piece as the chosen one, or nothing with null. */
    select(index) {
      if (selected === index) return;
      selected = index;
      group.children.forEach((mesh, i) => {
        mesh.material.emissive.set(i === index ? 0x2a6bff : 0x000000);
        mesh.material.emissiveIntensity = i === index ? 0.3 : 0;
      });
      redraw();
    },

    /**
     * The draggable rings and magnets, as circles lying on the piece. Each is `{ pick, x, y, z, radius, colour }`;
     * `pick` comes back from `onPick` and `onDrag`.
     */
    setHandles(list) {
      empty(handleGroup);
      handles = list.map((item) => {
        const geometry = new three.RingGeometry(Math.max(0.3, item.radius - 0.45), item.radius, 36);
        const mesh = new three.Mesh(
          geometry,
          new three.MeshBasicMaterial({
            color: new three.Color(item.colour ?? "#2a6bff"),
            transparent: true,
            opacity: item.active ? 0.95 : 0.45,
            depthTest: false,
            side: three.DoubleSide,
          }),
        );
        mesh.position.set(item.x, item.y, item.z);
        mesh.renderOrder = 5;
        handleGroup.add(mesh);
        return { ...item, mesh };
      });
      redraw();
    },

    /** A card or a phone laid flat beside the keyring, for scale. */
    setGuide(name) {
      empty(guideGroup);
      const guide = SIZE_GUIDES[name];
      if (guide) {
        const half = [guide.width / 2, guide.height / 2];
        const outline = new three.BufferGeometry().setFromPoints([
          new three.Vector3(-half[0], -half[1], 0),
          new three.Vector3(half[0], -half[1], 0),
          new three.Vector3(half[0], half[1], 0),
          new three.Vector3(-half[0], half[1], 0),
          new three.Vector3(-half[0], -half[1], 0),
        ]);
        guideGroup.add(
          new three.Line(outline, new three.LineBasicMaterial({ color: 0x8893a4, transparent: true, opacity: 0.8 })),
        );
        radius = Math.max(radius, Math.hypot(half[0], half[1]));
      }
      redraw();
    },

    clear() {
      empty(group);
      empty(handleGroup);
      redraw();
    },
    look,
    redraw,
    /** The canvas as a picture, for the cover of a saved model. */
    toBlob: (type = "image/png") =>
      new Promise((resolve) => {
        draw(); // the buffer is only guaranteed to hold the picture right after a render
        canvas.toBlob(resolve, type);
      }),
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      canvas.removeEventListener("wheel", wheel);
      empty(group);
      empty(guideGroup);
      empty(handleGroup);
      renderer.dispose();
    },
  };
}
