import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import DashboardCustomizeOutlinedIcon from "@mui/icons-material/DashboardCustomizeOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import TabIcon from "@mui/icons-material/TabOutlined";
import { UnauthorizedError } from "../../api/client";
import { dashboardApi, type DashboardSummary } from "../../api/dashboard";
import type { DashboardPanel, DashboardWidgetId } from "../../api/settings";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import HelpTip from "../../components/HelpTip";
import SelectionToolbar, { SelectionAction } from "../../components/selection/SelectionToolbar";
import { useSelection } from "../../hooks/useSelection";
import { useDashboardConfig } from "../../hooks/useDashboardConfig";
import DashboardCustomizeDialog, { type CustomizeSection } from "./DashboardCustomizeDialog";
import DashboardGrid from "./DashboardGrid";
import TemplateSketch from "./TemplateSketch";
import DashboardCardSkeleton from "./DashboardCardSkeleton";
import { addWidget, mergePanels, removePanels, templateName, templateWidgets } from "./templates";
import { DASHBOARD_WIDGETS, widgetById } from "./widgets";

const panelKey = (panel: DashboardPanel) => panel.id;
const NO_PANELS: DashboardPanel[] = [];
const KEYS_HINT_ID = "dashboard-panel-keys";
// For screen readers only.
const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

type Props = {
  onUnauthorized?: () => void;
};

export default function DashboardPage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const confirm = useConfirm();
  const showToast = useToast();
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const dashboard = useDashboardConfig();
  const [customize, setCustomize] = React.useState<CustomizeSection | null>(null);
  const [templatesMenu, setTemplatesMenu] = React.useState<HTMLElement | null>(null);
  const [addMenu, setAddMenu] = React.useState<HTMLElement | null>(null);
  const panels = dashboard?.template.panels ?? NO_PANELS;
  const selection = useSelection(panels, panelKey);
  const editing = selection.active;
  const selectedIds = new Set(selection.selected.map(panelKey));
  const missing = dashboard
    ? DASHBOARD_WIDGETS.filter((widget) => !templateWidgets(dashboard.template).has(widget.id))
    : [];

  const removeSelected = async (ids: Set<string>) => {
    if (!dashboard || ids.size === 0) return;
    const ok = await confirm({
      title: t("dashboard.edit.removeTitle", { count: ids.size }),
      message: t("dashboard.edit.removeMessage"),
      confirmLabel: t("dashboard.edit.removeConfirm"),
      destructive: true,
    });
    if (!ok) return;
    dashboard.updateTemplate((template) => removePanels(template, ids));
    selection.clear();
    showToast({ message: t("dashboard.edit.removed", { count: ids.size }), severity: "success" });
  };

  const mergeSelected = () => {
    if (!dashboard || selectedIds.size < 2) return;
    dashboard.updateTemplate((template) => mergePanels(template, selectedIds));
    selection.clear();
    showToast({ message: t("dashboard.edit.merged", { count: selectedIds.size }), severity: "success" });
  };

  const addPanel = (id: DashboardWidgetId) => {
    setAddMenu(null);
    dashboard?.updateTemplate((template) => addWidget(template, id));
  };

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await dashboardApi.getSummary();
        if (active) setSummary(data);
      } catch (err) {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(t("dashboard.loadError"));
      }
    })();
    return () => {
      active = false;
    };
  }, [onUnauthorized, t]);

  // Until the summary arrives, widgets that need it show their placeholder; the rest render already.
  const renderWidget = React.useCallback(
    (id: DashboardWidgetId) => {
      const widget = widgetById(id);
      if (!widget) return null;
      return !summary && widget.skeleton ? (
        <DashboardCardSkeleton skeleton={widget.skeleton} />
      ) : (
        widget.render({ summary: summary as DashboardSummary, t, navigate, onUnauthorized })
      );
    },
    [summary, t, navigate, onUnauthorized],
  );

  const toolbar = dashboard ? (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2, minHeight: 40 }}>
      <SelectionToolbar
        selection={selection}
        total={panels.length}
        icon={<EditOutlinedIcon fontSize="small" />}
        labels={{
          enter: t("dashboard.edit.enter"),
          exit: t("dashboard.edit.exit"),
          toolbar: t("dashboard.edit.toolbar"),
          selectAllLoaded: t("common:selectAll"),
        }}
        dialogs={
          <Menu anchorEl={addMenu} open={addMenu !== null} onClose={() => setAddMenu(null)}>
            {missing.map((widget) => (
              <MenuItem key={widget.id} onClick={() => addPanel(widget.id)}>
                <ListItemIcon sx={{ color: "primary.main" }}>{widget.icon}</ListItemIcon>
                <ListItemText>{t(widget.labelKey)}</ListItemText>
              </MenuItem>
            ))}
          </Menu>
        }
      >
        <SelectionAction
          label={t("dashboard.edit.add")}
          hint={t("dashboard.edit.addNone")}
          icon={<AddIcon fontSize="small" />}
          disabled={missing.length === 0}
          onClick={(event) => setAddMenu(event.currentTarget)}
        />
        <SelectionAction
          label={t("dashboard.edit.merge")}
          hint={t("dashboard.edit.mergeHint")}
          icon={<TabIcon fontSize="small" />}
          disabled={selectedIds.size < 2}
          onClick={mergeSelected}
        />
        <SelectionAction
          label={t("dashboard.edit.remove")}
          hint={t("dashboard.edit.removeHint")}
          icon={<DeleteOutlineIcon fontSize="small" />}
          disabled={selectedIds.size === 0}
          onClick={() => void removeSelected(selectedIds)}
        />
        <HelpTip text={t("dashboard.edit.help")} />
      </SelectionToolbar>
      <Tooltip title={t("dashboard.templates.open")}>
        <Button
          size="small"
          color="inherit"
          aria-label={`${t("dashboard.templates.open")}: ${templateName(t, dashboard.template)}`}
          aria-haspopup="menu"
          startIcon={<DashboardCustomizeOutlinedIcon fontSize="small" />}
          endIcon={<ExpandMoreIcon fontSize="small" />}
          onClick={(event) => setTemplatesMenu(event.currentTarget)}
          sx={{ ml: "auto !important", color: "text.secondary", textTransform: "none", fontWeight: 600, minWidth: 0 }}
        >
          <Box
            component="span"
            sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}
          >
            {templateName(t, dashboard.template)}
          </Box>
        </Button>
      </Tooltip>
      <Menu anchorEl={templatesMenu} open={templatesMenu !== null} onClose={() => setTemplatesMenu(null)}>
        {dashboard.config.templates.map((template) => {
          const current = template.id === dashboard.config.active;
          return (
            <MenuItem
              key={template.id}
              selected={current}
              onClick={() => {
                setTemplatesMenu(null);
                dashboard.update((config) => ({ ...config, active: template.id }));
              }}
            >
              <ListItemIcon>{current && <CheckIcon fontSize="small" />}</ListItemIcon>
              <Box
                aria-hidden
                sx={{
                  width: 56,
                  flexShrink: 0,
                  mr: 1.5,
                  p: "3px",
                  borderRadius: "4px",
                  border: 1,
                  borderColor: current ? "primary.main" : "divider",
                  bgcolor: "background.paper",
                }}
              >
                <TemplateSketch template={template} small />
              </Box>
              <ListItemText>{templateName(t, template)}</ListItemText>
            </MenuItem>
          );
        })}
        <Divider />
        <MenuItem
          onClick={() => {
            setTemplatesMenu(null);
            setCustomize("templates");
          }}
        >
          <ListItemIcon>
            <SettingsOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("dashboard.templates.manage")}</ListItemText>
        </MenuItem>
      </Menu>
    </Stack>
  ) : null;

  let content: React.ReactNode;
  if (error) {
    content = (
      <Alert severity="error" sx={{ m: 3 }}>
        {error}
      </Alert>
    );
  } else if (!dashboard) {
    // Shaped like the dashboard's usual first row, so the page doesn't jump when it arrives.
    content = (
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(4, 1fr)" }, gap: 2 }}>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} variant="rounded" height={144} />
        ))}
      </Box>
    );
  } else if (panels.length === 0) {
    content = (
      <Stack alignItems="center" spacing={1.5} sx={{ py: 10, textAlign: "center" }}>
        <Typography color="text.secondary">{t("dashboard.edit.empty")}</Typography>
        <Button variant="outlined" startIcon={<AddIcon />} onClick={(event) => setAddMenu(event.currentTarget)}>
          {t("dashboard.edit.add")}
        </Button>
      </Stack>
    );
  } else {
    content = (
      <DashboardGrid
        template={dashboard.template}
        editing={editing}
        isSelected={selection.isSelected}
        onToggleSelected={selection.toggle}
        onChange={dashboard.updateTemplate}
        onRemove={(id) => void removeSelected(new Set([id]))}
        renderWidget={renderWidget}
        keysHintId={KEYS_HINT_ID}
      />
    );
  }

  return (
    <Box sx={{ p: { xs: 0, md: 1 } }}>
      {!error && toolbar}
      {content}
      <Box id={KEYS_HINT_ID} sx={visuallyHidden}>
        {t("dashboard.edit.keys")}
      </Box>
      {dashboard && (
        <DashboardCustomizeDialog
          open={customize !== null}
          initialSection={customize ?? "templates"}
          dashboard={dashboard}
          onClose={() => setCustomize(null)}
        />
      )}
    </Box>
  );
}
