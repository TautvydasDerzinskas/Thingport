// The code as solids, one mesh per filament.
//
// A part per colour, not per module: a slicer wants a handful of objects it can give a filament each, not four
// thousand. So every dark module goes into one mesh, the plate and the light parts of a flush code into another,
// and the border, the caption and a logo pad into their own.
//
// Nothing here subtracts one shape from another. A raised code is modules standing on a slab; a flush code is a
// slab with a sheet on top whose dark parts are the modules and whose light parts are the bands around them, cut
// in the same directions, so the two meet exactly and neither overlaps the other.

import { extrudeBand, extrudeBox, extrudeRing, extrudeShape, createMesh } from "./mesh.js";
import { cellRing, eyeRings, moduleRing, reliefHeight, reliefLevels } from "./shapes.js";
import { MIN_RADIUS, circleAt, darkRuns, lightRuns, plateOutline, roundedRectRing } from "./layout.js";
import { captionShapes } from "./caption.js";

const nearlyEqual = (a, b) =>
  a.length === b.length && a.every((point, i) => Math.hypot(point[0] - b[i][0], point[1] - b[i][1]) < 1e-6);

/**
 * Every part of the model, from a plan.
 *
 * `font` is wanted only for a caption and `logo` only for a middle patch with something in it; both may be left
 * out, and what can't be drawn is reported rather than guessed at.
 */
export function buildParts(code, state, plan, { font = null, logo = null, singleColour = false } = {}) {
  const warnings = [];
  const raised = singleColour || !plan.flush;
  const top = plan.thickness.base;
  const codeHeight = raised ? Math.max(0.2, state.codeMm) : plan.thickness.code;

  const base = createMesh("base", "base");
  const dark = createMesh("code", "code");

  // ---- the plate ----
  const outline = plateOutline(plan, state);
  extrudeShape(base, outline.ring, outline.holes, 0, top);

  // ---- the modules ----
  const levels = (height) => reliefLevels(state.relief, height, plan.cell);
  // Plain squares, all of a height, are the one case where neighbouring modules are the same solid: a run of
  // them goes in as one box, which is a third of the triangles for the shape most likely to be printed small.
  const asRuns = state.body === "square" && state.fill >= 0.999 && state.relief === "flat";
  if (asRuns) {
    for (let row = 0; row < plan.size; row++) {
      for (const [from, to] of darkRuns(plan, row)) {
        const y1 = plan.grid.y0 + plan.gridMm - row * plan.cell;
        extrudeBox(
          dark,
          plan.grid.x0 + from * plan.cell,
          y1 - plan.cell,
          plan.grid.x0 + (to + 1) * plan.cell,
          y1,
          top,
          top + codeHeight,
        );
      }
    }
  }
  for (let row = 0; !asRuns && row < plan.size; row++) {
    for (let column = 0; column < plan.size; column++) {
      if (!plan.drawn(column, row)) continue;
      const [x, y] = plan.centreOf(column, row);
      const mask = plan.neighbours(column, row);
      const angles = plan.anglesFor(mask, !raised);
      const ring = moduleRing(state.body, x, y, plan.cell, mask, angles, state.fill);
      const height = raised ? reliefHeight(state.relief, codeHeight, column, row, plan.size) : codeHeight;
      const shaped = raised
        ? levels(height)
        : {
            levels: [
              { scale: 1, z: 0 },
              { scale: 1, z: height },
            ],
            apex: false,
          };
      extrudeRing(dark, ring, top, shaped.levels, shaped.apex);
      if (!raised) {
        // The light part of the cell: the band between the cell and the shape in it, cut in the same directions.
        const cell = cellRing(x, y, plan.cell, angles);
        if (!nearlyEqual(cell, ring)) extrudeBand(base, cell, ring, top, top + codeHeight);
      }
    }
  }

  // ---- the three eyes ----
  for (const eye of plan.eyes) {
    const rings = eyeRings(
      state.eyeFrame,
      state.eyeCentre,
      eye.x,
      eye.y,
      plan.cell,
      eye.towards,
      Math.max(24, plan.points * 3),
    );
    const height = raised ? reliefHeight(state.relief, codeHeight, eye.column, eye.row, plan.size) : codeHeight;
    const shaped = raised
      ? levels(height)
      : {
          levels: [
            { scale: 1, z: 0 },
            { scale: 1, z: height },
          ],
          apex: false,
        };
    extrudeBand(dark, rings.frameOuter, rings.frameInner, top, top + height);
    extrudeRing(dark, rings.pupilOuter, top, shaped.levels, shaped.apex);
    if (!raised) {
      if (!nearlyEqual(rings.block, rings.frameOuter))
        extrudeBand(base, rings.block, rings.frameOuter, top, top + codeHeight);
      extrudeBand(base, rings.frameInner, rings.pupilOuter, top, top + codeHeight);
    }
  }

  // ---- the light sheet of a flush code ----
  if (!raised) {
    const cell = plan.cell;
    for (let row = 0; row < plan.size; row++) {
      for (const [from, to] of lightRuns(plan, row)) {
        const x0 = plan.grid.x0 + from * cell;
        const x1 = plan.grid.x0 + (to + 1) * cell;
        const y1 = plan.grid.y0 + plan.gridMm - row * cell;
        extrudeBox(base, x0, y1 - cell, x1, y1, top, top + codeHeight);
      }
    }
    // The quiet zone, as the four strips round the grid.
    const { opening, grid, gridMm } = plan;
    const gridTop = grid.y0 + gridMm;
    if (plan.quietMm > 1e-6) {
      extrudeBox(base, opening.x0, gridTop, opening.x1, opening.y1, top, top + codeHeight);
      extrudeBox(base, opening.x0, opening.y0, opening.x1, grid.y0, top, top + codeHeight);
      extrudeBox(base, opening.x0, grid.y0, grid.x0, gridTop, top, top + codeHeight);
      extrudeBox(base, grid.x0 + gridMm, grid.y0, opening.x1, gridTop, top, top + codeHeight);
    }
  }

  const parts = [base.done(), dark.done()];

  // ---- the border ----
  if (state.border && plan.border > 0.01) {
    const frame = createMesh("border", "border");
    const outer = roundedRectRing(
      plan.plate.x0,
      plan.plate.y0,
      plan.plate.x1,
      plan.plate.y1,
      Math.max(MIN_RADIUS, state.cornerMm),
      10,
    );
    const inside = roundedRectRing(
      plan.opening.x0,
      plan.opening.y0,
      plan.opening.x1,
      plan.opening.y1,
      Math.max(MIN_RADIUS, Math.min(state.borderCornerMm, plan.quietMm + plan.border)),
      10,
    );
    extrudeBand(frame, outer, inside, top, top + plan.thickness.border);
    parts.push(frame.done());
  }

  // ---- the caption ----
  if (plan.caption && font) {
    const words = captionShapes(font, plan.caption.text, {
      sizeMm: plan.caption.sizeMm,
      maxWidthMm: plan.plate.width - 2 * Math.max(plan.border, 2) - 1,
    });
    if (words.shapes.length) {
      const mesh = createMesh("caption", "caption");
      // Centred in the band the plate grew for it.
      const bandMiddle =
        plan.caption.where === "top" ? plan.plate.y1 - plan.captionBand / 2 : plan.plate.y0 + plan.captionBand / 2;
      const shift = bandMiddle - (words.bottom + words.top) / 2;
      for (const shape of words.shapes) {
        extrudeShape(
          mesh,
          shape.outer.map(([x, y]) => [x, y + shift]),
          shape.holes.map((hole) => hole.map(([x, y]) => [x, y + shift])),
          top,
          top + plan.thickness.caption,
        );
      }
      parts.push(mesh.done());
      if (words.scaled < 0.999)
        warnings.push({ code: "captionShrunk", vars: { percent: Math.round(words.scaled * 100) } });
    } else {
      warnings.push({ code: "captionEmpty" });
    }
  } else if (plan.caption && !font) {
    warnings.push({ code: "captionNoFont" });
  }

  // ---- the middle patch, and a logo on it ----
  if (plan.patch) {
    const mesh = createMesh("patch", "patch");
    const padHeight = raised ? Math.max(0.4, codeHeight) : codeHeight;
    const ring =
      plan.patch.shape === "circle"
        ? circleAt(plan.patch.cx, plan.patch.cy, plan.patch.half, 64)
        : roundedRectRing(
            plan.patch.cx - plan.patch.half,
            plan.patch.cy - plan.patch.half,
            plan.patch.cx + plan.patch.half,
            plan.patch.cy + plan.patch.half,
            Math.max(MIN_RADIUS, plan.cell * 0.6),
            8,
          );
    extrudeShape(mesh, ring, [], top, top + padHeight);
    parts.push(mesh.done());

    if (logo?.shapes?.length) {
      const logoMesh = createMesh("logo", "code");
      const box = logo.bounds;
      const want = plan.patch.half * 2 * Math.max(0.2, Math.min(1, state.patch?.scale ?? 0.8));
      const scale = want / Math.max(box.maxX - box.minX, box.maxY - box.minY || 1);
      const dx = plan.patch.cx - ((box.minX + box.maxX) / 2) * scale;
      const dy = plan.patch.cy - ((box.minY + box.maxY) / 2) * scale;
      for (const shape of logo.shapes) {
        extrudeShape(
          logoMesh,
          shape.outer.map(([x, y]) => [x * scale + dx, y * scale + dy]),
          shape.holes.map((hole) => hole.map(([x, y]) => [x * scale + dx, y * scale + dy])),
          top + padHeight,
          top + padHeight + Math.max(0.2, state.patch?.raiseMm ?? 0.6),
        );
      }
      if (!logoMesh.empty) parts.push(logoMesh.done());
    }
  }

  const kept = parts.filter((part) => part.triangles.length > 0);
  const triangles = kept.reduce((total, part) => total + part.triangles.length / 3, 0);
  return { parts: kept, triangles, warnings };
}
