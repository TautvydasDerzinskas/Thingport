import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { settingsApi } from "../../api/settings";
import { useStudioEnabled } from "../../hooks/useStudioEnabled";
import { aiDescriptionsApi } from "../../api/aiDescriptions";
import type { AiConnection } from "../../api/aiConnections";
import SectionHeader from "../../components/SectionHeader";
import { useAiDescriptionRun, useAiRun } from "../../components/Layout/AiRunContext";
import AiCategorizationDialog from "./AiCategorizationDialog";
import AiDescriptionsDialog from "./AiDescriptionsDialog";
import CategorizationAnimation from "./CategorizationAnimation";
import DescriptionAnimation from "./DescriptionAnimation";
import FeatureTile, { FEATURE_TILE, type FeatureSection } from "./FeatureTile";
import StudioAssistantAnimation from "./StudioAssistantAnimation";
import StudioAssistantDialog from "./StudioAssistantDialog";

type Props = {
  /** Null while the models are loading. */
  connections: AiConnection[] | null;
  onUnauthorized?: () => void;
  /** Opens Studio's assistant settings at once: the page was opened for them, from Studio's prompt. */
  openStudio?: boolean;
};

type FeatureSettings = { enabled: boolean };

/**
 * One feature's settings: loaded, switched on and off, and read again when models come or go (deleting the last
 * one switches every feature off on the server).
 */
function useFeature<T extends FeatureSettings>(
  load: () => Promise<T>,
  update: (input: { enabled: boolean }) => Promise<T>,
  modelCount: number | undefined,
  onUnauthorized: (() => void) | undefined,
  failed: string,
) {
  const [settings, setSettings] = useState<T | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : failed);
    },
    [onUnauthorized, failed],
  );

  useEffect(() => {
    if (modelCount === undefined) return;
    let active = true;
    void load()
      .then((loaded) => {
        if (active) setSettings(loaded);
      })
      .catch((err: unknown) => {
        if (active) fail(err);
      });
    return () => {
      active = false;
    };
  }, [load, modelCount, fail]);

  const toggle = async (enabled: boolean) => {
    setSwitching(true);
    setError(null);
    try {
      setSettings(await update({ enabled }));
    } catch (err) {
      fail(err);
    } finally {
      setSwitching(false);
    }
  };
  return { settings, setSettings, switching, error, setError, toggle };
}

/** What the AIs are used for, each as a tile: click it for its settings, switch it on or off underneath. */
export default function AiFeaturesSection({ connections, onUnauthorized, openStudio }: Props) {
  const { t } = useTranslation("app");
  const modelCount = connections?.length;
  const { running: categorizing } = useAiRun();
  const { running: improving } = useAiDescriptionRun();
  const categorization = useFeature(
    settingsApi.getAiCategorization,
    settingsApi.updateAiCategorization,
    modelCount,
    onUnauthorized,
    t("adminSettings.aiCategorization.failed"),
  );
  const descriptions = useFeature(
    aiDescriptionsApi.getSettings,
    aiDescriptionsApi.updateSettings,
    modelCount,
    onUnauthorized,
    t("adminSettings.aiDescriptions.failed"),
  );
  const studioOn = useStudioEnabled() === true;
  const studio = useFeature(
    settingsApi.getStudioAssistant,
    settingsApi.updateStudioAssistant,
    modelCount,
    onUnauthorized,
    t("adminSettings.studioAssistant.failed"),
  );
  // Which dialog is open, and on which section.
  const [open, setOpen] = useState<{
    feature: "categorization" | "descriptions" | "studio";
    section: FeatureSection;
  } | null>(() => (openStudio ? { feature: "studio", section: "settings" } : null));

  const hasModel = Boolean(connections?.length);
  // The AI a feature would use: the one it's set to while that exists, otherwise the default, as the backend picks.
  const modelFor = (id: string | null | undefined) =>
    connections?.find((connection) => connection.id === id) ?? connections?.find((connection) => connection.is_default);
  // Without a model nothing can run, whatever was saved, and there's nothing to switch on until one is added.
  const categorizationOn = Boolean(categorization.settings?.enabled) && hasModel;
  const descriptionsOn = Boolean(descriptions.settings?.enabled) && hasModel;
  const studioAssistantOn = Boolean(studio.settings?.enabled) && hasModel;
  const loading = connections === null || (!categorization.settings && !categorization.error);
  const errors = [
    { key: "categorization", ...categorization },
    { key: "descriptions", ...descriptions },
    { key: "studio", ...studio },
  ].filter((feature) => feature.error);

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.aiFeatures.heading")} subtitle={t("adminSettings.aiFeatures.subtitle")} />
      {loading ? (
        <CircularProgress size={20} />
      ) : (
        <Box>
          <Box sx={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${FEATURE_TILE + 104}px)`, gap: 2 }}>
            <FeatureTile
              label={t("adminSettings.aiFeatures.categorization")}
              description={t("adminSettings.aiFeatures.categorizationDescription")}
              Animation={CategorizationAnimation}
              enabled={categorizationOn}
              hasModel={hasModel}
              model={modelFor(categorization.settings?.ai_connection_id)}
              ready={Boolean(categorization.settings)}
              switching={categorization.switching}
              running={categorizing}
              onToggle={(enabled) => void categorization.toggle(enabled)}
              onOpen={(section) => setOpen({ feature: "categorization", section })}
            />
            <FeatureTile
              label={t("adminSettings.aiFeatures.descriptions")}
              description={t("adminSettings.aiFeatures.descriptionsDescription")}
              Animation={DescriptionAnimation}
              enabled={descriptionsOn}
              hasModel={hasModel}
              model={modelFor(descriptions.settings?.ai_connection_id)}
              ready={Boolean(descriptions.settings)}
              switching={descriptions.switching}
              running={improving}
              onToggle={(enabled) => void descriptions.toggle(enabled)}
              onOpen={(section) => setOpen({ feature: "descriptions", section })}
            />
            {studioOn && (
              <FeatureTile
                label={t("adminSettings.aiFeatures.studio")}
                description={t("adminSettings.aiFeatures.studioDescription")}
                Animation={StudioAssistantAnimation}
                enabled={studioAssistantOn}
                hasModel={hasModel}
                // Only an AI it offers: none until an admin picks some, rather than the instance's default.
                model={connections?.find((connection) => connection.id === studio.settings?.default_ai_connection_id)}
                ready={Boolean(studio.settings)}
                switching={studio.switching}
                running={false}
                manage={false}
                onToggle={(enabled) => void studio.toggle(enabled)}
                onOpen={() => setOpen({ feature: "studio", section: "settings" })}
              />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            {t("adminSettings.aiFeatures.hint")}
          </Typography>
        </Box>
      )}
      {errors.map((feature) => (
        <Alert key={feature.key} severity="error" onClose={() => feature.setError(null)}>
          {feature.error}
        </Alert>
      ))}
      {open?.feature === "categorization" && categorization.settings && (
        <AiCategorizationDialog
          settings={categorization.settings}
          active={categorizationOn}
          connections={connections ?? []}
          initialSection={open.section}
          onClose={() => setOpen(null)}
          onSaved={categorization.setSettings}
          onUnauthorized={onUnauthorized}
        />
      )}
      {open?.feature === "studio" && studio.settings && (
        <StudioAssistantDialog
          settings={studio.settings}
          connections={connections ?? []}
          onClose={() => setOpen(null)}
          onSaved={studio.setSettings}
          onUnauthorized={onUnauthorized}
        />
      )}
      {open?.feature === "descriptions" && descriptions.settings && (
        <AiDescriptionsDialog
          settings={descriptions.settings}
          active={descriptionsOn}
          connections={connections ?? []}
          initialSection={open.section}
          onClose={() => setOpen(null)}
          onSaved={descriptions.setSettings}
          onUnauthorized={onUnauthorized}
        />
      )}
    </Stack>
  );
}
