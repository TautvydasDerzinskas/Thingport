const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const API = "https://api.open-meteo.com/v1/forecast";
const TWILIGHT = 50 * 60 * 1000;
const places = new Map();

// WMO weather codes, as Open-Meteo reports them: the label key for each, and which scene it draws. The words
// themselves are in locales/<code>.json, which Thingport reads and hands over as `t()`.
const CODES = {
  0: ["code.clear", "clear"],
  1: ["code.mostlyClear", "clear"],
  2: ["code.partly", "partly"],
  3: ["code.overcast", "overcast"],
  45: ["code.fog", "fog"],
  48: ["code.rimeFog", "fog"],
  51: ["code.lightDrizzle", "drizzle"],
  53: ["code.drizzle", "drizzle"],
  55: ["code.heavyDrizzle", "drizzle"],
  56: ["code.freezingDrizzle", "drizzle"],
  57: ["code.freezingDrizzle", "drizzle"],
  61: ["code.lightRain", "rain"],
  63: ["code.rain", "rain"],
  65: ["code.heavyRain", "heavy"],
  66: ["code.freezingRain", "rain"],
  67: ["code.freezingRain", "heavy"],
  71: ["code.lightSnow", "snow"],
  73: ["code.snow", "snow"],
  75: ["code.heavySnow", "heavysnow"],
  77: ["code.snowGrains", "snow"],
  80: ["code.showers", "rain"],
  81: ["code.showers", "rain"],
  82: ["code.heavyShowers", "heavy"],
  85: ["code.snowShowers", "snow"],
  86: ["code.heavySnowShowers", "heavysnow"],
  95: ["code.storm", "storm"],
  96: ["code.stormHail", "storm"],
  99: ["code.stormHail", "storm"],
};
// What a fixed scene is called, when one is picked instead of the live weather.
const PREVIEW = {
  clear: "code.clear",
  partly: "code.partly",
  overcast: "code.overcast",
  rain: "code.rain",
  snow: "code.snow",
  storm: "code.storm",
  fog: "code.fog",
};

// grey: 0 blue sky, 1 grey, 2 dark grey.
const KINDS = {
  clear: { clouds: 1, grey: 0 },
  partly: { clouds: 4, grey: 0 },
  overcast: { clouds: 7, grey: 1 },
  fog: { clouds: 2, grey: 1, fog: true },
  drizzle: { clouds: 6, grey: 1, rain: 45 },
  rain: { clouds: 7, grey: 1, rain: 90 },
  heavy: { clouds: 8, grey: 2, rain: 150 },
  snow: { clouds: 6, grey: 1, snow: 50 },
  heavysnow: { clouds: 8, grey: 1, snow: 110 },
  storm: { clouds: 8, grey: 2, rain: 130, flash: true },
};

const SKY = {
  night: ["#070b1f", "#1b2550", "#2e3a6b"],
  dawn: ["#2f3c74", "#b46f8e", "#f5b47a"],
  day: ["#2f7fd6", "#6fb2ec", "#bfe1fa"],
  dusk: ["#241f4f", "#a14a6b", "#f08a5d"],
};
const GREY = {
  night: ["#0e1119", "#1b202b", "#2a303c"],
  dawn: ["#4b5062", "#7d7680", "#b0998c"],
  day: ["#6c7a89", "#95a1ae", "#c1c9d2"],
  dusk: ["#383645", "#6a5964", "#9a7a72"],
};
const CLOUD = {
  night: ["#3b4358", "#2b303b", "#1f232b"],
  dawn: ["#f7cdbb", "#9d8c92", "#6d6670"],
  day: ["#ffffff", "#dfe4ea", "#8b939f"],
  dusk: ["#f2b5a0", "#8e7c86", "#5f5862"],
};
// Far hill, near hill, tree crown (none: bare).
const GROUND = {
  spring: ["#86c96f", "#5fae52", "#8fd47a"],
  summer: ["#55a043", "#3d8332", "#2f7a2a"],
  autumn: ["#c98f3e", "#a66b2d", "#e0752d"],
  winter: ["#9ea88c", "#7f8a70", null],
  snow: ["#eef3f7", "#d3dde6", null],
};
const LEAVES = { spring: ["#f7b7cc", "#fbd3e0", "#ffffff"], autumn: ["#e0752d", "#c9542a", "#e9a93b", "#a8442a"] };
const SNOW_WHITE = "#f4f8fb";
const BARK = "#4f3524";
// Far trees, nearer trees, the forest floor, pines, and the leafy trees' crowns (none: bare).
const FOREST = {
  spring: ["#b4dcae", "#86c47c", "#5fae52", "#2f7a45", ["#8fd47a", "#73c565", "#a5dd8f"]],
  summer: ["#8cc3a0", "#559e62", "#3d8332", "#1f5f36", ["#2f7a2a", "#3f8f38", "#4f9e43"]],
  autumn: ["#d3b47e", "#bb8440", "#a66b2d", "#2c5a3a", ["#e0752d", "#c9542a", "#e9a93b"]],
  winter: ["#aab4ad", "#8a958c", "#7f8a70", "#2f4f3f", null],
  snow: ["#dce6ec", "#bfccd5", "#e6edf2", "#355a4a", null],
};
// Far range, near range, and how high the snow comes down (a fraction of the panel's height).
const ROCK = {
  spring: ["#8ea3c4", "#6b7f9e", 0.5],
  summer: ["#8ea3c4", "#66788f", 0.56],
  autumn: ["#9a9db4", "#77717f", 0.5],
  winter: ["#a7b4c6", "#7f8ca0", 0.34],
  snow: ["#c5d2e0", "#a9b9ca", 0.26],
};
const BUILDINGS = ["#5f6f86", "#74808f", "#85695c", "#8f5f4e", "#56677f", "#98a2ac", "#6a5f78"];
const AWNINGS = ["#c9483b", "#2e8b7f", "#d99a2b", "#3f6fb5"];
const SKIN = ["#f2c9a1", "#d9a066", "#8d5a3b"];
const HAIR = ["#3b2a1e", "#7a4a21", "#d9a74a", "#23232b"];
const SHIRTS = ["#e53935", "#1e88e5", "#fdd835", "#8e24aa", "#43a047", "#fb8c00"];
const TROUSERS = ["#37474f", "#3e5c76", "#5d4037"];
const DOG_COATS = [
  ["#c58a4f", "#8f5e30"],
  ["#3c3a38", "#23211f"],
  ["#e3d6bf", "#b89f7c"],
];
const CARS = ["#d13b3b", "#2f6fb5", "#e8e8ea", "#2e2f36", "#e0a92b"];

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const f = (n, d = 1) => n.toFixed(d);
const repeat = (n, fn) => Array.from({ length: Math.round(n) }, (_, i) => fn(i)).join("");
const pick = (list, r = Math.random) => list[Math.floor(r() * list.length)];

// Drawn in units of --u, so one unit is as big here as in the CSS; vw by vh is the panel. The trees and ranges are
// SVG, which also keeps them out of reach of the square corners of Thingport's dark themes.
const art = (vw, vh, inner) =>
  `<svg class="wx-art" viewBox="0 0 ${f(vw)} ${f(vh)}" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
const outline = (points) => `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}Z`;

// Rolling ground across the panel, through heights given as fractions of the panel's.
function swell(vw, vh, heights) {
  const at = (i) => [(i / (heights.length - 1)) * vw, vh * (1 - heights[i])];
  const [startX, startY] = at(0);
  let d = `M0 ${f(vh)}L${f(startX)} ${f(startY)}`;
  for (let i = 1; i < heights.length - 1; i++) {
    const [x, y] = at(i);
    const [nextX, nextY] = at(i + 1);
    d += `Q${f(x)} ${f(y)} ${f((x + nextX) / 2)} ${f((y + nextY) / 2)}`;
  }
  const [endX, endY] = at(heights.length - 1);
  return `${d}L${f(endX)} ${f(endY)}L${f(vw)} ${f(vh)}Z`;
}

// The top of a distant wood: a jagged line of treetops.
function treeline(r, vw, vh, top, jag, step) {
  const points = [[-step, vh]];
  for (let x = -step; x < vw + step; x += step * (0.7 + r() * 0.6)) {
    const tip = top - r() * jag;
    points.push([x, tip + step * 1.1], [x + step * 0.5, tip]);
  }
  points.push([vw + step, vh]);
  return outline(points);
}

// A mountain range: its outline, a shaded side for each peak, and snow on the ones above the snow line.
function range(r, vw, vh, { count, low, high, snowLine, color, opacity = 1 }) {
  const points = [[-6, vh]];
  const peaks = [];
  const jagged = (x, y) => {
    const [px, py] = points.at(-1);
    points.push([(px + x) / 2 + (r() - 0.5) * Math.abs(x - px) * 0.3, (py + y) / 2 + (r() - 0.5) * vh * 0.05], [x, y]);
  };
  for (let i = 0; i < count; i++) {
    const x = ((i + 0.2 + r() * 0.6) / count) * vw;
    const height = low + r() * (high - low);
    if (i) {
      const [previousX] = points.at(-1);
      jagged(previousX + (x - previousX) * (0.4 + r() * 0.2), vh * (1 - height * (0.62 + r() * 0.12)));
    } else points.push([x - vw / count, vh * (1 - height * 0.7)]);
    jagged(x, vh * (1 - height));
    peaks.push(points.length - 1);
  }
  points.push([vw + 6, vh * (1 - low * 0.7)], [vw + 6, vh]);

  const line = vh * (1 - snowLine);
  const walk = (from, dir) => {
    const path = [];
    let j = from;
    while (points[j + dir] && points[j + dir][1] < line) path.push(points[(j += dir)]);
    const [ax, ay] = points[j];
    const [bx, by] = points[j + dir] ?? points[j];
    path.push([by === ay ? ax : ax + ((bx - ax) * (line - ay)) / (by - ay), line]);
    return path;
  };
  let shade = "";
  let caps = "";
  for (const peak of peaks) {
    const [x, y] = points[peak];
    const [downX, downY] = points[peak + 2] ?? points[peak + 1];
    shade += `<path d="${outline([[x, y], points[peak + 1], [downX, downY], [x + (downX - x) * 0.18, downY]])}"/>`;
    if (y >= line) continue;
    const left = walk(peak, -1);
    const right = walk(peak, 1);
    const [leftX] = left.at(-1);
    const [rightX] = right.at(-1);
    const teeth = Array.from({ length: 5 }, (_, k) => [
      rightX + ((leftX - rightX) * (k + 1)) / 6,
      line + (k % 2 ? 0.4 : 1) * vh * 0.035 * (0.6 + r() * 0.8),
    ]);
    caps += `<path d="${outline([...left.toReversed(), [x, y], ...right, ...teeth])}"/>`;
  }
  return (
    `<g opacity="${opacity}"><path fill="${color}" d="${outline(points)}"/>` +
    `<g fill="#0b1630" opacity="0.14">${shade}</g><g fill="${SNOW_WHITE}">${caps}</g></g>`
  );
}

// Trees, standing on the bottom of a box: pines are 40 by 80, leafy ones 40 by 60.
function pine(color, snowy) {
  return (
    `<rect x="17.5" y="66" width="5" height="14" fill="${BARK}"/>` +
    `<path fill="${color}" d="M20 0 31 22H25.5L35 44H28.5L39 70H1L11.5 44H5L14.5 22H9Z"/>` +
    `<path fill="#000" opacity="0.14" d="M20 0 31 22H25.5L35 44H28.5L39 70H20Z"/>` +
    (snowy
      ? `<path fill="${SNOW_WHITE}" d="M20 0 27 14 23.5 12 20 15.5 16.5 12 13 14ZM14.5 22H25.5L29.5 31 25.5 28 21.5 32 17.5 28 11 31ZM11.5 44H28.5L33.5 55 28 51 24 56 20 51 15 56 11.5 51 6.5 55Z"/>`
      : "")
  );
}
function leafy(color, { blossom, snowy } = {}) {
  return (
    `<rect x="18" y="30" width="4" height="30" fill="${BARK}"/>` +
    `<g fill="${color}"><circle cx="20" cy="17" r="15"/><circle cx="9" cy="27" r="9.5"/><circle cx="31" cy="27" r="9.5"/></g>` +
    `<path fill="#000" opacity="0.1" d="M20 32a10 10 0 0 0 11 4.5 9.5 9.5 0 0 0 3-18.5 15 15 0 0 0-14 14Z"/>` +
    (blossom
      ? `<g fill="#f7b7cc">${[
          [12, 12],
          [24, 8],
          [30, 20],
          [17, 22],
          [7, 28],
          [33, 31],
          [25, 27],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.7"/>`)
          .join("")}</g>`
      : "") +
    (snowy
      ? `<path fill="${SNOW_WHITE}" d="M6.5 12a15 15 0 0 1 27 0c-4-2.5-6-1-8.5.5-3-3-6-3-9 0-2.5-1.5-5.5-3-9.5-.5Z"/>`
      : "")
  );
}
function bare(snowy) {
  return (
    `<path fill="none" stroke="${BARK}" stroke-width="2.6" stroke-linecap="round" d="M20 60V20M20 42 9 27M20 34 32 20M20 25 13 12M20 27 27 9M12 30 6 26M28 25 34 26"/>` +
    (snowy
      ? `<path fill="none" stroke="${SNOW_WHITE}" stroke-width="1.3" stroke-linecap="round" d="M9.5 26 17 36M31 20 23 30M13.5 11.5 18 19M26.5 8.5 22 18"/>`
      : "")
  );
}
const TREE_BOX = { pine: [40, 80], leafy: [40, 60], bare: [40, 60] };

// A tree inside a scene's art, centred on x with its foot on y.
function plant(x, y, height, kind, inner) {
  const [w, h] = TREE_BOX[kind];
  const scale = height / h;
  return `<g transform="translate(${f(x - (w * scale) / 2)} ${f(y - height)}) scale(${f(scale, 3)})">${inner}</g>`;
}
// A tree of its own in the foreground, swaying with the wind.
function standing(leftPercent, bottom, height, kind, inner, sway) {
  const [w, h] = TREE_BOX[kind];
  const width = (height * w) / h;
  return `<svg class="wx-standing" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="left:${f(leftPercent)}%;bottom:${bottom};width:calc(var(--u) * ${f(width)});height:calc(var(--u) * ${f(height)});margin-left:calc(var(--u) * ${f(width / -2)});--sw:${f(sway)}deg;animation-delay:-${f(leftPercent / 20)}s">${inner}</svg>`;
}

// What a tree of this season looks like in the forest and the city.
function seasonTree(s, r, colors) {
  if (!colors) return ["bare", bare(s.snowy)];
  return ["leafy", leafy(pick(colors, r), { blossom: s.season === "spring" && !s.snowy, snowy: s.snowy })];
}

// What each landscape draws, back to front: `back`; `lights`, undimmed at night; then whoever passes through; `front`,
// which is closer to the viewer than they are and covers them; and `halos`, undimmed again. The lower something's foot
// is on the panel the closer it is, so what's in `front` stands below `lane` and what's in `back` above it.
// `lane` and `road` are where the ground-level visitors walk and drive, as a CSS `bottom`.
const LANDSCAPES = {
  field({ r, s, area, crown, sway }) {
    const tree = crown
      ? `<div class="wx-trunk"></div><div class="wx-crown${s.season === "spring" ? " blossom" : ""}${s.snowy ? " snowy" : ""}"></div>`
      : `<div class="wx-trunk"></div><div class="wx-branch b1"></div><div class="wx-branch b2"></div><div class="wx-branch b3"></div>`;
    const flowers =
      s.season === "spring" && !s.snowy
        ? repeat(
            14 * area,
            () =>
              `<i class="wx-flower" style="left:${f(r() * 100)}%;bottom:${f(2 + r() * 12)}%;background:${["#ffffff", "#ffe066", "#f7a8c4"][Math.floor(r() * 3)]}"></i>`,
          )
        : "";
    return {
      lane: "6%",
      back: `<div class="wx-hill far"></div><div class="wx-hill near"></div>${flowers}<div class="wx-tree${crown ? "" : " bare"}" style="--sw:${f(sway)}deg">${tree}</div>`,
    };
  },

  forest({ r, s, vw, vh, sway }) {
    const [far, mid, floor, pineColor, crowns] = FOREST[s.snowy ? "snow" : s.season];
    const leaves = s.snowy && s.season !== "winter" ? FOREST[s.season][4] : crowns;
    const tree = () => {
      if (r() < 0.45) return ["pine", pine(pineColor, s.snowy)];
      return seasonTree(s, r, leaves);
    };
    const row = (n, y, lo, hi) =>
      repeat(n, (i) => {
        const [kind, inner] = tree();
        const height = (kind === "pine" ? 1.25 : 1) * (lo + r() * (hi - lo));
        return plant(((i + 0.15 + r() * 0.7) / n) * vw, y + r() * 1.5, height, kind, inner);
      });
    const front = [
      [3 + r() * 3, 50 + r() * 8],
      [29 + r() * 7, 34 + r() * 6],
      [70 + r() * 6, 38 + r() * 6],
      [95 + r() * 3, 52 + r() * 8],
    ];
    return {
      lane: "5%",
      leaves: true,
      back: art(
        vw,
        vh,
        `<path fill="${far}" d="${treeline(r, vw, vh, vh * 0.8 - 22, 7, 5)}"/>` +
          `<path fill="${mid}" d="${treeline(r, vw, vh, vh * 0.8 - 13, 6, 6.5)}"/>` +
          row(Math.round(vw / 8), vh * 0.8, 21, 27) +
          `<path fill="${floor}" d="${swell(vw, vh, [0.21, 0.17, 0.2, 0.16, 0.19, 0.17, 0.2])}"/>` +
          row(Math.round(vw / 13), vh * 0.87, 24, 30),
      ),
      front: front
        .map(([left, height]) => {
          const [kind, inner] = tree();
          return standing(left, "-3%", kind === "pine" ? height * 1.2 : height, kind, inner, sway / 2);
        })
        .join(""),
    };
  },

  mountains({ r, s, vw, vh, g, sway, area }) {
    const [farRock, nearRock, snowLine] = ROCK[s.snowy ? "snow" : s.season];
    const pineColor = FOREST[s.snowy ? "snow" : s.season][3];
    const flowers =
      s.season === "spring" && !s.snowy
        ? repeat(
            10 * area,
            () =>
              `<i class="wx-flower" style="left:${f(r() * 100)}%;bottom:${f(1 + r() * 8)}%;background:${pick(["#ffffff", "#ffe066", "#f7a8c4"], r)}"></i>`,
          )
        : "";
    const pines = (n, y, lo, hi) =>
      repeat(n, (i) => {
        return plant(
          ((i + 0.1 + r() * 0.8) / n) * vw,
          y + r() * 2,
          lo + r() * (hi - lo),
          "pine",
          pine(pineColor, s.snowy),
        );
      });
    const count = Math.max(3, Math.round(vw / 42));
    return {
      lane: "4%",
      leaves: false,
      back:
        art(vw, vh, range(r, vw, vh, { count, low: 0.46, high: 0.62, snowLine, color: farRock, opacity: 0.92 })) +
        `<div class="wx-mist" style="bottom:18%;height:26%"></div>` +
        art(
          vw,
          vh,
          range(r, vw, vh, { count: count + 1, low: 0.28, high: 0.4, snowLine, color: nearRock }) +
            `<path fill="${g[0]}" d="${swell(vw, vh, [0.2, 0.25, 0.19, 0.24, 0.17, 0.22, 0.19])}"/>` +
            pines(Math.round(vw / 9), vh * 0.83, 8, 13) +
            `<path fill="${g[1]}" d="${swell(vw, vh, [0.13, 0.11, 0.15, 0.1, 0.14, 0.11, 0.13])}"/>`,
        ) +
        flowers,
      front:
        standing(4 + r() * 3, "-2%", 30 + r() * 6, "pine", pine(pineColor, s.snowy), sway / 2) +
        standing(93 + r() * 3, "-2%", 34 + r() * 8, "pine", pine(pineColor, s.snowy), sway / 2),
    };
  },

  city({ r, s, vw, vh, crown, lit }) {
    const road = vh - 10;
    const walk = road - 7;
    const glass = "#c9e0f2";
    let farSky = "";
    for (let x = -r() * 6; x < vw;) {
      const w = 8 + r() * 13;
      const top = vh * (1 - (0.42 + r() * 0.17));
      farSky += `<rect x="${f(x)}" y="${f(top)}" width="${f(w + 0.5)}" height="${f(walk - top)}"/>`;
      x += w;
    }
    let blocks = "";
    let panes = "";
    let litPanes = "";
    let flickering = "";
    let shops = "";
    let beacon = "";
    let tallest = { top: vh };
    for (let x = -r() * 8; x < vw;) {
      const w = 15 + r() * 14;
      const top = vh * (1 - (0.34 + r() * 0.2));
      if (top < tallest.top) tallest = { x: x + w / 2, top };
      blocks += `<rect x="${f(x)}" y="${f(top)}" width="${f(w + 0.4)}" height="${f(walk - top)}" fill="${pick(BUILDINGS, r)}"/>`;
      blocks += `<rect x="${f(x)}" y="${f(top)}" width="${f(w * 0.28)}" height="${f(walk - top)}" fill="#000" opacity="0.1"/>`;
      if (r() < 0.45)
        blocks += `<rect x="${f(x + w * 0.2 + r() * w * 0.4)}" y="${f(top - 3)}" width="${f(3 + r() * 3)}" height="3" fill="#4a505c"/>`;
      if (s.snowy)
        blocks += `<rect x="${f(x - 0.3)}" y="${f(top - 0.9)}" width="${f(w + 1)}" height="2" fill="${SNOW_WHITE}"/>`;
      const shop = r() < 0.55;
      const lastRow = shop ? walk - 11 : walk - 5;
      const cols = Math.max(1, Math.floor((w - 3) / 4));
      const pad = (w - cols * 4 + 1.8) / 2;
      for (let y = top + 3.5; y < lastRow; y += 5.4) {
        for (let c = 0; c < cols; c++) {
          const px = x + pad + c * 4;
          const pane = `M${f(px)} ${f(y)}h2.2v3h-2.2Z`;
          panes += pane;
          const roll = r();
          if (roll < lit * 0.14) flickering += pane;
          else if (roll < lit) litPanes += pane;
        }
      }
      if (shop) {
        const shopTop = walk - 7;
        blocks += `<rect x="${f(x + 1)}" y="${f(shopTop + 1.6)}" width="${f(w - 2)}" height="5.4" fill="#2c3440"/>`;
        blocks += `<rect x="${f(x + 0.4)}" y="${f(shopTop)}" width="${f(w - 0.8)}" height="2" fill="${pick(AWNINGS, r)}"/>`;
        const fronts = Math.max(2, Math.floor((w - 3) / 6));
        for (let i = 0; i < fronts; i++) {
          const pane = (w - 3 - (fronts - 1) * 0.7) / fronts;
          const px = x + 1.5 + i * (pane + 0.7);
          blocks += `<rect x="${f(px)}" y="${f(shopTop + 2.4)}" width="${f(pane)}" height="4.2" fill="${glass}" opacity="0.28"/>`;
          shops += `<rect x="${f(px)}" y="${f(shopTop + 2.4)}" width="${f(pane)}" height="4.2"/>`;
        }
      }
      x += w;
    }
    if (tallest.x) {
      blocks += `<path stroke="#3b404b" stroke-width="0.5" d="M${f(tallest.x)} ${f(tallest.top)}V${f(tallest.top - 8)}"/>`;
      beacon = `<rect class="wx-beacon" x="${f(tallest.x - 0.6)}" y="${f(tallest.top - 8.8)}" width="1.2" height="1.2" fill="#ff5a4d"/>`;
    }
    const street = s.snowy
      ? { pavement: "#e8eef3", curb: "#c6d0d9", road: "#aab4bd" }
      : { pavement: "#aeb3ba", curb: "#8d939b", road: "#4a4f58" };
    let dashes = "";
    if (!s.snowy) for (let x = 2; x < vw; x += 9) dashes += `M${f(x)} ${f(road + 5)}h4.5v0.6h-4.5Z`;

    const trees = Math.max(2, Math.round(vw / 34));
    const planted = repeat(trees, (i) => {
      const [kind, inner] = seasonTree(s, r, crown ? [crown, crown] : null);
      return plant(((i + 0.25 + r() * 0.5) / trees) * vw, walk + 5.5, 12 + r() * 3.5, kind, inner);
    });
    const lamps = Math.max(2, Math.round(vw / 42));
    const lampAt = Array.from({ length: lamps }, (_, i) => ((i + 0.5) / lamps) * vw + (r() - 0.5) * 6);
    const posts = lampAt
      .map(
        (x) =>
          `<path fill="none" stroke="#2d323b" stroke-width="0.8" d="M${f(x)} ${f(walk + 6)}V${f(walk - 12)}q0 -2 2 -2h1.6"/><rect x="${f(x + 3)}" y="${f(walk - 14.6)}" width="3" height="1.2" fill="#2d323b"/>`,
      )
      .join("");
    const glows = lampAt
      .map(
        (x) =>
          `<i class="wx-lamp" style="left:${f(((x + 4.5) / vw) * 100)}%;bottom:calc(var(--u) * ${f(vh - walk + 13.5)})"></i>`,
      )
      .join("");
    return {
      lane: "calc(var(--u) * 13.5)",
      road: "calc(var(--u) * 1.6)",
      leaves: true,
      fireflies: false,
      back: art(
        vw,
        vh,
        `<g fill="#92a6bd" opacity="0.72">${farSky}</g>` +
          blocks +
          `<path fill="${glass}" opacity="0.55" d="${panes}"/>` +
          `<rect y="${f(walk)}" width="${f(vw)}" height="7.4" fill="${street.pavement}"/>` +
          `<rect y="${f(road - 0.8)}" width="${f(vw)}" height="0.8" fill="${street.curb}"/>` +
          `<rect y="${f(road)}" width="${f(vw)}" height="10" fill="${street.road}"/>` +
          `<path fill="#d9dcdf" d="${dashes || "M0 0"}"/>`,
      ),
      lights: art(
        vw,
        vh,
        `<g fill="#ffd98a">${s.phase === "day" ? "" : `<g opacity="0.84">${shops}</g>`}<path d="${litPanes || "M0 0"}"/><path class="wx-flicker" d="${flickering || "M0 0"}"/></g>${beacon}`,
      ),
      // At the curb: nearer than anyone on the pavement, though not the road.
      front: art(vw, vh, planted + posts),
      halos: glows,
    };
  },
};

// Whatever passes through: `fits` keeps each to the scenes it looks right in, and `play` draws it. No ball games in
// the rain; nothing out in a storm but the traffic.
const daylight = (s) => s.phase !== "night";
const dry = (s) => !s.k.rain && !s.k.snow && !s.k.fog;
const clearSky = (s) => !s.k.grey;

// Crossing the panel once, either way, at `speed` units of --u a second.
function crossing({ vw }, { width, speed, place, inner }) {
  const seconds = (vw + width) / speed;
  const back = Math.random() < 0.5;
  return {
    seconds,
    html: `<div class="wx-track wx-cross${back ? " back" : ""}" style="--w:calc(var(--u) * ${width});${place};animation-duration:${f(seconds)}s;animation-timing-function:linear"><div class="wx-troupe" style="width:calc(var(--u) * ${width})">${inner}</div></div>`,
  };
}

function sprite(box, left, width, height, inner, vars = "") {
  return `<svg class="wx-sprite" viewBox="${box}" aria-hidden="true" style="left:calc(var(--u) * ${f(left)});width:calc(var(--u) * ${f(width)});height:calc(var(--u) * ${f(height)});${vars}">${inner}</svg>`;
}
const footShadow = (cx, cy, rx) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="1.3" fill="#000" opacity="0.16"/>`;

function deerSprite(left, size, antlers, delay) {
  const legs = (x, cls, color) =>
    `<rect class="leg ${cls}" x="${x}" y="30" width="3.2" height="21" rx="1.5" fill="${color}"/>`;
  return sprite(
    "0 -8 64 62",
    left,
    15 * size,
    14.5 * size,
    footShadow(30, 52.5, 21) +
      `<g class="lope">` +
      legs(14, "b", "#8c5f3a") +
      legs(41, "a", "#8c5f3a") +
      legs(18, "b", "#a9744a") +
      legs(45, "a", "#a9744a") +
      `<path fill="#f5efe6" d="M13 21 7 17c-1 3 1 8 5 10Z"/>` +
      `<path fill="#a9744a" d="M12 26C12 20 18 17 26 17H38C41 17 43 15 45 12L48 6C49 4 52 3 54 4L60 7C62 8 62 10 60 11L54 13C52 14 51 16 50 19L48 26C47 31 43 34 38 34H20C15 34 12 31 12 26Z"/>` +
      `<path fill="#d9b58a" d="M18 33C24 31 38 31 44 30 42 33 40 34 38 34H20C19 34 18.5 33.5 18 33Z"/>` +
      `<path fill="#8c5f3a" d="M49 5 44 1C44 4 46 7 48 8Z"/>` +
      (antlers
        ? `<path fill="none" stroke="#6a4a2e" stroke-width="1.6" stroke-linecap="round" d="M52 4C51 0 50 -2 48 -6M50.5 0 46 -2M54 4C55 0 57 -2 58 -6M56 0 60 -2"/>`
        : "") +
      `<circle cx="55" cy="8" r="0.9" fill="#20150c"/><circle cx="61" cy="9" r="1" fill="#20150c"/>` +
      `</g>`,
    `--pace:0.4s;--reach:36deg;--lift:-2.5px;--pitch:3deg;--delay:${delay}s`,
  );
}

function dogSprite(left, pace = "0.2s") {
  const [coat, dark] = pick(DOG_COATS);
  const legs = (x, cls, color) =>
    `<rect class="leg ${cls}" x="${x}" y="18" width="2.8" height="10.5" rx="1.3" fill="${color}"/>`;
  return sprite(
    "0 -1 46 31",
    left,
    11,
    7.4,
    footShadow(22, 29, 15) +
      `<g class="lope">` +
      legs(11, "b", dark) +
      legs(28, "a", dark) +
      legs(15, "b", coat) +
      legs(32, "a", coat) +
      `<path class="wag" fill="none" stroke="${coat}" stroke-width="2.4" stroke-linecap="round" d="M9 12C6 10 4 8 3 4"/>` +
      `<path fill="${coat}" d="M8 13C9 10 13 9 18 9H30C32 9 33 8 34 6L35 4C36 2 39 1 41 2L45 5C46 6 46 7 45 8L41 10C39 11 38 12 37 14L36 17C35 20 32 21 29 21H13C9 21 7 17 8 13Z"/>` +
      `<path fill="${dark}" d="M37 2 33 1C32 4 33 8 35 9 36 7 37 5 37 2Z"/>` +
      `<path fill="none" stroke="#d13b3b" stroke-width="1.3" d="M33 7.5 36.5 12"/>` +
      `<circle cx="40" cy="5" r="0.8" fill="#15110d"/><circle cx="45" cy="6.5" r="0.9" fill="#15110d"/>` +
      `</g>`,
    `--pace:${pace};--reach:40deg;--lift:-1.5px;--pitch:4deg`,
  );
}

function personSprite(left, { running, umbrella }) {
  const skin = pick(SKIN);
  const shirt = pick(SHIRTS);
  const trousers = pick(TROUSERS);
  const leg = (cls, color) =>
    `<g class="leg ${cls}"><rect x="10" y="25" width="4" height="18" rx="1.8" fill="${color}"/><rect x="10" y="41.5" width="6.2" height="2.6" rx="1.2" fill="#23232b"/></g>`;
  const arm = (cls, color) =>
    `<rect class="arm ${cls}" x="10.3" y="12.5" width="3.4" height="13" rx="1.6" fill="${color}"/>`;
  const canopy = umbrella
    ? `<path fill="none" stroke="#3a3a42" stroke-width="1" d="M16 -3V15"/><path fill="${pick(["#c62828", "#1565c0", "#f9a825", "#2e7d32"])}" d="M2 0Q16 -17 30 0Q26.5 -2.5 23 0Q19.5 -2.5 16 0Q12.5 -2.5 9 0Q5.5 -2.5 2 0Z"/>`
    : "";
  return sprite(
    "0 -14 32 60",
    left,
    8.4,
    15.8,
    footShadow(12, 44.5, 8) +
      `<g transform="rotate(${running ? 7 : 1} 12 26)">` +
      `<g class="lope">` +
      leg("b", trousers) +
      (umbrella ? "" : arm("a", shirt)) +
      leg("a", trousers) +
      `<rect x="8" y="11" width="8" height="16" rx="3.2" fill="${shirt}"/>` +
      `<circle cx="12" cy="6" r="4.7" fill="${skin}"/>` +
      `<path fill="${pick(HAIR)}" d="M7.3 6A4.7 4.7 0 0 1 16.7 5C14 3.5 11 4 9.5 6.5Z"/>` +
      (umbrella
        ? `<path fill="none" stroke="${skin}" stroke-width="2.8" stroke-linecap="round" d="M12 14 16 11"/>`
        : arm("b", skin)) +
      `</g>${canopy}</g>`,
    running ? "--pace:0.2s;--reach:42deg;--lift:-1.5px" : "--pace:0.5s;--reach:20deg;--lift:-0.6px",
  );
}

function ball(left) {
  return `<svg class="wx-ball" viewBox="0 0 12 12" aria-hidden="true" style="left:calc(var(--u) * ${left})"><g class="spin"><circle cx="6" cy="6" r="5.5" fill="#e53935"/><path fill="none" stroke="#fff" stroke-width="1.2" stroke-linecap="round" d="M1.7 3.2Q6 5.6 10.3 3.2M1.7 8.8Q6 6.4 10.3 8.8"/></g></svg>`;
}

function flying({ vw }, s, { speed, top, pace, width, birds }) {
  return crossing(
    { vw },
    {
      width,
      speed,
      place: `top:${f(top)}%`,
      inner: `<div class="wx-flock" style="color:${s.phase === "night" ? "#c2cbe0" : "#1b2230"};width:calc(var(--u) * ${width});--pace:${pace}s">${birds}</div>`,
    },
  );
}

const EVENTS = {
  birds: {
    fits: (_, s) => daylight(s) && dry(s),
    play(ctx, s) {
      const count = 3 + Math.floor(Math.random() * 5);
      const birds = repeat(count, (i) => {
        const rank = Math.ceil(i / 2);
        const side = i % 2 ? 1 : -1;
        return `<svg class="wx-bird" viewBox="0 0 20 8" aria-hidden="true" style="left:calc(var(--u) * ${f(23 - rank * 7)});top:calc(var(--u) * ${f(rank * side * 4.2)});width:calc(var(--u) * ${f(6.4 + Math.random() * 1.4)});height:calc(var(--u) * 2.6);animation-delay:-${f(Math.random())}s"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path class="wing" d="M10 5Q6 1.5 1 3"/><path class="wing right" d="M10 5Q14 1.5 19 3"/></g><ellipse cx="10" cy="5.3" rx="1.7" ry="0.9" fill="currentColor"/></svg>`;
      });
      return flying(ctx, s, { speed: 15, top: 18 + Math.random() * 20, pace: 0.34, width: 30, birds });
    },
  },
  owl: {
    fits: (landscape, s) => landscape !== "city" && (s.phase === "night" || s.phase === "dusk") && dry(s),
    play(ctx, s) {
      const birds = `<svg class="wx-bird owl" viewBox="0 0 36 12" aria-hidden="true" style="left:0;top:0;width:calc(var(--u) * 11);height:calc(var(--u) * 3.7)"><path fill="currentColor" d="M0 8Q8 0 16 6L18 4 20 6Q28 0 36 8 28 6 22 9L18 12 14 9Q8 6 0 8Z"/></svg>`;
      return flying(ctx, s, { speed: 16, top: 16 + Math.random() * 20, pace: 0.62, width: 11, birds });
    },
  },
  meteor: {
    fits: (_, s) => s.phase === "night" && clearSky(s),
    play() {
      const a = Math.random() < 0.5 ? 18 + Math.random() * 16 : 146 + Math.random() * 16;
      return {
        seconds: 1.2,
        html: `<i class="wx-meteor" style="left:${f(25 + Math.random() * 50)}%;top:${f(6 + Math.random() * 24)}%;--a:${f(a)}deg"></i>`,
      };
    },
  },
  deer: {
    fits: (landscape, s) => landscape !== "city" && daylight(s) && !s.k.rain && s.kind !== "heavysnow",
    play(ctx) {
      const count = 1 + Math.floor(Math.random() * 3);
      const herd = repeat(count, (i) =>
        deerSprite([32, 12, 0][i] - (count === 1 ? 32 : count === 2 ? 12 : 0), i ? 0.84 : 1, !i, -i * 0.13),
      );
      return crossing(ctx, {
        width: count === 1 ? 15 : count === 2 ? 35 : 47,
        speed: 36,
        place: `bottom:${ctx.lane}`,
        inner: herd,
      });
    },
  },
  dog: {
    fits: (landscape, s) => landscape !== "forest" && s.phase !== "night" && s.phase !== "dawn" && dry(s),
    play(ctx) {
      return crossing(ctx, { width: 24, speed: 30, place: `bottom:${ctx.lane}`, inner: dogSprite(0) + ball(19) });
    },
  },
  player: {
    fits: (landscape, s) => (landscape === "field" || landscape === "city") && s.phase === "day" && dry(s),
    play(ctx) {
      const withDog = Math.random() < 0.4;
      const offset = withDog ? 14 : 0;
      return crossing(ctx, {
        width: 18 + offset,
        speed: 24,
        place: `bottom:${ctx.lane}`,
        inner: (withDog ? dogSprite(0) : "") + personSprite(offset, { running: true }) + ball(offset + 14),
      });
    },
  },
  umbrella: {
    fits: (landscape, s) =>
      (landscape === "city" || (landscape === "field" && daylight(s))) && (s.kind === "drizzle" || s.kind === "rain"),
    play(ctx) {
      return crossing(ctx, {
        width: 9,
        speed: 9,
        place: `bottom:${ctx.lane}`,
        inner: personSprite(0, { umbrella: true }),
      });
    },
  },
  car: {
    fits: (landscape) => landscape === "city",
    play(ctx, s) {
      const headlights = s.phase === "night" || s.phase === "dusk" || s.k.grey === 2 || s.k.fog;
      const paint = pick(CARS);
      const body =
        footShadow(35, 25, 30) +
        `<path fill="${paint}" d="M2 20V14Q3 11 8 10L18 9 28 2Q30 1 33 1H46Q49 1 51 3L58 9 64 10Q68 11 68 15V20Z"/>` +
        `<path fill="#bcd6e8" d="M21 9 30 3.5H38V9ZM41 3.5H47L53 9H41Z"/><rect x="2" y="12" width="3" height="3" fill="#d32f2f"/><rect x="64.5" y="12" width="3.5" height="3" fill="#ffe9a8"/>` +
        `<g fill="#17181c"><circle cx="16" cy="20" r="5.2"/><circle cx="54" cy="20" r="5.2"/></g><g fill="#a9adb5"><circle cx="16" cy="20" r="2.2"/><circle cx="54" cy="20" r="2.2"/></g>`;
      return crossing(ctx, {
        width: 24,
        speed: 46,
        place: `bottom:${ctx.road}`,
        inner:
          sprite("0 0 70 26", 0, 24, 8.9, body) +
          (headlights ? `<div class="wx-beam" style="left:calc(var(--u) * 23.5)"></div>` : ""),
      });
    },
  },
};

const eventsFor = (landscape, s) => Object.keys(EVENTS).filter((name) => EVENTS[name].fits(landscape, s));

// The guest: the Thingport logo out for a walk, and what it brings along for the scene. Rain and snow come first, as
// nobody hikes without an umbrella in the rain.
function gearFor(landscape, s) {
  if (s.k.rain) return "umbrella";
  if (s.snowy) return "beanie";
  if (landscape === "forest" || landscape === "mountains") return "backpack";
  return s.phase === "day" && !s.k.grey ? "sunglasses" : "hat";
}

const GUEST_HEIGHT = 40;
const GUEST_WIDTH = (GUEST_HEIGHT * 100) / 108;
const INK = "#1f1f1f";
const limb = `fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`;
const hand = (x, y) => `<circle cx="${x}" cy="${y}" r="5.6" fill="#fff" stroke="${INK}" stroke-width="2.4"/>`;
const swingingArm = (side, shoulder, reach, beat) =>
  `<g class="arm ${side} ${beat}" style="--shoulder:${shoulder}px"><path ${limb} d="M${shoulder} 46 ${shoulder + reach} 70"/>${hand(shoulder + reach * 1.1, 72)}</g>`;
const walkingLeg = (x, beat) =>
  `<g class="leg ${beat}"><path ${limb} d="M${x} 70V100"/><ellipse cx="${x + 3}" cy="102" rx="7.5" ry="4" fill="#00b800" stroke="${INK}" stroke-width="2"/></g>`;

const GEAR = {
  // Drawn behind the body, on the side it walks away from.
  backpack: {
    behind:
      `<rect x="3" y="30" width="27" height="42" rx="7" fill="#d9692b" stroke="${INK}" stroke-width="2.4"/>` +
      `<rect x="7" y="52" width="15" height="14" rx="3" fill="#a54a1c"/>` +
      `<rect x="1" y="19" width="31" height="11" rx="5.5" fill="#3f6f55" stroke="${INK}" stroke-width="2.4"/>`,
    front: `<path fill="none" stroke="#a54a1c" stroke-width="4" stroke-linecap="round" d="M27 32Q36 24 43 15M25 58Q29 50 31 44"/>`,
  },
  hat: {
    front:
      `<path fill="#9c6b36" stroke="${INK}" stroke-width="2" d="M34 21Q33 2 50 2 67 2 66 21Z"/>` +
      `<rect x="33.5" y="14" width="33" height="6" fill="#3b2a1e"/>` +
      `<ellipse cx="50" cy="21.5" rx="30" ry="4.6" fill="#b5834a" stroke="${INK}" stroke-width="2"/>`,
  },
  beanie: {
    front:
      `<circle cx="50" cy="1" r="6" fill="#fff" stroke="${INK}" stroke-width="2"/>` +
      `<path fill="#d13b3b" stroke="${INK}" stroke-width="2" d="M29 26Q29 5 50 5 71 5 71 26Z"/>` +
      `<rect x="26" y="20" width="48" height="9" rx="4" fill="#f4f1ea" stroke="${INK}" stroke-width="2"/>`,
  },
  // Far too big for it, on purpose.
  sunglasses: {
    eyes:
      `<g class="gaze"><g class="shades"><path fill="none" stroke="${INK}" stroke-width="4" d="M47 42Q50 38 53 42"/>` +
      `<g fill="#14161b" stroke="${INK}" stroke-width="2"><rect x="15" y="33" width="33" height="27" rx="11"/><rect x="52" y="33" width="33" height="27" rx="11"/></g>` +
      `<path fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity="0.8" d="M22 44 29 38M26 50 37 40M59 44 66 38M63 50 74 40"/></g></g>`,
  },
  // Held up in the right hand, tilted over its head, so that's the arm that doesn't swing and the other one waves.
  umbrella: {
    arm: `<path ${limb} d="M78 47 84 39"/>`,
    front:
      `<g transform="rotate(-20 84 38)"><path fill="none" stroke="#3a3a42" stroke-width="2.4" stroke-linecap="round" d="M84 -24V49Q84 54 79 54"/>` +
      `<path fill="#c62828" stroke="${INK}" stroke-width="2" stroke-linejoin="round" d="M36 2Q84 -52 132 2 120 -8 108 2 96 -8 84 2 72 -8 60 2 48 -8 36 2Z"/></g>` +
      hand(84, 38),
  },
};

function guestFigure(gear) {
  const kit = GEAR[gear] ?? {};
  // Big and not quite a pair. The pupils look ahead as it walks and jiggle with each step.
  const eyes =
    kit.eyes ??
    `<g class="eyes"><g fill="#fff" stroke="${INK}" stroke-width="2.4"><circle cx="38" cy="47" r="13"/><circle cx="62" cy="45" r="15"/></g>` +
      `<g class="gaze"><g class="lope" fill="${INK}"><circle cx="39" cy="48" r="6.5"/><circle cx="61" cy="46" r="7.5"/></g></g></g>`;
  return (
    `<svg class="wx-sprite wx-figure" viewBox="0 0 100 108" aria-hidden="true" style="width:calc(var(--u) * ${f(GUEST_WIDTH)});height:calc(var(--u) * ${GUEST_HEIGHT});margin-left:calc(var(--u) * ${f(GUEST_WIDTH / -2)});--pace:0.26s;--reach:26deg;--lift:-3px">` +
    footShadow(50, 105, 30) +
    `<g class="lope">` +
    (kit.behind ?? "") +
    walkingLeg(40, "a") +
    walkingLeg(60, "b") +
    swingingArm("left", 22, -11, "b") +
    (kit.arm ?? swingingArm("right", 78, 11, "a")) +
    // favicon.svg, on a white body so the scene doesn't show through it.
    `<g transform="translate(10 6)"><path fill="#fff" stroke="${INK}" stroke-width="5.270" stroke-linejoin="round" d="M35.382 11.301Q40 8.635 44.618 11.301L62.545 21.651Q67.163 24.317 67.163 29.650L67.163 50.350Q67.163 55.682 62.545 58.349L44.618 68.699Q40 71.365 35.382 68.699L17.455 58.349Q12.837 55.683 12.837 50.350L12.837 29.650Q12.837 24.318 17.455 21.651Z"/>` +
    `<path fill="#00b800" d="M42.264 37.285Q40 38.592 37.736 37.285L27.286 31.252Q25.022 29.945 27.286 28.637L37.736 22.604Q40 21.297 42.264 22.604L52.714 28.637Q54.978 29.944 52.714 31.252Z"/>` +
    `<path fill="#00b800" d="M36.517 39.397Q38.781 40.704 38.781 43.318L38.781 55.385Q38.781 57.999 36.517 56.692L26.067 50.659Q23.803 49.352 23.803 46.737L23.803 34.671Q23.803 32.056 26.067 33.363Z"/>` +
    `<path fill="#00b800" d="M41.219 43.318Q41.219 40.704 43.483 39.397L53.933 33.363Q56.197 32.056 56.197 34.671L56.197 46.737Q56.197 49.352 53.933 50.659L43.483 56.692Q41.219 57.999 41.219 55.385Z"/></g>` +
    (kit.front ?? "") +
    eyes +
    `<path class="smile" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" d="M41 65Q50 73 59 65"/>` +
    `<g class="wave"><path ${limb} d="M22 46 7 21"/>${hand(5, 18)}</g>` +
    `</g></svg>`
  );
}

async function locate(fetch, query) {
  const coords = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coords) return { lat: Number(coords[1]), lon: Number(coords[2]), name: "" };
  const key = query.trim().toLowerCase();
  if (!places.has(key)) {
    const res = await fetch(`${GEO}?name=${encodeURIComponent(query.trim())}&count=1&format=json`);
    if (!res.ok) throw new Error("geocoding");
    const hit = (await res.json()).results?.[0];
    if (!hit) throw new Error("notfound");
    places.set(key, { lat: hit.latitude, lon: hit.longitude, name: hit.name });
  }
  return places.get(key);
}

// Sunrises and sunsets around now, as epoch ms. Open-Meteo gives them in the location's local time.
function sunEvents(data, off) {
  const events = [];
  if (data) {
    const toMs = (s) => Date.parse(`${s}Z`) - off;
    data.daily.time.forEach((_, i) => {
      if (data.daily.sunrise[i]) events.push({ up: true, t: toMs(data.daily.sunrise[i]) });
      if (data.daily.sunset[i]) events.push({ up: false, t: toMs(data.daily.sunset[i]) });
    });
  } else {
    const local = new Date(Date.now() + off);
    const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off;
    for (const d of [-1, 0, 1]) {
      events.push(
        { up: true, t: midnight + (d * 24 + 7) * 3600e3 },
        { up: false, t: midnight + (d * 24 + 19) * 3600e3 },
      );
    }
  }
  return events.toSorted((a, b) => a.t - b.t);
}

function sunState(events, now, isDay) {
  const i = events.findLastIndex((e) => e.t <= now);
  const prev = events[i];
  const next = events[i + 1];
  if (!prev || !next) return { up: isDay, phase: isDay ? "day" : "night", progress: 0.5 };
  const near = [prev, next]
    .filter((e) => Math.abs(now - e.t) < TWILIGHT)
    .toSorted((a, b) => Math.abs(now - a.t) - Math.abs(now - b.t))[0];
  return {
    up: prev.up,
    phase: near ? (near.up ? "dawn" : "dusk") : prev.up ? "day" : "night",
    progress: (now - prev.t) / (next.t - prev.t),
  };
}

const TIME_PREVIEW = {
  dawn: { up: true, phase: "dawn", progress: 0.04 },
  day: { up: true, phase: "day", progress: 0.42 },
  dusk: { up: true, phase: "dusk", progress: 0.96 },
  night: { up: false, phase: "night", progress: 0.4 },
};

function seasonOf(month, lat) {
  const m = lat < 0 ? (month + 6) % 12 : month;
  return m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
}

// 0 new moon, 0.5 full.
const moonAge = (now) => ((((now - Date.UTC(2000, 0, 6, 18, 14)) / 86400000 / 29.530588) % 1) + 1) % 1;

function moonMask(age) {
  const lit = (1 - Math.cos(2 * Math.PI * age)) / 2;
  const shift = lit * 110;
  const cx = age < 0.5 ? 50 - shift : 50 + shift;
  const r = "calc(var(--u) * 8)";
  const mask = `radial-gradient(circle ${r} at ${f(cx)}% 50%, transparent calc(${r} - 0.5px), #000 ${r})`;
  return `-webkit-mask:${mask};mask:${mask}`;
}

export default function mount(thingport) {
  const { root, settings, theme, t } = thingport;
  const q = (c) => root.querySelector(c);
  const wx = q(".wx");
  const layer = {
    sky: q(".wx-sky"),
    stars: q(".wx-stars"),
    body: q(".wx-body"),
    clouds: q(".wx-clouds"),
    ground: q(".wx-ground"),
    lights: q(".wx-lights"),
    events: q(".wx-events"),
    front: q(".wx-front"),
    guest: q(".wx-guest"),
    halos: q(".wx-halos"),
    shade: q(".wx-shade"),
    precip: q(".wx-precip"),
    fog: q(".wx-fog"),
    storm: q(".wx-storm"),
  };
  const text = { temp: q(".wx-temp"), desc: q(".wx-desc"), place: q(".wx-place"), extra: q(".wx-extra") };
  const imperial = settings.units === "imperial";
  const shuffled = settings.landscape === "random";
  let landscape = LANDSCAPES[settings.landscape] ? settings.landscape : "field";
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  wx.style.fontFamily = theme.fontFamily;

  let size = thingport.size;
  let data = null;
  let place = null;
  let sceneKey = "";
  let stopped = false;
  let settle = null;
  let eventTimer = null;
  let walkways = {};
  let shuffledAt = null;
  let visiting = false;
  // The side the guest comes in from next: -1 left, 1 right. It's the side it last left by.
  let guestSide = -1;
  let guestMove = null;
  let guestPause = null;

  function fit(next) {
    size = next;
    wx.style.setProperty("--u", `${Math.min(next.width, next.height) / 100}px`);
    wx.classList.toggle("small", next.width < 240 || next.height < 150);
  }
  fit(size);
  const stopResize = thingport.onResize((next) => {
    fit(next);
    clearTimeout(settle);
    settle = setTimeout(draw, 250);
  });
  // The panel's width in units of --u: how much scene there's room to draw.
  const unitsWide = () => (size.width / Math.max(1, Math.min(size.width, size.height))) * 100;

  function scene(now = Date.now()) {
    const cur = data?.current;
    const off = (data ? data.utc_offset_seconds : -new Date().getTimezoneOffset() * 60) * 1000;
    const lat = data?.latitude ?? place?.lat ?? 50;
    const sun = TIME_PREVIEW[settings.time] ?? sunState(sunEvents(data, off), now, cur ? cur.is_day === 1 : true);
    const kind = PREVIEW[settings.scene] ? settings.scene : (CODES[cur?.weather_code]?.[1] ?? "partly");
    const tempC = cur ? (imperial ? ((cur.temperature_2m - 32) * 5) / 9 : cur.temperature_2m) : 10;
    const windKmh = cur ? (imperial ? cur.wind_speed_10m * 1.609 : cur.wind_speed_10m) : 8;
    const season = settings.season !== "auto" ? settings.season : seasonOf(new Date(now + off).getUTCMonth(), lat);
    const k = KINDS[kind];
    const snowy = Boolean(k.snow) || (season === "winter" && tempC <= 1 && settings.season === "auto");
    return { ...sun, kind, k, season, snowy, windKmh, moon: moonAge(now) };
  }

  function placeBody(s) {
    const p = clamp(s.progress, 0, 1);
    layer.body.style.left = `${f(6 + p * 88)}%`;
    layer.body.style.top = `${f(64 - Math.sin(p * Math.PI) * 50)}%`;
  }

  function build(s) {
    const r = rng(7);
    const { k, phase } = s;
    // "Random" picks again each time the time of day turns, so a dashboard left open still changes.
    if (shuffled && phase !== shuffledAt) {
      const others = Object.keys(LANDSCAPES).filter((name) => shuffledAt === null || name !== landscape);
      landscape = pick(others);
      shuffledAt = phase;
    }
    const twilight = phase === "dawn" || phase === "dusk";
    const area = clamp((size.width * size.height) / 90000, 0.5, 2);

    const sky = (k.grey ? GREY : SKY)[phase];
    layer.sky.style.background = `linear-gradient(${sky[0]}, ${sky[1]} 55%, ${sky[2]})`;

    const starAlpha = k.grey ? 0 : phase === "night" ? 1 : twilight ? 0.3 : 0;
    layer.stars.style.opacity = starAlpha;
    layer.stars.innerHTML = starAlpha
      ? repeat(
          45 * area,
          () =>
            `<i class="wx-star" style="left:${f(r() * 100)}%;top:${f(r() * 62)}%;transform:scale(${f(0.6 + r(), 2)});animation-duration:${f(2 + r() * 3)}s;animation-delay:-${f(r() * 4)}s"></i>`,
        )
      : "";

    layer.body.className = `wx-body${twilight ? " low" : ""}`;
    layer.body.innerHTML = s.up
      ? `<div class="wx-rays"></div><div class="wx-sun"></div>`
      : `<div class="wx-moonbase"></div><div class="wx-moonglow"><div class="wx-moon" style="${moonMask(s.moon)}"></div></div>`;
    layer.body.style.opacity = k.fog ? 0.5 : k.grey ? (k.clouds >= 7 ? 0.25 : 0.4) : 1;
    placeBody(s);

    wx.style.setProperty("--cc", CLOUD[phase][k.grey]);
    const speed = 1 + Math.min(s.windKmh, 60) / 15;
    layer.clouds.innerHTML =
      (k.grey ? `<div class="wx-blanket"></div>` : "") +
      repeat(k.clouds, () => {
        const dur = (80 + r() * 70) / speed;
        return `<div class="wx-track" style="--w:calc(var(--u) * ${f(26 + r() * 26)});top:${f(5 + r() * 36)}%;animation-duration:${f(dur)}s;animation-delay:-${f(r() * dur)}s"><div class="wx-cloud" style="opacity:${f(0.75 + r() * 0.25, 2)}"></div></div>`;
      });

    const g = GROUND[s.snowy ? "snow" : s.season];
    const crown = s.snowy && s.season !== "winter" ? GROUND[s.season][2] : g[2];
    const dimmed = k.grey ? 0.85 : 1;
    wx.style.setProperty("--gb", (phase === "night" ? 0.38 : twilight ? 0.72 : 1) * dimmed);
    wx.style.setProperty("--gs", phase === "night" ? 0.6 : 1);
    // Dimmed less than the ground, as the guest is meant to be seen.
    wx.style.setProperty("--mb", phase === "night" ? 0.72 : twilight ? 0.88 : 1);
    layer.ground.style.cssText = `--g1:${g[0]};--g2:${g[1]};--crown:${crown}`;
    const vw = unitsWide();
    // How much the windows and street lamps show: not at all on a clear day.
    const glow = phase === "day" ? (k.grey ? 0.75 : 0) : 1;
    const vh = (size.height / Math.max(1, Math.min(size.width, size.height))) * 100;
    const scenery = LANDSCAPES[landscape]({
      r,
      s,
      g,
      crown,
      area,
      vw,
      vh,
      sway: 0.6 + Math.min(s.windKmh, 70) / 12,
      // How many of the city's windows are lit.
      lit: phase === "night" ? 0.5 : phase === "dusk" ? 0.34 : phase === "dawn" ? 0.2 : k.grey === 2 ? 0.14 : 0.06,
    });
    layer.ground.innerHTML = scenery.back;
    layer.lights.innerHTML = scenery.lights ?? "";
    layer.lights.style.opacity = glow;
    layer.front.innerHTML = scenery.front ?? "";
    layer.halos.innerHTML = scenery.halos ?? "";
    layer.halos.style.opacity = glow;
    layer.events.innerHTML = "";
    walkways = { lane: scenery.lane, road: scenery.road ?? scenery.lane };

    // A faint scrim at the top keeps the text readable over pale clouds.
    const scrim = "linear-gradient(rgba(0, 0, 0, 0.18), transparent 50%)";
    layer.shade.style.background = k.grey === 2 ? `${scrim}, rgba(8, 12, 24, 0.28)` : scrim;

    layer.precip.style.setProperty("--tilt", `${f(clamp(s.windKmh / 2, 0, 22))}deg`);
    let precip = "";
    if (k.rain) {
      precip = repeat(k.rain * area, () => {
        const dur = 0.45 + r() * 0.35;
        return `<i class="wx-fall wx-drop" style="left:${f(r() * 100)}%;animation-duration:${f(dur, 2)}s;animation-delay:-${f(r() * dur, 2)}s"><b></b></i>`;
      });
    } else if (k.snow) {
      precip = repeat(k.snow * area, () => {
        const dur = 5 + r() * 6;
        return `<i class="wx-fall wx-flake" style="left:${f(r() * 100)}%;--s:${f(2 + r() * 3)}px;opacity:${f(0.6 + r() * 0.4, 2)};animation-duration:${f(dur)}s;animation-delay:-${f(r() * dur)}s"><b style="animation-delay:-${f(r() * 3)}s"></b></i>`;
      });
    } else if (LEAVES[s.season] && phase !== "night" && !s.snowy && scenery.leaves !== false) {
      const colors = LEAVES[s.season];
      precip = repeat((s.season === "autumn" ? 10 : 7) * area, () => {
        const dur = 7 + r() * 6;
        return `<i class="wx-fall wx-leaf" style="left:${f(r() * 100)}%;--s:calc(var(--u) * ${f(2 + r() * 2)});--c:${colors[Math.floor(r() * colors.length)]};animation-duration:${f(dur)}s;animation-delay:-${f(r() * dur)}s"><b style="animation-duration:${f(3 + r() * 3)}s"></b></i>`;
      });
    }
    if (s.season === "summer" && phase === "night" && !k.rain && scenery.fireflies !== false) {
      precip += repeat(
        10 * area,
        () =>
          `<i class="wx-fly" style="left:${f(15 + r() * 75)}%;top:${f(68 + r() * 18)}%;animation-delay:-${f(r() * 3)}s,-${f(r() * 7)}s"></i>`,
      );
    }
    layer.precip.innerHTML = precip;

    layer.fog.innerHTML = k.fog
      ? repeat(
          3,
          (i) =>
            `<div class="wx-fogband" style="top:${30 + i * 22}%;animation-duration:${20 + i * 9}s;animation-delay:-${i * 7}s"></div>`,
        )
      : "";
    layer.storm.innerHTML = k.flash
      ? `<div class="wx-flash"></div><svg class="wx-bolt" viewBox="0 0 20 40" aria-hidden="true"><path d="M12 0 3 22h7L6 40l12-26h-7z" fill="#fffbe0"/></svg>`
      : "";
  }

  function draw() {
    const s = scene();
    const key = [s.kind, s.phase, s.up, s.season, s.snowy, Math.round(unitsWide() / 20)].join("|");
    if (key === sceneKey) placeBody(s);
    else {
      sceneKey = key;
      build(s);
    }
  }

  // Now and then, something passes through. Nothing does while the page is hidden or for anyone asking for less motion.
  function queueEvent(delay = 25000 + Math.random() * 50000) {
    eventTimer = setTimeout(playEvent, delay);
  }
  function playEvent() {
    const s = scene();
    const names = document.hidden || reduceMotion.matches ? [] : eventsFor(landscape, s);
    if (!names.length) {
      queueEvent();
      return;
    }
    const { html, seconds } = EVENTS[pick(names)].play({ vw: unitsWide(), ...walkways }, s);
    layer.events.innerHTML = html;
    eventTimer = setTimeout(() => {
      layer.events.innerHTML = "";
      queueEvent();
    }, seconds * 1000);
  }

  // Double-click the scene: the guest walks in, stops in the middle, looks at you, waves and walks out the far side.
  // For anyone asking for less motion it fades in and out where it stands instead. Nothing happens until it has gone.
  async function visit() {
    if (visiting) return;
    visiting = true;
    const from = guestSide;
    const calm = reduceMotion.matches;
    const offstage = (side) => `translateX(calc(${side} * (50% + var(--u) * ${f(GUEST_WIDTH / 2)})))`;
    const walkTime = Math.min(4000, ((unitsWide() + GUEST_WIDTH) / 2 / 38) * 1000);
    layer.guest.innerHTML = `<div class="wx-visitor${from > 0 ? " back" : ""}" style="bottom:${walkways.lane}">${guestFigure(gearFor(landscape, scene()))}</div>`;
    const walker = layer.guest.firstElementChild;
    const figure = walker.firstElementChild;
    // Blinking from a different moment each visit. Not when animations are paused, or its eyes could stay shut.
    if (!calm) figure.style.setProperty("--blink", `-${f(Math.random() * 5.6)}s`);
    const move = (keyframes, duration) => {
      guestMove = walker.animate(keyframes, { duration, fill: "both" });
      return guestMove.finished;
    };
    const pause = (ms) =>
      new Promise((resolve) => {
        guestPause = setTimeout(resolve, ms);
      });
    try {
      await (calm
        ? move([{ opacity: 0 }, { opacity: 1 }], 300)
        : move([{ transform: offstage(from) }, { transform: "none" }], walkTime));
      figure.classList.add("still");
      await pause(450);
      figure.classList.add("waving");
      await pause(2100);
      figure.classList.remove("waving");
      await pause(300);
      figure.classList.remove("still");
      await (calm
        ? move([{ opacity: 1 }, { opacity: 0 }], 300)
        : move([{ transform: "none" }, { transform: offstage(-from) }], walkTime));
      guestSide = -from;
      layer.guest.innerHTML = "";
      visiting = false;
    } catch {
      /* Cancelled: the panel is going away. */
    }
  }

  function showText(message) {
    const cur = data?.current;
    if (!cur) {
      text.temp.textContent = "–";
      text.desc.textContent = message;
      text.place.textContent = "";
      text.extra.textContent = "";
      return;
    }
    const deg = (v) => `${Math.round(v)}°`;
    text.temp.textContent = deg(cur.temperature_2m);
    const key = PREVIEW[settings.scene] ?? CODES[cur.weather_code]?.[0];
    text.desc.textContent = key ? t(key) : "";
    const name = settings.label?.trim() || place?.name || "";
    const hi = data.daily.temperature_2m_max?.[1];
    const lo = data.daily.temperature_2m_min?.[1];
    text.place.textContent = [name, hi != null && lo != null ? t("temp.highLow", { high: deg(hi), low: deg(lo) }) : ""]
      .filter(Boolean)
      .join(" · ");
    text.extra.innerHTML = "";
    if (settings.details) {
      for (const line of [
        t("extra.feels", { temp: deg(cur.apparent_temperature) }),
        t("extra.wind", { speed: Math.round(cur.wind_speed_10m), unit: data.current_units.wind_speed_10m }),
        t("extra.humidity", { percent: cur.relative_humidity_2m }),
      ]) {
        const div = document.createElement("div");
        div.textContent = line;
        text.extra.append(div);
      }
    }
  }

  async function refresh() {
    try {
      place = await locate(thingport.fetch, settings.location || "Vilnius");
      const params = new URLSearchParams({
        latitude: place.lat,
        longitude: place.lon,
        current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m",
        daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min",
        timezone: "auto",
        past_days: "1",
        forecast_days: "2",
        temperature_unit: imperial ? "fahrenheit" : "celsius",
        wind_speed_unit: imperial ? "mph" : "kmh",
      });
      const res = await thingport.fetch(`${API}?${params}`);
      if (!res.ok) throw new Error("forecast");
      const next = await res.json();
      if (stopped) return;
      data = next;
      showText();
    } catch (err) {
      if (stopped) return;
      if (!data) showText(t(err.message === "notfound" ? "error.notFound" : "error.failed"));
    }
    draw();
  }

  draw();
  refresh();
  const poll = setInterval(refresh, Number(settings.refresh || 30) * 60 * 1000);
  const clock = setInterval(draw, 60 * 1000);
  if (settings.events !== false) queueEvent(8000 + Math.random() * 15000);
  wx.addEventListener("dblclick", visit);
  return () => {
    stopped = true;
    clearInterval(poll);
    clearInterval(clock);
    clearTimeout(settle);
    clearTimeout(eventTimer);
    clearTimeout(guestPause);
    guestMove?.cancel();
    wx.removeEventListener("dblclick", visit);
    stopResize();
  };
}
