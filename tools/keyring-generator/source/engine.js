// The keyring itself: text in, solids out.
//
// The shape of it: every character becomes its real outline from the font; the outlines are slid together until
// they touch and spaced by the gap asked for; each letter is grown outwards by the border width and the results
// unioned into one footprint; anything still in pieces is bridged; ring holes are placed where they will hold;
// then the footprint is extruded for the base and the border, the letters are extruded on top, and the letters
// are subtracted from the shell so the two fit each other exactly.
//
// All the two-dimensional work is Manifold's CrossSection — union, offset, hull, subtract — which is why a letter
// with a counter needs no special handling: its outline is a contour with a hole in it, and the hole survives
// every operation. The width is reached by solving for the scale rather than guessing, because the border, the
// gaps and the ring all add to it.
//

import { bounds, componentLinks, shiftPolys, signedArea, snapHole, snapInRegion, touchingShift } from "./geometry2d.js";
import { edgeSizes, finishedExtrude } from "./finishing.js";
import { effectiveBase, normalizeMagnets } from "./magnets.js";
import { MAX_CHARACTERS, MAX_LINES, normalizeText, textStats } from "./text.js";

/** Everything the engine takes, and what it falls back to. Sizes are millimetres. */
export const DEFAULTS = {
  text: "Keyring",
  width: 60,
  widthLocked: true,
  textScale: null,
  align: "center",
  lineGap: 3,
  stroke: 0,
  infill: 0,
  fillVoids: false,
  smoothBorder: false,
  smoothRadius: 0.6,
  letterRound: false,
  borderRound: false,
  borderBevel: false,
  roundRadius: 0.4,
  letterTopSize: null,
  borderTopSize: null,
  bottomBevelSize: null,
  magnetRibs: false,
  magnetRibSize: 0.1,
  magnetEnabled: false,
  magnetMode: "open",
  magnetBase: null,
  magnetAutoHeight: true,
  magnetDiameterGap: 0.2,
  magnetDepthGap: 0.1,
  magnets: [],
  gap: 1.2,
  letterDepth: 3,
  borderDepth: 2,
  borderWidth: 1.4,
  base: 1,
  bridge: 2.4,
  clearance: 0.2,
  assembled: true,
  separate: false,
  holes: [{ x: -0.94, y: 0.2, inner: 4, outer: 8, localJoin: true, reinforce: true }],
};

/** Whether a solid came out without complaint. Manifold has reported this as a string and as an object with a
 *  value over its versions, so both are accepted rather than pinning the tool to one. */
const isSound = (solid) => {
  const status = solid.status();
  return status === "NoError" || status === 0 || status?.value === 0;
};

/** A space in the text moves the pen this far, in the font's own units before scaling. */
const SPACE_UNITS = 35;
/** Glyphs are read at this size and scaled afterwards, so the outline's detail doesn't depend on the final size. */
const GLYPH_SIZE = 100;

/**
 * Builds the keyring.
 *
 * `font` is an opentype font, `api` is Manifold's `{ CrossSection, Manifold }`, and `contours` turns a glyph's
 * path into polygons. Returns the solids to print, with their meshes, and everything the window needs to describe
 * what it made.
 */
/**
 * An error the window can put in the user's own language: it carries a code and whatever the sentence filled in,
 * while the message itself stays readable English for anything reading it plainly.
 */
function fail(code, message, vars) {
  const error = new Error(message);
  error.code = code;
  if (vars) error.vars = vars;
  return error;
}

export function buildModel(font, api, input, contours) {
  const s = { ...DEFAULTS, ...input };
  s.base = effectiveBase(s);
  s.text = normalizeText(s.text);

  if (!font) throw fail("noFont", "Load a font first.");
  if (!s.text.trim()) throw fail("noText", "Type something to put on the keyring.");
  const stats = textStats(s.text);
  if (stats.characters > MAX_CHARACTERS)
    throw fail("tooManyCharacters", `That's more than ${MAX_CHARACTERS} characters.`, { max: MAX_CHARACTERS });
  if (stats.lines > MAX_LINES) throw fail("tooManyLines", `That's more than ${MAX_LINES} lines.`, { max: MAX_LINES });
  if (!["left", "center", "right"].includes(s.align)) throw fail("badAlign", "Pick how the lines line up.");
  for (const key of [
    "width",
    "gap",
    "lineGap",
    "letterDepth",
    "borderDepth",
    "borderWidth",
    "base",
    "bridge",
    "clearance",
    "stroke",
    "infill",
    "smoothRadius",
  ]) {
    if (!Number.isFinite(s[key])) throw fail("notNumbers", "Every setting has to be a number.");
  }
  if (s.lineGap < 0) throw fail("negativeLineGap", "The space between lines can't be negative.");
  if (s.smoothBorder && s.smoothRadius <= 0)
    throw fail("badSmoothRadius", "The smoothing radius has to be more than nothing.");
  if (
    s.base <= 0 ||
    s.borderDepth <= 0 ||
    s.letterDepth <= 0 ||
    s.bridge <= 0 ||
    s.borderWidth <= 0 ||
    s.gap < 0 ||
    s.infill < 0
  ) {
    throw fail("nonPositive", "Heights and widths have to be more than nothing, and gaps can't be negative.");
  }
  if (s.width < 15) throw fail("tooNarrow", "Make it at least 15 mm across.", { min: 15 });
  const missing = [...new Set([...s.text].filter((c) => c.trim() && !font.charToGlyphIndex(c)))];
  if (missing.length)
    throw fail("missingGlyphs", `This font has no ${missing.join(" ")}. Try another font.`, {
      glyphs: missing.join(" "),
    });

  // Read every glyph once, at a fixed size. How finely the curves are cut follows the final scale, so a small
  // keyring doesn't carry a million points and a large one doesn't come out faceted.
  const advances = s.text.split("\n").map((line) => font.getAdvanceWidth(line, GLYPH_SIZE));
  const guessScale =
    !s.widthLocked && Number.isFinite(s.textScale) && s.textScale > 0
      ? s.textScale
      : s.width / Math.max(1, ...advances);
  const tolerance = Math.max(0.002, Math.min(0.12, 0.02 / guessScale));

  const glyphs = [];
  const rows = Array.from({ length: stats.lines }, () => []);
  let spaces = 0;
  let row = 0;
  for (const [i, character] of [...s.text].entries()) {
    if (character === "\n") {
      row++;
      spaces = 0;
      continue;
    }
    const polygons = contours(font.charToGlyph(character).getPath(0, 0, GLYPH_SIZE), tolerance);
    if (polygons.length) {
      const glyph = { i, ch: character, p: polygons, spaces, row };
      glyphs.push(glyph);
      rows[row].push(glyph);
      spaces = 0;
    } else {
      spaces++;
    }
  }
  if (!glyphs.length) throw fail("nothingToPrint", "There's nothing here to print.");

  const rawBounds = bounds(glyphs.flatMap((glyph) => glyph.p));
  const baseline = (rawBounds.min[1] + rawBounds.max[1]) / 2;
  const rawWidth = Math.max(
    ...rows.map((line) =>
      line.reduce((total, glyph) => {
        const box = bounds(glyph.p);
        return total + box.max[0] - box.min[0] + glyph.spaces * SPACE_UNITS;
      }, 0),
    ),
  );

  const { CrossSection: C, Manifold: M } = api;
  // Manifold hands back objects that have to be freed by hand; every one made here is noted and freed at the end.
  const rubbish = [];
  const keep = (x) => (rubbish.push(x), x);
  const union = (list) => keep(C.union(list));
  const subtract = (a, b) => keep(a.subtract(b));
  const add = (a, b) => keep(a.add(b));
  const move = (a, x, y) => keep(a.translate([x, y]));

  try {
    /** Lays the text out at a scale and returns the footprint it makes. */
    function layout(scale) {
      const lines = [];
      for (const line of rows) {
        const placed = [];
        const letters = [];
        let first = true;
        let furthest = -Infinity;
        for (const glyph of line) {
          let cs = keep(
            new C(
              glyph.p.map((p) => p.map(([x, y]) => [x * scale, (y - baseline) * scale])),
              "EvenOdd",
            ),
          );
          if (s.stroke) cs = keep(cs.offset(s.stroke, "Round", 2, 128));
          if (cs.isEmpty())
            throw fail("strokesTooThin", "The strokes are too thin and the letters vanish. Thicken them.");
          const polygons = cs.toPolygons();
          const own = bounds(polygons);

          // Slide this letter left until it touches one already placed, then back off by the gap. Only letters
          // whose heights overlap can touch, which is what keeps "AV" tight and "LT" apart.
          let touch = -Infinity;
          if (!first) {
            for (let i = placed.length - 1; i >= 0; i--) {
              const previous = placed[i];
              if (previous.max[0] - own.min[0] <= touch || previous.max[1] < own.min[1] || previous.min[1] > own.max[1])
                continue;
              touch = Math.max(touch, touchingShift(previous.p, polygons, false));
            }
          }
          if (!Number.isFinite(touch)) touch = furthest - own.min[0];
          const dx = first ? -own.min[0] : touch + s.gap + glyph.spaces * SPACE_UNITS * scale + 0.00002;
          first = false;
          cs = move(cs, dx, 0);
          const moved = shiftPolys(polygons, dx, 0);
          const box = bounds(moved);
          placed.push({ p: moved, ...box });
          furthest = Math.max(furthest, box.max[0]);
          letters.push({ ...glyph, cs, p: moved });
        }
        lines.push({ letters, box: letters.length ? bounds(letters.flatMap((g) => g.p)) : null });
      }

      const widest = Math.max(...lines.map((line) => (line.box ? line.box.max[0] - line.box.min[0] : 0)));
      const letters = [];
      const emptyHeight = Math.max((rawBounds.max[1] - rawBounds.min[1]) * scale + 2 * s.stroke, 0.01);
      let top = 0;
      for (const line of lines) {
        if (!line.box) {
          top -= emptyHeight + s.lineGap;
          continue;
        }
        const width = line.box.max[0] - line.box.min[0];
        const height = line.box.max[1] - line.box.min[1];
        const dx =
          -line.box.min[0] + (s.align === "left" ? 0 : s.align === "right" ? widest - width : (widest - width) / 2);
        const dy = top - line.box.max[1];
        for (const glyph of line.letters) {
          const cs = move(glyph.cs, dx, dy);
          const polygons = shiftPolys(glyph.p, dx, dy);
          // Only the outer contours are grown: growing a counter would close it.
          const outside = polygons.filter((p) => signedArea(p) > 0);
          const filled = keep(new C(outside, "Positive"));
          letters.push({ ...glyph, cs, p: polygons, outline: keep(filled.offset(s.borderWidth, "Round", 2, 128)) });
        }
        top -= height + s.lineGap + 0.00002;
      }

      let footprint = union(letters.map((glyph) => glyph.outline));

      // Letters too far apart to have merged leave the keyring in pieces; a bar between each pair joins them.
      const pieces = footprint.toPolygons().filter((p) => signedArea(p) > 0);
      const bars = [];
      for (const { p, q } of componentLinks(pieces)) {
        const dx = q[0] - p[0];
        const dy = q[1] - p[1];
        const length = Math.hypot(dx, dy);
        const bar = keep(C.square([length + s.bridge, s.bridge], true));
        const turned = keep(bar.rotate((Math.atan2(dy, dx) * 180) / Math.PI));
        bars.push(move(turned, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2));
      }
      if (bars.length) footprint = union([footprint, ...bars]);

      let smoothingRadius = 0;
      if (s.smoothBorder) {
        // Round the real perimeter, bridge junctions included. The radius is capped against the border and bridge
        // widths so a thin band or a bar isn't rounded away.
        smoothingRadius = Math.min(s.smoothRadius, s.borderWidth * 0.45, s.bridge * 0.3);
        const r = smoothingRadius;
        const hull = keep(C.hull([footprint]));
        const grown = keep(footprint.offset(r, "Round", 2, 64));
        const closed = keep(grown.offset(-r, "Round", 2, 64));
        const inset = keep(closed.offset(-r, "Round", 2, 64));
        const rounded = keep(inset.offset(r, "Round", 2, 64));
        // Rounding can eat into a letter's own edge, so a thin skin of every letter is put back.
        const cover = union(
          letters.map((g) => keep(g.cs.offset(Math.min(s.borderWidth * 0.25, 0.35), "Round", 2, 128))),
        );
        footprint = union([keep(rounded.intersect(hull)), cover]);
      }

      // The ring is attached to the unfilled outline, so turning infill on never moves it.
      const attachment = footprint;
      if (s.infill > 0) {
        const hull = keep(C.hull([footprint]));
        const grown = keep(footprint.offset(s.infill, "Round", 2, 128));
        const closed = keep(grown.offset(-s.infill, "Round", 2, 128));
        footprint = add(footprint, keep(closed.intersect(hull)));
      }

      const outlinePolys = attachment.toPolygons();
      const box = bounds(outlinePolys);
      const cx = (box.min[0] + box.max[0]) / 2;
      const cy = (box.min[1] + box.max[1]) / 2;
      const halfWidth = (box.max[0] - box.min[0]) / 2;
      const halfHeight = (box.max[1] - box.min[1]) / 2;
      const letterUnion = union(letters.map((g) => g.cs));
      const letterPolys = letterUnion.toPolygons();
      const holePaths = [];
      const holeInfo = [];
      const ringDisks = [];

      for (const hole of s.holes) {
        if (
          ![hole.x, hole.y, hole.inner, hole.outer].every(Number.isFinite) ||
          hole.inner <= 0 ||
          hole.inner > hole.outer * 0.9 ||
          hole.outer <= 0
        ) {
          throw fail("ringTooBig", "A ring's hole has to be smaller than nine tenths of the ring.");
        }
        const safe = snapHole(
          outlinePolys,
          letterPolys,
          hole,
          cx + hole.x * halfWidth,
          cy + hole.y * halfHeight,
          s.borderWidth,
        );
        const outer = move(keep(C.circle(hole.outer / 2, 128)), safe.x, safe.y);
        const inner = move(keep(C.circle(hole.inner / 2, 128)), safe.x, safe.y);
        const overlap = keep((hole.localJoin ? inner : outer).intersect(letterUnion));
        if (overlap.area() > 1e-5) throw fail("ringHitsLetters", "That ring runs into the letters. Move it.");

        if (s.infill > 0) {
          // Keep the infill clear of the ring, so the ring still reads as a ring.
          const clear = move(keep(C.circle(hole.outer / 2 + 0.3, 64)), safe.x, safe.y);
          const infillOnly = subtract(footprint, attachment);
          footprint = union([attachment, subtract(infillOnly, clear), ...ringDisks]);
        }
        footprint = add(footprint, outer);

        if (hole.localJoin && hole.reinforce !== false) {
          // A hull between the ring and the body right behind it gives tangent shoulders, instead of the ring
          // meeting the body at a corner that would snap.
          const n = safe.normal;
          const t = [-n[1], n[0]];
          const w = hole.outer * 0.6;
          const d = hole.outer * 0.55;
          const a = safe.anchor;
          const clip = keep(
            new C(
              [
                [
                  [a[0] + t[0] * w + n[0] * 0.15, a[1] + t[1] * w + n[1] * 0.15],
                  [a[0] - t[0] * w + n[0] * 0.15, a[1] - t[1] * w + n[1] * 0.15],
                  [a[0] - t[0] * w - n[0] * d, a[1] - t[1] * w - n[1] * d],
                  [a[0] + t[0] * w - n[0] * d, a[1] + t[1] * w - n[1] * d],
                ],
              ],
              "EvenOdd",
            ),
          );
          const nearby = keep(attachment.intersect(clip));
          if (!nearby.isEmpty()) footprint = add(footprint, keep(C.hull([outer, nearby])));
          const fillet = Math.min(0.65, s.borderWidth * 0.4, (hole.outer - hole.inner) * 0.2);
          const zone = move(keep(C.circle(hole.outer * 0.95, 96)), safe.x, safe.y);
          if (fillet > 0.03) {
            const grown = keep(footprint.offset(fillet, "Round", 2, 96));
            const closed = keep(grown.offset(-fillet, "Round", 2, 96));
            footprint = add(footprint, keep(closed.intersect(zone)));
          }
        }
        ringDisks.push(outer);
        holePaths.push(inner);
        holeInfo.push({ ...hole, ...safe });
      }

      // Dropping every negative contour fills the counters, whatever made them. It happens before the ring holes
      // are cut, so those survive.
      let filledVoidArea = 0;
      if (s.fillVoids) {
        const filled = keep(
          new C(
            footprint.toPolygons().filter((p) => signedArea(p) > 0),
            "Positive",
          ),
        );
        filledVoidArea = Math.max(0, filled.area() - footprint.area());
        footprint = filled;
      }
      const internalHoleCount = footprint.toPolygons().filter((p) => signedArea(p) < 0).length;
      const cut = holePaths.length ? union(holePaths) : null;
      if (cut) footprint = subtract(footprint, cut);

      const whole = bounds(footprint.toPolygons());
      return {
        letters,
        footprint,
        letterUnion,
        cut,
        outlinePolys,
        letterPolys,
        frame: { min: box.min, max: box.max },
        holeInfo,
        width: whole.max[0] - whole.min[0],
        smoothingRadius,
        filledVoidArea,
        internalHoleCount,
      };
    }

    // Solve for the scale that makes the finished width the one asked for. The width isn't proportional to the
    // scale — the border, the gaps and the ring don't grow with the text — so it's solved by secant steps,
    // bracketed so it can't wander.
    let scale =
      Number.isFinite(s.textScale) && s.textScale > 0
        ? s.textScale
        : Math.max(
            0.01,
            (s.width -
              2 * s.borderWidth -
              s.gap * (Math.max(...rows.map((line) => line.length)) - 1) -
              (s.holes[0]?.outer || 0)) /
              rawWidth,
          );
    const fitWidth = s.widthLocked || !Number.isFinite(s.textScale) || s.textScale <= 0;
    let laid;
    let previous = null;
    let low = 0;
    let high = Infinity;
    for (let attempt = 0; attempt < (fitWidth ? 14 : 1); attempt++) {
      laid = layout(scale);
      if (!fitWidth || Math.abs(laid.width - s.width) < 0.025) break;
      if (laid.width > s.width) high = scale;
      else low = scale;
      const slope = previous ? (laid.width - previous.width) / (scale - previous.scale) : rawWidth;
      let next = scale + (s.width - laid.width) / Math.max(slope, 1);
      if (!Number.isFinite(next) || next <= low || next >= high)
        next = Number.isFinite(high) ? (low + high) / 2 : scale * 1.5;
      previous = { scale, width: laid.width };
      scale = Math.max(0.0001, next);
    }
    if (fitWidth && Math.abs(laid.width - s.width) > 0.08) {
      throw fail(
        "wontFitWidth",
        "That won't fit the width you set. Narrow the gaps, the border or the ring, or make it wider.",
      );
    }

    const { letters, footprint, letterUnion, holeInfo } = laid;
    const models = [];
    const wantedEdges = edgeSizes(s);
    const appliedEdges = Object.fromEntries(
      Object.entries(wantedEdges).map(([key, requested]) => [key, { requested, min: Infinity, max: 0 }]),
    );
    const track = (key, value) => {
      appliedEdges[key].min = Math.min(appliedEdges[key].min, value);
      appliedEdges[key].max = Math.max(appliedEdges[key].max, value);
    };

    // Every letter is its own solid, standing on the base, so each can take its own colour.
    const bodies = letters.map((glyph) => {
      const body = finishedExtrude(
        glyph.cs,
        s.letterDepth,
        { top: wantedEdges.letter, report: (r) => track("letter", r.top) },
        keep,
      );
      const raised = keep(body.translate([0, 0, s.base]));
      models.push({
        name: `letter_${glyph.i + 1}`,
        index: glyph.i,
        char: glyph.ch,
        row: glyph.row,
        kind: "letter",
        solid: raised,
      });
      return raised;
    });

    // Printing the pieces apart needs the hole in the border to be bigger than the letter by the fit clearance.
    const cavity = s.separate && s.clearance > 0 ? keep(letterUnion.offset(s.clearance, "Round", 2, 128)) : letterUnion;
    const upper = subtract(footprint, cavity);
    const base = finishedExtrude(
      footprint,
      s.base,
      { bottom: wantedEdges.bottom, report: (r) => track("bottom", r.bottom) },
      keep,
    );
    const border = finishedExtrude(
      upper,
      s.borderDepth,
      { top: wantedEdges.border, report: (r) => track("border", r.top) },
      keep,
    );
    let shell = keep(base.add(keep(border.translate([0, 0, s.base]))));
    shell = keep(shell.subtract(keep(M.union(bodies))));

    const magnets = [];
    const magnetRegions = [];
    if (s.magnetEnabled) {
      for (const magnet of normalizeMagnets(s)) {
        const radius = (magnet.diameter + (+s.magnetDiameterGap || 0)) / 2;
        const region = keep(footprint.offset(-radius - 0.6 - appliedEdges.bottom.max, "Round", 2, 128));
        const polygons = region.toPolygons();
        if (!polygons.length) throw fail("noRoomForMagnet", "There's no room for a magnet. Make the keyring bigger.");
        const frame = laid.frame;
        const cx = (frame.min[0] + frame.max[0]) / 2;
        const cy = (frame.min[1] + frame.max[1]) / 2;
        const halfWidth = (frame.max[0] - frame.min[0]) / 2;
        const halfHeight = (frame.max[1] - frame.min[1]) / 2;
        const safe = snapInRegion(polygons, cx + magnet.x * halfWidth, cy + magnet.y * halfHeight, magnets, radius);
        const depth = magnet.depth + (+s.magnetDepthGap || 0);
        const z = s.magnetMode === "embedded" ? 0.4 : -0.01;
        const pocket = keep(move(keep(C.circle(radius, 64)), safe.x, safe.y).extrude(depth + (z < 0 ? 0.01 : 0)));
        shell = keep(shell.subtract(keep(pocket.translate([0, 0, z]))));

        // Four short ribs grip the magnet. The circle they leave is never smaller than the magnet itself, and the
        // mouth is tapered so it still goes in.
        const ribSize =
          s.magnetRibs && s.magnetMode !== "embedded"
            ? Math.max(0, Math.min(+s.magnetRibSize || 0, radius - magnet.diameter / 2))
            : 0;
        if (ribSize > 1e-5) {
          const inner = radius - ribSize;
          const outer = radius + 0.25;
          const width = Math.max(0.45, Math.min(0.8, magnet.diameter * 0.12));
          const ramp = Math.min(0.4, depth * 0.45);
          const piece = move(keep(C.square([outer - inner, width], true)), (outer + inner) / 2, 0);
          const raw = keep(piece.extrude(depth, 3));
          const tapered = keep(
            raw.warp((v) => {
              if (Math.abs(v[0] - inner) < 1e-5 && v[2] < ramp) v[0] += ribSize * (1 - v[2] / ramp);
            }),
          );
          for (let angle = 0; angle < 360; angle += 90) {
            shell = keep(shell.add(keep(keep(tapered.rotate([0, 0, angle])).translate([safe.x, safe.y, 0]))));
          }
        }
        magnets.push({
          ...magnet,
          ...safe,
          radius,
          depth,
          ribSize,
          ribCount: ribSize > 1e-5 ? 4 : 0,
          gripDiameter: 2 * (radius - ribSize),
          normalizedX: (safe.x - cx) / halfWidth,
          normalizedY: (safe.y - cy) / halfHeight,
          pauseZ: s.magnetMode === "embedded" ? z + depth : null,
        });
        magnetRegions.push(polygons);
      }
    }

    // Offset curves that land on each other can leave specks of a billionth of a cubic millimetre. Those go; a
    // real piece that happens to be separate stays, and is reported instead.
    const parts = shell.decompose().map(keep);
    const real = parts.filter((part) => part.volume() > 1e-6);
    const count = real.length;
    if (!count)
      throw fail("borderNotSolid", "The border didn't come out as a solid. Try a wider border or a taller one.");
    const removedNumericalFragments = parts.length - count;
    if (removedNumericalFragments) shell = keep(M.union(real));
    models.push({ name: "border_and_base", kind: "border", solid: shell });

    // Everything is moved so the keyring sits over the middle, which is where a slicer expects it.
    const box = shell.boundingBox();
    const centre = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, 0];
    const result = models.map((model) => {
      const mesh = model.solid.getMesh();
      const vertices = [];
      for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
        vertices.push(
          mesh.vertProperties[i] - centre[0],
          mesh.vertProperties[i + 1] - centre[1],
          mesh.vertProperties[i + 2],
        );
      }
      if (!isSound(model.solid))
        throw fail("notClosed", "That didn't come out as a closed solid. Change a setting and try again.");
      return {
        name: model.name,
        index: model.index,
        char: model.char,
        row: model.row,
        kind: model.kind,
        vertices: new Float32Array(vertices),
        triangles: new Uint32Array(mesh.triVerts),
        volume: model.solid.volume(),
        // How many holes run through this piece, which is how a counter proves it survived: o is 1, B is 2, l is
        // 0. Below zero means the piece is in more than one lump, like the dot and the stem of an i.
        genus: model.solid.genus(),
      };
    });

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const model of result) {
      for (let i = 0; i < model.vertices.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], model.vertices[i + k]);
          max[k] = Math.max(max[k], model.vertices[i + k]);
        }
      }
    }

    const warnings = [];
    if (count > 1) warnings.push(`The border is in ${count} separate pieces. Widen the join, or fill the inside.`);
    if (s.borderDepth > s.letterDepth)
      warnings.push("The border stands higher than the letters. Look at it from the side.");
    if (s.bridge < 1.6) warnings.push("The join between letters is under 1.6 mm. It may be fragile.");
    if (s.holes.some((hole) => (hole.outer - hole.inner) / 2 < 0.8 - 1e-6)) {
      warnings.push("A ring's wall is under 0.8 mm. Make the hole smaller, or the ring bigger.");
    }

    const shift = (polygons) => shiftPolys(polygons, -centre[0], -centre[1]);
    return {
      models: result,
      effectiveBase: s.base,
      magnets: magnets.map((magnet) => ({ ...magnet, x: magnet.x - centre[0], y: magnet.y - centre[1] })),
      magnetRegions: magnetRegions.map(shift),
      textLayout: { lines: stats.lines, characters: stats.characters, align: s.align, lineGap: s.lineGap },
      size: max.map((value, i) => value - min[i]),
      textScale: scale,
      centre,
      bounds: { min, max },
      holes: holeInfo.map((hole) => ({
        ...hole,
        x: hole.x - centre[0],
        y: hole.y - centre[1],
        anchor: [hole.anchor[0] - centre[0], hole.anchor[1] - centre[1]],
      })),
      placement: {
        outlines: shift(laid.outlinePolys),
        letters: shift(laid.letterPolys),
        min: laid.frame.min.map((value, i) => value - centre[i]),
        max: laid.frame.max.map((value, i) => value - centre[i]),
      },
      finishing: {
        edges: Object.fromEntries(
          Object.entries(appliedEdges).map(([key, value]) => [
            key,
            { ...value, min: Number.isFinite(value.min) ? value.min : 0 },
          ]),
        ),
        removedNumericalFragments,
        smoothingRadius: laid.smoothingRadius,
        filledVoidArea: laid.filledVoidArea,
        internalHoleCount: laid.internalHoleCount,
      },
      warnings,
      connected: count === 1,
      triangles: result.reduce((total, model) => total + model.triangles.length / 3, 0),
    };
  } finally {
    for (const object of new Set(rubbish.reverse())) {
      try {
        object.delete();
      } catch {
        // Already freed, or never allocated: either way there is nothing to do.
      }
    }
  }
}
