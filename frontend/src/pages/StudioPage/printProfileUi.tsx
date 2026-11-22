import type { TFunction } from "i18next";
import type React from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";
import BoltOutlinedIcon from "@mui/icons-material/BoltOutlined";
import DiamondOutlinedIcon from "@mui/icons-material/DiamondOutlined";
import FitnessCenterOutlinedIcon from "@mui/icons-material/FitnessCenterOutlined";
import IronOutlinedIcon from "@mui/icons-material/IronOutlined";
import LocalFireDepartmentOutlinedIcon from "@mui/icons-material/LocalFireDepartmentOutlined";
import LocalFloristOutlinedIcon from "@mui/icons-material/LocalFloristOutlined";
import ToysOutlinedIcon from "@mui/icons-material/ToysOutlined";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import WaterDropOutlinedIcon from "@mui/icons-material/WaterDropOutlined";
import WavesOutlinedIcon from "@mui/icons-material/WavesOutlined";
import WbSunnyOutlinedIcon from "@mui/icons-material/WbSunnyOutlined";
import { slicerProfile } from "../../adapter/slicers/index.generated";
import type { UserPrinter } from "../../api/printers";
import { SLICER_OPTIONS } from "../../constants/settingsOptions";
import type { SlicerSettings } from "../../api/settings";
import {
  PRINT_PRESETS,
  printPreset,
  profileSetting,
  type ProfileCheck,
  type ProfileSettingKey,
  type ProfileValue,
  type PrintPresetId,
  type StudioPrintProfile,
} from "../../studio/printProfile";

// What the Print tab and the save dialog share: how a preset looks, the slicers and printers a profile can be for, and
// how a setting, a choice and a check read in the person's language.

export const PRESET_ICONS: Record<PrintPresetId, React.ComponentType<{ fontSize?: "small" | "inherit" }>> = {
  standard: ViewInArOutlinedIcon,
  fine: DiamondOutlinedIcon,
  draft: BoltOutlinedIcon,
  strong: FitnessCenterOutlinedIcon,
  outdoor: WbSunnyOutlinedIcon,
  water: WaterDropOutlinedIcon,
  toy: ToysOutlinedIcon,
  flexible: WavesOutlinedIcon,
  heat: LocalFireDepartmentOutlinedIcon,
  vase: LocalFloristOutlinedIcon,
  smooth: IronOutlinedIcon,
};

/** A choice's translation key: its value with anything but letters and digits as "_" ("tree(auto)" → "tree_auto_"). */
export const choiceKey = (value: string) => value.replace(/[^a-z0-9]+/gi, "_");

export function settingLabel(t: TFunction, key: string): string {
  return t(`studio.printProfile.setting.${key}`);
}

export function valueLabel(t: TFunction, key: ProfileSettingKey, value: ProfileValue): string {
  const setting = profileSetting(key)!;
  if (setting.kind === "switch") return value ? t("studio.printProfile.on") : t("studio.printProfile.off");
  if (setting.kind === "choice") return t(`studio.printProfile.choice.${choiceKey(String(value))}`);
  return setting.unit
    ? `${value}${setting.unit === "%" || setting.unit === "°" ? "" : " "}${setting.unit}`
    : String(value);
}

/** "Layer height 0.2 mm · Walls 4 · Infill density 25% · ASA": the profile's main settings in a line. */
export function profileLine(t: TFunction, profile: StudioPrintProfile): string {
  const keys: ProfileSettingKey[] = ["layer_height", "wall_loops", "sparse_infill_density"];
  return [
    ...keys.flatMap((key) =>
      profile.settings[key] === undefined
        ? []
        : [`${settingLabel(t, key)} ${valueLabel(t, key, profile.settings[key]!)}`],
    ),
    profile.settings.spiral_mode === true ? settingLabel(t, "spiral_mode") : null,
    profile.material,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A setting's value when the person adds it: a common starting point, which they then change. */
export function startingValue(key: ProfileSettingKey): ProfileValue {
  const setting = profileSetting(key)!;
  if (setting.kind === "switch") return true;
  if (setting.kind === "choice") return setting.options[0].value;
  const common: Partial<Record<ProfileSettingKey, number>> = {
    layer_height: 0.2,
    wall_loops: 3,
    top_shell_layers: 5,
    bottom_shell_layers: 4,
    top_shell_thickness: 1,
    sparse_infill_density: 15,
    support_threshold_angle: 30,
    brim_width: 5,
    raft_layers: 2,
  };
  return common[key] ?? setting.min;
}

export function checkText(t: TFunction, check: ProfileCheck, slicer: string | null): string {
  const params = check.params ?? {};
  if (check.code === "material")
    return t("studio.printProfile.check.material", {
      preset: t(`studio.printProfile.preset.${params.preset}.title`),
      material: params.material,
      suits: String(params.suits).split(", ").join(" / "),
    });
  if (check.code === "not_carried")
    return t("studio.printProfile.check.not_carried", {
      slicer: slicerName(slicer) ?? "",
      keys: String(params.keys)
        .split(", ")
        .map((key) => settingLabel(t, key))
        .join(", "),
    });
  return t(`studio.printProfile.check.${check.code}`, params);
}

export function slicerName(id: string | null | undefined): string | null {
  return SLICER_OPTIONS.find((option) => option.id === id)?.label ?? null;
}

/** The slicers a profile can be for: those Thingport opens projects in, the person's installed ones first. */
export function profileSlicers(settings: SlicerSettings) {
  const supported = SLICER_OPTIONS.filter((option) => slicerProfile(option.id));
  const installed = supported.filter((option) => settings.slicers.includes(option.id));
  return installed.length ? [...installed, ...supported.filter((option) => !installed.includes(option))] : supported;
}

/** The person's main slicer, else the first they have. */
export function defaultSlicer(settings: SlicerSettings): string {
  const slicers = profileSlicers(settings);
  return slicers.find((option) => option.id === settings.slicer)?.id ?? slicers[0]?.id ?? "bambustudio";
}

export type PrinterChoice = { key: string; id: string; nozzle: string; label: string };

/** The person's printers the slicer has a preset for, at their nozzle; none for a slicer that doesn't target one. */
export function printerChoices(printers: UserPrinter[], slicer: string): PrinterChoice[] {
  if (!slicerProfile(slicer)?.targetsPrinter) return [];
  return printers
    .filter((entry) => entry.presets[slicer])
    .map(({ printer, brandName, nozzle }) => ({
      key: `${printer.id}/${nozzle}`,
      id: printer.id,
      nozzle,
      label: `${brandName} ${printer.model} · ${nozzle} mm`,
    }));
}

/** The printer a new profile starts with: the one the person last used with the slicer, else their first. */
export function defaultPrinter(
  printers: UserPrinter[],
  settings: SlicerSettings,
  slicer: string,
): { id: string; nozzle: string } | null {
  const choices = printerChoices(printers, slicer);
  const chosen = choices.find((choice) => choice.id === settings.printers[slicer]) ?? choices[0];
  return chosen ? { id: chosen.id, nozzle: chosen.nozzle } : null;
}

/** "Outdoor ASA · P1S": a name for the profile in the library, which the person may change. */
export function suggestedProfileName(t: TFunction, profile: StudioPrintProfile, printers: UserPrinter[]): string {
  if (profile.name) return profile.name;
  const preset = printPreset(profile.preset);
  const title = preset ? t(`studio.printProfile.preset.${preset.id}.title`) : t("studio.printProfile.custom");
  const printer = printers.find((entry) => entry.printer.id === profile.printer?.id)?.printer.model;
  return [[title, profile.material].filter(Boolean).join(" "), printer].filter(Boolean).join(" · ");
}

const NO_PRESETS: PrintPresetId[] = [];

/** The presets as tiles to pick one from; `suggested` ones carry a badge. */
export function PresetGrid({
  t,
  value,
  suggested = NO_PRESETS,
  columns = 2,
  onPick,
}: {
  t: TFunction;
  value: PrintPresetId | null | undefined;
  suggested?: PrintPresetId[];
  columns?: number;
  onPick: (id: PrintPresetId) => void;
}) {
  return (
    <Box
      component="fieldset"
      aria-label={t("studio.printProfile.presets")}
      sx={{
        border: 0,
        m: 0,
        p: 0,
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 1,
      }}
    >
      {PRINT_PRESETS.map((preset) => {
        const Icon = PRESET_ICONS[preset.id];
        const chosen = preset.id === value;
        return (
          <ButtonBase
            key={preset.id}
            aria-pressed={chosen}
            onClick={() => onPick(preset.id)}
            sx={(theme) => ({
              position: "relative",
              justifyContent: "flex-start",
              gap: 1,
              p: 1,
              textAlign: "left",
              border: 1.5,
              borderRadius: 1.5,
              borderColor: chosen ? "primary.main" : "divider",
              bgcolor: chosen ? "action.selected" : "background.paper",
              transition: "border-color 150ms, background-color 150ms",
              "&:hover": { borderColor: chosen ? "primary.main" : "text.secondary" },
              "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
            })}
          >
            <Box
              sx={{
                width: 28,
                height: 28,
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                borderRadius: 1,
                color: "primary.main",
                bgcolor: "action.hover",
              }}
            >
              <Icon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 650, lineHeight: 1.25 }} noWrap>
                {t(`studio.printProfile.preset.${preset.id}.title`)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.25 }} noWrap>
                {t(`studio.printProfile.preset.${preset.id}.purpose`)}
              </Typography>
            </Box>
            {suggested.includes(preset.id) && (
              <Box
                component="span"
                sx={{
                  position: "absolute",
                  top: -8,
                  right: 8,
                  px: 0.75,
                  borderRadius: 999,
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  lineHeight: "16px",
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                }}
              >
                {t("studio.printProfile.suggested")}
              </Box>
            )}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/** What Suggest with AI asks Studio's assistant, in the person's language: choose from what the design is for, for the
 *  person's slicer and printer, which it's told by id so it can name them in the command. */
export function profileAiPrompt(
  t: TFunction,
  profile: StudioPrintProfile | undefined,
  settings: SlicerSettings,
  printers: UserPrinter[],
): string {
  const slicer = profile?.slicer ?? defaultSlicer(settings);
  const printer = profile?.printer ?? defaultPrinter(printers, settings, slicer);
  const known = printer && printers.find((entry) => entry.printer.id === printer.id);
  return [
    t("studio.printProfile.aiPrompt"),
    t("studio.printProfile.aiPromptSlicer", { name: slicerName(slicer) ?? slicer, id: slicer }),
    printer && known
      ? t("studio.printProfile.aiPromptPrinter", {
          name: `${known.brandName} ${known.printer.model}`,
          id: printer.id,
          nozzle: printer.nozzle,
        })
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}
