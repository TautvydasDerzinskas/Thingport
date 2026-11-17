// Colours as filaments have them: "#RRGGBB" hexes, how far apart two look (CIEDE2000), and a plain name for one.

/** "#RRGGBB" in capitals, from "#rgb", "rrggbb" or "#rrggbbaa" (the alpha dropped); null for anything else. */
export function normaliseHex(text) {
  if (typeof text !== "string") return null;
  let hex = text.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  else if (/^[0-9a-f]{8}$/i.test(hex)) hex = hex.slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

/** Whether a value is a colour as a spool keeps it: exactly "#RRGGBB". */
export const isHex = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** CIE L*a*b* (D65) of an sRGB hex. */
export function hexToLab(hex) {
  const value = Number.parseInt(normaliseHex(hex).slice(1), 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const rad = (degrees) => (degrees * Math.PI) / 180;
const hue = (b, a) => {
  if (a === 0 && b === 0) return 0;
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
};

/** CIEDE2000 between two L*a*b* colours: about 1 is the smallest difference an eye sees side by side. */
export function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const chromatic = c1p * c2p !== 0;

  let dhp = 0;
  if (chromatic) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dLp = L2 - L1;
  const dCp = c2p - c1p;
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp / 2));

  const lBarp = (L1 + L2) / 2;
  const cBarp = (c1p + c2p) / 2;
  let hBarp = h1p + h2p;
  if (chromatic) {
    if (Math.abs(h1p - h2p) <= 180) hBarp = (h1p + h2p) / 2;
    else hBarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos(rad(hBarp - 30)) +
    0.24 * Math.cos(rad(2 * hBarp)) +
    0.32 * Math.cos(rad(3 * hBarp + 6)) -
    0.2 * Math.cos(rad(4 * hBarp - 63));
  const dTheta = 30 * Math.exp(-(((hBarp - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(cBarp ** 7 / (cBarp ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (lBarp - 50) ** 2) / Math.sqrt(20 + (lBarp - 50) ** 2);
  const sC = 1 + 0.045 * cBarp;
  const sH = 1 + 0.015 * cBarp * t;
  const rT = -Math.sin(rad(2 * dTheta)) * rC;
  return Math.sqrt((dLp / sL) ** 2 + (dCp / sC) ** 2 + (dHp / sH) ** 2 + rT * (dCp / sC) * (dHp / sH));
}

const labs = new Map();
const labOf = (hex) => {
  if (!labs.has(hex)) labs.set(hex, hexToLab(hex));
  return labs.get(hex);
};

/** How different two hexes look, by CIEDE2000. */
export function colourDistance(a, b) {
  return deltaE2000(labOf(normaliseHex(a)), labOf(normaliseHex(b)));
}

/** Colours a filament is commonly called, each a label `colour.<name>`. */
export const NAMED = [
  ["white", "#FFFFFF"],
  ["lightGrey", "#C8C8C8"],
  ["grey", "#8E8E8E"],
  ["darkGrey", "#4A4A4A"],
  ["black", "#111111"],
  ["red", "#C62828"],
  ["orange", "#F57C00"],
  ["yellow", "#F4D03F"],
  ["gold", "#C9A227"],
  ["beige", "#E3D3B0"],
  ["brown", "#6D4C41"],
  ["lime", "#8BC34A"],
  ["green", "#2E9D57"],
  ["teal", "#00897B"],
  ["cyan", "#29B6F6"],
  ["blue", "#1F5FBF"],
  ["navy", "#1A2A6C"],
  ["purple", "#7B3FA0"],
  ["pink", "#F06292"],
];

/** The colours offered to pick from, and the ones the shelf filters by. */
export const PALETTE = [
  "white",
  "black",
  "grey",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "brown",
  "beige",
].map((name) => [name, NAMED.find(([named]) => named === name)[1]]);

const nearest = (hex, list) => {
  let best = list[0][0];
  let distance = Infinity;
  for (const [name, reference] of list) {
    const d = colourDistance(hex, reference);
    if (d < distance) [best, distance] = [name, d];
  }
  return best;
};

/** The name a hex is closest to, as a key under `colour.`. */
export const nameOf = (hex) => nearest(hex, NAMED);

/** The palette colour a hex is closest to: the shelf's colour filter puts it there. */
export const bucketOf = (hex) => nearest(hex, PALETTE);
