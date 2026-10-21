import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ViewQuiltOutlinedIcon from "@mui/icons-material/ViewQuiltOutlined";
import ToggleOnOutlinedIcon from "@mui/icons-material/ToggleOnOutlined";
import type { DashboardLayout, DashboardWidgetChoices, DashboardWidgetId } from "../../api/settings";
import SectionedDialog from "../../components/SectionedDialog";
import SelectableTile from "../../components/controls/SelectableTile";
import LayoutPicker from "./LayoutPicker";
import PanelSketch from "./PanelSketch";
import { DASHBOARD_WIDGETS, isWidgetEnabled } from "./widgets";

type Section = "layout" | "panels";

type Props = {
  open: boolean;
  layout: DashboardLayout;
  onLayoutChange: (layout: DashboardLayout) => void;
  choices: DashboardWidgetChoices;
  onToggle: (id: DashboardWidgetId, enabled: boolean) => void;
  onClose: () => void;
};

/** Every choice applies straight away, so the dashboard behind updates as the user goes. */
export default function DashboardCustomizeDialog({ open, layout, onLayoutChange, choices, onToggle, onClose }: Props) {
  const { t } = useTranslation("app");
  const [section, setSection] = useState<Section>("layout");

  // Each opening starts on Layout; kept while closing, so the section doesn't switch during the fade.
  useEffect(() => {
    if (open) setSection("layout");
  }, [open]);

  const sections = [
    {
      id: "layout" as const,
      label: t("dashboard.widgets.sections.layout"),
      icon: <ViewQuiltOutlinedIcon fontSize="small" />,
    },
    {
      id: "panels" as const,
      label: t("dashboard.widgets.sections.panels"),
      icon: <ToggleOnOutlinedIcon fontSize="small" />,
    },
  ];

  return (
    <SectionedDialog
      open={open}
      onClose={onClose}
      title={t("dashboard.widgets.title")}
      sections={sections}
      section={section}
      onSectionChange={setSection}
    >
      {section === "layout" && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {t("dashboard.widgets.layoutSubtitle")}
          </Typography>
          <LayoutPicker value={layout} onChange={onLayoutChange} />
        </Stack>
      )}
      {section === "panels" && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {t("dashboard.widgets.subtitle")}
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
            {DASHBOARD_WIDGETS.map((widget) => {
              const enabled = isWidgetEnabled(widget, choices);
              return (
                <SelectableTile
                  key={widget.id}
                  selected={enabled}
                  dimWhenOff
                  label={t(widget.labelKey)}
                  onClick={() => onToggle(widget.id, !enabled)}
                >
                  <PanelSketch kind={widget.sketch} />
                </SelectableTile>
              );
            })}
          </Box>
        </Stack>
      )}
    </SectionedDialog>
  );
}
