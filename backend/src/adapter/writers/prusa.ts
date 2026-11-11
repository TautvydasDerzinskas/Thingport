// A Bambu layout project for PrusaSlicer and the slicers built on it (eufyMake Studio): one core model, each
// multi-part object's parts as volumes, the painting under PrusaSlicer's names, and the designer's settings per object.
// No Slic3r_PE.config on purpose: without one the file is added to the user's own setup, printer, filaments and
// profile kept, where a partial one would replace them with a printer built from factory defaults.

import JSZip from "jszip";
import { readBambuModels, type BambuPackage } from "../readers/bambuProject";
import { prusaObjectSettings } from "../settings";
import { escapeXml } from "../xml";
import { contentTypesXml, flattenProject, relsXml, type ObjectMeta } from "./flatten";
import { joinModelXml, type WriteOptions, type Written } from "./types";

function slic3rModelConfig(objects: ObjectMeta[], projectSettings: Record<string, string>): string {
  const chunks = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"];
  for (const obj of objects) {
    chunks.push(` <object id="${obj.id}" instancescount="1">`);
    if (obj.name) chunks.push(`  <metadata type="object" key="name" value="${escapeXml(obj.name)}"/>`);
    if (obj.extruder) chunks.push(`  <metadata type="object" key="extruder" value="${obj.extruder}"/>`);
    const settings = { ...projectSettings, ...prusaObjectSettings(obj.settings) };
    for (const [key, value] of Object.entries(settings)) {
      chunks.push(`  <metadata type="object" key="${escapeXml(key)}" value="${escapeXml(value)}"/>`);
    }
    for (const vol of obj.volumes) {
      chunks.push(`  <volume firstid="${vol.firstid}" lastid="${vol.lastid}">`);
      if (vol.name) chunks.push(`   <metadata type="volume" key="name" value="${escapeXml(vol.name)}"/>`);
      chunks.push(`   <metadata type="volume" key="extruder" value="${vol.extruder || obj.extruder || 1}"/>`);
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
