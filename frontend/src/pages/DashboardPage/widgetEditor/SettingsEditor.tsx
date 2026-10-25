import { useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import TuneIcon from "@mui/icons-material/Tune";
import Segmented from "../../../components/controls/Segmented";
import HelpTip from "../../../components/HelpTip";
import { MAX_OPTIONS, MAX_SETTINGS, keyFromLabel, newSetting, uid, type DraftSetting, type SettingType } from "./draft";

const appear = keyframes`from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; }`;
const TYPES: SettingType[] = ["text", "number", "toggle", "choice"];

type Props = {
  settings: DraftSetting[];
  onChange: (settings: DraftSetting[]) => void;
  /** Problems by field, as `problems` in draft.ts names them. */
  errors: Record<string, string>;
};

/** The widget's settings, which the user then sets from a panel's cog: a card each, built from fields. */
export default function SettingsEditor({ settings, onChange, errors }: Props) {
  const { t } = useTranslation("app");
  const [menu, setMenu] = useState<{ index: number; anchor: HTMLElement } | null>(null);

  const update = (index: number, patch: Partial<DraftSetting>) =>
    onChange(settings.map((setting, i) => (i === index ? { ...setting, ...patch } : setting)));
  const move = (from: number, to: number) => {
    const next = [...settings];
    next.splice(to, 0, ...next.splice(from, 1));
    onChange(next);
  };
  const add = () =>
    onChange([
      ...settings,
      newSetting(
        "text",
        settings.map((s) => s.key),
      ),
    ]);

  return (
    <Stack spacing={1.5}>
      {settings.length === 0 && (
        <Paper
          variant="outlined"
          sx={{ p: 3, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, borderStyle: "dashed" }}
        >
          <TuneIcon sx={{ color: "text.disabled" }} />
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {t("dashboard.custom.editor.noSettings")}
          </Typography>
        </Paper>
      )}
      {settings.map((setting, index) => {
        const error = (field: string) => {
          const key = errors[`settings.${setting.uid}.${field}`];
          return key ? t(`dashboard.custom.editor.errors.${key}`) : undefined;
        };
        return (
          <Paper
            key={setting.uid}
            variant="outlined"
            sx={{
              p: 1.5,
              borderRadius: "12px",
              animation: `${appear} 180ms ease-out`,
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <Segmented
                label={t("dashboard.custom.editor.type")}
                value={setting.type}
                onChange={(type) => update(index, { type })}
                options={TYPES.map((type) => ({ value: type, label: t(`dashboard.custom.editor.types.${type}`) }))}
              />
              <Box sx={{ flex: 1 }} />
              <Tooltip title={t("dashboard.custom.editor.settingActions")}>
                <IconButton
                  size="small"
                  aria-label={`${t("dashboard.custom.editor.settingActions")}: ${setting.label || setting.key}`}
                  aria-haspopup="menu"
                  onClick={(event) => setMenu({ index, anchor: event.currentTarget })}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                size="small"
                fullWidth
                label={t("dashboard.custom.editor.settingLabel")}
                value={setting.label}
                error={!!error("label")}
                helperText={error("label")}
                onChange={(event) => {
                  const label = event.target.value;
                  update(index, setting.keyEdited ? { label } : { label, key: keyFromLabel(label) || setting.key });
                }}
                slotProps={{ htmlInput: { maxLength: 60 } }}
              />
              <TextField
                size="small"
                fullWidth
                label={t("dashboard.custom.editor.settingKey")}
                value={setting.key}
                error={!!error("key")}
                helperText={error("key")}
                onChange={(event) => update(index, { key: event.target.value, keyEdited: true })}
                slotProps={{
                  htmlInput: { maxLength: 40, spellCheck: false, style: { fontFamily: "monospace" } },
                  input: { endAdornment: <HelpTip text={t("dashboard.custom.editor.settingKeyHelp")} /> },
                }}
              />
            </Stack>
            <Box sx={{ mt: 1.5 }}>
              <TypeFields setting={setting} onChange={(patch) => update(index, patch)} error={error} />
            </Box>
          </Paper>
        );
      })}
      <Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={add}
          disabled={settings.length >= MAX_SETTINGS}
        >
          {t("dashboard.custom.editor.addSetting")}
        </Button>
      </Box>
      <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={() => setMenu(null)}>
        {menu && [
          <MenuItem
            key="up"
            disabled={menu.index === 0}
            onClick={() => {
              move(menu.index, menu.index - 1);
              setMenu(null);
            }}
          >
            <ListItemIcon>
              <ArrowUpwardIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("dashboard.custom.editor.moveUp")}</ListItemText>
          </MenuItem>,
          <MenuItem
            key="down"
            disabled={menu.index === settings.length - 1}
            onClick={() => {
              move(menu.index, menu.index + 1);
              setMenu(null);
            }}
          >
            <ListItemIcon>
              <ArrowDownwardIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("dashboard.custom.editor.moveDown")}</ListItemText>
          </MenuItem>,
          <Divider key="divider" />,
          <MenuItem
            key="remove"
            sx={{ color: "error.main" }}
            onClick={() => {
              onChange(settings.filter((_, i) => i !== menu.index));
              setMenu(null);
            }}
          >
            <ListItemIcon sx={{ color: "inherit" }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("dashboard.custom.editor.removeSetting")}</ListItemText>
          </MenuItem>,
        ]}
      </Menu>
    </Stack>
  );
}

/** What a setting of its type needs: a default, and a text's placeholder or a choice's options. */
function TypeFields({
  setting,
  onChange,
  error,
}: {
  setting: DraftSetting;
  onChange: (patch: Partial<DraftSetting>) => void;
  error: (field: string) => string | undefined;
}) {
  const { t } = useTranslation("app");

  if (setting.type === "toggle")
    return (
      <FormControlLabel
        control={<Switch checked={setting.on} onChange={(event) => onChange({ on: event.target.checked })} />}
        label={t("dashboard.custom.editor.defaultOn")}
      />
    );

  if (setting.type === "number")
    return (
      <TextField
        size="small"
        type="number"
        label={t("dashboard.custom.editor.default")}
        value={setting.value}
        error={!!error("value")}
        helperText={error("value")}
        onChange={(event) => onChange({ value: event.target.value })}
        sx={{ width: { xs: "100%", sm: 180 } }}
      />
    );

  if (setting.type === "choice") {
    const options = setting.options;
    const setOption = (index: number, patch: { value?: string; label?: string }) =>
      onChange({
        options: options.map((option, i) => (i === index ? { ...option, ...patch } : option)),
        // The default follows its option when the option's value is renamed.
        ...(patch.value !== undefined && options[index].value === setting.value ? { value: patch.value } : {}),
      });
    const usable = options.filter((option) => option.value.trim() && option.label.trim());
    return (
      <Stack spacing={1}>
        <Typography variant="caption" color={error("options") ? "error" : "text.secondary"}>
          {error("options") ?? t("dashboard.custom.editor.options")}
        </Typography>
        {options.map((option, index) => (
          <Stack key={option.uid} direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              placeholder={t("dashboard.custom.editor.optionLabel")}
              value={option.label}
              onChange={(event) => setOption(index, { label: event.target.value })}
              slotProps={{ htmlInput: { maxLength: 60, "aria-label": t("dashboard.custom.editor.optionLabel") } }}
              sx={{ flex: 1 }}
            />
            <TextField
              size="small"
              placeholder={t("dashboard.custom.editor.optionValue")}
              value={option.value}
              onChange={(event) => setOption(index, { value: event.target.value })}
              slotProps={{
                htmlInput: {
                  maxLength: 40,
                  spellCheck: false,
                  style: { fontFamily: "monospace" },
                  "aria-label": t("dashboard.custom.editor.optionValue"),
                },
              }}
              sx={{ flex: 1 }}
            />
            <Tooltip title={t("dashboard.custom.editor.removeOption")}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t("dashboard.custom.editor.removeOption")}
                  disabled={options.length <= 2}
                  onClick={() => onChange({ options: options.filter((_, i) => i !== index) })}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        ))}
        <Box>
          <Button
            size="small"
            startIcon={<AddIcon />}
            disabled={options.length >= MAX_OPTIONS}
            onClick={() =>
              onChange({ options: [...options, { uid: uid(), value: `option${options.length + 1}`, label: "" }] })
            }
          >
            {t("dashboard.custom.editor.addOption")}
          </Button>
        </Box>
        {usable.length >= 2 && (
          <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap sx={{ flexWrap: "wrap" }}>
            <Typography variant="caption" color="text.secondary">
              {t("dashboard.custom.editor.default")}
            </Typography>
            <Segmented
              label={t("dashboard.custom.editor.default")}
              value={usable.some((option) => option.value === setting.value) ? setting.value : usable[0].value}
              onChange={(value) => onChange({ value })}
              options={usable.map((option) => ({ value: option.value, label: option.label }))}
            />
          </Stack>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          size="small"
          fullWidth
          label={t("dashboard.custom.editor.default")}
          value={setting.value}
          type={setting.secret ? "password" : "text"}
          onChange={(event) => onChange({ value: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 2048, autoComplete: "off" } }}
        />
        <TextField
          size="small"
          fullWidth
          label={t("dashboard.custom.editor.placeholder")}
          value={setting.placeholder}
          onChange={(event) => onChange({ placeholder: event.target.value })}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </Stack>
      <FormControlLabel
        control={<Switch checked={setting.secret} onChange={(event) => onChange({ secret: event.target.checked })} />}
        label={
          <>
            {t("dashboard.custom.editor.secret")}
            <HelpTip text={t("dashboard.custom.editor.secretHelp")} />
          </>
        }
      />
    </Stack>
  );
}
