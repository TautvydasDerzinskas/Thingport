import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import GridOnOutlinedIcon from "@mui/icons-material/GridOnOutlined";
import StraightenOutlinedIcon from "@mui/icons-material/StraightenOutlined";
import type { StudioSettings } from "../../api/studio";
import type { StudioSettingsChange } from "../../hooks/useStudioSettings";
import HelpTip from "../../components/HelpTip";
import SectionedDialog from "../../components/SectionedDialog";
import Segmented from "../../components/controls/Segmented";
import { PanelHeader, SectionLabel } from "../../components/Layout/ConfigurationDialog/parts";
import { NumberField } from "./fields";
import { STUDIO_UNITS, type StudioUnit } from "./units";

// Studio's own settings, kept in Studio: where Ask AI shows; units, as CAD keeps them, the open design's own and the ones
// a new design starts in; and the grid, adaptive or fixed, and whether points snap to it.

type Section = "assistant" | "units" | "grid";

const SECTIONS: { id: Section; icon: React.ReactNode }[] = [
  { id: "assistant", icon: <AutoAwesomeOutlinedIcon fontSize="small" /> },
  { id: "units", icon: <StraightenOutlinedIcon fontSize="small" /> },
  { id: "grid", icon: <GridOnOutlinedIcon fontSize="small" /> },
];
const SUBDIVISIONS = [2, 4, 5, 10];

type Props = {
  open: boolean;
  onClose: () => void;
  settings: StudioSettings;
  /** Saves to the account; rejects when it couldn't. */
  onChange: (changes: StudioSettingsChange) => Promise<void>;
  /** The open design's units, null with none open; changing them is a command, undone like any other. */
  designUnits: StudioUnit | null;
  onDesignUnits: (units: StudioUnit) => void;
};

export default function StudioSettingsDialog({ open, onClose, settings, onChange, designUnits, onDesignUnits }: Props) {
  const { t } = useTranslation("app");
  const [section, setSection] = useState<Section>("assistant");
  const [failed, setFailed] = useState<Section | null>(null);
  const save = (changes: StudioSettingsChange, from: Section) => {
    setFailed(null);
    onChange(changes).catch(() => setFailed(from));
  };
  const unitOptions = STUDIO_UNITS.map((unit) => ({ value: unit, label: t(`studio.settings.unitNames.${unit}`) }));
  const failure = (from: Section) =>
    failed === from && (
      <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
        {t("studio.settings.failed")}
      </Typography>
    );

  return (
    <SectionedDialog
      open={open}
      onClose={onClose}
      title={t("studio.settings.title")}
      sections={SECTIONS.map(({ id, icon }) => ({ id, icon, label: t(`studio.settings.sections.${id}`) }))}
      section={section}
      onSectionChange={setSection}
    >
      {section === "assistant" && (
        <>
          <PanelHeader title={t("studio.settings.sections.assistant")} subtitle={t("studio.settings.assistantIntro")} />
          <SectionLabel>
            {t("studio.settings.layout")}
            <HelpTip text={t("studio.settings.layoutHelp")} />
          </SectionLabel>
          <Segmented
            label={t("studio.settings.layout")}
            value={settings.prompt_layout}
            onChange={(layout) => save({ prompt_layout: layout }, "assistant")}
            options={[
              { value: "bar", label: t("studio.settings.layouts.bar") },
              { value: "panel", label: t("studio.settings.layouts.panel") },
            ]}
          />
          {failure("assistant")}
        </>
      )}
      {section === "grid" && (
        <>
          <PanelHeader title={t("studio.settings.sections.grid")} subtitle={t("studio.settings.grid.intro")} />
          <Stack spacing={2.5}>
            <FormControlLabel
              sx={{ ml: 0 }}
              control={
                <Switch
                  checked={settings.grid.show}
                  onChange={(event) => save({ grid: { show: event.target.checked } }, "grid")}
                />
              }
              label={t("studio.settings.grid.show")}
            />
            <div>
              <SectionLabel>
                {t("studio.settings.grid.spacing")}
                <HelpTip text={t("studio.settings.grid.spacingHelp")} />
              </SectionLabel>
              <Segmented
                label={t("studio.settings.grid.spacing")}
                value={settings.grid.spacing}
                onChange={(spacing) => save({ grid: { spacing } }, "grid")}
                options={[
                  { value: "adaptive", label: t("studio.settings.grid.spacings.adaptive") },
                  { value: "fixed", label: t("studio.settings.grid.spacings.fixed") },
                ]}
              />
            </div>
            {settings.grid.spacing === "adaptive" ? (
              <div>
                <SectionLabel>{t("studio.settings.grid.density")}</SectionLabel>
                <Segmented
                  label={t("studio.settings.grid.density")}
                  value={settings.grid.density}
                  onChange={(density) => save({ grid: { density } }, "grid")}
                  options={(["coarse", "normal", "fine"] as const).map((density) => ({
                    value: density,
                    label: t(`studio.settings.grid.densities.${density}`),
                  }))}
                />
              </div>
            ) : (
              <Stack direction="row" spacing={2} alignItems="flex-end">
                <Box sx={{ width: 150 }}>
                  <NumberField
                    label={t("studio.settings.grid.major")}
                    value={settings.grid.major}
                    unit="mm"
                    onCommit={(major) => major > 0 && save({ grid: { major } }, "grid")}
                  />
                </Box>
                <div>
                  <SectionLabel>{t("studio.settings.grid.subdivisions")}</SectionLabel>
                  <Segmented
                    label={t("studio.settings.grid.subdivisions")}
                    value={String(settings.grid.subdivisions)}
                    onChange={(count) => save({ grid: { subdivisions: Number(count) } }, "grid")}
                    options={SUBDIVISIONS.map((count) => ({ value: String(count), label: String(count) }))}
                  />
                </div>
              </Stack>
            )}
            <div>
              <FormControlLabel
                sx={{ ml: 0 }}
                control={
                  <Switch
                    checked={settings.grid.snap}
                    onChange={(event) => save({ grid: { snap: event.target.checked } }, "grid")}
                  />
                }
                label={
                  <>
                    {t("studio.settings.grid.snap")}
                    <HelpTip text={t("studio.settings.grid.snapHelp")} />
                  </>
                }
              />
            </div>
          </Stack>
          {failure("grid")}
        </>
      )}
      {section === "units" && (
        <>
          <PanelHeader title={t("studio.settings.sections.units")} subtitle={t("studio.settings.unitsIntro")} />
          <Stack spacing={2.5}>
            {designUnits && (
              <div>
                <SectionLabel>
                  {t("studio.settings.designUnits")}
                  <HelpTip text={t("studio.settings.designUnitsHelp")} />
                </SectionLabel>
                <Segmented
                  label={t("studio.settings.designUnits")}
                  value={designUnits}
                  onChange={onDesignUnits}
                  options={unitOptions}
                />
              </div>
            )}
            <div>
              <SectionLabel>
                {t("studio.settings.newUnits")}
                <HelpTip text={t("studio.settings.newUnitsHelp")} />
              </SectionLabel>
              <Segmented
                label={t("studio.settings.newUnits")}
                value={settings.units}
                onChange={(units) => save({ units }, "units")}
                options={unitOptions}
              />
              {failure("units")}
            </div>
          </Stack>
        </>
      )}
    </SectionedDialog>
  );
}
