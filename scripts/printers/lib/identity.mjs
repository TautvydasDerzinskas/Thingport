// Which printer a slicer's record is: a brand key and a model key. The brand comes from a table of the spellings
// slicers use; the model is its name with the brand taken off, configuration suffixes (HF, MMU3, CFS-C, Combo, ...)
// split off, then lowercased with "+" as "plus" and everything but letters and digits dropped. A name listing
// several printers ("MK3S & MK3S+", "Ender-3 / Ender-3 v2") gives one key per printer.

/** A name as a key: "Ender-3 V2" -> "ender3v2", "4Max Pro 2.0" -> "4maxpro2". */
export function nameKey(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/&&/g, "&")
    .replace(/\+/g, "plus")
    .replace(/(\d)\.0\b/g, "$1")
    .replace(/(\d)\s*mm\b/g, "$1")
    .replace(/[^a-z0-9]/g, "");
}

// Every spelling's key, as the brand Thingport shows.
const BRANDS = {
  bbl: "Bambu Lab",
  bambulab: "Bambu Lab",
  prusa: "Prusa Research",
  prusaresearch: "Prusa Research",
  prusa3d: "Prusa Research",
  creality: "Creality",
  creality3d: "Creality",
  qidi: "QIDI",
  qiditechnology: "QIDI",
  qiditech: "QIDI",
  qseries: "QIDI",
  x3series: "QIDI",
  x4series: "QIDI",
  x5series: "QIDI",
  anker: "AnkerMake",
  ankermake: "AnkerMake",
  ultimaker: "UltiMaker",
  ultimakerbv: "UltiMaker",
  voron: "Voron Design",
  vorondesign: "Voron Design",
  elegoo: "Elegoo",
  flsun: "FLSun",
  twotrees: "Two Trees",
  goofoo: "Goofoo",
  sovol: "Sovol",
  sovol3d: "Sovol",
  biqu: "BIQU",
  ratrig: "RatRig",
  lulzbot: "LulzBot",
  positron3d: "Positron 3D",
  wanhaofrance: "Wanhao",
  wanhao: "Wanhao",
  flashforge: "Flashforge",
  anycubic: "Anycubic",
  snapmaker: "Snapmaker",
  artillery: "Artillery",
  geeetech: "Geeetech",
  longer: "Longer",
  iq: "innovatiQ",
  innovatiq: "innovatiQ",
  raise3d: "Raise3D",
  tronxy: "Tronxy",
  kingroon: "Kingroon",
  hartsmartproducts: "HartSmart Products",
  cocoapress: "Cocoa Press",
  papapiu: "Papapiu",
  papapiulab: "Papapiu",
  zonestar: "Zonestar",
  gcreate: "gCreate",
  makergear: "MakerGear",
  trilab: "TriLAB",
  infinity3d: "Infinity3D",
  mingda: "Mingda",
  velleman: "Velleman",
  vellemannv: "Velleman",
  dremel: "Dremel",
  vivedino: "Vivedino",
  voxelab: "Voxelab",
  tiertime: "Tiertime",
  blocks: "Blocks",
  volumic: "Volumic",
  eryone: "Eryone",
  flyingbear: "FlyingBear",
  mellow: "Mellow",
};

// What a brand's model names may start with besides the brand itself.
const PREFIXES = {
  "Prusa Research": ["Original Prusa i3", "Original Prusa", "Prusa i3", "Prusa"],
  "Bambu Lab": ["Bambu Lab", "Bambulab", "BBL"],
  QIDI: ["Qidi", "QIDI", "QIDI Tech"],
  UltiMaker: ["UltiMaker", "Ultimaker"],
  "Voron Design": ["Voron Design", "Voron"],
  AnkerMake: ["AnkerMake", "Anker"],
  Creality: ["Creality3D", "Creality"],
  Sovol: ["Sovol 3D", "Sovol-", "Sovol"],
  Elegoo: ["ELEGOO", "Elegoo"],
  "Two Trees": ["Two Trees", "TwoTrees"],
  Wanhao: ["Wanhao France", "Wanhao"],
};

// Trailing configuration markers: [pattern, label (null: the matched text), the multi-material system it says, tools].
const CONFIGS = [
  [/[\s_-]+input shaper$/i, "Input Shaper", null, null],
  [/[\s_-]+is$/i, "Input Shaper", null, null],
  [/[\s_-]+mmu3( single)?$/i, "MMU3", "Prusa MMU3", null],
  [/[\s_-]+mmu2s( single)?$/i, "MMU2S", "Prusa MMU2S", null],
  [/[\s_-]+mmu2( single)?$/i, "MMU2", "Prusa MMU2", null],
  [/[\s_-]+mmu1( single)?$/i, "MMU1", "Prusa MMU1", null],
  [/[\s_-]+hf$/i, "HF", null, null],
  [/[\s_-]+cfs-?c$/i, "CFS-C", "Creality CFS-C", null],
  [/[\s_-]+cfs$/i, "CFS", "Creality CFS", null],
  [/[\s_-]+ace[\s_-]?pro$/i, "ACE PRO", "Anycubic ACE PRO", null],
  [/[\s_-]+all-metal( hot ?end)?$/i, "All-Metal", null, null],
  [/[\s_-]+(dual )?(qs\+b kit|qskit|bkit)$/i, null, null, null],
  [/[\s_-]+dual( extruder)?$/i, "Dual", "dual extruder", 2],
  [/[\s_-]+(-\s*)?(\d+)t$/i, "tools", "toolchanger", null],
  [/[\s_-]+indx$/i, "INDX", "Prusa INDX toolchanger", null],
  [/[\s_-]+sonic$/i, "Sonic", null, null],
  [/[\s_-]+(direct drive|bowden)$/i, null, null, null],
  [/\s*\+\s*box$/i, "BOX", "QIDI Box", null],
  [/[\s_-]+combo$/i, "Combo", null, null],
  [/[\s_-]+(idex\s+)?(copy|mirror|duplicate|duplication|dual|single)(\s+mode)?(\s+\d+)?$/i, null, "IDEX", null],
];

// Hand-kept renames no rule can infer, [brand key, model key] -> model key. Keep this short.
export const ALIAS_OVERLAY = new Map([
  ["bambulab|x1c", "x1carbon"],
  ["elegoo|neptune1", "neptune"],
  ["snapmaker|2a250", "a250"],
  ["snapmaker|2a350", "a350"],
  ["snapmaker|2a150", "a150"],
  ["vorondesign|voron2250", "24250"],
  ["vorondesign|voron2300", "24300"],
  ["vorondesign|voron2350", "24350"],
]);
// [source, its own id] -> model key, for a definition whose name looks like another printer's.
export const SOURCE_OVERLAY = new Map([["cura|prusa_i3_xl", "i3xl"]]); // A 2016 "Prusa i3 xl", not the Prusa XL.

const LEGAL =
  /(,.*$|\s+(printers|co\.?|co\., ltd\.?|ltd\.?|llc\.?|inc\.?|gmbh|s\.r\.o\.|sp\. z o\.o\.|b\.v\.|n\.v\.|ab|3dp design|technologies|technology)$)/i;

export function createBrands() {
  const seen = new Map();
  /** The brand a maker's name means: a known spelling, else the first spelling seen for its key. */
  const brandOf = (raw) => {
    let s = String(raw ?? "").trim();
    for (let i = 0; i < 3; i++) {
      const next = s.replace(LEGAL, "").trim();
      if (next === s) break;
      s = next;
    }
    const k = nameKey(s);
    if (BRANDS[k]) return BRANDS[k];
    const k3 = k.length > 5 ? k.replace(/3d$/, "") : k;
    if (BRANDS[k3]) return BRANDS[k3];
    if (!seen.has(k3)) seen.set(k3, s);
    return seen.get(k3);
  };
  /** A known brand a printer's name starts with, when it isn't the stated maker ("MakerBot Method" by UltiMaker). */
  const brandFromName = (name, fallback) => {
    const known = [...new Set([...Object.values(BRANDS), ...seen.values()])].sort((a, b) => b.length - a.length);
    const low = String(name).toLowerCase();
    return known.find((b) => b.length > 2 && b !== fallback && low.startsWith(`${b.toLowerCase()} `)) ?? fallback;
  };
  const isKnown = (key) => Boolean(BRANDS[key]);
  return { brandOf, brandFromName, isKnown, known: (key) => BRANDS[key] };
}

/** The model name without its brand: "Bambu Lab P1S" -> "P1S". */
export function stripBrand(name, brand, rawVendor) {
  let s = String(name).replace(/&&/g, "&").trim();
  const prefixes = [...new Set([...(PREFIXES[brand] ?? []), brand, rawVendor].filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  for (const p of prefixes) {
    if (s.toLowerCase().startsWith(p.toLowerCase()) && (s.length === p.length || !/[a-z0-9]/i.test(s[p.length]))) {
      const rest = s.slice(p.length).replace(/^[\s_-]+/, "");
      if (rest) {
        s = rest;
        break;
      }
    }
  }
  return s.trim();
}

/** "MK4S MMU3" -> { model: "MK4S", labels: ["MMU3"], multiMaterial: ["Prusa MMU3"], tools: null }. */
export function splitConfig(model) {
  const labels = [];
  const multiMaterial = [];
  let tools = null;
  let s = String(model)
    .trim()
    .replace(/^sonic[_ ](.+)$/i, "$1 Sonic"); // Creality Print's "Sonic_Ender-3 S1"
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pattern, label, mm, count] of CONFIGS) {
      const m = pattern.exec(s);
      if (!m || m.index === 0) continue;
      let text = label ?? m[0].replace(/^[\s_-]+|[\s_-]+$/g, "");
      if (label === "tools") {
        tools = Number(m[2]);
        text = `${tools}T`;
      } else if (count) tools = count;
      labels.unshift(text);
      if (mm) multiMaterial.push(mm);
      s = s.slice(0, m.index).replace(/[\s_-]+$/, "");
      changed = true;
      break;
    }
  }
  return { model: s, labels, multiMaterial, tools };
}

/** "MK3S & MK3S+" -> ["MK3S", "MK3S+"]; "CORE One & One+" -> ["CORE One", "CORE One+"]. */
export function alternatives(model) {
  const parts = String(model)
    .split(/\s+&\s+|\s*\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return [String(model).trim()];
  const firstWords = parts[0].split(/\s+/);
  return [
    parts[0],
    ...parts.slice(1).map((p) => {
      const words = p.split(/\s+/);
      for (let i = 1; i < firstWords.length; i++) {
        if (words[0]?.toLowerCase().startsWith(firstWords[i].toLowerCase())) {
          return [...firstWords.slice(0, i), ...words].join(" ");
        }
      }
      return p;
    }),
  ];
}
