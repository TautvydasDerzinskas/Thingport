import React from "react";
import { useTranslation } from "react-i18next";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../../api/client";
import { settingsApi, type CardPreview } from "../../../api/settings";
import { matchLanguage, SUPPORTED_LANGUAGES } from "../../../constants/languages";
import {
  ACCENT_COLORS,
  DEFAULT_ACCENT,
  RENDER_COLORS,
  renderColorLabelKey,
  type AccentColor,
  type RenderColor,
  type ThemeSelection,
} from "../../../constants/settingsOptions";
import {
  getCachedRenderColor,
  setCachedAccentColor,
  setCachedRenderColor,
  useAccentColor,
  useRenderColor,
} from "../../../hooks/useAccentColor";
import { setCachedAuthorPreviewEnabled, useAuthorPreviewEnabled } from "../../../hooks/useAuthorPreviewEnabled";
import { useCardPreview } from "../../../hooks/useCardPreview";
import { useHoverSlideshowEnabled } from "../../../hooks/useHoverSlideshowEnabled";
import { accentSwatch, renderSwatch } from "../../../theme";
import { useConfirm } from "../../ConfirmProvider";
import ColorSwatches from "../../controls/ColorSwatches";
import Segmented from "../../controls/Segmented";
import HelpTip from "../../HelpTip";
import { PanelHeader, SectionLabel } from "./parts";

const THEMES: ThemeSelection[] = ["light", "dark", "system"];
const DEFAULT_THEME: ThemeSelection = "system";
const DEFAULT_CARD_PREVIEW: CardPreview = "images";
// More languages than this no longer fit a segmented control comfortably.
const MAX_SEGMENTED_LANGUAGES = 4;

type Props = {
  theme: ThemeSelection;
  onThemeChange: (theme: ThemeSelection) => Promise<boolean>;
  onUnauthorized?: () => void;
};

/** Language, theme, accent, render colour, model card pictures and hover slideshow, and author preview, each applied as it's changed. */
export default function AppearancePanel({ theme, onThemeChange, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation("app");
  const authorPreview = useAuthorPreviewEnabled();
  const [authorPreviewError, setAuthorPreviewError] = React.useState<string | null>(null);
  const language = matchLanguage(i18n.resolvedLanguage ?? i18n.language);
  const accent = useAccentColor();
  const [cardPreview, setCardPreview] = useCardPreview();
  const [accentError, setAccentError] = React.useState<string | null>(null);
  const renderColor = useRenderColor();
  const [renderColorError, setRenderColorError] = React.useState<string | null>(null);
  // Picks can overlap; only the latest one's failure may put the accent, or the render colour, back.
  const latestAccentSave = React.useRef(0);
  const latestRenderColorSave = React.useRef(0);
  // Accent and render colour saves go one at a time and in order, as a new accent clears the render colour on the
  // server: one sent first but answered later would otherwise undo a newer pick.
  const themeSaves = React.useRef<Promise<unknown>>(Promise.resolve());
  const queueThemeSave = (patch: Parameters<typeof settingsApi.updateTheme>[0]) => {
    const request = themeSaves.current.then(() => settingsApi.updateTheme(patch));
    themeSaves.current = request.catch(() => undefined);
    return request;
  };
  const [themeError, setThemeError] = React.useState<string | null>(null);
  const [cardPreviewError, setCardPreviewError] = React.useState<string | null>(null);
  const [hoverSlideshow, setHoverSlideshow] = useHoverSlideshowEnabled();
  const [hoverSlideshowError, setHoverSlideshowError] = React.useState<string | null>(null);
  const confirm = useConfirm();

  const changeTheme = async (next: ThemeSelection) => {
    setThemeError(null);
    // A lapsed session also signs out, where the theme lives.
    if (!(await onThemeChange(next))) setThemeError(t("appearance.themeFailed"));
  };

  const changeCardPreview = async (next: CardPreview) => {
    setCardPreviewError(null);
    try {
      await setCardPreview(next);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setCardPreviewError(t("appearance.cardPreview.failed"));
    }
  };

  const changeAccent = async (next: AccentColor) => {
    const previous = accent;
    const previousRender = getCachedRenderColor();
    const save = ++latestAccentSave.current;
    const renderSave = latestRenderColorSave.current;
    setAccentError(null);
    // The whole app recolours straight away, renders included, as the server puts the render colour back to
    // following the accent; put both back if the save fails.
    setCachedAccentColor(next);
    setCachedRenderColor(null);
    try {
      await queueThemeSave({ accent: next });
    } catch (err) {
      if (save !== latestAccentSave.current) return;
      setCachedAccentColor(previous);
      // A render colour picked since is newer than the one this save cleared.
      if (renderSave === latestRenderColorSave.current) setCachedRenderColor(previousRender);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setAccentError(t("appearance.accentFailed"));
    }
  };

  const changeRenderColor = async (next: RenderColor) => {
    const previous = getCachedRenderColor();
    const save = ++latestRenderColorSave.current;
    setRenderColorError(null);
    setCachedRenderColor(next);
    try {
      await queueThemeSave({ renderColor: next });
    } catch (err) {
      if (save !== latestRenderColorSave.current) return;
      setCachedRenderColor(previous);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setRenderColorError(t("appearance.renderColor.failed"));
    }
  };

  const toggleHoverSlideshow = async (enabled: boolean) => {
    setHoverSlideshowError(null);
    try {
      await setHoverSlideshow(enabled);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setHoverSlideshowError(t("appearance.hoverSlideshow.failed"));
    }
  };

  const toggleAuthorPreview = async (enabled: boolean) => {
    setAuthorPreviewError(null);
    // Shown straight away; put back if the save fails.
    setCachedAuthorPreviewEnabled(enabled);
    try {
      const res = await settingsApi.updateAuthorPreview(enabled);
      setCachedAuthorPreviewEnabled(res.enabled);
    } catch (err) {
      setCachedAuthorPreviewEnabled(!enabled);
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setAuthorPreviewError(t("profile.authorPreview.failed"));
    }
  };

  // Language is left alone: it's the one choice a reset could leave someone unable to read.
  const accentAtDefault = accent === DEFAULT_ACCENT && getCachedRenderColor() === null;
  const atDefaults =
    theme === DEFAULT_THEME &&
    accentAtDefault &&
    (cardPreview ?? DEFAULT_CARD_PREVIEW) === DEFAULT_CARD_PREVIEW &&
    hoverSlideshow &&
    authorPreview;

  const resetToDefaults = async () => {
    const confirmed = await confirm({
      title: t("appearance.reset.title"),
      message: t("appearance.reset.message"),
      confirmLabel: t("appearance.reset.action"),
    });
    if (!confirmed) return;
    // Only what differs is saved; each keeps its own error message if its save fails.
    if (theme !== DEFAULT_THEME) void changeTheme(DEFAULT_THEME);
    // A new accent puts the render colour back to following it.
    if (!accentAtDefault) void changeAccent(DEFAULT_ACCENT);
    if (cardPreview !== null && cardPreview !== DEFAULT_CARD_PREVIEW) void changeCardPreview(DEFAULT_CARD_PREVIEW);
    if (!hoverSlideshow) void toggleHoverSlideshow(true);
    if (!authorPreview) void toggleAuthorPreview(true);
  };

  return (
    <>
      <PanelHeader
        title={t("appearance.title")}
        subtitle={t("appearance.subtitle")}
        action={
          <Button
            size="small"
            disabled={atDefaults}
            startIcon={<RestartAltIcon fontSize="small" />}
            onClick={() => void resetToDefaults()}
          >
            {t("appearance.reset.action")}
          </Button>
        }
      />
      <Stack spacing={2.5}>
        <div>
          <SectionLabel>{t("profile.language.heading")}</SectionLabel>
          {SUPPORTED_LANGUAGES.length > MAX_SEGMENTED_LANGUAGES ? (
            <Select
              size="small"
              value={language}
              onChange={(e) => void i18n.changeLanguage(e.target.value)}
              inputProps={{ "aria-label": t("profile.language.heading") }}
              sx={{ minWidth: 200 }}
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <MenuItem key={lang.code} value={lang.code} lang={lang.code}>
                  {lang.label}
                </MenuItem>
              ))}
            </Select>
          ) : (
            <Segmented
              label={t("profile.language.heading")}
              value={language}
              onChange={(code) => void i18n.changeLanguage(code)}
              options={SUPPORTED_LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))}
            />
          )}
        </div>
        <div>
          <SectionLabel>{t("userMenu.theme")}</SectionLabel>
          <Segmented
            label={t("userMenu.theme")}
            value={theme}
            onChange={(next) => void changeTheme(next)}
            options={THEMES.map((value) => ({ value, label: t(`appearance.themes.${value}`) }))}
          />
          {themeError && (
            <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
              {themeError}
            </Typography>
          )}
        </div>
        <div>
          <SectionLabel>{t("appearance.accent")}</SectionLabel>
          <ColorSwatches
            label={t("appearance.accent")}
            value={accent}
            onChange={(next) => void changeAccent(next)}
            options={ACCENT_COLORS.map((value) => {
              const { color, contrast } = accentSwatch(value);
              return { value, label: t(`appearance.accents.${value}`), color, contrast };
            })}
          />
          {accentError && (
            <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
              {accentError}
            </Typography>
          )}
        </div>
        <div>
          <SectionLabel>
            {t("appearance.renderColor.heading")}
            <HelpTip text={t("appearance.renderColor.help")} />
          </SectionLabel>
          <ColorSwatches
            label={t("appearance.renderColor.heading")}
            value={renderColor}
            onChange={(next) => void changeRenderColor(next)}
            options={RENDER_COLORS.map((value) => {
              const { color, contrast } = renderSwatch(value);
              return { value, label: t(renderColorLabelKey(value)), color, contrast };
            })}
          />
          {renderColorError && (
            <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
              {renderColorError}
            </Typography>
          )}
        </div>
        <div>
          <SectionLabel>
            {t("appearance.cardPreview.heading")}
            <HelpTip text={t("appearance.cardPreview.help")} />
          </SectionLabel>
          <Segmented
            label={t("appearance.cardPreview.heading")}
            value={cardPreview ?? "images"}
            disabled={cardPreview === null}
            onChange={(next) => void changeCardPreview(next)}
            options={[
              { value: "images", label: t("appearance.cardPreview.images") },
              { value: "renders", label: t("appearance.cardPreview.renders") },
            ]}
          />
          {cardPreviewError && (
            <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
              {cardPreviewError}
            </Typography>
          )}
        </div>
        <div>
          <SectionLabel>
            {t("appearance.hoverSlideshow.heading")}
            <HelpTip text={t("appearance.hoverSlideshow.help")} />
          </SectionLabel>
          <Segmented
            label={t("appearance.hoverSlideshow.heading")}
            value={hoverSlideshow ? "on" : "off"}
            onChange={(value) => void toggleHoverSlideshow(value === "on")}
            options={[
              { value: "on", label: t("appearance.on") },
              { value: "off", label: t("appearance.off") },
            ]}
          />
          {hoverSlideshowError && (
            <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
              {hoverSlideshowError}
            </Typography>
          )}
        </div>
        <div>
          <SectionLabel>
            {t("profile.authorPreview.heading")}
            <HelpTip text={t("profile.authorPreview.help")} />
          </SectionLabel>
          <Segmented
            label={t("profile.authorPreview.heading")}
            value={authorPreview ? "on" : "off"}
            onChange={(value) => void toggleAuthorPreview(value === "on")}
            options={[
              { value: "on", label: t("appearance.on") },
              { value: "off", label: t("appearance.off") },
            ]}
          />
          {authorPreviewError && (
            <Typography variant="caption" color="error" sx={{ display: "block", mt: 1 }}>
              {authorPreviewError}
            </Typography>
          )}
        </div>
      </Stack>
    </>
  );
}
