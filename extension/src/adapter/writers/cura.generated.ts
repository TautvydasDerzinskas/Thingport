// GENERATED from backend/src/adapter/writers/cura.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// A Bambu layout project for Cura: one core model whose multi-part objects are groups of meshes, each part with its
// own extruder (`cura:extruder_nr`, which Cura keeps only on a group's children), and the designer's walls, layers,
// infill and supports as each mesh's own settings. Cura reads no painting.

import JSZip from "jszip";
import { readBambuModels, type BambuPackage } from "../readers/bambuProject.generated";
import { curaObjectSettings } from "../settings.generated";
import { contentTypesXml, flattenProject, relsXml } from "./flatten.generated";
import { thumbnailOf } from "./prusa.generated";
import { joinModelXml, type WriteOptions, type Written } from "./types.generated";

function curaKeys(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(settings).map(([key, value]) => [`cura:${key}`, value]));
}

export async function writeCura(pkg: BambuPackage, options: WriteOptions = {}): Promise<Written> {
  const projectSettings = curaObjectSettings(pkg.settings);
  const flat = flattenProject({
    parsedModels: await readBambuModels(pkg),
    rootPath: pkg.root.relativePath,
    modelSettings: pkg.modelSettings,
    settings: pkg.settings,
    plates: pkg.plates,
    mode: "group",
    paint: "none",
    objectMetadata: ({ kind, extruder, settings }) => {
      if (kind === "group") return {};
      const own = curaKeys({ ...projectSettings, ...curaObjectSettings(settings) });
      return kind === "part" ? { ...own, "cura:extruder_nr": String(Math.max(0, extruder - 1)) } : own;
    },
  });

  const out = new JSZip();
  out.file("[Content_Types].xml", contentTypesXml());
  const thumb = thumbnailOf(pkg);
  if (thumb) out.file("Metadata/thumbnail.png", await thumb.entry.async("uint8array"));
  out.file("_rels/.rels", relsXml(Boolean(thumb)));
  out.file("3D/3dmodel.model", (options.modelContent ?? joinModelXml)(flat.modelXml()) as string);
  return {
    zip: out,
    report: () => ({ output: "cura", stats: flat.stats, objectSettings: Object.keys(projectSettings).length }),
  };
}
