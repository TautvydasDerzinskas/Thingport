// Copy of frontend/src/utils/season.ts (the store source zip can only hold extension/), so Grab dresses its icon up on
// the same days as the web app's sidebar logo. Change them together.

/** In calendar order. Each has an overlay of the same name, in lower case, in assets/seasonal, but April Fools' turns the logo. */
export const SEASONS = [
  "newYear",
  "lunarNewYear",
  "valentines",
  "holi",
  "womensDay",
  "stPatricks",
  "spring",
  "ramadan",
  "aprilFools",
  "easter",
  "saltibarsciai",
  "summer",
  "jonines",
  "birthday",
  "programmersDay",
  "autumn",
  "coffee",
  "diwali",
  "halloween",
  "muertos",
  "hanukkah",
  "winter",
  "christmas",
] as const;

export type Season = (typeof SEASONS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

// Lunar calendars have no simple formula, so these are looked up; past the last year, that season just doesn't show.
// Ramadan begins by moon sighting, so its days can be a day off where the user is.
const LUNAR_NEW_YEAR = [
  "2026-02-17",
  "2027-02-06",
  "2028-01-26",
  "2029-02-13",
  "2030-02-03",
  "2031-01-23",
  "2032-02-11",
  "2033-01-31",
  "2034-02-19",
  "2035-02-08",
];
/** Holika Dahan, the bonfire night; Rangwali Holi, the colour day, is the next. */
const HOLI = ["2026-03-03", "2027-03-21", "2028-03-10", "2029-02-28", "2030-03-19", "2031-03-08"];
const RAMADAN_START = [
  "2026-02-18",
  "2027-02-08",
  "2028-01-28",
  "2029-01-16",
  "2030-01-05",
  "2030-12-26",
  "2031-12-15",
  "2032-12-04",
  "2033-11-23",
  "2034-11-12",
  "2035-11-01",
];
/** Lakshmi Puja, the main day. */
const DIWALI = ["2026-11-08", "2027-10-29", "2028-10-17", "2029-11-05", "2030-10-26"];
/** The evening the first candle is lit. */
const HANUKKAH = ["2026-12-04", "2027-12-24", "2028-12-12", "2029-12-01", "2030-12-20"];

/** Western (Gregorian) Easter Sunday, by the anonymous Gregorian algorithm. */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Meeus, Astronomical Algorithms, ch. 27: mean equinox/solstice for 2000-3000, then its periodic terms.
const MEAN = {
  march: [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
  june: [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003],
  september: [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
  december: [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
};
const PERIODIC = [
  [485, 324.96, 1934.136],
  [203, 337.23, 32964.467],
  [199, 342.08, 20.186],
  [182, 27.85, 445267.112],
  [156, 73.14, 45036.886],
  [136, 171.52, 22518.443],
  [77, 222.54, 65928.934],
  [74, 296.72, 3034.906],
  [70, 243.58, 9037.513],
  [58, 119.81, 33718.147],
  [52, 297.17, 150.678],
  [50, 21.02, 2281.226],
  [45, 247.54, 29929.562],
  [44, 325.15, 31555.956],
  [29, 60.93, 4443.417],
  [18, 155.12, 67555.328],
  [17, 288.79, 4562.452],
  [16, 198.04, 62894.029],
  [14, 199.76, 31436.921],
  [12, 95.39, 14577.848],
  [12, 287.11, 31931.756],
  [12, 320.81, 34777.259],
  [9, 227.73, 1222.114],
  [8, 15.45, 16859.074],
];
const RAD = Math.PI / 180;

/** The moment of a year's equinox or solstice, to within a few minutes. */
export function equinox(year: number, which: keyof typeof MEAN): Date {
  const y = (year - 2000) / 1000;
  const jde0 = MEAN[which].reduce((sum, coefficient, power) => sum + coefficient * y ** power, 0);
  const t = (jde0 - 2451545) / 36525;
  const w = (35999.373 * t - 2.47) * RAD;
  const lambda = 1 + 0.0334 * Math.cos(w) + 0.0007 * Math.cos(2 * w);
  const s = PERIODIC.reduce((sum, [a, b, c]) => sum + a * Math.cos((b + c * t) * RAD), 0);
  const jde = jde0 + (0.00001 * s) / lambda;
  // Julian day to Unix time; the minute or so between TT and UTC doesn't matter here.
  return new Date((jde - 2440587.5) * DAY_MS);
}

/** `minor`: gives way to any holiday, as the equinoxes do. */
type Window = { season: Season; start: Date; days: number; minor?: boolean };

const atMidnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

function fromTable(season: Season, dates: string[], offset: number, days: number): Window[] {
  return dates.map((iso) => {
    const [year, month, day] = iso.split("-").map(Number);
    return { season, start: new Date(year, month - 1, day + offset), days };
  });
}

function windowsAround(year: number): Window[] {
  const fixed = (season: Season, month: number, day: number, days = 1): Window => ({
    season,
    start: new Date(year, month - 1, day),
    days,
  });
  const easter = easterSunday(year);
  return [
    fixed("newYear", 1, 1, 2),
    fixed("valentines", 2, 14),
    fixed("womensDay", 3, 8),
    fixed("stPatricks", 3, 17),
    fixed("aprilFools", 4, 1),
    // Good Friday to Easter Monday.
    { season: "easter", start: new Date(year, easter.getMonth(), easter.getDate() - 2), days: 4 },
    // Vilnius's day of the cold pink soup; its Pink Soup Fest moves around early June.
    fixed("saltibarsciai", 6, 10),
    // Midsummer: the eve, when the fern flower is looked for, and the day.
    fixed("jonines", 6, 23, 2),
    // The day of Thingport's first commit, 7 September 2026.
    fixed("birthday", 9, 7),
    // The 256th day (2^8): 13 September, or the 12th in a leap year.
    { season: "programmersDay", start: new Date(year, 0, 256), days: 1 },
    fixed("coffee", 10, 1),
    fixed("halloween", 10, 29, 3),
    fixed("muertos", 11, 1, 2),
    // Christmas Eve to Boxing Day always; the days around them give way, even to the winter solstice.
    fixed("christmas", 12, 24, 3),
    { ...fixed("christmas", 12, 18, 14), minor: true },
    // On the user's own calendar day of each, wherever they are.
    { season: "spring", start: atMidnight(equinox(year, "march")), days: 1, minor: true },
    { season: "summer", start: atMidnight(equinox(year, "june")), days: 1, minor: true },
    { season: "autumn", start: atMidnight(equinox(year, "september")), days: 1, minor: true },
    { season: "winter", start: atMidnight(equinox(year, "december")), days: 1, minor: true },
  ];
}

const rank = (window: Window) => (window.minor ? 1000 : 0) + window.days;

const LOOKED_UP: Window[] = [
  ...fromTable("lunarNewYear", LUNAR_NEW_YEAR, 0, 2),
  ...fromTable("holi", HOLI, 0, 2),
  // Ramadan's first day, then Eid al-Fitr on both days it may fall, after 29 or 30 days of fasting.
  ...fromTable("ramadan", RAMADAN_START, 0, 1),
  ...fromTable("ramadan", RAMADAN_START, 29, 2),
  ...fromTable("diwali", DIWALI, 0, 1),
  ...fromTable("hanukkah", HANUKKAH, 0, 8),
];

/**
 * The season `date` falls in, by the user's own calendar day; null on an ordinary day. Where two overlap, a holiday
 * beats a minor one, then the shorter wins, so e.g. Diwali shows through Halloween's three days.
 */
export function seasonFor(date: Date): Season | null {
  const today = atMidnight(date);
  let best: Window | null = null;
  for (const window of [...windowsAround(today.getFullYear()), ...LOOKED_UP]) {
    // Round: a day that crosses a daylight saving change is an hour short or long.
    const into = Math.round((today.getTime() - window.start.getTime()) / DAY_MS);
    if (into >= 0 && into < window.days && (!best || rank(window) < rank(best))) best = window;
  }
  return best?.season ?? null;
}
