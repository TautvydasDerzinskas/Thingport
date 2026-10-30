// The enclosure itself: its base and lid as solids, from the settings. The base is a rounded box with its inside taken
// out, less what stands inside it (screw bosses, PCB standoffs, snap ridges), with holes cut through it; the lid is a
// plate, with a lip that drops inside the base when it has one.
//
// x runs across the width, y along the length (the front faces -y) and z up; the base stands on z = 0 and the lid
// sits on top of it, at z = height.

import { normalize } from "./data.js";
import { subtract, triangles, union, unionAll, volume } from "./csg.js";
import {
  box,
  chamferedBottom,
  circle,
  cylinder,
  move2,
  prism,
  prismIn,
  rotate2,
  roundedRect,
  segmentsFor,
  stadium,
  trapezoid,
} from "./shapes.js";
import { measure, textSolid } from "./font.js";

const UP = [0, 0, 1];
/** PLA's density, g/cm³. */
const PLA = 1.24;

/**
 * Each wall seen from outside: its outward normal, the way along it from left to right, its length, and its outer
 * face's distance from the centre.
 */
function wallsOf(W, L) {
  return {
    front: { n: [0, -1, 0], u: [1, 0, 0], length: W, half: L / 2 },
    back: { n: [0, 1, 0], u: [-1, 0, 0], length: W, half: L / 2 },
    left: { n: [-1, 0, 0], u: [0, -1, 0], length: L, half: W / 2 },
    right: { n: [1, 0, 0], u: [0, 1, 0], length: L, half: W / 2 },
  };
}

/** The point on a wall's outer face `x` from its left end and `z` up. */
const onWall = (wall, x, z) =>
  [0, 1, 2].map((i) => wall.n[i] * wall.half + wall.u[i] * (x - wall.length / 2) + UP[i] * z);

/**
 * A prism of `outline` drawn on a wall's outer face around (x, z), from `d0` to `d1` outward: negative is into the wall.
 */
const wallPrism = (wall, outline, x, z, d0, d1) => prismIn(outline, onWall(wall, x, z), wall.u, UP, d0, d1);

/** A cutout's opening, centred. */
function cutoutOutline(c, quality) {
  let outline;
  if (c.shape === "circle") outline = circle(c.diameter / 2, segmentsFor(c.diameter / 2, quality));
  else if (c.shape === "type-c") outline = stadium(c.width, c.height, quality);
  else if (c.shape === "dsub") outline = trapezoid(c.width, c.height);
  else if (c.shape === "hdmi") outline = chamferedBottom(c.width, c.height, c.height * 0.3);
  else if (c.shape === "xt60") outline = chamferedBottom(c.width, c.height, c.height * 0.35);
  else outline = roundedRect(c.width, c.height, Math.min(0.5, c.width / 4, c.height / 4), quality);
  return rotate2(outline, c.rotation);
}

/** A cutout's extent from its centre, for placing its label. */
function cutoutHalf(c) {
  if (c.shape === "circle") return [c.diameter / 2, c.diameter / 2];
  const a = (c.rotation * Math.PI) / 180;
  const [cs, sn] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a))];
  return [(c.width * cs + c.height * sn) / 2, (c.width * sn + c.height * cs) / 2];
}

/** Holes in a pattern filling a `long` × `wide` area, centred, `long` along the first axis. */
function ventOutlines(p, long, wide, quality) {
  const w = p.ventSlotWidth;
  const s = p.ventSlotSpacing;
  if (p.ventPattern === "slots") {
    const count = Math.max(1, Math.min(p.ventSlotCount, Math.floor((wide + s) / (w + s))));
    const span = count * w + (count - 1) * s;
    return Array.from({ length: count }, (_, i) =>
      move2(stadium(long, w, quality), 0, -span / 2 + w / 2 + i * (w + s)),
    );
  }
  // Holes of one size in rows: dots, diamonds, or hexagons offset in alternate rows.
  const size = Math.max(2, w * 1.5);
  const pitch = size + s;
  const cols = Math.max(1, Math.floor((long + s) / pitch));
  const rowPitch = p.ventPattern === "honeycomb" ? pitch * 0.866 : pitch;
  const rows = Math.max(1, Math.floor((wide - size) / rowPitch) + 1);
  const shape =
    p.ventPattern === "dots"
      ? circle(size / 2, Math.max(12, segmentsFor(size / 2, quality)))
      : p.ventPattern === "diamonds"
        ? [
            [size / 2, 0],
            [0, size / 2],
            [-size / 2, 0],
            [0, -size / 2],
          ]
        : rotate2(circle(size / 2, 6), 30);
  const out = [];
  for (let r = 0; r < rows && out.length < 400; r++) {
    const offset = p.ventPattern === "honeycomb" && r % 2 ? pitch / 2 : 0;
    const n = offset ? cols - 1 : cols;
    for (let c = 0; c < n; c++) {
      const x = -((cols - 1) * pitch) / 2 + offset + c * pitch;
      const y = -((rows - 1) * rowPitch) / 2 + r * rowPitch;
      out.push(move2(shape, x, y));
    }
  }
  return out;
}

/**
 * A wedge for a snap fit: `section` is its outline across the wall, as [outward, up] points from the wall's outer face,
 * run along the wall `width` wide around `x`.
 */
function wedge(wall, x, width, section) {
  // Drawn in the plane of (outward, up), which runs along the wall the other way: from x + width/2 back.
  const area = section.reduce((sum, [d, z], i) => {
    const [d2, z2] = section[(i + 1) % section.length];
    return sum + d * z2 - d2 * z;
  }, 0);
  return prismIn(area > 0 ? section : section.slice().reverse(), onWall(wall, x + width / 2, 0), wall.n, UP, 0, width);
}

/**
 * The enclosure's base and lid, as triangles ready to print or draw, and what to know about them.
 * `quality` is "draft", "normal" or "high": how finely curves are cut.
 */
export function buildEnclosure(input, { quality = "normal" } = {}) {
  const { params: p, notes } = normalize(input);
  const warnings = [...notes];
  const W = p.width;
  const L = p.length;
  const H = p.height;
  const t = p.thickness;
  const tol = p.tolerance;
  const walls = wallsOf(W, L);
  const innerW = W - 2 * t;
  const innerL = L - 2 * t;
  const innerR = Math.max(0, p.radius - t);
  const q = quality;

  const lid = p.hasLid;
  const lip = lid && p.lidType === "lip";
  const screws = lid && p.lidFixation === "screws" && p.hasCornerScrews;
  const snap = lid && lip && p.lidFixation === "snap";
  const snapJoint = lid && lip && p.lidFixation === "snapJoint";
  const lipH = lip ? (snap || snapJoint ? Math.max(p.lidLipHeight, p.latchHeight + 2) : p.lidLipHeight) : 0;
  const lt = p.lidThickness;
  const lidTop = H + lt;

  const inside = []; // stands inside the base: taken from its hollow
  const baseAdd = []; // joined to the base's outside
  const baseHoles = [];
  const lidAdd = [];
  const lidHoles = [];
  const lipCuts = [];

  // ---- corner screws -----------------------------------------------------------------------------------------
  const corners = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(([sx, sy]) => [sx * (W / 2 - p.bossInset), sy * (L / 2 - p.bossInset), sx, sy]);
  if (screws) {
    for (const [x, y, sx, sy] of corners) {
      // The boss, and a block tying it to the corner of the walls.
      inside.push(cylinder(x, y, p.bossRadius, t - 0.5, H + 1, q));
      inside.push(
        box(
          Math.min(x, sx * (W / 2 - t / 2)),
          Math.min(y, sy * (L / 2 - t / 2)),
          t - 0.5,
          Math.max(x, sx * (W / 2 - t / 2)),
          Math.max(y, sy * (L / 2 - t / 2)),
          H + 1,
        ),
      );
      baseHoles.push(cylinder(x, y, p.screwDiameter / 2, Math.min(t + 1, H - 2), H + 1, q));
      lidHoles.push(cylinder(x, y, p.lidScrewDiameter / 2, H - lipH - 1, lidTop + 1, q));
      if (p.screwHeadDepth > 0)
        lidHoles.push(
          cylinder(x, y, p.screwHeadDiameter / 2, lidTop - Math.min(p.screwHeadDepth, lt - 0.6), lidTop + 1, q),
        );
      if (lip) {
        lipCuts.push(cylinder(x, y, p.bossRadius + tol, H - lipH - 1, H + 0.5, q));
        lipCuts.push(
          box(
            Math.min(x, sx * (W / 2)),
            Math.min(y, sy * (L / 2)),
            H - lipH - 1,
            Math.max(x, sx * (W / 2)),
            Math.max(y, sy * (L / 2)),
            H + 0.5,
          ),
        );
      }
    }
    if (p.screwHeadDiameter <= p.lidScrewDiameter) warnings.push("warn.screwHeads");
  }

  // ---- snap fits ---------------------------------------------------------------------------------------------
  const latchWalls = p.latchWalls.length ? p.latchWalls : ["left", "right"];
  const latchSpots = [];
  if (snap || snapJoint) {
    for (const name of latchWalls) {
      const wall = walls[name];
      const usable = wall.length - 2 * Math.max(p.radius, t) - p.latchWidth;
      for (let i = 0; i < p.latchCount; i++) {
        const x = wall.length / 2 + (p.latchCount === 1 ? 0 : -usable / 2 + (usable * i) / (p.latchCount - 1));
        latchSpots.push([wall, x]);
      }
    }
    const hw = Math.max(1.2, p.latchHeight * 0.4);
    const zb = H - lipH + 1.2;
    const lipOuter = -(t + tol);
    if (snap) {
      // Ridges on the base's walls, sloped on top; windows in the lip they click into.
      for (const [wall, x] of latchSpots) {
        const h = hw - 2 * tol;
        inside.push(
          wedge(wall, x, p.latchWidth, [
            [-t + 0.4, zb + tol],
            [-t - p.latchDepth, zb + tol],
            [-t + 0.4, zb + tol + h + p.latchDepth],
          ]),
        );
        lipCuts.push(
          wallPrism(
            wall,
            roundedRect(p.latchWidth + 2 * tol + 0.4, hw, 0, q),
            x,
            zb + hw / 2,
            lipOuter - p.lidLipThickness - 1,
            lipOuter + 1,
          ),
        );
      }
    } else {
      // Bumps on the lip, sloped below; grooves inside the base's walls they click into.
      for (const [wall, x] of latchSpots) {
        const top = zb + hw;
        lidAdd.push(
          wedge(wall, x, p.latchWidth, [
            [lipOuter - 0.4, top],
            [lipOuter + p.latchDepth, top],
            [lipOuter - 0.4, top - hw - p.latchDepth],
          ]),
        );
        baseHoles.push(
          wallPrism(
            wall,
            roundedRect(p.latchWidth + 2 * tol + 0.4, hw + 2 * tol + p.latchDepth, 0, q),
            x,
            top - (hw + p.latchDepth) / 2,
            -t - 0.5,
            -t + p.latchDepth + tol,
          ),
        );
      }
      if (t - p.latchDepth - tol < 0.8) warnings.push("warn.thinWalls");
    }
  }

  // ---- the lid's opening groove ------------------------------------------------------------------------------
  if (lid && p.hasLidGroove) {
    const name = p.grooveWall === "auto" ? (snap || snapJoint ? latchWalls[0] : "front") : p.grooveWall;
    const wall = walls[name];
    const depth = Math.min(p.grooveDepth, t - 0.4);
    baseHoles.push(
      wallPrism(wall, roundedRect(p.grooveWidth, p.grooveHeight * 2, 0, q), wall.length / 2, H, -depth, 1),
    );
  }

  // ---- wall-mount flanges ------------------------------------------------------------------------------------
  if (p.hasFlanges) {
    for (const name of p.flangeWalls) {
      const wall = walls[name];
      const reach = p.flangeLength;
      const fw = Math.min(p.flangeWidth, wall.length - 2 * p.radius);
      if (fw < 6) {
        warnings.push(`The ${name} wall is too short for a flange.`);
        continue;
      }
      // A tab from inside the wall outward, its far end round, with a hole in that end.
      const end = Math.min(fw / 2, reach);
      const tab = roundedRect(fw, reach + 2 * t, end, q).map(([s, e]) => [s, e + (reach - t) / 2 - t / 2]);
      const origin = onWall(wall, wall.length / 2, 0);
      baseAdd.push(prismIn(tab, origin, wall.u, wall.n, -p.flangeThickness, 0));
      const hole = reach - end;
      const [hx, hy] = [origin[0] + wall.n[0] * hole, origin[1] + wall.n[1] * hole];
      baseHoles.push(cylinder(hx, hy, p.flangeHoleDiameter / 2, -1, p.flangeThickness + 1, q));
      if (p.flangeHoleDiameter > end * 2 - 2) warnings.push("warn.flangeHoles");
    }
  }

  // ---- PCB standoffs -----------------------------------------------------------------------------------------
  if (p.hasPcbStandoffs) {
    const list =
      p.standoffMode === "list"
        ? p.pcbStandoffs
        : [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].map(([sx, sy]) => ({
            x: (sx * p.pcbWidth) / 2,
            y: (sy * p.pcbLength) / 2,
            height: p.pcbStandoffHeight,
            outerDia: p.pcbStandoffOuterDia,
            innerDia: p.pcbStandoffInnerDia,
          }));
    for (const s of list) {
      let [x, y] = [s.x, s.y];
      if (p.pcbRotated) [x, y] = [-y, x];
      x += p.pcbOffsetX;
      y += p.pcbOffsetY;
      const r = s.outerDia / 2;
      if (Math.abs(x) + r > innerW / 2 || Math.abs(y) + r > innerL / 2) {
        warnings.push(`A standoff at ${x.toFixed(1)}, ${y.toFixed(1)} mm is outside the box.`);
        continue;
      }
      const hole = Math.min(s.innerDia, s.outerDia - 1.2) / 2;
      if (p.pcbOnLid && lid) {
        const ringIn = [innerW / 2 - tol - p.lidLipThickness, innerL / 2 - tol - p.lidLipThickness];
        if (lip && (Math.abs(x) + r > ringIn[0] || Math.abs(y) + r > ringIn[1]) && s.height > 0)
          warnings.push("warn.standoffLip");
        lidAdd.push(cylinder(x, y, r, H - s.height, H + 0.5, q));
        lidHoles.push(cylinder(x, y, hole, H - s.height - 1, H + lt - 0.8, q));
      } else {
        inside.push(cylinder(x, y, r, t - 0.5, t + s.height, q));
        baseHoles.push(cylinder(x, y, hole, t + 0.6, t + s.height + 1, q));
      }
    }
  }

  // ---- vents -------------------------------------------------------------------------------------------------
  if (lid && p.hasVentilation) {
    const room = [
      innerW - 2 * (tol + (lip ? p.lidLipThickness : 0)) - 6,
      innerL - 2 * (tol + (lip ? p.lidLipThickness : 0)) - 6,
    ];
    const along = p.ventOrientation === "X" ? 0 : 1;
    const long = Math.min(p.ventSlotLength, room[along]);
    const wide = Math.min(p.ventSlotCount * (p.ventSlotWidth + p.ventSlotSpacing), room[1 - along]);
    if (long < p.ventSlotWidth * 2 || wide < p.ventSlotWidth) warnings.push("warn.noRoomVents");
    else
      for (const outline of ventOutlines(p, long, wide, q))
        lidHoles.push(prism(along === 0 ? outline : rotate2(outline, 90), H - lipH - 1, lidTop + 1));
  }
  for (const name of p.ventWalls) {
    const wall = walls[name];
    const top = H - Math.max(lipH, 0) - 3;
    const bottom = t + 3;
    const roomLong = wall.length - 2 * Math.max(p.radius, p.bossInset + p.bossRadius) - 4;
    const roomTall = top - bottom;
    const horizontal = p.ventOrientation === "X";
    const long = Math.min(p.ventSlotLength, horizontal ? roomLong : roomTall);
    const wide = Math.min(p.ventSlotCount * (p.ventSlotWidth + p.ventSlotSpacing), horizontal ? roomTall : roomLong);
    if (long < p.ventSlotWidth * 2 || wide < p.ventSlotWidth) {
      warnings.push(`The ${name} wall has no room for vents.`);
      continue;
    }
    for (const outline of ventOutlines(p, long, wide, q))
      baseHoles.push(
        wallPrism(wall, horizontal ? outline : rotate2(outline, 90), wall.length / 2, (top + bottom) / 2, -t - 1.5, 1),
      );
  }

  // ---- cutouts and their labels ------------------------------------------------------------------------------
  const labelDepth = (thick) => Math.min(0.6, thick * 0.3);
  for (const c of p.cutouts) {
    const outline = cutoutOutline(c, q);
    const [hx, hz] = cutoutHalf(c);
    const gap = 1.5;
    const labelSpot = (cx, cz) => {
      if (!c.label) return null;
      const size = c.labelSize;
      const { width } = measure(c.label, size);
      if (c.labelPosition === "below") return [cx, cz - hz - gap - size / 2];
      if (c.labelPosition === "left") return [cx - hx - gap - width / 2, cz];
      if (c.labelPosition === "right") return [cx + hx + gap + width / 2, cz];
      return [cx, cz + hz + gap + size / 2];
    };
    if (c.wall === "lid") {
      if (!lid) continue;
      const cx = c.x - W / 2;
      const cy = c.z - L / 2;
      if (Math.abs(cx) + hx > W / 2 - t || Math.abs(cy) + hz > L / 2 - t)
        warnings.push(`A cutout in the lid reaches past its edge.`);
      lidHoles.push(prism(move2(outline, cx, cy), H - lipH - 1, lidTop + 1));
      const spot = labelSpot(cx, cy);
      if (spot)
        lidHoles.push(
          textSolid(c.label, c.labelSize, [spot[0], spot[1], lidTop], [1, 0, 0], [0, 1, 0], -labelDepth(lt), 1),
        );
    } else {
      const wall = walls[c.wall];
      if (c.x - hx < 0 || c.x + hx > wall.length || c.z - hz < 0 || c.z + hz > H)
        warnings.push(`A cutout on the ${c.wall} wall reaches past its edge.`);
      baseHoles.push(wallPrism(wall, outline, c.x, c.z, -t - 1.5, 1));
      const spot = labelSpot(c.x, c.z);
      if (spot)
        baseHoles.push(textSolid(c.label, c.labelSize, onWall(wall, spot[0], spot[1]), wall.u, UP, -labelDepth(t), 1));
    }
  }

  // ---- text --------------------------------------------------------------------------------------------------
  if (p.hasText && p.textString.trim()) {
    const raise = p.textType === "emboss";
    if (p.textPlacement === "lid" && lid && p.hasVentilation) {
      // Both sit in the middle of the lid to begin with.
      const { width: tw, height: th } = measure(p.textString, p.textSize);
      const along = p.ventOrientation === "X";
      const vl = p.ventSlotLength / 2;
      const vw = (p.ventSlotCount * (p.ventSlotWidth + p.ventSlotSpacing)) / 2;
      const [vx, vy] = along ? [vl, vw] : [vw, vl];
      if (Math.abs(p.textOffsetX) < vx + tw / 2 && Math.abs(p.textOffsetY) < vy + th / 2)
        warnings.push("warn.textVents");
    }
    const depth = raise ? p.textDepth : Math.min(p.textDepth, (p.textPlacement === "lid" ? lt : t) - 0.6);
    const [d0, d1] = raise ? [-0.2, depth] : [-depth, 1];
    const { width, height } = measure(p.textString, p.textSize);
    if (p.textPlacement === "lid") {
      if (lid) {
        if (width > W - 2 * p.radius || height > L - 4) warnings.push("warn.textTooBig");
        const solid = textSolid(
          p.textString,
          p.textSize,
          [p.textOffsetX, p.textOffsetY, lidTop],
          [1, 0, 0],
          [0, 1, 0],
          d0,
          d1,
        );
        (raise ? lidAdd : lidHoles).push(solid);
      }
    } else {
      const wall = walls[p.textPlacement];
      if (width > wall.length - 2 * p.radius || height > H - 4)
        warnings.push(`The text is bigger than the ${p.textPlacement} wall.`);
      const solid = textSolid(
        p.textString,
        p.textSize,
        onWall(wall, wall.length / 2 + p.textOffsetX, H / 2 + p.textOffsetY),
        wall.u,
        UP,
        d0,
        d1,
      );
      (raise ? baseAdd : baseHoles).push(solid);
    }
  }

  // ---- putting it together -----------------------------------------------------------------------------------
  const outer = prism(roundedRect(W, L, p.radius, q), 0, H);
  const hollow = subtract(prism(roundedRect(innerW, innerL, innerR, q), t, H + 1), unionAll(inside));
  let base = subtract(union(outer, unionAll(baseAdd)), hollow);
  base = subtract(base, unionAll(baseHoles));

  let lidSolid = [];
  if (lid) {
    lidSolid = prism(roundedRect(W, L, p.radius, q), H, lidTop);
    if (lip) {
      const outerLip = roundedRect(innerW - 2 * tol, innerL - 2 * tol, Math.max(0, innerR - tol), q);
      const innerLip = roundedRect(
        innerW - 2 * (tol + p.lidLipThickness),
        innerL - 2 * (tol + p.lidLipThickness),
        Math.max(0, innerR - tol - p.lidLipThickness),
        q,
      );
      let ring = subtract(prism(outerLip, H - lipH, H + 0.2), prism(innerLip, H - lipH - 1, H + 0.5));
      ring = subtract(ring, unionAll(lipCuts));
      lidSolid = union(lidSolid, ring);
    }
    lidSolid = union(lidSolid, unionAll(lidAdd));
    lidSolid = subtract(lidSolid, unionAll(lidHoles));
  }

  const baseTris = triangles(base);
  const lidTris = lid ? triangles(lidSolid) : [];
  const baseVolume = volume(baseTris) / 1000;
  const lidVolume = volume(lidTris) / 1000;
  return {
    params: p,
    warnings: [...new Set(warnings)],
    base: baseTris,
    lid: lidTris,
    stats: {
      outer: [
        W + (p.hasFlanges ? flangeReach(p, "x") : 0),
        L + (p.hasFlanges ? flangeReach(p, "y") : 0),
        lid ? lidTop : H,
      ],
      inner: [innerW, innerL, H - t],
      baseVolume,
      lidVolume,
      grams: (baseVolume + lidVolume) * PLA,
    },
  };
}

function flangeReach(p, axis) {
  const walls = axis === "x" ? ["left", "right"] : ["front", "back"];
  return walls.filter((w) => p.flangeWalls.includes(w)).length * p.flangeLength;
}

/** The lid turned over to print, its top on the bed. */
export function lidForPrint(tris) {
  if (!tris.length) return tris;
  let top = -Infinity;
  for (const tri of tris) for (const v of tri) top = Math.max(top, v[2]);
  // Half a turn about x: y and z change sign, which is a turn, not a mirror, so the triangles keep their winding.
  return tris.map((tri) => tri.map(([x, y, z]) => [x, -y, top - z]));
}
