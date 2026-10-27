// One place that turns settings into a model: the symbol, the plan, the solids, the filaments, and what's worth
// knowing before it's printed.
//
// The checks matter as much as the geometry. A QR code that is beautiful and won't scan is a wasted print, and
// the three things that stop one scanning — modules too small for the nozzle, too little quiet zone, too little
// contrast between the two filaments — are all knowable here, before anything is sliced.

import { LEVEL_RECOVERY, encode, smallestVersion } from "./qr.js";
import { planFor } from "./layout.js";
import { buildParts } from "./geometry.js";
import { textFor } from "./content.js";

/** What a printer can actually draw: a module narrower than this comes out as a smudge. */
export const NOZZLE_MM = 0.4;

const hexToRgb = (hex) => {
  const value = String(hex ?? "").replace("#", "");
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value.padEnd(6, "0");
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16) / 255);
};

/** How light a colour reads, as the web's own measure, which is what contrast is worked out from. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** How far apart two colours read, from 1 (the same) to 21 (black on white). */
export function contrastRatio(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Which filament each part is printed in: the same colour twice is one filament, not two. */
export function filamentSlots(parts, colours) {
  const order = [];
  const slotOf = new Map();
  for (const part of parts) {
    const colour = (colours[part.kind] ?? colours.code ?? "#000000").toLowerCase();
    if (!slotOf.has(colour)) {
      slotOf.set(colour, order.length);
      order.push(colour);
    }
  }
  return {
    colours: order,
    parts: parts.map((part) => ({
      ...part,
      colour: colours[part.kind] ?? colours.code,
      slot: slotOf.get((colours[part.kind] ?? colours.code ?? "#000000").toLowerCase()),
    })),
  };
}

/**
 * The whole model for the settings given: the symbol, where everything sits, the solids, the filaments, and the
 * warnings worth reading.
 *
 * Throws only where there is nothing to draw at all — no content, or more of it than a QR code holds. Everything
 * else that might be wrong comes back as a warning, so the window keeps showing the code and says what to change.
 */
export function buildModel(state, { font = null, logo = null, singleColour = false } = {}) {
  const text = textFor(state.content);
  const code = encode(text, { level: state.level, version: state.version });
  const plan = planFor(code, state);
  const built = buildParts(code, state, plan, { font, logo, singleColour });
  const { colours, parts } = filamentSlots(built.parts, state.colours);

  const warnings = [...built.warnings];
  const totalDark = code.modules.reduce((count, value) => count + value, 0);
  const contrast = contrastRatio(state.colours.code, state.colours.base);
  const raised = !plan.flush;

  if (plan.cell < NOZZLE_MM * 2.5) warnings.push({ code: "moduleTiny", vars: { mm: plan.cell.toFixed(2) } });
  else if (plan.cell < 1.2) warnings.push({ code: "moduleSmall", vars: { mm: plan.cell.toFixed(2) } });
  if (plan.quiet === 0) warnings.push({ code: "noQuietZone" });
  else if (plan.quiet < 4) warnings.push({ code: "shortQuietZone", vars: { modules: plan.quiet } });
  if (contrast < 1.5) warnings.push({ code: raised ? "sameColourRaised" : "sameColourFlush" });
  else if (contrast < 3) warnings.push({ code: "lowContrast", vars: { ratio: contrast.toFixed(1) } });
  if (plan.patch && totalDark) {
    const share = (plan.clearedCount / totalDark) * 100;
    const allowed = LEVEL_RECOVERY[state.level] ?? 15;
    if (share > allowed * 0.7)
      warnings.push({ code: "patchTooBig", vars: { share: share.toFixed(0), level: state.level } });
    else if (share > 1) warnings.push({ code: "patchCovers", vars: { share: share.toFixed(0), level: state.level } });
  }
  if (state.fill < 0.85 && plan.cell < 1.6) warnings.push({ code: "thinModules" });
  if (Math.max(plan.plate.width, plan.plate.height) > 250) {
    warnings.push({ code: "biggerThanBed", vars: { mm: Math.round(Math.max(plan.plate.width, plan.plate.height)) } });
  }
  if (raised && state.codeMm > plan.cell * 1.5) warnings.push({ code: "tallModules" });
  if (code.version > 20) warnings.push({ code: "bigVersion", vars: { version: code.version } });

  const smallest = smallestVersion(text, state.level, code.mode);
  if (smallest && code.version > smallest)
    warnings.push({ code: "biggerThanNeeded", vars: { version: code.version, smallest } });

  return {
    text,
    code,
    plan,
    parts,
    filaments: colours,
    triangles: built.triangles,
    warnings,
    contrast,
    size: {
      width: plan.plate.width,
      height: plan.plate.height,
      thickness: plan.height,
      cell: plan.cell,
    },
    counts: { dark: totalDark, cleared: plan.clearedCount, modules: code.size * code.size },
  };
}
