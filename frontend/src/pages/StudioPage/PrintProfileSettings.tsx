import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import {
  PROFILE_CATEGORIES,
  PROFILE_SETTINGS,
  settingsNotCarried,
  type ProfileCategory,
  type ProfileSettingDef,
  type ProfileSettingKey,
  type ProfileValue,
  type SlicerFamily,
  type StudioPrintProfile,
} from "../../studio/printProfile";
import { NumberField } from "./fields";
import { ChoicePreview, hasChoicePreviews } from "./printProfilePreviews";
import { choiceKey, settingLabel, slicerName, startingValue } from "./printProfileUi";

// The profile's settings in Bambu Studio's categories, as sections that fold: in each, the settings the slicer reads
// from a 3MF, those the profile sets as fields and the rest as a "Slicer default" row that sets one with a click.

const OPEN_KEY = "thingport_studio_print_sections";
const DEFAULT_OPEN: ProfileCategory[] = ["quality", "strength"];
const appear = keyframes`from { opacity: 0; transform: translateY(-4px); }`;

function storedOpen(): Set<ProfileCategory> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? "null");
    if (Array.isArray(value)) return new Set(value.filter((entry) => PROFILE_CATEGORIES.includes(entry)));
  } catch {}
  return new Set(DEFAULT_OPEN);
}

type Props = {
  profile: StudioPrintProfile;
  slicer: string;
  family: SlicerFamily;
  onSet: (key: ProfileSettingKey, value: ProfileValue | null) => void;
};

export default function PrintProfileSettings({ profile, slicer, family, onSet }: Props) {
  const { t } = useTranslation("app");
  const [open, setOpen] = useState(storedOpen);
  const ids = useId();
  const notCarried = new Set(settingsNotCarried(profile, family));
  const toggle = (category: ProfileCategory) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  const nativeName = (setting: ProfileSettingDef) => {
    const name = slicerName(slicer);
    return name ? t("studio.printProfile.nativeName", { slicer: name, name: setting.names[family] }) : "";
  };

  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, overflow: "hidden" }}>
      {PROFILE_CATEGORIES.map((category, index) => {
        const inCategory = (PROFILE_SETTINGS as readonly ProfileSettingDef[]).filter(
          (setting) =>
            setting.category === category &&
            (setting.carries.includes(family) || profile.settings[setting.key as ProfileSettingKey] !== undefined),
        );
        const count = inCategory.filter(
          (setting) => profile.settings[setting.key as ProfileSettingKey] !== undefined,
        ).length;
        const expanded = open.has(category);
        const panelId = `${ids}-${category}`;
        return (
          <Box key={category} sx={{ borderTop: index ? 1 : 0, borderColor: "divider" }}>
            <ButtonBase
              onClick={() => toggle(category)}
              aria-expanded={expanded}
              aria-controls={panelId}
              sx={(theme) => ({
                width: "100%",
                justifyContent: "flex-start",
                gap: 0.75,
                px: 1,
                py: 0.75,
                "&:hover": { bgcolor: "action.hover" },
                "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
              })}
            >
              <ChevronRightRoundedIcon
                sx={{
                  fontSize: 18,
                  color: "text.secondary",
                  transform: expanded ? "rotate(90deg)" : "none",
                  transition: "transform 150ms",
                  "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                }}
              />
              <Typography variant="body2" sx={{ fontWeight: 650, flex: 1, textAlign: "left" }}>
                {t(`studio.printProfile.category.${category}`)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {count ? t("studio.printProfile.setCount", { count }) : "—"}
              </Typography>
            </ButtonBase>
            {expanded && (
              <Stack
                id={panelId}
                spacing={1.25}
                sx={{
                  px: 1,
                  pt: 1,
                  pb: 1.25,
                  borderTop: 1,
                  borderColor: "divider",
                  animation: `${appear} 160ms ease-out`,
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }}
              >
                {inCategory.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {t("studio.printProfile.noneCarried", { slicer: slicerName(slicer) ?? "" })}
                  </Typography>
                )}
                {inCategory.map((setting) => {
                  const key = setting.key as ProfileSettingKey;
                  const value = profile.settings[key];
                  const label = settingLabel(t, key);
                  if (value === undefined)
                    return (
                      <ButtonBase
                        key={key}
                        onClick={() => onSet(key, startingValue(key))}
                        aria-label={`${t("studio.printProfile.setIt")}: ${label}`}
                        sx={(theme) => ({
                          justifyContent: "flex-start",
                          gap: 0.75,
                          px: 1.25,
                          py: 0.75,
                          border: 1,
                          borderStyle: "dashed",
                          borderColor: "divider",
                          borderRadius: 1,
                          color: "text.secondary",
                          "&:hover": { borderColor: "text.secondary" },
                          "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
                        })}
                      >
                        <Typography variant="body2" color="text.primary" noWrap>
                          {label}
                        </Typography>
                        <Typography variant="caption" noWrap sx={{ flex: 1, textAlign: "left" }}>
                          · {t("studio.printProfile.slicerDefault")}
                        </Typography>
                        <Typography variant="caption" color="primary" sx={{ fontWeight: 650 }}>
                          {t("studio.printProfile.setIt")}
                        </Typography>
                      </ButtonBase>
                    );
                  return (
                    <SetRow
                      key={key}
                      setting={setting}
                      value={value}
                      label={label}
                      family={family}
                      hint={nativeName(setting)}
                      notCarried={
                        notCarried.has(key)
                          ? t("studio.printProfile.notCarried", { slicer: slicerName(slicer) ?? "" })
                          : null
                      }
                      onSet={(next) => onSet(key, next)}
                    />
                  );
                })}
              </Stack>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/** A set setting with its reset button; hovering names it as the slicer does, but not while its menu is open. */
function SetRow({
  setting,
  value,
  label,
  family,
  hint,
  notCarried,
  onSet,
}: {
  setting: ProfileSettingDef;
  value: ProfileValue;
  label: string;
  family: SlicerFamily;
  hint: string;
  notCarried: string | null;
  onSet: (value: ProfileValue | null) => void;
}) {
  const { t } = useTranslation("app");
  const [tip, setTip] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <Tooltip
      title={hint}
      placement="left"
      enterDelay={600}
      disableFocusListener
      open={tip && !menuOpen}
      onOpen={() => setTip(true)}
      onClose={() => setTip(false)}
    >
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
        <SettingField
          setting={setting}
          value={value}
          label={label}
          family={family}
          onChange={onSet}
          onMenu={setMenuOpen}
        />
        {notCarried && (
          <Tooltip title={notCarried}>
            <Typography component="span" color="warning.main" sx={{ fontWeight: 700, px: 0.25 }}>
              !
            </Typography>
          </Tooltip>
        )}
        <Tooltip title={t("studio.printProfile.reset")}>
          <IconButton
            size="small"
            aria-label={`${t("studio.printProfile.reset")}: ${label}`}
            onClick={() => onSet(null)}
            sx={{ p: 0.25 }}
          >
            <CloseRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Tooltip>
  );
}

/** One set setting: a switch, a number in its unit, or a choice (with each choice's picture where it has one). */
function SettingField({
  setting,
  value,
  label,
  family,
  onChange,
  onMenu,
}: {
  setting: ProfileSettingDef;
  value: ProfileValue;
  label: string;
  family: SlicerFamily;
  onChange: (value: ProfileValue) => void;
  /** A choice's menu opened or closed. */
  onMenu: (open: boolean) => void;
}) {
  const { t } = useTranslation("app");
  if (setting.kind === "switch")
    return (
      <FormControlLabel
        sx={{ flex: 1, m: 0, justifyContent: "space-between" }}
        labelPlacement="start"
        label={<Typography variant="body2">{label}</Typography>}
        control={<Switch size="small" checked={Boolean(value)} onChange={(_, on) => onChange(on)} />}
      />
    );
  if (setting.kind === "number")
    return (
      <Box sx={{ flex: 1, "& .MuiFormControl-root": { width: "100%" } }}>
        <NumberField
          label={label}
          value={Number(value)}
          unit={setting.unit ?? undefined}
          fixedUnit
          validate={(next) =>
            next >= setting.min && next <= setting.max && (setting.step < 1 || Number.isInteger(next))
          }
          onCommit={onChange}
        />
      </Box>
    );
  const pictured = hasChoicePreviews(setting.key);
  const choiceLabel = (choice: string) => t(`studio.printProfile.choice.${choiceKey(choice)}`);
  return (
    <TextField
      select
      size="small"
      label={label}
      value={String(value)}
      onChange={(event) => onChange(event.target.value)}
      sx={{ flex: 1 }}
      slotProps={{
        select: {
          renderValue: (selected) => (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
              {pictured && <ChoicePreview setting={setting.key} value={String(selected)} size={20} />}
              <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {choiceLabel(String(selected))}
              </Box>
            </Stack>
          ),
          onOpen: () => onMenu(true),
          onClose: () => onMenu(false),
          MenuProps: { slotProps: { paper: { sx: { maxHeight: 420 } } } },
        },
      }}
    >
      {setting.options
        .filter((choice) => choice.carries.includes(family) || choice.value === value)
        .map((choice) => (
          <MenuItem key={choice.value} value={choice.value} dense={!pictured}>
            {pictured && (
              <ListItemIcon sx={{ minWidth: 0, mr: 1.25 }}>
                <ChoicePreview setting={setting.key} value={choice.value} size={32} />
              </ListItemIcon>
            )}
            <ListItemText primary={choiceLabel(choice.value)} primaryTypographyProps={{ variant: "body2" }} />
          </MenuItem>
        ))}
    </TextField>
  );
}
