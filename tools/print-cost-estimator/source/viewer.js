// The part on the plate, drawn with WebGL and no 3D library: the mesh in the theme's own colours, the faces that
// need support picked out in its warning colour, and the bed under it to the size the printer's settings give. Drawn
// when something changes rather than every frame, so a still window costs nothing.

const VERTEX = `
attribute vec3 position;
attribute vec3 normal;
attribute vec3 colour;
uniform mat4 viewProjection;
varying vec3 shaded;
void main() {
  vec3 light = normalize(vec3(-0.4, -0.65, 0.75));
  // Lit from above and a little from the front; a face seen from the inside is lit as if from the outside, so the
  // hollow of an open mesh doesn't read as a black hole.
  float key = abs(dot(normal, light));
  float rim = max(dot(normal, normalize(vec3(0.5, 0.4, 0.3))), 0.0);
  shaded = colour * (0.45 + 0.48 * key + 0.1 * rim);
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec3 shaded;
void main() {
  gl_FragColor = vec4(min(shaded, vec3(1.0)), 1.0);
}`;

const START = { azimuth: -52, elevation: 19, zoom: 0.85 };
/** Above this many triangles only every nth is drawn: the measurement still uses them all, but a mesh this size
 *  costs more to upload than the extra detail is worth on a canvas this big. */
const DRAW_LIMIT = 700_000;

const hexToRgb = (hex) => {
  const value = String(hex ?? "").trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (short) return [1, 2, 3].map((i) => parseInt(short[i] + short[i], 16) / 255);
  if (full) return [1, 2, 3].map((i) => parseInt(full[i], 16) / 255);
  const rgb = value.match(/-?\d+(\.\d+)?/g);
  if (rgb && rgb.length >= 3) return rgb.slice(0, 3).map((part) => Math.min(1, Math.max(0, Number(part) / 255)));
  return [0.6, 0.6, 0.65];
};

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const range = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * range, -1, 0, 0, 2 * far * near * range, 0];
}

function lookAt(eye, target, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const unit = (v) => {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = unit(sub(eye, target));
  const x = unit(cross(up, z));
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

/** The mesh as flat arrays for drawing: a normal a face, and a colour a vertex so overhangs can be picked out. */
function build(part, colours, highlight) {
  const triangles = part?.triangles ?? new Float32Array(0);
  const count = Math.floor(triangles.length / 9);
  const stride = count > DRAW_LIMIT ? Math.ceil(count / DRAW_LIMIT) : 1;
  const drawn = Math.ceil(count / stride);
  const positions = new Float32Array(drawn * 9);
  const normals = new Float32Array(drawn * 9);
  const tint = new Float32Array(drawn * 9);
  const base = hexToRgb(colours.model);
  const warn = hexToRgb(colours.warning);

  let at = 0;
  for (let i = 0; i < count; i += stride) {
    const from = i * 9;
    for (let v = 0; v < 9; v++) positions[at + v] = triangles[from + v];
    const ux = positions[at + 3] - positions[at];
    const uy = positions[at + 4] - positions[at + 1];
    const uz = positions[at + 5] - positions[at + 2];
    const vx = positions[at + 6] - positions[at];
    const vy = positions[at + 7] - positions[at + 1];
    const vz = positions[at + 8] - positions[at + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const colour = highlight && part?.faces?.[i] ? warn : base;
    for (let v = 0; v < 3; v++) {
      normals[at + v * 3] = nx;
      normals[at + v * 3 + 1] = ny;
      normals[at + v * 3 + 2] = nz;
      tint[at + v * 3] = colour[0];
      tint[at + v * 3 + 1] = colour[1];
      tint[at + v * 3 + 2] = colour[2];
    }
    at += 9;
  }
  return { positions, normals, colours: tint, vertices: drawn * 3, stride };
}

/**
 * The ground under the part: a grid 10 mm apart, drawn over as much of the bed as the view takes in rather than all
 * of it — on a 256 mm plate a 30 mm part would otherwise sit on one faint square with the bed's edge cutting across
 * the picture from nowhere. The bed's own outline is drawn only when it's close enough to be in the frame, where it
 * does say something.
 */
function buildBed(bed, z, colours, reach) {
  const step = 10;
  const halfX = Math.max(10, (bed?.x ?? 256) / 2);
  const halfY = Math.max(10, (bed?.y ?? 256) / 2);
  // As far out as the view goes, and never past the bed itself.
  const x = Math.min(halfX, Math.max(25, reach)) * 2;
  const y = Math.min(halfY, Math.max(25, reach)) * 2;
  const lines = [];
  const edge = hexToRgb(colours.gridEdge);
  const faint = hexToRgb(colours.grid);
  const push = (x1, y1, x2, y2, colour) => {
    lines.push({ x1, y1, x2, y2, colour });
  };
  for (let at = 0; at <= x + 0.001; at += step) push(at - x / 2, -y / 2, at - x / 2, y / 2, faint);
  for (let at = 0; at <= y + 0.001; at += step) push(-x / 2, at - y / 2, x / 2, at - y / 2, faint);
  if (x / 2 >= halfX - 0.001 && y / 2 >= halfY - 0.001) {
    push(-halfX, -halfY, halfX, -halfY, edge);
    push(-halfX, halfY, halfX, halfY, edge);
    push(-halfX, -halfY, -halfX, halfY, edge);
    push(halfX, -halfY, halfX, halfY, edge);
  }

  const positions = new Float32Array(lines.length * 6);
  const normals = new Float32Array(lines.length * 6);
  const tint = new Float32Array(lines.length * 6);
  lines.forEach((line, index) => {
    const at = index * 6;
    positions[at] = line.x1;
    positions[at + 1] = line.y1;
    positions[at + 2] = z;
    positions[at + 3] = line.x2;
    positions[at + 4] = line.y2;
    positions[at + 5] = z;
    for (let v = 0; v < 2; v++) {
      normals[at + v * 3 + 2] = 1;
      tint[at + v * 3] = line.colour[0];
      tint[at + v * 3 + 1] = line.colour[1];
      tint[at + v * 3 + 2] = line.colour[2];
    }
  });
  return { positions, normals, colours: tint, vertices: lines.length * 2 };
}

/**
 * A viewer on one canvas. `colours` takes { model, warning, grid, gridEdge }; `show(part, bed)` takes the triangles
 * and the overhang flags geometry.js measured. Returns null where the browser has no WebGL, and the window then
 * shows the figures without a picture.
 */
export function createViewer(canvas, colours) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) return null;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    return shader;
  };
  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link");
  } catch {
    return null;
  }
  gl.useProgram(program);
  const where = {
    position: gl.getAttribLocation(program, "position"),
    normal: gl.getAttribLocation(program, "normal"),
    colour: gl.getAttribLocation(program, "colour"),
    viewProjection: gl.getUniformLocation(program, "viewProjection"),
  };
  const buffers = {
    position: gl.createBuffer(),
    normal: gl.createBuffer(),
    colour: gl.createBuffer(),
    bedPosition: gl.createBuffer(),
    bedNormal: gl.createBuffer(),
    bedColour: gl.createBuffer(),
  };
  gl.enable(gl.DEPTH_TEST);

  const orbit = { ...START };
  let mesh = { vertices: 0, stride: 1 };
  let bed = { vertices: 0 };
  let centre = [0, 0, 0];
  let radius = 50;
  let frame = 0;

  const upload = (buffer, data) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  };
  const bind = (buffer, location) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
  };

  function draw() {
    const width = Math.max(1, Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1, 2)));
    const height = Math.max(1, Math.round(canvas.clientHeight * Math.min(devicePixelRatio || 1, 2)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!mesh.vertices && !bed.vertices) return;

    const azimuth = (orbit.azimuth * Math.PI) / 180;
    const elevation = (orbit.elevation * Math.PI) / 180;
    const distance = (radius * 2.6) / Math.max(0.15, orbit.zoom);
    const eye = [
      centre[0] + distance * Math.cos(elevation) * Math.cos(azimuth),
      centre[1] + distance * Math.cos(elevation) * Math.sin(azimuth),
      centre[2] + distance * Math.sin(elevation),
    ];
    const view = lookAt(eye, centre, [0, 0, 1]);
    const projection = perspective(
      Math.PI / 5,
      width / height,
      Math.max(0.1, distance - radius * 4),
      distance + radius * 6,
    );
    gl.uniformMatrix4fv(where.viewProjection, false, new Float32Array(multiply(projection, view)));

    if (bed.vertices) {
      bind(buffers.bedPosition, where.position);
      bind(buffers.bedNormal, where.normal);
      bind(buffers.bedColour, where.colour);
      gl.drawArrays(gl.LINES, 0, bed.vertices);
    }
    if (mesh.vertices) {
      bind(buffers.position, where.position);
      bind(buffers.normal, where.normal);
      bind(buffers.colour, where.colour);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.vertices);
    }
  }

  const redraw = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  };
  const turn = (azimuth, elevation) => {
    orbit.azimuth = (orbit.azimuth + azimuth) % 360;
    orbit.elevation = Math.max(-85, Math.min(85, orbit.elevation + elevation));
    redraw();
  };
  const zoom = (factor) => {
    orbit.zoom = Math.max(0.15, Math.min(8, orbit.zoom * factor));
    redraw();
  };
  const reset = () => {
    Object.assign(orbit, START);
    tilt = 0;
    redraw();
  };

  // Swinging the camera under the part, for when the overhangs are picked out: they are by definition the faces you
  // can't see from above, so showing them means going and looking.
  let tilt = 0;
  const tiltTo = (elevation) => {
    cancelAnimationFrame(tilt);
    const from = orbit.elevation;
    const distance = elevation - from;
    if (!distance) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      orbit.elevation = elevation;
      redraw();
      return;
    }
    const started = performance.now();
    const step = (now) => {
      const part = Math.min(1, (now - started) / 320);
      // Eased, so it settles rather than stops.
      orbit.elevation = from + distance * (1 - (1 - part) ** 3);
      draw();
      if (part < 1) tilt = requestAnimationFrame(step);
      else tilt = 0;
    };
    tilt = requestAnimationFrame(step);
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
    zoom(event.deltaY > 0 ? 1 / 1.12 : 1.12);
  };
  const key = (event) => {
    const steps = { ArrowLeft: [10, 0], ArrowRight: [-10, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] };
    if (steps[event.key]) turn(...steps[event.key]);
    else if (event.key === "+" || event.key === "=") zoom(1.12);
    else if (event.key === "-" || event.key === "_") zoom(1 / 1.12);
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
  const resize = new ResizeObserver(redraw);
  resize.observe(canvas);

  return {
    /** Shows a part: `{ triangles, faces, box }` from geometry.js, scaled by `scale` per cent, on a bed that size. */
    show(part, options = {}) {
      const scale = (options.scale ?? 100) / 100;
      const highlight = options.highlight ?? false;
      const built = build(part, colours, highlight);
      // The part is centred over the bed and scaled here, in the one place the triangles are copied.
      const box = part?.box;
      if (box) {
        const middle = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.min[2]];
        for (let i = 0; i < built.positions.length; i += 3) {
          built.positions[i] = (built.positions[i] - middle[0]) * scale;
          built.positions[i + 1] = (built.positions[i + 1] - middle[1]) * scale;
          built.positions[i + 2] = (built.positions[i + 2] - middle[2]) * scale;
        }
      }
      upload(buffers.position, built.positions);
      upload(buffers.normal, built.normals);
      upload(buffers.colour, built.colours);
      mesh = built;

      const size = (box?.size ?? [20, 20, 20]).map((value) => value * scale);
      centre = [0, 0, size[2] / 2];
      // Framed on the part with a little room round it, rather than on the whole plate, which is what keeps a 30 mm
      // part from being a speck on a 256 mm bed.
      radius = Math.max(8, (Math.hypot(size[0], size[1], size[2]) / 2) * 1.06);

      const plate = buildBed(options.bed, 0, colours, radius * 1.5);
      upload(buffers.bedPosition, plate.positions);
      upload(buffers.bedNormal, plate.normals);
      upload(buffers.bedColour, plate.colours);
      bed = plate;
      reset();
      return built.stride;
    },
    clear() {
      mesh = { vertices: 0, stride: 1 };
      bed = { vertices: 0 };
      redraw();
    },
    redraw,
    reset,
    /** Looks at the part from below, or back from where it started. */
    look(from) {
      tiltTo(from === "under" ? -26 : START.elevation);
    },
    dispose() {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(tilt);
      resize.disconnect();
      for (const [type, fn] of listeners) canvas.removeEventListener(type, fn);
      canvas.removeEventListener("wheel", wheel);
      for (const buffer of Object.values(buffers)) gl.deleteBuffer(buffer);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
