// Every source's printers as one catalogue: records of the same printer (lib/identity.mjs) become one entry, its facts
// (bed, height, nozzles...) taken from the best source for it -- the maker's own slicer, then OrcaSlicer, the other
// makers' slicers, Bambu Studio's copies of other brands' printers, PrusaSlicer, Cura -- and every slicer's own preset
// names kept, so a copy can name the preset the user's slicer has for their printer.

import {
  ALIAS_OVERLAY,
  SOURCE_OVERLAY,
  alternatives,
  createBrands,
  nameKey,
  splitConfig,
  stripBrand,
} from "./identity.mjs";
import { nozzleName } from "./geometry.mjs";

const RANK = { orcaslicer: 1, bambustudio: 3, prusaslicer: 4, cura: 5 };

const FLAVOR = {
  marlin: "marlin",
  marlin2: "marlin2",
  klipper: "klipper",
  reprapfirmware: "reprapfirmware",
  repetier: "repetier",
  reprap: "reprap",
  sprinter: "reprap",
  teacup: "teacup",
  makerware: "makerbot",
  sailfish: "sailfish",
  smoothie: "smoothie",
  mach3: "mach3",
  machinekit: "machinekit",
  "no-extrusion": "none",
  "RepRap (Marlin/Sprinter)": "marlin",
  "RepRap (RepRap)": "reprapfirmware",
  Repetier: "repetier",
  Griffin: "griffin",
  UltiGCode: "ultigcode",
  Makerbot: "makerbot",
  MakerBot: "makerbot",
  Marlin: "marlin",
  Cheetah: "griffin",
  BFB: "bfb",
  "RepRap (Volumetric)": "marlin",
  BambuLab: "bambu",
};

const numericNozzle = (s) => {
  const n = nozzleName(s);
  return n === null ? null : Number(n);
};

/** Cura's disallowed areas are around the plate's centre, +y towards the front; as bed coordinates. */
function curaAreas(polygons, bed) {
  if (!polygons || !bed) return null;
  return polygons.map((polygon) => polygon.map(([x, y]) => [x + bed.x / 2, bed.y / 2 - y]));
}

function recordsOf(source, read, brands) {
  const records = [];
  for (const vendor of read.vendors) {
    for (const model of vendor.models) {
      let brand;
      if (source.format === "cura") {
        brand = brands.brandFromName(model.name, brands.brandOf(vendor.name));
        if (["custom", "unknown", "other", ""].includes(nameKey(vendor.name)) || model.modelId === "custom") continue;
      } else {
        brand = brands.brandOf(vendor.dir === "BBL" ? "BBL" : vendor.dir);
        if (brand === vendor.dir && brands.isKnown(nameKey(vendor.name))) brand = brands.known(nameKey(vendor.name));
      }
      const variants = model.variants;
      const primary =
        variants.find((v) => numericNozzle(v.nozzle) === 0.4 && !/^HF/.test(v.nozzle ?? "")) ?? variants[0];
      const presets = {};
      for (const v of variants) {
        if (source.format === "cura") continue;
        const key = v.nozzle ?? nozzleName(v.preset) ?? "?";
        (presets[key] ??= []).push({
          name: v.preset,
          ...(v.defaultProcess ? { defaultProcess: v.defaultProcess } : {}),
          processes: v.processes,
          ...(v.renamedFrom?.length ? { renamedFrom: v.renamedFrom } : {}),
          ...(v.defaultFilament ? { defaultFilament: v.defaultFilament } : {}),
          ...(v.filaments && Object.keys(v.filaments.types).length ? { filaments: v.filaments } : {}),
        });
      }
      const nozzles =
        source.format === "cura"
          ? (primary.nozzleSizes.length ? primary.nozzleSizes : [primary.defaultNozzle])
              .filter(Boolean)
              .map((n) => Math.round(n * 100) / 100)
          : [...new Set(variants.map((v) => numericNozzle(v.nozzle)).filter(Boolean))];
      records.push({
        source: source.id,
        format: source.format,
        own: source.brand === brand,
        brand,
        rawVendor: vendor.name,
        name: model.name,
        modelId: model.modelId,
        cover: model.cover,
        bed: primary.bed,
        exclude:
          source.format === "cura"
            ? curaAreas(primary.exclude, primary.bed)
            : primary.exclude
              ? [primary.exclude]
              : null,
        extruderBeds: primary.extruderBeds,
        height: primary.height,
        extruders: primary.extruders,
        nozzles: nozzles.sort((a, b) => a - b),
        // OrcaSlicer's own defaults where its presets leave these unset.
        gcodeFlavor: primary.gcodeFlavor ?? (source.format === "orca" ? "marlin" : null),
        relativeE: primary.relativeE ?? (source.format === "orca" ? true : null),
        multiMaterial: [...new Set(variants.flatMap((v) => v.multiMaterial))],
        materialDiameter: primary.materialDiameter ?? null,
        temps: primary.temps ?? null,
        slicer:
          source.format === "cura"
            ? { definition: model.modelId, nozzles: primary.nozzleVariants }
            : { model: model.name, presets },
      });
    }
  }
  return records;
}

export function mergeCatalogue(sources, reads) {
  const brands = createBrands();
  const order = new Map(sources.map((s, i) => [s.id, i]));
  const records = sources.flatMap((s) => (reads[s.id] ? recordsOf(s, reads[s.id], brands) : []));

  for (const r of records) {
    const stripped = stripBrand(r.name, r.brand, r.rawVendor);
    const { model, labels, multiMaterial, tools } = splitConfig(stripped);
    const alts = alternatives(model);
    r.display = alts[0];
    r.config = labels.join(" ") || null;
    r.multiMaterial = [...r.multiMaterial, ...multiMaterial];
    r.tools = tools;
    r.bkey = nameKey(r.brand);
    r.mkey = nameKey(alts[0]) || nameKey(stripped);
    const extra = new Set([
      ...alts.map((a) => nameKey(a.replace(/\s*\([^)]*\)\s*/g, " "))), // "Kossel Pulley (Linear)" -> "kosselpulley"
      ...alts.map((a) => nameKey(a.replace(/\s+series$/i, ""))), // "Adventurer 3 Series" -> "adventurer3"
    ]);
    r.aliases = [...new Set([...alts.slice(1).map(nameKey), nameKey(stripped), nameKey(r.name), ...extra])].filter(
      (a) => a && a !== r.mkey,
    );
    r.altKeys = alts.slice(1).map(nameKey).filter(Boolean);
    const sourceOverlay = SOURCE_OVERLAY.get(`${r.source}|${r.modelId}`);
    if (sourceOverlay) {
      r.mkey = sourceOverlay;
      r.aliases = [];
      r.altKeys = [];
    }
    const overlay = ALIAS_OVERLAY.get(`${r.bkey}|${r.mkey}`);
    if (overlay) {
      r.aliases = [...new Set([...r.aliases, r.mkey])];
      r.mkey = overlay;
    }
  }

  records.sort(
    (a, b) =>
      (a.own ? 0 : (RANK[a.source] ?? 2)) - (b.own ? 0 : (RANK[b.source] ?? 2)) ||
      order.get(a.source) - order.get(b.source) ||
      Number(a.config !== null) - Number(b.config !== null),
  );

  const entries = [];
  const index = new Map();
  const mainIndex = new Map();
  for (const r of records) {
    const key = `${r.bkey}|${r.mkey}`;
    let entry = mainIndex.get(key) ?? index.get(key);
    if (!entry) entry = r.aliases.map((a) => index.get(`${r.bkey}|${a}`)).find(Boolean);
    if (!entry) {
      entry = { brand: r.brand, model: r.display, bkey: r.bkey, mkey: r.mkey, records: [], aliases: new Set() };
      entries.push(entry);
      index.set(key, entry);
      mainIndex.set(key, entry);
    }
    entry.records.push(r);
    for (const a of r.aliases) {
      entry.aliases.add(a);
      if (!index.has(`${r.bkey}|${a}`)) index.set(`${r.bkey}|${a}`, entry);
    }
    // One record naming several printers ("Ender-3 / Ender-3 v2") serves each of them.
    for (const a of r.altKeys) {
      const other = mainIndex.get(`${r.bkey}|${a}`);
      if (other && other !== entry) other.records.push({ ...r, shared: true });
    }
  }
  for (const [from, to] of ALIAS_OVERLAY) {
    const [b, model] = from.split("|");
    mainIndex.get(`${b}|${to}`)?.aliases.add(model);
  }

  const report = { bedDisagreements: [], heightDisagreements: [] };
  const printers = entries.map((e) => {
    const recs = e.records;
    const base = recs.filter((r) => !r.config).length ? recs.filter((r) => !r.config) : recs;
    const primary = base[0];
    const beds = new Map();
    for (const r of base) if (r.bed && !beds.has(r.source)) beds.set(r.source, r);
    if (beds.size > 1) {
      const all = [...beds.values()];
      if (all.some((r) => Math.abs(r.bed.x - all[0].bed.x) + Math.abs(r.bed.y - all[0].bed.y) > 1)) {
        report.bedDisagreements.push({
          printer: `${e.brand} ${e.model}`,
          beds: Object.fromEntries(all.map((r) => [r.source, `${r.bed.x}x${r.bed.y}`])),
        });
      }
      const heights = all.map((r) => r.height).filter(Boolean);
      if (heights.length && Math.max(...heights) - Math.min(...heights) > 1) {
        report.heightDisagreements.push({
          printer: `${e.brand} ${e.model}`,
          heights: Object.fromEntries(all.map((r) => [r.source, r.height])),
        });
      }
    }
    const device =
      e.brand === "Bambu Lab" || e.brand === "QIDI"
        ? (() => {
            const from = e.brand === "Bambu Lab" ? "bambustudio" : "qidistudio";
            const id = recs.find((r) => r.source === from && r.modelId)?.modelId;
            return id ? (reads[from]?.devices?.[id] ?? null) : null;
          })()
        : null;
    const multiMaterial = new Set(recs.flatMap((r) => r.multiMaterial));
    if (device?.amsType) {
      multiMaterial.add(device.amsType === "f1" ? "Bambu AMS lite" : "Bambu AMS");
      for (const flag of [...multiMaterial]) if (/^AMS \(/.test(flag)) multiMaterial.delete(flag);
    }
    const curaTemps = recs.find((r) => r.temps && Object.values(r.temps).some(Boolean))?.temps;
    const temps = device
      ? { nozzle: device.nozzleTempMax, bed: device.bedTempMax, chamber: device.chamberTempMax }
      : curaTemps
        ? { nozzle: curaTemps.nozzle, bed: curaTemps.bed, chamber: curaTemps.chamber }
        : null;
    const slicers = {};
    for (const r of recs) {
      (slicers[r.source] ??= []).push({ ...(r.config ? { config: r.config } : {}), ...r.slicer });
    }
    const flavor = String(primary.gcodeFlavor ?? "").trim();
    const codes = {
      bambu: e.brand === "Bambu Lab" ? device?.modelId : undefined,
      qidi: e.brand === "QIDI" ? device?.modelId : undefined,
      orca: recs.find((r) => r.format === "orca" && !r.config && r.modelId)?.modelId,
      prusa: recs.find((r) => r.format === "prusa" && !r.config)?.modelId,
      cura: recs.find((r) => r.format === "cura" && !r.config)?.modelId,
    };
    return {
      id: `${e.bkey}-${e.mkey}`,
      brand: e.bkey,
      brandName: e.brand,
      model: e.model,
      aliases: [...e.aliases].filter((a) => a !== e.mkey && (mainIndex.get(`${e.bkey}|${a}`) ?? e) === e).sort(),
      bed: primary.bed ?? null,
      exclude: primary.exclude ?? null,
      extruderBeds: primary.extruderBeds ?? null,
      height: primary.height ?? null,
      nozzles: [...new Set(recs.flatMap((r) => r.nozzles))].sort((a, b) => a - b).map(String),
      extruders: Math.max(...base.map((r) => r.extruders || 1)),
      tools: [...new Set(recs.filter((r) => r.config && r.extruders > 1).map((r) => `${r.config}|${r.extruders}`))]
        .map((x) => ({ config: x.split("|")[0], tools: Number(x.split("|")[1]) }))
        .sort((a, b) => a.config.localeCompare(b.config)),
      multiMaterial: [...multiMaterial].sort(),
      temps: temps && Object.values(temps).some(Boolean) ? compact(temps) : null,
      materialDiameter: recs.find((r) => r.materialDiameter)?.materialDiameter ?? null,
      gcodeFlavor: FLAVOR[flavor] ?? (flavor || null),
      relativeE: primary.relativeE,
      codes: compact(codes),
      device: device
        ? compact({
            name: device.displayName,
            arch: device.arch,
            series: device.series,
            enclosed: device.enclosed,
            nozzleCount: device.nozzleCount,
            snPrefix: device.snPrefix,
          })
        : null,
      sources: [...new Set(recs.map((r) => r.source))].sort((a, b) => order.get(a) - order.get(b)),
      coverFrom: recs.find((r) => r.cover)?.cover ?? null,
      slicers,
    };
  });
  printers.sort((a, b) => a.brandName.localeCompare(b.brandName) || a.model.localeCompare(b.model));
  return { printers, report, records: records.length };
}

function compact(object) {
  const out = Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return Object.keys(out).length ? out : null;
}
