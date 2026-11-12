// GENERATED from backend/src/adapter/readers/prusaProject.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// A PrusaSlicer project (PrusaSlicer, eufyMake Studio): one model file with every object's mesh, the parts of each
// as ranges of its triangles in Metadata/Slic3r_PE_model.config, and the whole configuration the project was saved
// with in Metadata/Slic3r_PE.config.

import JSZip from "jszip";
import { parseAttrs } from "../xml.generated";
import {
  indexZipFiles,
  NO_MODEL,
  parseModelXml,
  type ParsedModel,
  type PartRole,
  type ZipRecord,
} from "./bambuProject.generated";

/** A part: a range of its object's triangles, with what it is, its filament and the settings changed for it. */
export type PrusaVolume = {
  first: number;
  last: number;
  name: string;
  role: PartRole;
  /** 0 is the object's. */
  extruder: number;
  /** By PrusaSlicer's names. */
  settings: Record<string, string>;
};

export type PrusaObject = {
  id: string;
  name: string;
  /** 0 is the project's first. */
  extruder: number;
  settings: Record<string, string>;
  volumes: PrusaVolume[];
};

export type PrusaPackage = {
  zip: JSZip;
  filesByKey: Record<string, ZipRecord>;
  root: ZipRecord;
  model: ParsedModel;
  /** The model file's metadata by name (Application, Title, slic3rpe:MmPaintingVersion...). */
  metadata: Record<string, string>;
  /** Slic3r_PE.config: every setting the project was saved with, by PrusaSlicer's names. */
  config: Record<string, string>;
  /** Slic3r_PE_model.config, by object id; an object it doesn't list is one part. */
  objects: Record<string, PrusaObject>;
};

// PrusaSlicer's names for what a part is (ModelVolumeType), as Bambu's.
const VOLUME_ROLES: Record<string, PartRole> = {
  ModelPart: "normal_part",
  NegativeVolume: "negative_part",
  ParameterModifier: "modifier_part",
  SupportEnforcer: "support_enforcer",
  SupportBlocker: "support_blocker",
};

// What PrusaSlicer writes in an object's or part's metadata besides the settings changed for it.
const INFO_KEYS = new Set([
  "name",
  "volume_type",
  "modifier",
  "matrix",
  "extruder",
  "source_file",
  "source_object_id",
  "source_volume_id",
  "source_offset_x",
  "source_offset_y",
  "source_offset_z",
  "source_in_inches",
  "source_in_meters",
]);

/** Slic3r_PE.config's `; key = value` lines. */
export function parsePrusaConfig(text: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = /^;\s*([A-Za-z0-9_]+) = (.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** A list setting's values: `a;b`, or with quoted names `"PLA";"PETG"`. */
export function prusaList(value: string | null | undefined): string[] {
  const text = String(value ?? "").trim();
  if (!text) return [];
  if (!text.startsWith('"')) return text.split(";").map((v) => v.trim());
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1].replace(/\\(.)/g, "$1"));
  return out;
}

function metadataOf(body: string, type: "object" | "volume"): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<metadata\b([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(body))) {
    const a = parseAttrs(m[1]);
    if (a.type === type && a.key) out[a.key] = a.value ?? "";
  }
  return out;
}

const settingsOf = (meta: Record<string, string>) =>
  Object.fromEntries(Object.entries(meta).filter(([key]) => !INFO_KEYS.has(key)));

const extruderOf = (value: string | undefined) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Slic3r_PE_model.config: each object's name, filament and settings, and its parts as ranges of its triangles. */
export function parsePrusaModelConfig(xml: string): Record<string, PrusaObject> {
  const objects: Record<string, PrusaObject> = {};
  const objectRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  let m;
  while ((m = objectRe.exec(xml))) {
    const id = parseAttrs(m[1]).id;
    if (!id) continue;
    const body = m[2];
    const volumeAt = body.search(/<volume\b/i);
    const meta = metadataOf(volumeAt >= 0 ? body.slice(0, volumeAt) : body, "object");
    const volumes: PrusaVolume[] = [];
    const volumeRe = /<volume\b([^>]*)>([\s\S]*?)<\/volume>/gi;
    let v;
    while ((v = volumeRe.exec(body))) {
      const a = parseAttrs(v[1]);
      const first = Number.parseInt(a.firstid ?? "", 10);
      const last = Number.parseInt(a.lastid ?? "", 10);
      if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) continue;
      const vmeta = metadataOf(v[2], "volume");
      // PrusaSlicer before 2.4 marked a modifier with `modifier` alone.
      const role = VOLUME_ROLES[vmeta.volume_type ?? ""] ?? (vmeta.modifier === "1" ? "modifier_part" : "normal_part");
      volumes.push({
        first,
        last,
        name: vmeta.name ?? "",
        role,
        extruder: extruderOf(vmeta.extruder),
        settings: settingsOf(vmeta),
      });
    }
    objects[id] = {
      id,
      name: meta.name ?? "",
      extruder: extruderOf(meta.extruder),
      settings: settingsOf(meta),
      volumes: volumes.toSorted((x, y) => x.first - y.first),
    };
  }
  return objects;
}

/** The package's files read, its one model file parsed. */
export async function readPrusaPackage(input: Uint8Array | JSZip): Promise<PrusaPackage> {
  const zip = input instanceof JSZip ? input : await JSZip.loadAsync(input);
  const filesByKey = indexZipFiles(zip);
  const root = filesByKey["3d/3dmodel.model"];
  if (!root) throw new Error(NO_MODEL);
  const text = async (key: string) => {
    const rec = filesByKey[key];
    return rec ? rec.entry.async("string") : null;
  };
  const model = parseModelXml(await root.entry.async("string"));
  const modelConfig = await text("metadata/slic3r_pe_model.config");
  return {
    zip,
    filesByKey,
    root,
    model,
    metadata: Object.fromEntries(
      model.metadata.map((meta) => [meta.attrs.name ?? "", meta.text] as const).filter(([name]) => name),
    ),
    config: parsePrusaConfig(await text("metadata/slic3r_pe.config")),
    objects: modelConfig ? parsePrusaModelConfig(modelConfig) : {},
  };
}
