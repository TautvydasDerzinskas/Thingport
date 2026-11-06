// The Thingport avatar: the mark as a head, its cube the face, with hair, glasses and an expression drawn on. Everything
// is in the mark's own coordinates (its ring spans x 12-72, y 8-76, around 42,42), then placed on a 128 square.

/** Which of each part an avatar has; -1 for no hair or no glasses. */
export type AvatarStyle = {
  hair: number;
  hair_color: number;
  glasses: number;
  mouth: number;
  background: number;
};

// The mark's paths, from frontend/src/assets/logos/thingport-lockup-compact-color.svg.
const RING =
  "M36.975 10.769Q42 7.867 47.025 10.769L66.534 22.032Q71.56 24.934 71.56 30.736L71.56 53.264Q71.56 59.066 66.534 61.968L47.025 73.231Q42 76.132 36.975 73.231L17.466 61.968Q12.44 59.066 12.44 53.264L12.44 30.736Q12.44 24.934 17.466 22.032Z";
const TOP =
  "M44.464 39.045Q42 40.468 39.536 39.045L28.164 32.48Q25.7 31.057 28.164 29.635L39.536 23.069Q42 21.646 44.464 23.069L55.836 29.635Q58.3 31.057 55.836 32.48Z";
const LEFT =
  "M38.209 41.343Q40.673 42.766 40.673 45.611L40.673 58.742Q40.673 61.588 38.209 60.165L26.837 53.599Q24.373 52.177 24.373 49.332L24.373 36.2Q24.373 33.355 26.837 34.778Z";
const RIGHT =
  "M43.327 45.611Q43.327 42.766 45.791 41.343L57.163 34.778Q59.627 33.355 59.627 36.2L59.627 49.332Q59.627 52.177 57.163 53.599L45.791 60.165Q43.327 61.588 43.327 58.742Z";

const INK = "#1f1f1f";
const TONGUE = "#ff7a8a";
export const AVATAR_BACKGROUNDS = [
  "#cfe8d6",
  "#cfe0f5",
  "#f6d6cf",
  "#e6dcf6",
  "#f6e6c2",
  "#cdeaea",
  "#e8e4dc",
  "#fbd5e3",
];
export const AVATAR_HAIR_COLORS = [
  "#2b2b2b",
  "#5a3825",
  "#9a6233",
  "#e2b84c",
  "#c5562c",
  "#a3a8ae",
  "#3d7be0",
  "#d94f9a",
];

const EYE_L = [32.6, 45.4] as const;
const EYE_R = [51.4, 45.4] as const;

/** A googly eye, its pupil `dx`,`dy` off centre and `r` across. */
const eye = ([x, y]: readonly [number, number], dx: number, dy: number, r = 2) =>
  `<circle cx="${x}" cy="${y}" r="4.1" fill="#fff" stroke="${INK}" stroke-width="1"/>` +
  `<circle cx="${x + dx}" cy="${y + dy}" r="${r}" fill="${INK}"/>` +
  `<circle cx="${x + dx + r * 0.35}" cy="${y + dy - r * 0.4}" r="${Math.max(0.45, r * 0.3)}" fill="#fff"/>`;
const stroke = (d: string, width = 2.1, color = INK) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;

type Expression = { eyes: string; brows?: string; mouth: string };

// Each mouth comes with the eyes that go with it: a face's expression, not a mouth on its own.
const EXPRESSIONS: Expression[] = [
  // smile
  {
    eyes: eye(EYE_L, 0, -0.7, 2.1) + eye(EYE_R, 0, -0.7, 2.1),
    mouth:
      `<path d="M35.6 53.4Q42 55.6 48.4 53.4Q47.6 61.4 42 61.4Q36.4 61.4 35.6 53.4Z" fill="${INK}"/>` +
      `<path d="M38.6 59.2Q42 57.2 45.4 59.2Q44 61 42 61Q40 61 38.6 59.2Z" fill="${TONGUE}"/>` +
      stroke("M34.4 52.6Q35 54.2 36.4 54.4M49.6 52.6Q49 54.2 47.6 54.4", 1.2),
  },
  // toothy
  {
    eyes: eye(EYE_L, -1.3, -1.4) + eye(EYE_R, 1.4, 1.3),
    mouth:
      `<path d="M35.4 53H48.6Q48 60.6 42 60.6Q36 60.6 35.4 53Z" fill="${INK}"/>` +
      `<g fill="#fff" stroke="${INK}" stroke-width=".6"><rect x="39.3" y="52.8" width="2.6" height="3.9" rx=".6"/><rect x="42.1" y="52.8" width="2.6" height="3.9" rx=".6"/></g>`,
  },
  // wobbly
  {
    eyes: eye(EYE_L, -1.6, 0.2) + eye(EYE_R, -1.6, 0.2),
    brows: stroke("M28.4 39.2L35.8 37.2M55.6 39.2L48.2 37.2", 1.6),
    mouth: stroke("M35.6 56.2L37.8 54.4L40 56.2L42.2 54.4L44.4 56.2L46.6 54.4L48.4 55.8", 1.8),
  },
  // surprised
  {
    eyes: eye(EYE_L, 0, 0, 1.25) + eye(EYE_R, 0, 0, 1.25),
    brows: stroke("M28.4 37.4Q32.6 34 36.8 37.4M47.2 37.4Q51.4 34 55.6 37.4", 1.6),
    mouth: `<ellipse cx="42" cy="57" rx="3.4" ry="4.2" fill="${INK}"/><ellipse cx="42" cy="59.4" rx="2.1" ry="1.4" fill="${TONGUE}"/>`,
  },
  // cheeky: a wink, and the tongue out to one side
  {
    eyes: stroke("M28.6 46.4Q32.6 41.8 36.6 46.4", 1.9) + eye(EYE_R, 0.8, -0.8, 2.1),
    mouth:
      stroke("M35.8 54Q42 59 48.2 53.6") +
      `<path d="M42.6 56.6H47.6V60.6Q47.6 64 45.1 64Q42.6 64 42.6 60.6Z" fill="${TONGUE}" stroke="${INK}" stroke-width="1"/>` +
      stroke("M45.1 57.4V60.8", 0.8, "#c94a5c"),
  },
];

// Lenses big enough for the googly eyes behind them.
const GLASSES: ((hidesEyes: boolean) => string)[] = [
  // round
  () =>
    `<g fill="#fff" fill-opacity=".22" stroke="${INK}" stroke-width="1.6"><circle cx="${EYE_L[0]}" cy="${EYE_L[1]}" r="5.8"/><circle cx="${EYE_R[0]}" cy="${EYE_R[1]}" r="5.8"/></g>` +
    stroke("M38.4 44.6Q42 42.2 45.6 44.6M26.8 44.8L24.4 43M57.2 44.8L59.6 43", 1.6),
  // square
  () =>
    `<g fill="#fff" fill-opacity=".22" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"><rect x="${EYE_L[0] - 6.4}" y="${EYE_L[1] - 5.2}" width="12.8" height="10.4" rx="1.8"/><rect x="${EYE_R[0] - 6.4}" y="${EYE_R[1] - 5.2}" width="12.8" height="10.4" rx="1.8"/></g>` +
    stroke("M39 44.4H45M26.2 43.2L24.2 42.2M57.8 43.2L59.8 42.2", 1.6),
  // sunglasses
  () =>
    `<g fill="${INK}"><path d="M25.8 41.2H39.2Q39.4 51.2 32.6 51.2Q25.6 51.2 25.8 41.2Z"/><path d="M44.8 41.2H58.2Q58.4 51.2 51.4 51.2Q44.6 51.2 44.8 41.2Z"/></g>` +
    stroke("M39 42Q42 40.2 45 42M26 41.8L24 40.8M58 41.8L60 40.8", 1.6) +
    `<g fill="#fff" opacity=".55"><path d="M28 43H31.2L29.2 46.6Z"/><path d="M47 43H50.2L48.2 46.6Z"/></g>`,
  // cat-eye
  () =>
    `<g fill="#fff" fill-opacity=".22" stroke="#8e24aa" stroke-width="1.7" stroke-linejoin="round"><path d="M25 39.6L39 41.6Q39.8 51 32.6 51.2Q26.4 51.2 25 39.6Z"/><path d="M59 39.6L45 41.6Q44.2 51 51.4 51.2Q57.6 51.2 59 39.6Z"/></g>` +
    stroke("M39 43.4Q42 42.2 45 43.4", 1.6, "#8e24aa"),
  // 3D
  () =>
    `<rect x="24.6" y="39.6" width="34.8" height="11.6" rx="2" fill="#f5f5f5" stroke="${INK}" stroke-width="1.3"/>` +
    `<rect x="26.8" y="41.6" width="11.6" height="7.6" rx="1.2" fill="#ef4444" fill-opacity=".82"/><rect x="45.6" y="41.6" width="11.6" height="7.6" rx="1.2" fill="#22d3ee" fill-opacity=".82"/>`,
];
const SUNGLASSES = 2;

const shade = (hex: string, amount: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * (1 + amount))));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
};
const circles = (points: [number, number][], r: number) =>
  points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join("");

/** `back` is drawn behind the head, `front` over it. */
type Hair = { back?: (c: string) => string; front: (c: string) => string };

const HAIR: Hair[] = [
  // spiky
  {
    front: (c) =>
      `<path d="M9 33L6 17L14 19L12 3L22 11L25 -6L33 7L42 -10L51 7L59 -6L62 11L72 3L70 19L78 17L75 33L69 26Q56 18 42 19Q28 18 15 26Z" fill="${c}" stroke="${shade(c, -0.3)}" stroke-width="1" stroke-linejoin="round"/>`,
  },
  // side swept
  {
    front: (c) =>
      `<path d="M9 33C6 12 22 -4 44 -4C62 -4 77 8 75 31L70 26C64 20 56 18 50 19C40 21 30 26 22 33C18 30 13 30 9 33Z" fill="${c}"/>` +
      stroke("M22 33C30 24 42 18 58 16", 1.4, shade(c, 0.35)),
  },
  // curly
  {
    back: (c) =>
      `<g fill="${shade(c, -0.15)}">${circles(
        [
          [5, 26],
          [2, 40],
          [5, 54],
          [10, 64],
          [79, 26],
          [82, 40],
          [79, 54],
          [74, 64],
          [10, 10],
          [74, 10],
        ],
        10,
      )}</g>`,
    front: (c) =>
      `<g fill="${c}">${circles(
        [
          [12, 26],
          [14, 13],
          [22, 4],
          [32, -1],
          [42, -3],
          [52, -1],
          [62, 4],
          [70, 13],
          [72, 26],
          [22, 18],
          [32, 11],
          [42, 9],
          [52, 11],
          [62, 18],
        ],
        8.5,
      )}</g>` +
      `<g fill="none" stroke="${shade(c, -0.3)}" stroke-width=".9" opacity=".7">${(
        [
          [22, 4],
          [42, -3],
          [62, 4],
          [32, 11],
          [52, 11],
          [14, 13],
          [70, 13],
        ] as const
      )
        .map(([x, y]) => `<path d="M${x - 3} ${y + 1}q3 -4 6 0"/>`)
        .join("")}</g>`,
  },
  // long
  {
    back: (c) => `<path d="M4 30C4 6 22 -6 42 -6C62 -6 80 6 80 30V88H62V40H22V88H4Z" fill="${shade(c, -0.18)}"/>`,
    front: (c) =>
      `<path d="M8 36C6 10 24 -3 42 -3C60 -3 78 10 76 36L70 30C64 22 54 18 44 18L42 22L40 18C30 18 20 22 14 30Z" fill="${c}"/>`,
  },
  // top bun
  {
    front: (c) =>
      `<circle cx="42" cy="-6" r="9.5" fill="${c}" stroke="${shade(c, -0.3)}" stroke-width="1"/>` +
      `<path d="M10 31C9 12 24 2 42 2C60 2 75 12 74 31L68 26Q56 19 42 19Q28 19 16 26Z" fill="${c}"/>` +
      stroke("M34 -2Q42 2 50 -2", 1.2, shade(c, -0.3)),
  },
  // mohawk
  {
    front: (c) =>
      `<path d="M34 22L31 6L35 8L33 -8L38 -4L39 -16L43 -8L46 -15L48 -3L52 -7L50 8L54 6L50 22Q42 18 34 22Z" fill="${c}" stroke="${shade(c, -0.3)}" stroke-width="1" stroke-linejoin="round"/>` +
      `<path d="M15 25Q28 16 34 17L34 22Q24 22 15 28ZM69 25Q56 16 50 17L50 22Q60 22 69 28Z" fill="${c}" opacity=".35"/>`,
  },
  // ponytail
  {
    back: (c) => `<path d="M64 6C80 4 92 18 88 38C86 50 78 58 72 62C80 48 80 30 66 20Z" fill="${shade(c, -0.15)}"/>`,
    front: (c) =>
      `<path d="M9 32C8 11 24 0 42 0C60 0 76 11 75 32L69 26C60 19 48 17 36 19C26 21 18 25 14 30Z" fill="${c}"/>` +
      `<rect x="66" y="9" width="6" height="5" rx="2" transform="rotate(-30 69 11)" fill="#ef4444"/>`,
  },
  // flat top
  {
    front: (c) =>
      `<path d="M12 31V4Q12 -2 18 -2H66Q72 -2 72 4V31L66 26Q54 20 42 20Q30 20 18 26Z" fill="${c}"/>` +
      stroke("M14 6H70", 1.2, shade(c, 0.3)),
  },
  // bob
  {
    back: (c) =>
      `<path d="M3 34C3 8 20 -5 42 -5C64 -5 81 8 81 34V66Q72 70 66 66V36H18V66Q12 70 3 66Z" fill="${shade(c, -0.15)}"/>`,
    front: (c) =>
      `<path d="M8 34C7 10 24 -2 42 -2C60 -2 77 10 76 34L72 29H12Z" fill="${c}"/>` +
      stroke("M12 29H72", 1, shade(c, -0.3)),
  },
  // space buns
  {
    front: (c) =>
      `<g fill="${c}" stroke="${shade(c, -0.3)}" stroke-width="1"><circle cx="17" cy="2" r="9"/><circle cx="67" cy="2" r="9"/></g>` +
      `<path d="M10 31C9 13 24 3 42 3C60 3 75 13 74 31L68 26Q56 20 42 20Q28 20 16 26Z" fill="${c}"/>` +
      stroke("M42 4V19", 1.2, shade(c, -0.3)),
  },
];

export const AVATAR_PARTS = {
  hair: HAIR.length,
  hair_color: AVATAR_HAIR_COLORS.length,
  glasses: GLASSES.length,
  mouth: EXPRESSIONS.length,
  background: AVATAR_BACKGROUNDS.length,
} as const;

/** Whether every part is one there is; -1 counts for hair and glasses, which can be left out. */
export function isAvatarStyle(value: unknown): value is AvatarStyle {
  if (!value || typeof value !== "object") return false;
  const style = value as Record<string, unknown>;
  const within = (key: keyof AvatarStyle, optional: boolean) =>
    Number.isInteger(style[key]) &&
    (style[key] as number) >= (optional ? -1 : 0) &&
    (style[key] as number) < AVATAR_PARTS[key];
  return (
    within("hair", true) &&
    within("hair_color", false) &&
    within("glasses", true) &&
    within("mouth", false) &&
    within("background", false)
  );
}

/** The avatar `seed` (a user's id) gets until they choose: the same every time, and every part spread evenly. */
export function randomAvatarStyle(seed: string): AvatarStyle {
  // FNV-1a, then mulberry32 to draw each part from it.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193);
  let state = hash >>> 0;
  const draw = (n: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
  return {
    hair: draw(AVATAR_PARTS.hair + 1) - 1,
    hair_color: draw(AVATAR_PARTS.hair_color),
    glasses: draw(AVATAR_PARTS.glasses + 1) - 1,
    mouth: draw(AVATAR_PARTS.mouth),
    background: draw(AVATAR_PARTS.background),
  };
}

/** The avatar as an SVG, 128 square. */
export function avatarSvg(style: AvatarStyle): string {
  const hairColor = AVATAR_HAIR_COLORS[style.hair_color];
  const hair = style.hair >= 0 ? HAIR[style.hair] : null;
  const face = EXPRESSIONS[style.mouth];
  // The head sits low and large: hair has room above it, and the bottom of the ring may run off, as a portrait's would.
  const s = 1.36;
  const place = `translate(${(64 - 42 * s).toFixed(2)} ${(80 - 42 * s).toFixed(2)}) scale(${s})`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">` +
    `<rect width="128" height="128" fill="${AVATAR_BACKGROUNDS[style.background]}"/>` +
    `<g transform="${place}">` +
    (hair?.back ? hair.back(hairColor) : "") +
    `<path d="${RING}" fill="#fff" stroke="${INK}" stroke-width="5.735" stroke-linejoin="round"/>` +
    `<path d="${TOP}" fill="#2fd14f"/><path d="${LEFT}" fill="#00b800"/><path d="${RIGHT}" fill="#009a00"/>` +
    (style.glasses === SUNGLASSES ? "" : face.eyes) +
    face.mouth +
    (style.glasses >= 0 ? GLASSES[style.glasses](style.glasses === SUNGLASSES) : "") +
    (face.brows ?? "") +
    (hair ? hair.front(hairColor) : "") +
    `</g></svg>`
  );
}
