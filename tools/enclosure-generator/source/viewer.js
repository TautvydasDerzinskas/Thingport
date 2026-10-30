// The 3D view: the base and the lid drawn with WebGL, each in its colour, on a grid of the floor, turned by dragging
// and zoomed by the wheel. Drawn when something changes rather than every frame, and with no 3D library.

const VERTEX = `
attribute vec3 position;
attribute vec3 normal;
uniform mat4 viewProjection;
uniform vec3 offset;
uniform vec3 colour;
uniform float lit;
varying vec3 shaded;
void main() {
  vec3 light = normalize(vec3(-0.45, -0.6, 0.75));
  float key = abs(dot(normal, light));
  float rim = max(dot(normal, normalize(vec3(0.6, 0.5, 0.2))), 0.0);
  shaded = mix(colour, colour * (0.42 + 0.5 * key + 0.14 * rim), lit);
  gl_Position = viewProjection * vec4(position + offset, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec3 shaded;
uniform float alpha;
void main() {
  gl_FragColor = vec4(min(shaded, vec3(1.0)) * alpha, alpha);
}`;

export const DEFAULT_ORBIT = { azimuth: -58, elevation: 30, zoom: 1 };

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

/** Triangles as flat arrays: positions, and each triangle's normal for its three corners. */
function flatten(tris) {
  const positions = new Float32Array(tris.length * 9);
  const normals = new Float32Array(tris.length * 9);
  tris.forEach(([a, b, c], t) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    [a, b, c].forEach((p, k) => {
      positions.set(p, t * 9 + k * 3);
      normals.set([n[0] / length, n[1] / length, n[2] / length], t * 9 + k * 3);
    });
  });
  return { positions, normals, count: tris.length * 3 };
}

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return [0.5, 0.5, 0.5];
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
};

/**
 * A view on `canvas`, or null where the browser has no WebGL. Show parts with `show({ name: { tris, colour,
 * offset } })`; drag to turn, wheel to zoom, double-click to start again, and arrow keys, + and − when it has focus.
 */
export function createViewer(canvas, { grid = "#888888" } = {}) {
  const gl = canvas.getContext("webgl", {
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
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
  const at = {
    position: gl.getAttribLocation(program, "position"),
    normal: gl.getAttribLocation(program, "normal"),
    viewProjection: gl.getUniformLocation(program, "viewProjection"),
    offset: gl.getUniformLocation(program, "offset"),
    colour: gl.getUniformLocation(program, "colour"),
    lit: gl.getUniformLocation(program, "lit"),
    alpha: gl.getUniformLocation(program, "alpha"),
  };

  const parts = new Map();
  let gridLines = null;
  let gridColour = hexToRgb(grid);
  let bounds = { centre: [0, 0, 20], radius: 60 };
  const orbit = { ...DEFAULT_ORBIT };
  let frame = 0;

  const upload = (data) => {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  };

  function draw() {
    frame = 0;
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
    const { centre, radius } = bounds;
    const a = (orbit.azimuth * Math.PI) / 180;
    const e = (orbit.elevation * Math.PI) / 180;
    const fov = (30 * Math.PI) / 180;
    const distance = (radius / Math.sin(fov / 2)) * 1.05 * orbit.zoom;
    const eye = [
      centre[0] + distance * Math.cos(e) * Math.cos(a),
      centre[1] + distance * Math.cos(e) * Math.sin(a),
      centre[2] + distance * Math.sin(e),
    ];
    const matrix = multiply(
      perspective(fov, width / height, Math.max(distance / 50, distance - radius * 3), distance + radius * 4),
      lookAt(eye, centre, [0, 0, 1]),
    );
    gl.useProgram(program);
    gl.enable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(at.viewProjection, false, new Float32Array(matrix));
    gl.enableVertexAttribArray(at.position);

    if (gridLines) {
      gl.disableVertexAttribArray(at.normal);
      gl.vertexAttrib3f(at.normal, 0, 0, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, gridLines.buffer);
      gl.vertexAttribPointer(at.position, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3f(at.offset, 0, 0, 0);
      gl.uniform3fv(at.colour, gridColour);
      gl.uniform1f(at.lit, 0);
      gl.uniform1f(at.alpha, 0.45);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.LINES, 0, gridLines.count);
      gl.disable(gl.BLEND);
    }
    gl.enableVertexAttribArray(at.normal);
    for (const part of parts.values()) {
      if (!part.visible || !part.count) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, part.positions);
      gl.vertexAttribPointer(at.position, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, part.normals);
      gl.vertexAttribPointer(at.normal, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(at.offset, part.offset);
      gl.uniform3fv(at.colour, part.colour);
      gl.uniform1f(at.lit, 1);
      gl.uniform1f(at.alpha, 1);
      gl.drawArrays(gl.TRIANGLES, 0, part.count);
    }
  }
  const redraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  /** A grid of 10 mm squares on the floor, a little bigger than the model. */
  function makeGrid(min, max) {
    const step = 10;
    const pad = 20;
    const x0 = Math.floor((min[0] - pad) / step) * step;
    const x1 = Math.ceil((max[0] + pad) / step) * step;
    const y0 = Math.floor((min[1] - pad) / step) * step;
    const y1 = Math.ceil((max[1] + pad) / step) * step;
    const lines = [];
    for (let x = x0; x <= x1; x += step) lines.push(x, y0, -0.05, x, y1, -0.05);
    for (let y = y0; y <= y1; y += step) lines.push(x0, y, -0.05, x1, y, -0.05);
    if (gridLines) gl.deleteBuffer(gridLines.buffer);
    gridLines = { buffer: upload(new Float32Array(lines)), count: lines.length / 3 };
  }

  // Turning and zooming.
  const turn = (dAzimuth, dElevation) => {
    orbit.azimuth = (orbit.azimuth + dAzimuth) % 360;
    orbit.elevation = Math.max(-85, Math.min(89, orbit.elevation + dElevation));
    redraw();
  };
  const zoom = (factor) => {
    orbit.zoom = Math.max(0.2, Math.min(5, orbit.zoom * factor));
    redraw();
  };
  const reset = () => {
    Object.assign(orbit, DEFAULT_ORBIT);
    redraw();
  };
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
    zoom(event.deltaY > 0 ? 1.1 : 1 / 1.1);
  };
  const key = (event) => {
    const steps = { ArrowLeft: [10, 0], ArrowRight: [-10, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] };
    if (steps[event.key]) turn(...steps[event.key]);
    else if (event.key === "+" || event.key === "=") zoom(1 / 1.1);
    else if (event.key === "-" || event.key === "_") zoom(1.1);
    else if (event.key === "0" || event.key === "Home") reset();
    else return;
    event.preventDefault();
    event.stopPropagation();
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
  const resize = new ResizeObserver(redraw);
  resize.observe(canvas);

  return {
    /** Replaces the parts drawn: { name: { tris, colour: "#rrggbb", offset: [x, y, z], visible } }. */
    show(next, { refit = false } = {}) {
      for (const [name, part] of parts)
        if (!(name in next)) {
          gl.deleteBuffer(part.positions);
          gl.deleteBuffer(part.normals);
          parts.delete(name);
        }
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const [name, spec] of Object.entries(next)) {
        let part = parts.get(name);
        if (!part || part.tris !== spec.tris) {
          if (part) {
            gl.deleteBuffer(part.positions);
            gl.deleteBuffer(part.normals);
          }
          const flat = flatten(spec.tris);
          part = {
            tris: spec.tris,
            positions: upload(flat.positions),
            normals: upload(flat.normals),
            count: flat.count,
          };
          parts.set(name, part);
        }
        part.colour = hexToRgb(spec.colour);
        part.offset = spec.offset ?? [0, 0, 0];
        part.visible = spec.visible !== false;
        if (!part.visible) continue;
        for (const tri of spec.tris)
          for (const p of tri)
            for (let i = 0; i < 3; i++) {
              const v = p[i] + part.offset[i];
              if (v < min[i]) min[i] = v;
              if (v > max[i]) max[i] = v;
            }
      }
      if (Number.isFinite(min[0])) {
        const centre = min.map((m, i) => (m + max[i]) / 2);
        const radius = Math.max(10, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
        // Kept steady while the model changes a little, so the view doesn't jump at every setting.
        if (
          refit ||
          Math.abs(radius - bounds.radius) > bounds.radius * 0.25 ||
          Math.hypot(...centre.map((c, i) => c - bounds.centre[i])) > bounds.radius * 0.3
        )
          bounds = { centre, radius };
        makeGrid(min, max);
      }
      redraw();
    },
    setGridColour(hex) {
      gridColour = hexToRgb(hex);
      redraw();
    },
    reset,
    redraw,
    /** The view as a PNG, `size` pixels square on `background`, for a model's picture. */
    async snapshot(size = 900, background = "#ffffff") {
      draw();
      const out = document.createElement("canvas");
      out.width = size;
      out.height = size;
      const ctx = out.getContext("2d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size, size);
      const side = Math.min(canvas.width, canvas.height);
      ctx.drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, 0, 0, size, size);
      return new Promise((resolve) => out.toBlob((blob) => resolve(blob), "image/png"));
    },
    dispose() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      canvas.removeEventListener("wheel", wheel);
      for (const part of parts.values()) {
        gl.deleteBuffer(part.positions);
        gl.deleteBuffer(part.normals);
      }
      if (gridLines) gl.deleteBuffer(gridLines.buffer);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
