// Draws the plan: the wall from the front, the boards in it, and the hardware that holds them.
//
// Everything is in millimetres and converted once, through a view of { scale, x, y }, so the same code draws the
// window's canvas and the picture saved with the model — only the scale differs.

import { PITCH_MM } from "./catalogue.js";

/** Slot sizes on a real Skadis board, in mm, drawn once there is room to see them. */
const SLOT_W = 5;
const SLOT_H = 15;
/** Below this many pixels a millimetre the slots are left off: they would be a grey smear. A wall that fits the
 *  window sits around 0.7, so the pattern is there at the size the plan opens at. */
const SLOT_DETAIL = 0.5;

export const fit = (plan, width, height, pad = 48) => {
  const scale = Math.min((width - pad * 2) / plan.widthMm, (height - pad * 2) / plan.heightMm);
  return {
    scale,
    x: (width - plan.widthMm * scale) / 2,
    y: (height - plan.heightMm * scale) / 2,
  };
};

const roundRect = (ctx, x, y, w, h, r) => {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

/**
 * Draws the whole plan.
 *
 * `colours` comes from Thingport's theme, so the drawing is the window's own colours in both themes.
 */
export function drawPlan(
  ctx,
  { plan, markers = [], view, colours, showMounts = true, showSizes = true, width, height },
) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  const { scale } = view;
  const at = (mm) => mm * scale;
  const X = (mm) => view.x + at(mm);
  const Y = (mm) => view.y + at(mm);

  // The space asked for, behind everything: what isn't covered shows as the gap it is.
  ctx.fillStyle = colours.gap;
  ctx.fillRect(X(0), Y(0), at(plan.widthMm), at(plan.heightMm));
  ctx.strokeStyle = colours.outline;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(X(0) + 0.5, Y(0) + 0.5, at(plan.widthMm), at(plan.heightMm));
  ctx.setLineDash([]);

  for (const board of plan.boards) {
    const x = X(board.xMm);
    const y = Y(board.yMm);
    const w = at(board.widthMm);
    const h = at(board.heightMm);
    roundRect(ctx, x, y, w, h, at(4));
    ctx.fillStyle = board.mirrorX || board.mirrorY ? colours.boardMirrored : colours.board;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = colours.boardEdge;
    ctx.stroke();

    if (scale >= SLOT_DETAIL) {
      // The slots, on the same pitch as the real board: the first sits one pitch in from the edge.
      ctx.fillStyle = colours.slot;
      const slotW = at(SLOT_W);
      const slotH = at(SLOT_H);
      const plain = slotW < 2.5;
      for (let col = 0; col < board.cols; col++) {
        for (let row = 0; row < board.rows; row++) {
          const sx = x + at(PITCH_MM * (col + 1)) - slotW / 2;
          const sy = y + at(PITCH_MM * (row + 1)) - slotH / 2;
          // Rounded while there is room for the shape; a plain bar once a slot is a couple of pixels wide.
          if (plain) ctx.fillRect(Math.round(sx), sy, Math.max(1, slotW), slotH);
          else {
            roundRect(ctx, sx, sy, slotW, slotH, slotW / 2);
            ctx.fill();
          }
        }
      }
    }

    if (showSizes && w > 54 && h > 26) {
      ctx.font = `600 ${Math.min(13, Math.max(10, at(26)))}px ${colours.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const flip = board.mirrorX || board.mirrorY ? " ⇄" : "";
      const text = `${board.cols} × ${board.rows}${flip}`;
      const cx = x + w / 2;
      const cy = y + h / 2;
      // A patch of the board's own colour behind the label, or the slots read straight through it.
      const pad = 5;
      const textWidth = ctx.measureText(text).width;
      roundRect(ctx, cx - textWidth / 2 - pad, cy - 9, textWidth + pad * 2, 18, 5);
      ctx.fillStyle = board.mirrorX || board.mirrorY ? colours.boardMirrored : colours.board;
      ctx.fill();
      ctx.fillStyle = colours.label;
      ctx.fillText(text, cx, cy);
    }
  }

  if (showMounts) {
    for (const marker of markers) {
      const radius = Math.max(2.5, Math.min(6, at(7)));
      ctx.beginPath();
      ctx.arc(X(marker.x), Y(marker.y), radius, 0, Math.PI * 2);
      ctx.fillStyle = marker.role === "junction" ? colours.mountStrong : colours.mount;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = colours.mountEdge;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The dimension lines along the top and the left, drawn over the plan when they're asked for. */
export function drawMeasurements(ctx, { plan, view, colours }) {
  const { scale } = view;
  const at = (mm) => mm * scale;
  const X = (mm) => view.x + at(mm);
  const Y = (mm) => view.y + at(mm);
  ctx.save();
  ctx.strokeStyle = colours.dimension;
  ctx.fillStyle = colours.dimension;
  ctx.lineWidth = 1;
  ctx.font = `11px ${colours.font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const tick = (x, y, vertical) => {
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(x - 3, y);
      ctx.lineTo(x + 3, y);
    } else {
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 3);
    }
    ctx.stroke();
  };

  // Across the top, one span per column of boards.
  let x = 0;
  const top = Y(0) - 18;
  for (const holes of plan.columns) {
    const size = (holes + 1) * PITCH_MM;
    ctx.beginPath();
    ctx.moveTo(X(x), top);
    ctx.lineTo(X(x + size), top);
    ctx.stroke();
    tick(X(x), top, false);
    tick(X(x + size), top, false);
    if (at(size) > 34) ctx.fillText(String(size), X(x + size / 2), top - 8);
    x += size;
  }
  // Down the left, one span per row.
  let y = 0;
  const left = X(0) - 18;
  ctx.textAlign = "right";
  for (const holes of plan.rows) {
    const size = (holes + 1) * PITCH_MM;
    ctx.beginPath();
    ctx.moveTo(left, Y(y));
    ctx.lineTo(left, Y(y + size));
    ctx.stroke();
    tick(left, Y(y), true);
    tick(left, Y(y + size), true);
    if (at(size) > 20) ctx.fillText(String(size), left - 6, Y(y + size / 2));
    y += size;
  }
  ctx.restore();
}

/**
 * The plan as a PNG, for the picture on the saved model. Drawn at a fixed size on a canvas of its own rather than
 * from the window's, so it comes out the same whatever the window is doing.
 */
export async function planImage(plan, { markers, colours, width = 1200, height = 800 }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = colours.background;
  ctx.fillRect(0, 0, width, height);
  const view = fit(plan, width, height, 64);
  drawPlan(ctx, { plan, markers, view, colours, width, height, showMounts: true, showSizes: true });
  drawMeasurements(ctx, { plan, view, colours });
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}
