// Rounded and bevelled edges.
//
// Extruding a flat outline gives square edges. A keyring wants the top edge of its letters and its border eased,
// and often the underside bevelled so it leaves the plate cleanly. Rather than build a rounded solid, the solid is
// extruded in slices and each slice is pulled towards the shape inset by the radius — so the edge follows a
// quarter circle, and every point lands where a true inset outline says it should rather than along a normal,
// which is what stops neighbouring curve segments rippling against each other.
//

/** How big each eased edge is, in mm: an explicit size when there is one, else the shared radius if it's on. */
export function edgeSizes(settings) {
  const size = (key, flag) =>
    Number.isFinite(settings[key])
      ? Math.max(0, Math.min(3, settings[key]))
      : settings[flag]
        ? Math.max(0.1, Math.min(3, +settings.roundRadius || 0.4))
        : 0;
  return {
    letter: size("letterTopSize", "letterRound"),
    border: size("borderTopSize", "borderRound"),
    bottom: size("bottomBevelSize", "borderBevel"),
  };
}

/** How many slices the quarter circle is cut into. Enough to read as round at any size a keyring is printed. */
const ROUND_STEPS = 16;

/**
 * A cross-section extruded to `height`, with its top and bottom edges eased by the sizes given.
 *
 * `keep` is the engine's bookkeeper: every Manifold object made here is handed to it so it can be freed.
 */
export function finishedExtrude(cs, height, { top = 0, bottom = 0, report = () => {}, component = false } = {}, keep) {
  // Separate pieces are eased one at a time: a radius that fits a wide piece can swallow a narrow one.
  if (!component && (top || bottom)) {
    const parts = cs.decompose().map(keep);
    if (parts.length > 1) {
      let combined;
      for (const part of parts) {
        const solid = finishedExtrude(part, height, { top, bottom, report, component: true }, keep);
        combined = combined ? keep(combined.add(solid)) : solid;
      }
      return combined;
    }
  }

  let radius = Math.min(Math.max(top, bottom), height * (top && bottom ? 0.45 : 0.9));
  if (!radius) {
    report({ top: 0, bottom: 0 });
    return keep(cs.extrude(height));
  }

  // The shape inset by the radius is where the eased edge has to land. A radius that would collapse a thin stroke
  // is backed off until the inset still has every piece and most of its area.
  const polygons = cs.toPolygons();
  const area = cs.area();
  const probe = (by) => {
    const inset = keep(cs.offset(-by, "Miter", 2, 96));
    const got = inset.toPolygons();
    return !inset.isEmpty() && got.length === polygons.length && inset.area() > area * 0.2 ? got : null;
  };
  let insetPolys = probe(radius);
  let usable = Boolean(insetPolys);
  if (!usable) {
    let low = 0;
    let high = radius;
    for (let attempt = 0; attempt < 10; attempt++) {
      const middle = (low + high) / 2;
      const got = probe(middle);
      if (got) {
        low = middle;
        insetPolys = got;
        usable = true;
      } else {
        high = middle;
      }
    }
    radius = low;
  }
  if (!usable || !insetPolys?.length || radius < 0.005) {
    report({ top: 0, bottom: 0 });
    return keep(cs.extrude(height));
  }

  const edgesOf = (polys) =>
    polys.flatMap((p) =>
      p.map((a, i) => {
        const b = p[(i + 1) % p.length];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        return { a, dx, dy, lengthSquared: dx * dx + dy * dy };
      }),
    );

  // Finding the nearest edge for every point of a long line of text is the slow part, so the edges go into square
  // buckets and only the buckets near the point are looked at.
  const all = polygons.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const cell = Math.max(
    radius * 2,
    (Math.max(...xs) - Math.min(...xs)) / 128,
    (Math.max(...ys) - Math.min(...ys)) / 128,
    0.25,
  );
  const index = (segments) => {
    const cells = new Map();
    for (const edge of segments) {
      const bx = edge.a[0] + edge.dx;
      const by = edge.a[1] + edge.dy;
      for (let x = Math.floor(Math.min(edge.a[0], bx) / cell); x <= Math.floor(Math.max(edge.a[0], bx) / cell); x++) {
        for (let y = Math.floor(Math.min(edge.a[1], by) / cell); y <= Math.floor(Math.max(edge.a[1], by) / cell); y++) {
          const key = `${x},${y}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(edge);
        }
      }
    }
    return { segments, cells };
  };
  const boundary = index(edgesOf(polygons));
  const target = index(edgesOf(insetPolys));

  const nearest = (point, grid) => {
    let best = Infinity;
    let found;
    const gx = Math.floor(point[0] / cell);
    const gy = Math.floor(point[1] / cell);
    const seen = new Set();
    const check = (edge) => {
      if (seen.has(edge)) return;
      seen.add(edge);
      const along = edge.lengthSquared
        ? Math.max(
            0,
            Math.min(1, ((point[0] - edge.a[0]) * edge.dx + (point[1] - edge.a[1]) * edge.dy) / edge.lengthSquared),
          )
        : 0;
      const x = edge.a[0] + along * edge.dx;
      const y = edge.a[1] + along * edge.dy;
      const distance = (point[0] - x) ** 2 + (point[1] - y) ** 2;
      if (distance < best) {
        best = distance;
        found = [x, y];
      }
    };
    // Ring by ring outwards, stopping as soon as nothing outside could be nearer.
    for (let ring = 0; ring <= 4; ring++) {
      for (let x = gx - ring; x <= gx + ring; x++) {
        for (let y = gy - ring; y <= gy + ring; y++) {
          if (ring && x !== gx - ring && x !== gx + ring && y !== gy - ring && y !== gy + ring) continue;
          for (const edge of grid.cells.get(`${x},${y}`) || []) check(edge);
        }
      }
      const margin = Math.min(
        point[0] - (gx - ring) * cell,
        (gx + ring + 1) * cell - point[0],
        point[1] - (gy - ring) * cell,
        (gy + ring + 1) * cell - point[1],
      );
      if (best <= margin * margin + 1e-14) return { best, point: found };
    }
    for (const edge of grid.segments) check(edge);
    return { best, point: found };
  };

  // The slices are spent on the quarter circle, not on the straight wall between, and stepped by equal angle so
  // the last one meets the flat top tangentially instead of as a visible facet.
  const topRadius = Math.min(top, radius);
  const bottomRadius = Math.min(bottom, radius);
  const levels = [0];
  report({ top: topRadius, bottom: bottomRadius });
  if (bottomRadius) levels.push(bottomRadius);
  if (topRadius) {
    levels.push(height - topRadius);
    for (let i = 1; i <= ROUND_STEPS; i++) {
      levels.push(height - topRadius + topRadius * Math.sin(((i / ROUND_STEPS) * Math.PI) / 2));
    }
  } else {
    levels.push(height);
  }
  const heights = [...new Set(levels)].sort((a, b) => a - b);
  const body = keep(cs.extrude(height, heights.length - 2));
  const directions = new Map();

  return keep(
    body.warp((v) => {
      v[2] = heights[Math.max(0, Math.min(heights.length - 1, Math.round((v[2] / height) * (heights.length - 1))))];
      let shift = 0;
      if (topRadius && v[2] > height - topRadius) {
        shift = topRadius - Math.sqrt(Math.max(0, topRadius * topRadius - (v[2] - height + topRadius) ** 2));
      }
      if (bottomRadius && v[2] < bottomRadius) shift = Math.max(shift, bottomRadius - v[2]);
      if (shift < 1e-8) return;
      const key = `${v[0]},${v[1]}`;
      let delta = directions.get(key);
      if (!delta) {
        // Only points on the outer wall move; anything already inside stays where it is.
        const on = nearest(v, boundary);
        if (on.best > 1e-9) {
          directions.set(key, [0, 0]);
          return;
        }
        const to = nearest(v, target).point;
        delta = [to[0] - v[0], to[1] - v[1]];
        directions.set(key, delta);
      }
      v[0] += (delta[0] * shift) / radius;
      v[1] += (delta[1] * shift) / radius;
    }),
  );
}
