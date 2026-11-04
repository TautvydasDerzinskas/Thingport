import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import StraightenOutlinedIcon from "@mui/icons-material/StraightenOutlined";
import type { StudioSettings } from "../../api/studio";
import HelpTip from "../../components/HelpTip";
import SectionedDialog from "../../components/SectionedDialog";
import Segmented from "../../components/controls/Segmented";
import { PanelHeader, SectionLabel } from "../../components/Layout/ConfigurationDialog/parts";
import { STUDIO_UNITS, type StudioUnit } from "./units";

// Studio's own settings, kept in Studio: where Ask AI shows, and units, as CAD keeps them: the open design's own, and
// the ones a new design starts in.

type Section = "assistant" | "units";

const SECTIONS: { id: Section; icon: React.ReactNode }[] = [
  { id: "assistant", icon: <AutoAwesomeOutlinedIcon fontSize="small" /> },
  { id: "units", icon: <StraightenOutlinedIcon fontSize="small" /> },
];

type Props = {
  open: boolean;
  onClose: () => void;
  settings: StudioSettings;
  /** Saves to the account; rejects when it couldn't. */
  onChange: (changes: Partial<StudioSettings>) => Promise<void>;
  /** The open design's units, null with none open; changing them is a command, undone like any other. */
  designUnits: StudioUnit | null;
  onDesignUnits: (units: StudioUnit) => void;
};

export default function StudioSettingsDialog({ open, onClose, settings, onChange, designUnits, onDesignUnits }: Props) {
  const { t } = useTranslation("app");
  const [section, setSection] = useState<Section>("assistant");
  const [failed, setFailed] = useState<Section | null>(null);
  const save = (changes: Partial<StudioSettings>, from: Section) => {
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
