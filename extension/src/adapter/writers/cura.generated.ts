// GENERATED from backend/src/adapter/writers/cura.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// A Bambu layout project for Cura: one core model whose multi-part objects are groups of meshes, each part with its
// own extruder (`cura:extruder_nr`, which Cura keeps only on a group's children), and the designer's walls, top and
// bottom layer counts, infill and supports as each mesh's own settings. Cura reads no painting.

import JSZip from "jszip";
import { readBambuModels, type BambuPackage, type PartRole } from "../readers/bambuProject.generated";
import { curaObjectSettings } from "../settings.generated";
import { contentTypesXml, flattenProject, relsXml } from "./flatten.generated";
import { thumbnailOf } from "./prusa.generated";
import { joinModelXml, type WriteOptions, type Written } from "./types.generated";

function curaKeys(settings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(settings).map(([key, value]) => [`cura:${key}`, value]));
}

// A part that isn't printed as itself, as the mesh types Cura's per-model settings give: a cutting mesh takes its own
// settings where it overlaps the other meshes (CuraEngine cuts it out of them), so a modifier is one and a negative
// part is one that prints nothing; the support volumes are Cura's support and anti-overhang meshes.
const NOTHING_PRINTED = { wall_line_count: "0", top_layers: "0", bottom_layers: "0", infill_sparse_density: "0" };

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
    objectMetadata: ({ kind, extruder, settings, part }) => {
      if (kind === "group") return {};
      const role: PartRole = part?.role ?? "normal_part";
      if (role === "negative_part") return curaKeys({ cutting_mesh: "True", ...NOTHING_PRINTED });
      if (role === "support_enforcer") return curaKeys({ support_mesh: "True" });
      if (role === "support_blocker") return curaKeys({ anti_overhang_mesh: "True" });
      const own = {
        ...projectSettings,
        ...curaObjectSettings(settings),
        ...curaObjectSettings(part?.settings ?? {}),
        ...(role === "modifier_part" ? { cutting_mesh: "True" } : {}),
      };
      return curaKeys(kind === "part" ? { ...own, extruder_nr: String(Math.max(0, extruder - 1)) } : own);
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
