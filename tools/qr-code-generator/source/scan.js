// The code as a picture: what a reader sees, drawn from the same plan as the solid.
//
// This is the view to point a phone at. If it scans here it will scan off the plate, because it is the same
// shapes, the same quiet zone and the same cleared middle — only flat and in ink rather than filament.

import { cellRing, eyeRings, moduleRing } from "./shapes.js";
import { circleAt, plateOutline, roundedRectRing } from "./layout.js";

const path = (ctx, ring, toPixels) => {
  ring.forEach(([x, y], index) => {
    const [px, py] = toPixels(x, y);
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
};

/**
 * Draws the plan on a canvas, filling it. `colours` are the filaments; `background` is what goes behind the
 * plate, which is the window's own paper colour, and `plain` draws the code as flat black and white instead,
 * which is what a reader likes best and what the picture file holds.
 */
export function drawPlan(ctx, plan, state, { colours, background = "transparent", plain = false, padding = 8 } = {}) {
  const canvas = ctx.canvas;
  const width = canvas.width;
  const height = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }

  const plateWidth = plan.plate.width;
  const plateHeight = Math.max(plan.plate.height, plan.plate.height + (state.shape === "keychain" ? plan.cell * 6 : 0));
  const scale = Math.min((width - padding * 2) / plateWidth, (height - padding * 2) / plateHeight);
  const toPixels = (x, y) => [width / 2 + x * scale, height / 2 - y * scale];

  const base = plain ? "#ffffff" : colours.base;
  const ink = plain ? "#000000" : colours.code;

  // The plate, with its lug and hole where there is one.
  const outline = plateOutline(plan, state);
  ctx.beginPath();
  path(ctx, outline.ring, toPixels);
  ctx.fillStyle = base;
  ctx.fill();
  for (const hole of outline.holes) {
    ctx.beginPath();
    path(ctx, hole, toPixels);
    ctx.fillStyle = background === "transparent" ? "#00000000" : background;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fill();
    ctx.restore();
  }

  if (state.border && plan.border > 0.01 && !plain) {
    ctx.save();
    ctx.beginPath();
    path(
      ctx,
      roundedRectRing(plan.plate.x0, plan.plate.y0, plan.plate.x1, plan.plate.y1, Math.max(0.2, state.cornerMm), 10),
      toPixels,
    );
    path(
      ctx,
      roundedRectRing(
        plan.opening.x0,
        plan.opening.y0,
        plan.opening.x1,
        plan.opening.y1,
        Math.max(0.2, state.borderCornerMm),
        10,
      ),
      toPixels,
    );
    ctx.fillStyle = colours.border;
    ctx.fill("evenodd");
    ctx.restore();
  }

  // The modules.
  ctx.fillStyle = ink;
  ctx.beginPath();
  for (let row = 0; row < plan.size; row++) {
    for (let column = 0; column < plan.size; column++) {
      if (!plan.drawn(column, row)) continue;
      const [x, y] = plan.centreOf(column, row);
      const mask = plan.neighbours(column, row);
      path(ctx, moduleRing(state.body, x, y, plan.cell, mask, plan.anglesFor(mask, false), state.fill), toPixels);
    }
  }
  ctx.fill();

  // The eyes: the frame is a ring, so it is drawn with a hole in it.
  for (const eye of plan.eyes) {
    const rings = eyeRings(state.eyeFrame, state.eyeCentre, eye.x, eye.y, plan.cell, state.body, 64);
    ctx.beginPath();
    path(ctx, rings.frameOuter, toPixels);
    path(ctx, rings.frameInner, toPixels);
    ctx.fillStyle = ink;
    ctx.fill("evenodd");
    ctx.beginPath();
    path(ctx, rings.pupilOuter, toPixels);
    ctx.fill();
  }

  // The middle patch, and the logo on it.
  if (plan.patch) {
    const ring =
      plan.patch.shape === "circle"
        ? circleAt(plan.patch.cx, plan.patch.cy, plan.patch.half, 64)
        : roundedRectRing(
            plan.patch.cx - plan.patch.half,
            plan.patch.cy - plan.patch.half,
            plan.patch.cx + plan.patch.half,
            plan.patch.cy + plan.patch.half,
            Math.max(0.2, plan.cell * 0.6),
            8,
          );
    ctx.beginPath();
    path(ctx, ring, toPixels);
    ctx.fillStyle = plain ? "#ffffff" : colours.patch;
    ctx.fill();
  }

  if (plan.caption?.text && !plain) {
    const bandMiddle =
      plan.caption.where === "top" ? plan.plate.y1 - plan.captionBand / 2 : plan.plate.y0 + plan.captionBand / 2;
    const [px, py] = toPixels(0, bandMiddle);
    ctx.fillStyle = colours.caption;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.max(6, plan.caption.sizeMm * scale)}px ${state.captionFontFamily ?? "sans-serif"}`;
    ctx.fillText(plan.caption.text, px, py);
  }

  return { scale, toPixels };
}

/** The code on its own as a picture, black on white, the size asked for: this is the one to scan or to print. */
export function scanImage(plan, state, { pixels = 720 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = pixels;
  const ctx = canvas.getContext("2d");
  const squarePlan = {
    ...plan,
    plate: { ...plan.opening, width: plan.opening.x1 - plan.opening.x0, height: plan.opening.y1 - plan.opening.y0 },
  };
  drawPlan(
    ctx,
    squarePlan,
    { ...state, shape: "tile", border: false, cornerMm: 0 },
    {
      colours: { base: "#ffffff", code: "#000000", border: "#ffffff", caption: "#000000", patch: "#ffffff" },
      background: "#ffffff",
      plain: true,
      padding: 0,
    },
  );
  return canvas;
}
