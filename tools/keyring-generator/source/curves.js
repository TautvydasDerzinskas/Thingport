// A glyph's outline, as straight lines.
//
// opentype hands back a path of lines and Bézier curves; a solid needs polygons. Each curve is split in half over
// and over until its control points sit within `tolerance` of the straight line between its ends, so a flat curve
// costs two points and a tight one costs as many as it needs. Corners the font really has are never rounded off,
// because only curves are ever split.
//

/** The furthest a point lies from the line between two others. */
function offLine(point, from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = dx * dx + dy * dy;
  const along = length ? Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / length)) : 0;
  return Math.hypot(point[0] - from[0] - along * dx, point[1] - from[1] - along * dy);
}

const middle = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** How deep the splitting may go. Twelve halvings is far finer than any printer, and stops a degenerate curve. */
const DEPTH = 12;

/**
 * The closed polygons of an opentype path, in the font's own units with y pointing up.
 *
 * A font measures y downwards, a model upwards, so every y is negated as it is read.
 */
export function flattenPath(path, tolerance = 0.08) {
  const polygons = [];
  const limit = Math.max(0.0005, tolerance);
  let polygon = [];
  let last = [0, 0];

  const append = (point) => {
    last = point;
    polygon.push(point);
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

  for (const command of path.commands) {
    const end = [command.x, -command.y];
    if (command.type === "M") {
      finish();
      append(end);
    } else if (command.type === "L") {
      append(end);
    } else if (command.type === "Q") {
      quadratic(last, [command.x1, -command.y1], end);
    } else if (command.type === "C") {
      cubic(last, [command.x1, -command.y1], [command.x2, -command.y2], end);
    } else if (command.type === "Z") {
      finish();
    }
  }
  finish();
  return polygons;
}
