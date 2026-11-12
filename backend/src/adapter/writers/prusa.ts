// A Bambu layout project for PrusaSlicer and the slicers built on it (eufyMake Studio): one core model, each object's
// parts as volumes (modifiers, negative and support volumes as what they are), the painting under PrusaSlicer's names,
// and the designer's settings per object and per part.
// No Slic3r_PE.config on purpose: without one the file is added to the user's own setup, printer, filaments and
// profile kept, where a partial one would replace them with a printer built from factory defaults.

import JSZip from "jszip";
import { readBambuModels, type BambuPackage, type PartRole } from "../readers/bambuProject";
import { prusaObjectSettings, prusaVolumeSettings } from "../settings";
import { escapeXml } from "../xml";
import { contentTypesXml, flattenProject, relsXml, type ObjectMeta } from "./flatten";
import { joinModelXml, type WriteOptions, type Written } from "./types";

// PrusaSlicer reads a 3MF without it as another app's: each extra instance becomes an object of its own without its
// parts, and an object's placement is baked into its first part alone.
const PRUSA_3MF_VERSION = { "slic3rpe:Version3mf": "1" };

const VOLUME_TYPES: Record<PartRole, string> = {
  normal_part: "ModelPart",
  modifier_part: "ParameterModifier",
  negative_part: "NegativeVolume",
  support_enforcer: "SupportEnforcer",
  support_blocker: "SupportBlocker",
};

function metadata(type: "object" | "volume", key: string, value: string | number): string {
  return `<metadata type="${type}" key="${escapeXml(key)}" value="${escapeXml(value)}"/>`;
}

function slic3rModelConfig(objects: ObjectMeta[], projectSettings: Record<string, string>): string {
  const chunks = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"];
  for (const obj of objects) {
    chunks.push(` <object id="${obj.id}" instancescount="1">`);
    if (obj.name) chunks.push(`  ${metadata("object", "name", obj.name)}`);
    if (obj.extruder) chunks.push(`  ${metadata("object", "extruder", obj.extruder)}`);
    const settings = { ...projectSettings, ...prusaObjectSettings(obj.settings) };
    for (const [key, value] of Object.entries(settings)) chunks.push(`  ${metadata("object", key, value)}`);
    // PrusaSlicer makes an object of the volumes listed here and nothing else, so even a single mesh is one.
    for (const vol of obj.volumes) {
      chunks.push(`  <volume firstid="${vol.firstid}" lastid="${vol.lastid}">`);
      if (vol.name) chunks.push(`   ${metadata("volume", "name", vol.name)}`);
      chunks.push(`   ${metadata("volume", "volume_type", VOLUME_TYPES[vol.role])}`);
      if (vol.role === "normal_part")
        chunks.push(`   ${metadata("volume", "extruder", vol.extruder || obj.extruder || 1)}`);
      for (const [key, value] of Object.entries(prusaVolumeSettings(vol.settings))) {
        chunks.push(`   ${metadata("volume", key, value)}`);
      }
      chunks.push("  </volume>");
    }
    chunks.push(" </object>");
  }
  chunks.push("</config>", "");
  return chunks.join("\n");
}

/** The picture a project shows as its file's thumbnail, if it has one. */
export function thumbnailOf(pkg: BambuPackage) {
  return (
    pkg.filesByKey["metadata/plate_1.png"] ||
    pkg.filesByKey["metadata/thumbnail.png"] ||
    pkg.filesByKey["metadata/top_1.png"] ||
    null
  );
}

export async function writePrusa(pkg: BambuPackage, options: WriteOptions = {}): Promise<Written> {
  const flat = flattenProject({
    parsedModels: await readBambuModels(pkg),
    rootPath: pkg.root.relativePath,
    modelSettings: pkg.modelSettings,
    settings: pkg.settings,
    plates: pkg.plates,
    mode: "merge",
    paint: "prusa",
    modelMetadata: PRUSA_3MF_VERSION,
  });
  const projectSettings = prusaObjectSettings(pkg.settings);

  const out = new JSZip();
  out.file("[Content_Types].xml", contentTypesXml());
  const thumb = thumbnailOf(pkg);
  if (thumb) out.file("Metadata/thumbnail.png", await thumb.entry.async("uint8array"));
  out.file("_rels/.rels", relsXml(Boolean(thumb)));
  out.file("3D/3dmodel.model", (options.modelContent ?? joinModelXml)(flat.modelXml()) as string);
  out.file("Metadata/Slic3r_PE_model.config", slic3rModelConfig(flat.objectMeta, projectSettings));
  return {
    zip: out,
    report: () => ({ output: "prusa", stats: flat.stats, objectSettings: Object.keys(projectSettings).length }),
  };
}
