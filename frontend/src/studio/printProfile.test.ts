import { describe, expect, it } from "vitest";
import { curaObjectSettings, curaPrintSettings, prusaObjectSettings } from "../adapter/settings.generated";
import { SLICER_PROFILES } from "../adapter/slicers/index.generated";
import { applyCommand, CommandError } from "./commands";
import { emptyDocument, type StudioDocument } from "./document";
import {
  checkProfile,
  PRINT_PRESETS,
  PROFILE_CATEGORIES,
  PROFILE_SETTINGS,
  PROFILE_SLICERS,
  profileMatchesPreset,
  profileProjectSettings,
  profileSetting,
  profileSummary,
  settingProjectValue,
  settingValueError,
  suggestPresets,
  type ProfileSettingDef,
  type ProfileSettingKey,
  type SlicerFamily,
  type StudioPrintProfile,
} from "./printProfile";

const cmd = (doc: StudioDocument, args: object) => applyCommand(doc, "set_print_profile", args).document;
const profileOf = (doc: StudioDocument) => doc.print_profile!;

/** A value of the setting that isn't its kind's "off", so an adapter has something to carry. */
function sample(setting: ProfileSettingDef): string | number | boolean {
  if (setting.kind === "switch") return true;
  if (setting.kind === "choice") return setting.options[setting.options.length - 1].value;
  return Math.min(setting.max, Math.max(setting.min, setting.step >= 1 ? 3 : 0.3));
}

/**
 * Whether each kind of slicer takes the setting from a project, through the adapter Thingport opens with: whether what
 * the adapter writes changes when the setting is there. Support settings are read with supports on, and the brim's
 * width with a brim, as Cura reads them only then.
 */
function carried(key: string, value: string): Record<SlicerFamily, boolean> {
  const base: Record<string, string> = key.startsWith("support_")
    ? { enable_support: "1" }
    : key === "brim_width"
      ? { brim_type: "outer_only" }
      : {};
  const read = (settings: Record<string, string>) =>
    JSON.stringify({
      prusa: prusaObjectSettings(settings),
      cura: [curaObjectSettings(settings), curaPrintSettings(settings, 1)],
    });
  const before = JSON.parse(read(base));
  const after = JSON.parse(read({ ...base, [key]: value }));
  const cura = JSON.stringify(before.cura) !== JSON.stringify(after.cura);
  return {
    bambu: true,
    prusa: JSON.stringify(before.prusa) !== JSON.stringify(after.prusa),
    // Cura makes normal supports whenever they're on, so "normal" reaches it as it is.
    cura: cura || (key === "support_type" && after.cura[1].global.support_structure === "normal"),
  };
}

describe("print profiles", () => {
  it("knows every slicer Thingport opens projects in, by the kind of project it reads", () => {
    expect(PROFILE_SLICERS).toEqual(
      Object.fromEntries(Object.values(SLICER_PROFILES).map((slicer) => [slicer.id, slicer.reads])),
    );
  });

  it("says truly which settings and choices reach PrusaSlicer and Cura", () => {
    for (const setting of PROFILE_SETTINGS as readonly ProfileSettingDef[]) {
      expect(setting.carries).toContain("bambu");
      const values =
        setting.kind === "choice"
          ? setting.options.map((choice) => ({ value: choice.value, carries: choice.carries }))
          : [
              {
                value: settingProjectValue(setting.key as ProfileSettingKey, sample(setting)),
                carries: setting.carries,
              },
            ];
      for (const { value, carries } of values) {
        const reached = carried(setting.key, value);
        for (const family of ["prusa", "cura"] as const)
          expect([setting.key, value, family, reached[family]]).toEqual([
            setting.key,
            value,
            family,
            carries.includes(family) && setting.carries.includes(family),
          ]);
      }
    }
  });

  it("has presets whose settings are all valid", () => {
    expect(new Set(PRINT_PRESETS.map((preset) => preset.id)).size).toBe(PRINT_PRESETS.length);
    for (const preset of PRINT_PRESETS) {
      expect(preset.materials.length).toBeGreaterThan(0);
      for (const [key, value] of Object.entries(preset.settings))
        expect([preset.id, key, settingValueError(key, value)]).toEqual([preset.id, key, null]);
    }
    expect(settingValueError("wall_loops", 2.5)).toMatch(/whole number/);
    expect(settingValueError("sparse_infill_pattern", "stars")).toMatch(/one of/);
    expect(settingValueError("nope", 1)).toMatch(/no profile setting/);
  });

  it("writes settings the way Bambu Studio keeps them in a project", () => {
    const profile: StudioPrintProfile = {
      preset: null,
      settings: {
        sparse_infill_density: 25,
        enable_support: false,
        layer_height: 0.16,
        sparse_infill_pattern: "gyroid",
      },
    };
    expect(profileProjectSettings(profile)).toEqual({
      settings: {
        layer_height: "0.16",
        sparse_infill_density: "25%",
        sparse_infill_pattern: "gyroid",
        enable_support: "0",
      },
      keys: ["layer_height", "sparse_infill_density", "sparse_infill_pattern", "enable_support"],
    });
  });

  it("writes a per-nozzle setting as a list, as Bambu Studio keeps speeds, and sorts every setting into a category", () => {
    expect(
      profileProjectSettings({ preset: null, settings: { outer_wall_speed: 150, wall_loops: 3 } }).settings,
    ).toEqual({
      wall_loops: "3",
      outer_wall_speed: ["150"],
    });
    for (const setting of PROFILE_SETTINGS as readonly ProfileSettingDef[])
      expect(PROFILE_CATEGORIES).toContain(setting.category);
    // Speeds reach only Bambu Studio's family; PrusaSlicer and Cura keep their own.
    expect(profileSetting("outer_wall_speed")?.carries).toEqual(["bambu"]);
  });

  it("starts from a preset, changes single settings, and keeps what it isn't told to change", () => {
    let doc = cmd(emptyDocument(), { profile: { preset: "outdoor", slicer: "prusaslicer", reason: "Garden" } });
    expect(profileOf(doc)).toMatchObject({ preset: "outdoor", material: "ASA", slicer: "prusaslicer", by: "person" });
    expect(profileMatchesPreset(profileOf(doc))).toBe(true);

    doc = cmd(doc, { profile: { settings: { wall_loops: 6, brim_width: null }, material: "PETG" } });
    expect(profileOf(doc).settings).toMatchObject({ wall_loops: 6, sparse_infill_density: 25 });
    expect(profileOf(doc).settings.brim_width).toBeUndefined();
    expect(profileOf(doc)).toMatchObject({ preset: "outdoor", material: "PETG", reason: "Garden" });
    expect(profileMatchesPreset(profileOf(doc))).toBe(false);
    expect(profileSummary(profileOf(doc))).toBe("Outdoor · 0.2 mm layers, 6 wall loops, 25% infill · PETG");

    // A new preset replaces the settings; the material follows it unless given.
    doc = cmd(doc, { profile: { preset: "vase" } });
    expect(profileOf(doc).settings).toEqual(PRINT_PRESETS.find((p) => p.id === "vase")!.settings);
    expect(profileOf(doc).material).toBe("PLA");
    doc = cmd(doc, { profile: { reason: null, slicer: null } });
    expect(profileOf(doc).reason).toBeUndefined();
    expect(profileOf(doc).slicer).toBeUndefined();

    expect(cmd(doc, { profile: null }).print_profile).toBeUndefined();
    expect(() => cmd(doc, { profile: { settings: { wall_loops: 31 } } })).toThrow(CommandError);
    expect(() => cmd(doc, { profile: { slicer: "notaslicer" } })).toThrow(CommandError);
    expect(() => cmd(doc, { profile: { printer: { id: "bambu-lab-p1s", nozzle: "wide" } } })).toThrow(CommandError);
  });

  it("warns about a material that doesn't suit the preset and settings the slicer won't take", () => {
    let doc = cmd(emptyDocument(), { profile: { preset: "outdoor", slicer: "prusaslicer" } });
    doc = { ...doc, filament_slots: [{ slot: 1, color: "#ff0000", material: "PLA" }] };
    doc = cmd(doc, { profile: { settings: { seam_position: "back", sparse_infill_pattern: "honeycomb" } } });
    expect(checkProfile(doc, profileOf(doc)).map((check) => [check.code, check.params])).toEqual([
      ["material", { preset: "outdoor", material: "PLA", suits: "ASA, PETG" }],
      ["not_carried", { keys: "seam_position" }],
    ]);
    // Cura has no honeycomb: that choice stays behind.
    doc = cmd(doc, { profile: { slicer: "cura" } });
    expect(checkProfile(doc, profileOf(doc)).find((check) => check.code === "not_carried")?.params?.keys).toBe(
      "seam_position, sparse_infill_pattern",
    );
    doc = cmd(doc, { profile: { preset: "water", slicer: "orcaslicer" } });
    expect(checkProfile(doc, profileOf(doc)).map((check) => check.code)).toEqual(["material", "food_contact"]);
  });

  it("warns about spiral vase only for a plate with more than one body", () => {
    const vaseCheck = (doc: StudioDocument) =>
      checkProfile(doc, profileOf(doc)).find((check) => check.code === "vase_bodies");
    let doc = applyCommand(emptyDocument(), "add_box", { width: 20, depth: 20, height: 20 }).document;
    const cylinder = applyCommand(doc, "add_cylinder", { radius: 10, height: 20 });
    doc = applyCommand(cylinder.document, "create_plate", { name: "Second" }).document;
    doc = applyCommand(doc, "move_to_plate", { plate_id: "plate-2", feature_ids: cylinder.created }).document;
    doc = cmd(doc, { profile: { preset: "vase" } });
    expect(vaseCheck(doc)).toBeUndefined();
    doc = applyCommand(doc, "add_box", { width: 10, depth: 10, height: 10, plate_id: "plate-2" }).document;
    expect(vaseCheck(doc)?.params).toEqual({ plates: "plate-2" });
  });

  it("suggests presets from what a design is for", () => {
    expect(suggestPresets("A wall bracket for the garden hose").map((hit) => hit.id)).toEqual(["strong", "outdoor"]);
    expect(suggestPresets("Small planter pots for herbs")[0]).toEqual({ id: "water", words: ["planter", "pot"] });
    expect(suggestPresets("A cube")).toEqual([]);
  });
});
