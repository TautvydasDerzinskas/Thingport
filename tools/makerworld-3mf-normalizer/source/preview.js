// The before-and-after preview: each 3MF's triangles drawn with WebGL, in their filament colours, in views that turn
// together. Drawn when something changes rather than every frame, and with no 3D library.

const VERTEX = `
attribute vec3 position;
attribute vec3 normal;
attribute vec3 colour;
uniform mat4 viewProjection;
varying vec3 shaded;
void main() {
  vec3 light = normalize(vec3(-0.45, -0.6, 0.75));
  // Lit from above and a little from behind; faces seen from inside get the same light as from outside.
  float key = abs(dot(normal, light));
  float rim = max(dot(normal, normalize(vec3(0.6, 0.5, 0.2))), 0.0);
  shaded = colour * (0.42 + 0.5 * key + 0.12 * rim);
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec3 shaded;
void main() {
  gl_FragColor = vec4(min(shaded, vec3(1.0)), 1.0);
}`;

const DEFAULT_ORBIT = { azimuth: -55, elevation: 28, zoom: 0.8 };

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const range = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * range, -1, 0, 0, 2 * far * near * range, 0];
}

function lookAt(eye, target, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}

function multiply(a, b) {
  const out = new Array(16);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  return out;
}

/** The meshes as flat arrays for drawing, a normal for each triangle, and the box round them. */
function prepare(preview) {
  let count = 0;
  for (const mesh of preview?.meshes ?? []) count += mesh.positions.length;
  const positions = new Float32Array(count);
  const normals = new Float32Array(count);
  const colours = new Float32Array(count);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let at = 0;
  for (const mesh of preview?.meshes ?? []) {
    const p = mesh.positions;
    positions.set(p, at);
    colours.set(mesh.colors, at);
    for (let i = 0; i + 8 < p.length; i += 9) {
      const ux = p[i + 3] - p[i];
      const uy = p[i + 4] - p[i + 1];
      const uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i];
      const vy = p[i + 7] - p[i + 1];
      const vz = p[i + 8] - p[i + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      for (let v = 0; v < 3; v++) {
        normals[at + i + v * 3] = nx;
        normals[at + i + v * 3 + 1] = ny;
        normals[at + i + v * 3 + 2] = nz;
        for (let axis = 0; axis < 3; axis++) {
          const value = p[i + v * 3 + axis];
          if (value < min[axis]) min[axis] = value;
          if (value > max[axis]) max[axis] = value;
        }
      }
    }
    at += p.length;
  }
  const empty = !count;
  const centre = empty ? [0, 0, 0] : min.map((value, axis) => (value + max[axis]) / 2);
  const radius = empty ? 1 : Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  return { positions, normals, colours, vertices: count / 3, centre, radius };
}

/** One canvas's drawing: WebGL, or null where the browser has none. */
function createView(canvas) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) return null;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) || "Shader failed");
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Link failed");
  const buffers = {};
  for (const name of ["position", "normal", "colour"])
    buffers[name] = { buffer: gl.createBuffer(), at: gl.getAttribLocation(program, name) };
  const viewProjection = gl.getUniformLocation(program, "viewProjection");
  let scene = prepare(null);

  return {
    canvas,
    get scene() {
      return scene;
    },
    show(preview) {
      scene = prepare(preview);
      const data = { position: scene.positions, normal: scene.normals, colour: scene.colours };
      for (const [name, { buffer }] of Object.entries(buffers)) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data[name], gl.STATIC_DRAW);
      }
    },
    draw(orbit) {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!scene.vertices) return;
      const { centre, radius } = scene;
      const a = (orbit.azimuth * Math.PI) / 180;
      const e = (orbit.elevation * Math.PI) / 180;
      const fov = (32 * Math.PI) / 180;
      // Far enough back for the whole model to fit, then nearer or further by the zoom.
      const distance = (radius / Math.sin(fov / 2)) * 1.08 * orbit.zoom;
      const eye = [
        centre[0] + distance * Math.cos(e) * Math.cos(a),
        centre[1] + distance * Math.cos(e) * Math.sin(a),
        centre[2] + distance * Math.sin(e),
      ];
      const matrix = multiply(
        perspective(fov, width / height, Math.max(distance - radius * 2, distance / 100), distance + radius * 2),
        lookAt(eye, centre, [0, 0, 1]),
      );
      gl.useProgram(program);
      gl.enable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(viewProjection, false, new Float32Array(matrix));
      for (const { buffer, at } of Object.values(buffers)) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, 3, gl.FLOAT, false, 0, 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, scene.vertices);
    },
    dispose() {
      for (const { buffer } of Object.values(buffers)) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/**
 * Views on `canvases` that turn together: drag to turn, the wheel to zoom, double-click to go back to the start, and
 * the arrow keys and + and − when one has focus. `false` when the browser can't draw them.
 */
export function createPreview(canvases) {
  let views;
  try {
    views = canvases.map(createView);
  } catch {
    views = [null];
  }
  if (views.some((view) => !view)) {
    for (const view of views) view?.dispose();
    return false;
  }
  const orbit = { ...DEFAULT_ORBIT };
  let frame = 0;
  const redraw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const view of views) view.draw(orbit);
    });
  };
  const turn = (dAzimuth, dElevation) => {
    orbit.azimuth = (orbit.azimuth + dAzimuth) % 360;
    orbit.elevation = Math.max(-85, Math.min(85, orbit.elevation + dElevation));
    redraw();
  };
  const zoom = (factor) => {
    orbit.zoom = Math.max(0.15, Math.min(6, orbit.zoom * factor));
    redraw();
  };
  const reset = () => {
    Object.assign(orbit, DEFAULT_ORBIT);
    redraw();
  };

  const cleanups = [];
  for (const { canvas } of views) {
    let last = null;
    const down = (event) => {
      if (event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      last = { x: event.clientX, y: event.clientY };
      canvas.style.cursor = "grabbing";
    };
    const move = (event) => {
      if (!last) return;
      turn(-(event.clientX - last.x) * 0.5, (event.clientY - last.y) * 0.4);
      last = { x: event.clientX, y: event.clientY };
    };
    const up = () => {
      last = null;
      canvas.style.cursor = "";
    };
    const wheel = (event) => {
      event.preventDefault();
      zoom(event.deltaY > 0 ? 1.12 : 1 / 1.12);
    };
    const key = (event) => {
      const steps = { ArrowLeft: [10, 0], ArrowRight: [-10, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] };
      if (steps[event.key]) turn(...steps[event.key]);
      else if (event.key === "+" || event.key === "=") zoom(1 / 1.12);
      else if (event.key === "-" || event.key === "_") zoom(1.12);
      else if (event.key === "0" || event.key === "Home") reset();
      else return;
      event.preventDefault();
    };
    const listeners = [
      ["pointerdown", down],
      ["pointermove", move],
      ["pointerup", up],
      ["pointercancel", up],
      ["dblclick", reset],
      ["keydown", key],
    ];
    for (const [type, fn] of listeners) canvas.addEventListener(type, fn);
    canvas.addEventListener("wheel", wheel, { passive: false });
    cleanups.push(() => {
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      canvas.removeEventListener("wheel", wheel);
    });
  }
  const resize = new ResizeObserver(redraw);
  for (const { canvas } of views) resize.observe(canvas);

  return {
    /** Shows one preview in each view, as extractPreviewMeshes gives them, from the start. */
    show(previews) {
      previews.forEach((preview, i) => views[i].show(preview));
      reset();
    },
    redraw,
    dispose() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      for (const cleanup of cleanups) cleanup();
      for (const view of views) view.dispose();
    },
  };
}
