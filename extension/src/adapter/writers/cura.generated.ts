// GENERATED from backend/src/adapter/writers/cura.ts by scripts/sync-adapter.mjs. Don't edit it here:
// change backend/src/adapter/ and run npm run adapter:sync.
// A Bambu layout project, or a plain 3MF's colours, for Cura: one core model whose multi-part objects are groups of
// meshes, each object and part with its own extruder (`cura:extruder_nr`), and the designer's walls, top and bottom
// layer counts, infill and supports as each mesh's own settings. Cura reads no painting.
//
// The copy is a Cura project for any printer too, a UCP (Cura 5.7 and later, ThreeMFWorkspaceReader): opened as one,
// Cura puts the settings it takes only for a whole print (user-settings.json) on the printer the user picks, their
// own selected first, and adds the objects with their extruders. Imported as models it's the 3MF alone, and Cura puts
// each whole object on the extruder selected, so only a group's parts keep theirs. Its printer is Cura's hidden base
// definition, which every Cura has and no one's printer is: an older Cura, which reads it as a plain project, makes a
// printer of its own rather than overwrite one.

import JSZip from "jszip";
import { readBambuModels, type BambuPackage, type PartRole } from "../readers/bambuProject.generated";
import { asArray, curaObjectSettings, curaPrintSettings, type CuraStackSettings } from "../settings.generated";
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

// Cura 5.7's, the first to read a UCP; later ones upgrade what they read.
const UCP_SETTING_VERSION = 23;

/** The Cura/ folder of a UCP that puts `settings` on the user's own printer. */
function ucpFiles(settings: CuraStackSettings): Record<string, string> {
  const definition = {
    version: 2,
    name: "FDM Printer Base Description",
    metadata: { type: "machine", visible: false },
  };
  return {
    "Cura/fdmprinter.def.json": JSON.stringify(definition, null, 4),
    "Cura/thingport.global.cfg": [
      "[general]",
      "version = 6",
      "name = Thingport",
      "id = thingport",
      "",
      "[metadata]",
      "type = machine",
      `setting_version = ${UCP_SETTING_VERSION}`,
      "",
      "[containers]",
      "0 = empty_user_changes",
      "1 = empty_quality_changes",
      "2 = empty_intent",
      "3 = empty_quality",
      "4 = empty_material",
      "5 = empty_variant",
      "6 = empty_definition_changes",
      "7 = fdmprinter",
      "",
    ].join("\n"),
    // No visible settings or categories: the user's own stay as they are.
    "Cura/preferences.cfg": [
      "[general]",
      "version = 7",
      "",
      "[metadata]",
      `setting_version = ${UCP_SETTING_VERSION}`,
      "",
    ].join("\n"),
    "Cura/user-settings.json": JSON.stringify(settings, null, 4),
  };
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
      return curaKeys({ ...own, extruder_nr: String(Math.max(0, extruder - 1)) });
    },
  });

  const out = new JSZip();
  out.file("[Content_Types].xml", contentTypesXml());
  const thumb = thumbnailOf(pkg);
  if (thumb) out.file("Metadata/thumbnail.png", await thumb.entry.async("uint8array"));
  out.file("_rels/.rels", relsXml(Boolean(thumb)));
  out.file("3D/3dmodel.model", (options.modelContent ?? joinModelXml)(flat.modelXml()) as string);
  const extruders = asArray(pkg.settings.filament_colour).length;
  for (const [name, text] of Object.entries(ucpFiles(curaPrintSettings(pkg.settings, extruders))))
    out.file(name, text, { createFolders: false });
  return {
    zip: out,
    report: () => ({ output: "cura", stats: flat.stats, objectSettings: Object.keys(projectSettings).length }),
  };
}
