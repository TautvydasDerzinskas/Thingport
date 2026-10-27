// Showing what the script just made.
//
// Through Thingport's own Three.js rather than a painter of this tool's own: a generator's output runs to a
// hundred thousand triangles and more, which WebGL draws without noticing and a canvas does not.

/** Drag to turn, wheel to come closer. Nothing orbits by itself: a model that spins is harder to look at. */
export function createViewer(host, { library, theme }) {
  let state = null;
  let disposed = false;

  const canvas = document.createElement("canvas");
  host.prepend(canvas);

  const ready = library("three")
    .then((THREE) => {
      if (disposed) return null;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);

      scene.add(new THREE.AmbientLight(0xffffff, 1.9));
      const key = new THREE.DirectionalLight(0xffffff, 2.1);
      key.position.set(1, 1.4, 1.2);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 0.7);
      fill.position.set(-1.2, -0.6, -1);
      scene.add(fill);

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(theme.primary),
        roughness: 0.62,
        metalness: 0.03,
        // A generated mesh can have a facet wound the wrong way; showing both sides hides a hole that isn't real.
        side: THREE.DoubleSide,
      });
      const pivot = new THREE.Group();
      scene.add(pivot);

      return { THREE, renderer, scene, camera, material, pivot, mesh: null, distance: 100, angles: { x: 0.9, y: 0.6 } };
    })
    .catch(() => null);

  function draw() {
    if (!state) return;
    const { renderer, scene, camera, pivot, angles, distance } = state;
    // Turned about the upright axis first, then tipped, so dragging sideways spins it rather than rolling it.
    // A positive tilt brings the model's top towards the camera: a plate with lettering on it is otherwise
    // shown from underneath, which looks like a model that came out blank.
    pivot.rotation.order = "YXZ";
    pivot.rotation.set(angles.x, angles.y, 0);
    // A window wider than it is tall sees less up than across, so the model is pushed back by that much.
    camera.position.set(0, 0, distance / Math.min(1, camera.aspect));
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }

  function resize() {
    if (!state) return;
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    state.renderer.setSize(width, height, false);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
    draw();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(host);

  let dragging = null;
  canvas.addEventListener("pointerdown", (event) => {
    dragging = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragging || !state) return;
    state.angles.y += (event.clientX - dragging.x) * 0.01;
    state.angles.x += (event.clientY - dragging.y) * 0.01;
    dragging = { x: event.clientX, y: event.clientY };
    draw();
  });
  const stop = () => (dragging = null);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!state) return;
      event.preventDefault();
      state.distance = Math.min(8000, Math.max(5, state.distance * (event.deltaY > 0 ? 1.1 : 0.9)));
      draw();
    },
    { passive: false },
  );

  return {
    /** `mesh` is the geometry the render already parsed: flat vertex and index arrays. */
    async show(mesh) {
      state = await ready;
      if (!state || !mesh) return;
      const { THREE } = state;
      this.clear();

      const indexed = new THREE.BufferGeometry();
      indexed.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(mesh.vertices), 3));
      indexed.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.triangles), 1));

      // Each triangle given its own corners before the normals are worked out. A solid shares a vertex between
      // faces that meet at an edge -- a cube's corner belongs to three -- and averaging across them rounds every
      // hard edge off, which on lettering reads as a smeared mess rather than a model.
      const geometry = indexed.toNonIndexed();
      indexed.dispose();
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();

      // Centred on its own middle, so turning it turns the model rather than swinging it around the origin.
      const middle = new THREE.Vector3();
      geometry.boundingBox.getCenter(middle);
      geometry.translate(-middle.x, -middle.y, -middle.z);

      const object = new THREE.Mesh(geometry, state.material);
      // OpenSCAD has Z up; the camera here looks down -Z, so the model is laid back to stand upright on screen.
      object.rotation.x = -Math.PI / 2;
      state.pivot.add(object);
      state.mesh = object;

      // Far enough back that the whole of it fits the narrower of the two directions, with a little air round it.
      const radius = geometry.boundingSphere?.radius || 10;
      const half = (state.camera.fov * Math.PI) / 360;
      const fit = radius / Math.sin(half);
      state.distance = fit * 1.15;
      state.camera.near = Math.max(0.05, radius / 100);
      state.camera.far = fit * 12;
      resize();
    },
    clear() {
      if (!state?.mesh) return;
      state.pivot.remove(state.mesh);
      state.mesh.geometry.dispose();
      state.mesh = null;
      draw();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      this.clear();
      state?.renderer.dispose();
      canvas.remove();
    },
  };
}
