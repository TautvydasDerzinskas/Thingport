import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import type { StudioDesign } from "../../api/studio";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import { useUserPrinters } from "../../hooks/useUserPrinters";
import { profileSettings, STUDIO_FILAMENT_MATERIALS, type StudioProfile } from "../../studio/document";
import {
  checkProfile,
  printPreset,
  profileMatchesPreset,
  slicerFamily,
  suggestPresets,
  type ProfileSettingKey,
  type ProfileValue,
  type PrintPresetId,
} from "../../studio/printProfile";
import {
  checkText,
  defaultPrinter,
  defaultSlicer,
  PRESET_ICONS,
  PresetGrid,
  printerChoices,
  profileSlicers,
} from "./printProfileUi";
import PrintProfileSettings from "./PrintProfileSettings";
import type { StudioCommandArgs } from "../../studio/commands";
import { profileLabel } from "./labels";
import type { RunCommand } from "./useStudioDesign";

// The Print tab: the design's print profile, set from a preset and changed setting by setting, for the person's slicer
// and printer. Every change is a set_print_profile command, as an AI's is.

type Props = {
  design: StudioDesign;
  group: StudioProfile;
  run: RunCommand;
  /** Whether Studio's assistant can be asked here. */
  canAskAi: boolean;
  /** It's working on a request. */
  aiBusy: boolean;
  onSuggestAi: () => void;
  /** What the design is for, in words (its requests and the models it was made from), for suggesting presets without
   *  an AI. */
  about: string;
};

export default function PrintProfilePanel({ design, group, run, canAskAi, aiBusy, onSuggestAi, about }: Props) {
  const { t } = useTranslation("app");
  const settings = useSlicerSettings();
  const { printers } = useUserPrinters();
  const [presetsAt, setPresetsAt] = useState<HTMLElement | null>(null);
  const profile = profileSettings(design.document, group.id).print_profile;
  const setProfile = (change: StudioCommandArgs<"set_print_profile">["profile"]) =>
    void run("set_print_profile", { profile_id: group.id, profile: change });
  const heading = (
    <Typography variant="subtitle2" noWrap title={profileLabel(group, t)}>
      {profileLabel(group, t)}
    </Typography>
  );
  const suggested = suggestPresets(about)
    .slice(0, 2)
    .map((hit) => hit.id);

  const pickPreset = (preset: PrintPresetId) => {
    setPresetsAt(null);
    if (profile) return setProfile({ preset });
    // A first profile is for the person's own slicer and printer.
    const slicer = defaultSlicer(settings);
    const printer = defaultPrinter(printers, settings, slicer);
    setProfile({ preset, slicer, ...(printer ? { printer } : {}) });
  };

  const aiButton = canAskAi && (
    <Button
      variant="outlined"
      size="small"
      startIcon={<AutoAwesomeOutlinedIcon />}
      disabled={aiBusy}
      onClick={onSuggestAi}
      fullWidth
    >
      {aiBusy ? t("studio.printProfile.aiWorking") : t("studio.printProfile.suggestAi")}
    </Button>
  );

  const presets = (
    <Popover
      open={Boolean(presetsAt)}
      anchorEl={presetsAt}
      onClose={() => setPresetsAt(null)}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{ paper: { sx: { p: 1.5, pt: 2, width: 420, maxWidth: "calc(100vw - 32px)" } } }}
    >
      <PresetGrid t={t} value={profile?.preset} suggested={suggested} onPick={pickPreset} />
    </Popover>
  );

  if (!profile)
    return (
      <Stack spacing={1.5} sx={{ p: 1.5, alignItems: "stretch", textAlign: "center" }}>
        {heading}
        <Box
          sx={{
            mx: "auto",
            mt: 1,
            width: 40,
            height: 40,
            display: "grid",
            placeItems: "center",
            borderRadius: 1.5,
            color: "primary.main",
            bgcolor: "action.hover",
          }}
        >
          <PrintOutlinedIcon />
        </Box>
        <Box>
          <Typography variant="subtitle2">{t("studio.printProfile.empty")}</Typography>
          <Typography variant="caption" color="text.secondary">
            {t("studio.printProfile.emptyHint")}
          </Typography>
        </Box>
        <Button variant="contained" size="small" onClick={(event) => setPresetsAt(event.currentTarget)}>
          {t("studio.printProfile.choosePreset")}
        </Button>
        {aiButton}
        {suggested.length > 0 && (
          <Stack direction="row" spacing={0.75} sx={{ justifyContent: "center", flexWrap: "wrap" }}>
            {suggested.map((id) => (
              <Chip
                key={id}
                size="small"
                variant="outlined"
                label={t("studio.printProfile.suggestedPreset", {
                  preset: t(`studio.printProfile.preset.${id}.title`),
                })}
                onClick={() => pickPreset(id)}
              />
            ))}
          </Stack>
        )}
        {presets}
      </Stack>
    );

  const slicer = profile.slicer ?? defaultSlicer(settings);
  const family = slicerFamily(slicer) ?? "bambu";
  const preset = printPreset(profile.preset);
  const Icon = preset ? PRESET_ICONS[preset.id] : PrintOutlinedIcon;
  const choices = printerChoices(printers, slicer);
  const printerKey = profile.printer ? `${profile.printer.id}/${profile.printer.nozzle}` : "";
  const setSetting = (key: ProfileSettingKey, value: ProfileValue | null) => setProfile({ settings: { [key]: value } });
  // For the slicer shown, which is the person's main one while the profile names none.
  const checks = checkProfile(design.document, { ...profile, slicer }, group.id);

  return (
    <Stack spacing={1.5} sx={{ p: 1.5, pt: 1 }}>
      {heading}
      {aiButton}
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.25 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              width: 32,
              height: 32,
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
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              {preset ? t(`studio.printProfile.preset.${preset.id}.title`) : t("studio.printProfile.custom")}
              {preset && !profileMatchesPreset(profile) && (
                <Typography component="span" variant="caption" color="text.secondary">
                  {" · "}
                  {t("studio.printProfile.changed")}
                </Typography>
              )}
            </Typography>
            {profile.material && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {profile.material}
              </Typography>
            )}
          </Box>
          <Button
            size="small"
            endIcon={<ExpandMoreRoundedIcon />}
            onClick={(event) => setPresetsAt(event.currentTarget)}
            aria-haspopup="listbox"
          >
            {t("studio.printProfile.change")}
          </Button>
        </Stack>
        {profile.reason && (
          <Stack direction="row" spacing={0.75} sx={{ mt: 1, alignItems: "flex-start" }}>
            {profile.by && profile.by !== "person" && (
              <Tooltip title={t("studio.printProfile.byAi")}>
                <AutoAwesomeOutlinedIcon sx={{ fontSize: 16, mt: "2px", color: "primary.main" }} />
              </Tooltip>
            )}
            <Typography variant="caption" color="text.secondary">
              {profile.reason}
            </Typography>
          </Stack>
        )}
      </Box>
      {presets}

      {checks.map((check) => (
        <Alert key={check.code} severity={check.level} sx={{ py: 0, "& .MuiAlert-message": { fontSize: "0.8rem" } }}>
          {checkText(t, check, slicer)}
        </Alert>
      ))}

      <TextField
        select
        size="small"
        label={t("studio.printProfile.slicer")}
        value={slicer}
        onChange={(event) => {
          const next = event.target.value;
          const printer = defaultPrinter(printers, settings, next);
          setProfile({ slicer: next, printer });
        }}
      >
        {profileSlicers(settings).map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      {choices.length > 0 && (
        <TextField
          select
          size="small"
          label={t("studio.printProfile.printer")}
          value={choices.some((choice) => choice.key === printerKey) ? printerKey : ""}
          onChange={(event) => {
            const choice = choices.find((entry) => entry.key === event.target.value);
            setProfile({ printer: choice ? { id: choice.id, nozzle: choice.nozzle } : null });
          }}
        >
          <MenuItem value="">{t("studio.printProfile.anyPrinter")}</MenuItem>
          {choices.map((choice) => (
            <MenuItem key={choice.key} value={choice.key}>
              {choice.label}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField
        select
        size="small"
        label={t("studio.printProfile.material")}
        value={profile.material ?? ""}
        onChange={(event) =>
          setProfile({ material: (event.target.value || null) as (typeof STUDIO_FILAMENT_MATERIALS)[number] | null })
        }
      >
        <MenuItem value="">{t("studio.printProfile.anyMaterial")}</MenuItem>
        {STUDIO_FILAMENT_MATERIALS.map((material) => (
          <MenuItem key={material} value={material}>
            {material}
          </MenuItem>
        ))}
      </TextField>

      <Box>
        <Typography
          variant="caption"
          component="h3"
          sx={{ display: "block", mb: 1, fontWeight: 700, color: "text.secondary", textTransform: "uppercase" }}
        >
          {t("studio.printProfile.settings")}
        </Typography>
        <PrintProfileSettings profile={profile} slicer={slicer} family={family} onSet={setSetting} />
      </Box>

      <Button size="small" color="error" onClick={() => setProfile(null)} sx={{ alignSelf: "flex-start" }}>
        {t("studio.printProfile.remove")}
      </Button>
    </Stack>
  );
}
