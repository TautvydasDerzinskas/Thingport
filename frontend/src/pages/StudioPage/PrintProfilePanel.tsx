import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import type { StudioDesign } from "../../api/studio";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import { useUserPrinters } from "../../hooks/useUserPrinters";
import { STUDIO_FILAMENT_MATERIALS } from "../../studio/document";
import {
  checkProfile,
  PROFILE_SETTINGS,
  printPreset,
  profileMatchesPreset,
  settingsNotCarried,
  slicerFamily,
  suggestPresets,
  type ProfileSettingDef,
  type ProfileSettingGroup,
  type ProfileSettingKey,
  type ProfileValue,
  type PrintPresetId,
} from "../../studio/printProfile";
import { NumberField } from "./fields";
import {
  checkText,
  choiceKey,
  defaultPrinter,
  defaultSlicer,
  PRESET_ICONS,
  PresetGrid,
  printerChoices,
  profileSlicers,
  settingLabel,
  slicerName,
  startingValue,
} from "./printProfileUi";
import type { RunCommand } from "./useStudioDesign";

// The Print tab: the design's print profile, set from a preset and changed setting by setting, for the person's slicer
// and printer. Every change is a set_print_profile command, as an AI's is.

const GROUPS: ProfileSettingGroup[] = ["layers", "walls", "infill", "support", "adhesion", "finish"];

type Props = {
  design: StudioDesign;
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

export default function PrintProfilePanel({ design, run, canAskAi, aiBusy, onSuggestAi, about }: Props) {
  const { t } = useTranslation("app");
  const settings = useSlicerSettings();
  const { printers } = useUserPrinters();
  const [presetsAt, setPresetsAt] = useState<HTMLElement | null>(null);
  const [addAt, setAddAt] = useState<HTMLElement | null>(null);
  const profile = design.document.print_profile;
  const suggested = suggestPresets(about)
    .slice(0, 2)
    .map((hit) => hit.id);

  const pickPreset = (preset: PrintPresetId) => {
    setPresetsAt(null);
    if (profile) return void run("set_print_profile", { profile: { preset } });
    // A first profile is for the person's own slicer and printer.
    const slicer = defaultSlicer(settings);
    const printer = defaultPrinter(printers, settings, slicer);
    void run("set_print_profile", { profile: { preset, slicer, ...(printer ? { printer } : {}) } });
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
  const setSetting = (key: ProfileSettingKey, value: ProfileValue | null) =>
    void run("set_print_profile", { profile: { settings: { [key]: value } } });
  const notCarried = new Set(settingsNotCarried(profile, family));
  const checks = checkProfile(design.document, profile);
  const set = (PROFILE_SETTINGS as readonly ProfileSettingDef[]).filter(
    (setting) => profile.settings[setting.key as ProfileSettingKey] !== undefined,
  );
  const addable = (PROFILE_SETTINGS as readonly ProfileSettingDef[]).filter(
    (setting) => setting.carries.includes(family) && profile.settings[setting.key as ProfileSettingKey] === undefined,
  );
  const native = (setting: ProfileSettingDef) => {
    const name = slicerName(slicer);
    return name ? t("studio.printProfile.nativeName", { slicer: name, name: setting.names[family] }) : "";
  };

  // The settings the slicer takes that aren't set yet, under their group's heading.
  const menuItems: ReactNode[] = [];
  for (const group of GROUPS) {
    const inGroup = addable.filter((setting) => setting.group === group);
    if (!inGroup.length) continue;
    menuItems.push(
      <ListSubheader key={group} sx={{ lineHeight: "32px" }}>
        {t(`studio.printProfile.group.${group}`)}
      </ListSubheader>,
    );
    for (const setting of inGroup)
      menuItems.push(
        <MenuItem
          key={setting.key}
          dense
          onClick={() => {
            setAddAt(null);
            setSetting(setting.key as ProfileSettingKey, startingValue(setting.key as ProfileSettingKey));
          }}
        >
          {settingLabel(t, setting.key)}
        </MenuItem>,
      );
  }

  return (
    <Stack spacing={1.5} sx={{ p: 1.5, pt: 1 }}>
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
          void run("set_print_profile", { profile: { slicer: next, printer } });
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
            void run("set_print_profile", {
              profile: { printer: choice ? { id: choice.id, nozzle: choice.nozzle } : null },
            });
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
          void run("set_print_profile", {
            profile: { material: (event.target.value || null) as (typeof STUDIO_FILAMENT_MATERIALS)[number] | null },
          })
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
        <Stack spacing={1.25}>
          {set.map((setting) => {
            const key = setting.key as ProfileSettingKey;
            const value = profile.settings[key]!;
            const label = settingLabel(t, key);
            const reset = (
              <Tooltip title={t("studio.printProfile.reset")}>
                <IconButton
                  size="small"
                  aria-label={`${t("studio.printProfile.reset")}: ${label}`}
                  onClick={() => setSetting(key, null)}
                  sx={{ p: 0.25 }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            );
            let field;
            if (setting.kind === "switch")
              field = (
                <FormControlLabel
                  sx={{ flex: 1, m: 0, justifyContent: "space-between" }}
                  labelPlacement="start"
                  label={<Typography variant="body2">{label}</Typography>}
                  control={<Switch size="small" checked={Boolean(value)} onChange={(_, on) => setSetting(key, on)} />}
                />
              );
            else if (setting.kind === "choice")
              field = (
                <TextField
                  select
                  size="small"
                  label={label}
                  value={String(value)}
                  onChange={(event) => setSetting(key, event.target.value)}
                  sx={{ flex: 1 }}
                >
                  {setting.options
                    .filter((choice) => choice.carries.includes(family) || choice.value === value)
                    .map((choice) => (
                      <MenuItem key={choice.value} value={choice.value}>
                        {t(`studio.printProfile.choice.${choiceKey(choice.value)}`)}
                      </MenuItem>
                    ))}
                </TextField>
              );
            else
              field = (
                <Box sx={{ flex: 1, "& .MuiFormControl-root": { width: "100%" } }}>
                  <NumberField
                    label={label}
                    value={Number(value)}
                    unit={setting.unit ?? undefined}
                    fixedUnit
                    validate={(next) =>
                      next >= setting.min && next <= setting.max && (setting.step < 1 || Number.isInteger(next))
                    }
                    onCommit={(next) => setSetting(key, next)}
                  />
                </Box>
              );
            return (
              <Tooltip key={key} title={native(setting)} placement="left" enterDelay={600} disableFocusListener>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                  {field}
                  {notCarried.has(key) && (
                    <Tooltip title={t("studio.printProfile.notCarried", { slicer: slicerName(slicer) ?? "" })}>
                      <Typography component="span" color="warning.main" sx={{ fontWeight: 700, px: 0.25 }}>
                        !
                      </Typography>
                    </Tooltip>
                  )}
                  {reset}
                </Stack>
              </Tooltip>
            );
          })}
        </Stack>
        {addable.length > 0 && (
          <Button
            size="small"
            startIcon={<AddRoundedIcon />}
            onClick={(event) => setAddAt(event.currentTarget)}
            aria-haspopup="menu"
            sx={{ mt: 1 }}
          >
            {t("studio.printProfile.addSetting")}
          </Button>
        )}
        <Menu
          anchorEl={addAt}
          open={Boolean(addAt)}
          onClose={() => setAddAt(null)}
          slotProps={{ paper: { sx: { maxHeight: 360 } } }}
        >
          {menuItems}
        </Menu>
      </Box>

      <Button
        size="small"
        color="error"
        onClick={() => void run("set_print_profile", { profile: null })}
        sx={{ alignSelf: "flex-start" }}
      >
        {t("studio.printProfile.remove")}
      </Button>
    </Stack>
  );
}
