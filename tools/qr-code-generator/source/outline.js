// Outlines that didn't come from the code: a letter of the caption, and a logo someone brought.
//
// Both arrive as curves and have to leave as rings of straight lines with their holes known — the counter of an
// "o", the gap in a ring — because that is what the triangulator takes. Curves are split only as finely as they
// need: a shallow one costs two points and a tight one as many as it takes.

/** How far a point lies from the line between two others. */
function offLine(point, from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = dx * dx + dy * dy;
  const along = length ? Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / length)) : 0;
  return Math.hypot(point[0] - from[0] - along * dx, point[1] - from[1] - along * dy);
}

const middle = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
/** Twelve halvings is finer than any printer, and stops a degenerate curve from going on for ever. */
const DEPTH = 12;

/** A path being walked, turning its curves into points as it goes. */
function walker(tolerance) {
  const polygons = [];
  let polygon = [];
  let last = [0, 0];
  const limit = Math.max(0.0005, tolerance);

  const append = (point) => {
    last = point;
    if (
      !polygon.length ||
      Math.hypot(point[0] - polygon[polygon.length - 1][0], point[1] - polygon[polygon.length - 1][1]) > 1e-9
    ) {
      polygon.push(point);
    }
  };
  const finish = () => {
    if (polygon.length > 2) polygons.push(polygon);
    polygon = [];
  };

  function quadratic(from, control, to, depth = 0) {
    if (depth >= DEPTH || offLine(control, from, to) <= limit) {
      append(to);
      return;
    }
    const a = middle(from, control);
    const b = middle(control, to);
    const centre = middle(a, b);
    quadratic(from, a, centre, depth + 1);
    quadratic(centre, b, to, depth + 1);
  }

  function cubic(from, first, second, to, depth = 0) {
    if (depth >= DEPTH || Math.max(offLine(first, from, to), offLine(second, from, to)) <= limit) {
      append(to);
      return;
    }
    const a = middle(from, first);
    const b = middle(first, second);
    const c = middle(second, to);
    const ab = middle(a, b);
    const bc = middle(b, c);
    const centre = middle(ab, bc);
    cubic(from, a, ab, centre, depth + 1);
    cubic(centre, bc, c, to, depth + 1);
  }

  return {
    move: (point) => {
      finish();
      append(point);
    },
    line: append,
    quadratic: (control, to) => quadratic(last, control, to),
    cubic: (first, second, to) => cubic(last, first, second, to),
    close: finish,
    get at() {
      return last;
    },
    get start() {
      return polygon[0] ?? last;
    },
    done() {
      finish();
      return polygons;
    },
  };
}

/**
 * The closed rings of an opentype path, in the font's own units with y pointing up.
 *
 * A font measures y downwards and a model upwards, so every y is turned round as it is read.
 */
export function flattenPath(path, tolerance = 0.08) {
  const walk = walker(tolerance);
  for (const command of path.commands) {
    const end = [command.x, -command.y];
    if (command.type === "M") walk.move(end);
    else if (command.type === "L") walk.line(end);
    else if (command.type === "Q") walk.quadratic([command.x1, -command.y1], end);
    else if (command.type === "C") walk.cubic([command.x1, -command.y1], [command.x2, -command.y2], end);
    else if (command.type === "Z") walk.close();
  }
  return walk.done();
}

const area = (ring) => {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    total += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return total / 2;
};

const inside = (ring, point) => {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      within = !within;
    }
  }
  return within;
};

/**
 * Rings sorted into shapes with their holes: a ring inside an odd number of others is a hole, and belongs to the
 * smallest shape that contains it.
 *
 * Winding is deliberately not what decides this. A font and an SVG wind their contours differently, and a hand-
 * drawn SVG often winds them inconsistently, so what encloses what is the only thing that can be relied on.
 */
export function groupContours(rings) {
  const kept = rings.filter((ring) => ring.length > 2 && Math.abs(area(ring)) > 1e-9);
  const sorted = kept.map((ring) => ({ ring, size: Math.abs(area(ring)) })).sort((a, b) => b.size - a.size);
  const shapes = [];
  for (const candidate of sorted) {
    const point = candidate.ring[0];
    // How many of the bigger rings contain this one: an odd number means it's a hole.
    const containing = sorted.filter(
      (other) => other !== candidate && other.size > candidate.size && inside(other.ring, point),
    );
    if (containing.length % 2 === 0) shapes.push({ outer: candidate.ring, holes: [], size: candidate.size });
    else {
      const parent = containing[containing.length - 1];
      const shape = shapes.find((item) => item.outer === parent.ring);
      if (shape) shape.holes.push(candidate.ring);
    }
  }
  return shapes.map(({ outer, holes }) => ({ outer, holes }));
}

/** Every shape moved and scaled the same way. */
export const transformShapes = (shapes, scale, dx, dy) =>
  shapes.map(({ outer, holes }) => ({
    outer: outer.map(([x, y]) => [x * scale + dx, y * scale + dy]),
    holes: holes.map((hole) => hole.map(([x, y]) => [x * scale + dx, y * scale + dy])),
  }));

/** The box round a set of shapes. */
export function shapeBounds(shapes) {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { outer } of shapes) {
    for (const [x, y] of outer) {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  }
  return box;
}

// ---- a logo from an SVG ----------------------------------------------------------------------------------------

const numbers = (text) => (text.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);

/** `transform="translate(…) scale(…)"` and the rest, as one matrix `[a, b, c, d, e, f]`. */
function parseTransform(text) {
  let matrix = [1, 0, 0, 1, 0, 0];
  const multiply = (m, n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  for (const [, name, args] of String(text ?? "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const values = numbers(args);
    if (name === "translate") matrix = multiply(matrix, [1, 0, 0, 1, values[0] ?? 0, values[1] ?? 0]);
    else if (name === "scale") matrix = multiply(matrix, [values[0] ?? 1, 0, 0, values[1] ?? values[0] ?? 1, 0, 0]);
    else if (name === "matrix" && values.length >= 6) matrix = multiply(matrix, values.slice(0, 6));
    else if (name === "rotate") {
      const angle = ((values[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const [cx, cy] = [values[1] ?? 0, values[2] ?? 0];
      matrix = multiply(matrix, [1, 0, 0, 1, cx, cy]);
      matrix = multiply(matrix, [cos, sin, -sin, cos, 0, 0]);
      matrix = multiply(matrix, [1, 0, 0, 1, -cx, -cy]);
    }
  }
  return matrix;
}

const applyMatrix = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** An elliptical arc as cubic curves, which is the only part of a path that isn't already one. */
function arcToCurves(from, rx, ry, rotation, largeArc, sweep, to) {
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let a = Math.abs(rx);
  let b = Math.abs(ry);
  if (!a || !b) return [{ type: "L", to }];
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const check = (x1 * x1) / (a * a) + (y1 * y1) / (b * b);
  if (check > 1) {
    const grow = Math.sqrt(check);
    a *= grow;
    b *= grow;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const top = a * a * b * b - a * a * y1 * y1 - b * b * x1 * x1;
  const bottom = a * a * y1 * y1 + b * b * x1 * x1;
  const factor = sign * Math.sqrt(Math.max(0, top / (bottom || 1)));
  const cxPrime = (factor * a * y1) / b;
  const cyPrime = (-factor * b * x1) / a;
  const cx = cos * cxPrime - sin * cyPrime + (from[0] + to[0]) / 2;
  const cy = sin * cxPrime + cos * cyPrime + (from[1] + to[1]) / 2;
  const angleOf = (x, y) => Math.atan2((y - cyPrime) / b, (x - cxPrime) / a);
  const start = angleOf(x1, y1);
  let sweepAngle = angleOf(-x1, -y1) - start;
  if (!sweep && sweepAngle > 0) sweepAngle -= Math.PI * 2;
  if (sweep && sweepAngle < 0) sweepAngle += Math.PI * 2;
  const steps = Math.max(1, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 2)));
  const out = [];
  let at = start;
  for (let i = 0; i < steps; i++) {
    const step = sweepAngle / steps;
    const next = at + step;
    const alpha = (4 / 3) * Math.tan(step / 4);
    const point = (t) => {
      const x = a * Math.cos(t);
      const y = b * Math.sin(t);
      return [cos * x - sin * y + cx, sin * x + cos * y + cy];
    };
    const slope = (t) => {
      const x = -a * Math.sin(t);
      const y = b * Math.cos(t);
      return [cos * x - sin * y, sin * x + cos * y];
    };
    const p0 = point(at);
    const p1 = point(next);
    const d0 = slope(at);
    const d1 = slope(next);
    out.push({
      type: "C",
      first: [p0[0] + alpha * d0[0], p0[1] + alpha * d0[1]],
      second: [p1[0] - alpha * d1[0], p1[1] - alpha * d1[1]],
      to: p1,
    });
    at = next;
  }
  return out;
}

/** An SVG `d` attribute as rings, in the SVG's own coordinates with y pointing down. */
function flattenSvgPath(d, tolerance) {
  const walk = walker(tolerance);
  const tokens = String(d).match(/[astvzqmhlc]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let at = [0, 0];
  let subpathStart = [0, 0];
  let command = "";
  let lastControl = null;
  let i = 0;
  const next = () => Number(tokens[i++]);

  while (i < tokens.length) {
    if (/[astvzqmhlc]/i.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const letter = command.toUpperCase();
    const base = relative ? at : [0, 0];
    if (letter === "M") {
      at = [base[0] + next(), base[1] + next()];
      subpathStart = at;
      walk.move(at);
      command = relative ? "l" : "L";
      lastControl = null;
    } else if (letter === "L") {
      at = [base[0] + next(), base[1] + next()];
      walk.line(at);
      lastControl = null;
    } else if (letter === "H") {
      at = [(relative ? at[0] : 0) + next(), at[1]];
      walk.line(at);
      lastControl = null;
    } else if (letter === "V") {
      at = [at[0], (relative ? at[1] : 0) + next()];
      walk.line(at);
      lastControl = null;
    } else if (letter === "C" || letter === "S") {
      const first =
        letter === "C"
          ? [base[0] + next(), base[1] + next()]
          : lastControl
            ? [2 * at[0] - lastControl[0], 2 * at[1] - lastControl[1]]
            : at;
      const second = [base[0] + next(), base[1] + next()];
      const to = [base[0] + next(), base[1] + next()];
      walk.cubic(first, second, to);
      lastControl = second;
      at = to;
    } else if (letter === "Q" || letter === "T") {
      const control =
        letter === "Q"
          ? [base[0] + next(), base[1] + next()]
          : lastControl
            ? [2 * at[0] - lastControl[0], 2 * at[1] - lastControl[1]]
            : at;
      const to = [base[0] + next(), base[1] + next()];
      walk.quadratic(control, to);
      lastControl = control;
      at = to;
    } else if (letter === "A") {
      const rx = next();
      const ry = next();
      const rotation = next();
      const largeArc = next() !== 0;
      const sweep = next() !== 0;
      const to = [base[0] + next(), base[1] + next()];
      for (const piece of arcToCurves(at, rx, ry, rotation, largeArc, sweep, to)) {
        if (piece.type === "L") walk.line(piece.to);
        else walk.cubic(piece.first, piece.second, piece.to);
      }
      at = to;
      lastControl = null;
    } else if (letter === "Z") {
      walk.close();
      at = subpathStart;
      walk.move(at);
      lastControl = null;
    } else {
      i++; // something unknown: step over it rather than spin
    }
  }
  return walk.done();
}

/**
 * An SVG as shapes with their holes, y pointing up, ready to be scaled into the middle of a code.
 *
 * Paths, rectangles, circles, ellipses, polygons and polylines are read, with the transforms on them and on the
 * groups round them. Anything else in the file — a bitmap, a gradient, text that hasn't been turned into
 * outlines — simply isn't geometry, so it is left out and the count of what was read is reported.
 */
export function shapesFromSvg(text, { tolerance = 0.6 } = {}) {
  const document = new DOMParser().parseFromString(String(text), "image/svg+xml");
  if (document.querySelector("parsererror")) throw new Error("That file isn't SVG this can read.");
  const svg = document.querySelector("svg");
  if (!svg) throw new Error("That file has no <svg> in it.");

  const rings = [];
  let skipped = 0;
  const matrixOf = (node) => {
    let matrix = [1, 0, 0, 1, 0, 0];
    const chain = [];
    for (let at = node; at && at !== svg.parentNode; at = at.parentNode) chain.unshift(at);
    for (const step of chain) {
      const own = parseTransform(step.getAttribute?.("transform"));
      matrix = [
        matrix[0] * own[0] + matrix[2] * own[1],
        matrix[1] * own[0] + matrix[3] * own[1],
        matrix[0] * own[2] + matrix[2] * own[3],
        matrix[1] * own[2] + matrix[3] * own[3],
        matrix[0] * own[4] + matrix[2] * own[5] + matrix[4],
        matrix[1] * own[4] + matrix[3] * own[5] + matrix[5],
      ];
    }
    return matrix;
  };
  const add = (node, polygons) => {
    const matrix = matrixOf(node);
    for (const polygon of polygons) {
      // y is turned round here, so the logo is the right way up in a model.
      rings.push(
        polygon.map(([x, y]) => {
          const moved = applyMatrix(matrix, x, y);
          return [moved[0], -moved[1]];
        }),
      );
    }
  };
  const value = (node, name, fallback = 0) => {
    const raw = node.getAttribute(name);
    const parsed = Number.parseFloat(raw ?? "");
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  for (const node of svg.querySelectorAll("path, rect, circle, ellipse, polygon, polyline")) {
    if (node.getAttribute("display") === "none" || /display\s*:\s*none/.test(node.getAttribute("style") ?? ""))
      continue;
    const tag = node.tagName.toLowerCase();
    if (tag === "path") {
      const d = node.getAttribute("d");
      if (!d) continue;
      add(node, flattenSvgPath(d, tolerance));
    } else if (tag === "rect") {
      const x = value(node, "x");
      const y = value(node, "y");
      const width = value(node, "width");
      const height = value(node, "height");
      const rx = Math.min(value(node, "rx", value(node, "ry")), width / 2);
      const ry = Math.min(value(node, "ry", value(node, "rx")), height / 2);
      if (width <= 0 || height <= 0) continue;
      if (rx > 0 && ry > 0) {
        const steps = 8;
        const ring = [];
        const corner = (cx, cy, from) => {
          for (let i = 0; i <= steps; i++) {
            const angle = from + (Math.PI / 2) * (i / steps);
            ring.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
          }
        };
        corner(x + width - rx, y + height - ry, 0);
        corner(x + rx, y + height - ry, Math.PI / 2);
        corner(x + rx, y + ry, Math.PI);
        corner(x + width - rx, y + ry, (3 * Math.PI) / 2);
        add(node, [ring]);
      } else {
        add(node, [
          [
            [x, y],
            [x + width, y],
            [x + width, y + height],
            [x, y + height],
          ],
        ]);
      }
    } else if (tag === "circle" || tag === "ellipse") {
      const cx = value(node, "cx");
      const cy = value(node, "cy");
      const rx = tag === "circle" ? value(node, "r") : value(node, "rx");
      const ry = tag === "circle" ? value(node, "r") : value(node, "ry");
      if (rx <= 0 || ry <= 0) continue;
      const steps = 48;
      add(node, [
        Array.from({ length: steps }, (_, i) => {
          const angle = (i / steps) * Math.PI * 2;
          return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
        }),
      ]);
    } else {
      const values = numbers(node.getAttribute("points") ?? "");
      const ring = [];
      for (let i = 0; i + 1 < values.length; i += 2) ring.push([values[i], values[i + 1]]);
      if (ring.length > 2) add(node, [ring]);
      else skipped++;
    }
  }

  const ignored = svg.querySelectorAll("image, text, use").length;
  const shapes = groupContours(rings);
  if (!shapes.length) throw new Error("Nothing in that file is an outline this can print.");
  return { shapes, skipped: skipped + ignored };
}
