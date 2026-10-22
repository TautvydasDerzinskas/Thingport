import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CropFreeIcon from "@mui/icons-material/CropFree";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import type { DashboardConfig, DashboardTemplate } from "../../api/settings";
import SelectableTile from "../../components/controls/SelectableTile";
import { useConfirm } from "../../components/ConfirmProvider";
import TemplateSketch from "./TemplateSketch";
import {
  DASHBOARD_PRESETS,
  MAX_TEMPLATES,
  duplicateTemplate,
  emptyTemplate,
  presetById,
  resetTemplate,
  templateFromPreset,
  templateName,
  uniqueTemplateName,
} from "./templates";

type Props = {
  config: DashboardConfig;
  onChange: (change: (config: DashboardConfig) => DashboardConfig) => void;
};

/** The user's templates: pick one to show it, and make, rename, copy, reset or delete them. */
export default function TemplatesSection({ config, onChange }: Props) {
  const { t } = useTranslation("app");
  const confirm = useConfirm();
  const [menu, setMenu] = React.useState<{ template: DashboardTemplate; anchor: HTMLElement } | null>(null);
  const [newMenu, setNewMenu] = React.useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = React.useState<DashboardTemplate | null>(null);
  const active = config.templates.find((template) => template.id === config.active) ?? config.templates[0];
  const full = config.templates.length >= MAX_TEMPLATES;

  // A new template shows straight away, so the dashboard behind the dialog follows.
  const add = (template: DashboardTemplate) =>
    onChange((current) => ({ ...current, active: template.id, templates: [...current.templates, template] }));
  const replace = (template: DashboardTemplate) =>
    onChange((current) => ({
      ...current,
      templates: current.templates.map((t2) => (t2.id === template.id ? template : t2)),
    }));

  const remove = async (template: DashboardTemplate) => {
    const ok = await confirm({
      title: t("dashboard.templates.deleteTitle", { name: templateName(t, template) }),
      message: t("dashboard.templates.deleteMessage"),
      confirmLabel: t("dashboard.templates.deleteConfirm"),
      destructive: true,
    });
    if (!ok) return;
    onChange((current) => {
      const templates = current.templates.filter((t2) => t2.id !== template.id);
      return { ...current, active: current.active === template.id ? templates[0].id : current.active, templates };
    });
  };

  const reset = async (template: DashboardTemplate) => {
    const ok = await confirm({
      title: t("dashboard.templates.resetTitle", { name: templateName(t, template) }),
      message: t("dashboard.templates.resetMessage"),
      confirmLabel: t("dashboard.templates.resetConfirm"),
      destructive: true,
    });
    if (ok) replace(resetTemplate(template));
  };

  const closeMenu = () => setMenu(null);

  return (
    <>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
        {config.templates.map((template) => (
          <Box
            key={template.id}
            sx={{ position: "relative", display: "flex", "& > button": { flex: 1 } }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ template, anchor: event.currentTarget });
            }}
          >
            <SelectableTile
              selected={template.id === active.id}
              label={templateName(t, template)}
              onClick={() => onChange((current) => ({ ...current, active: template.id }))}
            >
              <TemplateSketch template={template} />
            </SelectableTile>
            <Tooltip title={t("dashboard.templates.actions")}>
              <IconButton
                size="small"
                aria-label={`${t("dashboard.templates.actions")}: ${templateName(t, template)}`}
                aria-haspopup="menu"
                onClick={(event) => setMenu({ template, anchor: event.currentTarget })}
                sx={{ position: "absolute", left: 4, top: 4, bgcolor: "background.paper", boxShadow: 1, p: 0.25 }}
              >
                <MoreVertIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
        <Tooltip title={full ? t("dashboard.templates.limit", { max: MAX_TEMPLATES }) : ""}>
          <span style={{ display: "flex" }}>
            <ButtonBase
              disabled={full}
              aria-haspopup="menu"
              onClick={(event) => setNewMenu(event.currentTarget)}
              sx={{
                flex: 1,
                minHeight: 120,
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
                borderRadius: "10px",
                border: 2,
                borderStyle: "dashed",
                borderColor: "divider",
                color: "text.secondary",
                opacity: full ? 0.5 : 1,
                transition: "border-color 150ms, color 150ms",
                "&:hover": { borderColor: "primary.main", color: "primary.main" },
                "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
              }}
            >
              <AddIcon />
              <Typography variant="caption">{t("dashboard.templates.new")}</Typography>
            </ButtonBase>
          </span>
        </Tooltip>
      </Box>

      <Menu anchorEl={newMenu} open={newMenu !== null} onClose={() => setNewMenu(null)}>
        <MenuItem
          onClick={() => {
            setNewMenu(null);
            add(duplicateTemplate(active, uniqueTemplateName(t, config.templates, templateName(t, active))));
          }}
        >
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("dashboard.templates.newCopy", { name: templateName(t, active) })}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setNewMenu(null);
            add(emptyTemplate(uniqueTemplateName(t, config.templates, t("dashboard.templates.emptyName"))));
          }}
        >
          <ListItemIcon>
            <CropFreeIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("dashboard.templates.newEmpty")}</ListItemText>
        </MenuItem>
        <Divider />
        <ListSubheader sx={{ lineHeight: "32px", bgcolor: "transparent" }}>
          {t("dashboard.templates.fromPreset")}
        </ListSubheader>
        {DASHBOARD_PRESETS.map((preset) => (
          <MenuItem
            key={preset.id}
            onClick={() => {
              setNewMenu(null);
              const base = t(`dashboard.templates.presets.${preset.id}`);
              const name = uniqueTemplateName(t, config.templates, base);
              add({ ...templateFromPreset(preset), name: name === base ? null : name });
            }}
          >
            <ListItemIcon>
              <DashboardOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t(`dashboard.templates.presets.${preset.id}`)}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={closeMenu}>
        {menu && [
          <MenuItem
            key="rename"
            onClick={() => {
              setRenaming(menu.template);
              closeMenu();
            }}
          >
            <ListItemIcon>
              <EditOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("dashboard.templates.rename")}</ListItemText>
          </MenuItem>,
          <MenuItem
            key="duplicate"
            disabled={full}
            onClick={() => {
              const name = templateName(t, menu.template);
              add(duplicateTemplate(menu.template, uniqueTemplateName(t, config.templates, name)));
              closeMenu();
            }}
          >
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("dashboard.templates.duplicate")}</ListItemText>
          </MenuItem>,
          presetById(menu.template.preset) && (
            <MenuItem
              key="reset"
              onClick={() => {
                void reset(menu.template);
                closeMenu();
              }}
            >
              <ListItemIcon>
                <RestartAltIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("dashboard.templates.reset")}</ListItemText>
            </MenuItem>
          ),
          <Divider key="divider" />,
          <MenuItem
            key="delete"
            disabled={config.templates.length < 2}
            onClick={() => {
              void remove(menu.template);
              closeMenu();
            }}
            sx={{ color: "error.main" }}
          >
            <ListItemIcon sx={{ color: "inherit" }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("dashboard.templates.delete")}</ListItemText>
          </MenuItem>,
        ]}
      </Menu>

      <RenameDialog
        template={renaming}
        onClose={() => setRenaming(null)}
        onSave={(name) => renaming && replace({ ...renaming, name })}
      />
    </>
  );
}

function RenameDialog({
  template,
  onClose,
  onSave,
}: {
  template: DashboardTemplate | null;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const [name, setName] = React.useState("");
  React.useEffect(() => {
    if (template) setName(templateName(t, template));
  }, [template, t]);
  const trimmed = name.trim();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    onSave(trimmed);
    onClose();
  };
  return (
    <Dialog open={template !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>{t("dashboard.templates.renameTitle")}</DialogTitle>
        <DialogContent>
          <TextField
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            fullWidth
            margin="dense"
            label={t("common:name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t("common:cancel")}</Button>
          <Button type="submit" variant="contained" disabled={!trimmed}>
            {t("common:save")}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
