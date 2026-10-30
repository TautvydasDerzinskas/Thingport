import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import type { CustomWidget } from "../../api/widgets";
import { SUPPORTED_LANGUAGES, matchLanguage } from "../../constants/languages";
import { buildWidgetSdk, type WidgetSize } from "../../sdk/widgetSdk";
import { sdkTheme, setThemeVariables } from "../../sdk/theme";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import { useIconSrc } from "../../components/IconPicker/iconCatalog";
import { GRID_GAP, ROW_HEIGHT } from "./templates";
import DashboardCard from "./DashboardCard";
import type { ResolvedSettings } from "./widgets";

type Mount = (thingport: Record<string, unknown>) => unknown;

// One module per version of a widget's script, shared by every panel showing it.
const modules = new Map<string, Promise<{ default?: Mount }>>();

function loadModule(widget: CustomWidget): Promise<{ default?: Mount }> {
  let loaded = modules.get(widget.sha);
  if (!loaded) {
    const url = URL.createObjectURL(new Blob([widget.script], { type: "text/javascript" }));
    loaded = import(/* @vite-ignore */ url);
    modules.set(widget.sha, loaded);
    // A script that fails to load is tried afresh next time.
    loaded.catch(() => modules.delete(widget.sha)).finally(() => URL.revokeObjectURL(url));
  }
  return loaded;
}

/** A custom widget's icon: its picked icon or image address, else, or when it doesn't load, a jigsaw piece. */
export function WidgetIcon({ iconUrl: picked, size = 20 }: { iconUrl?: string; size?: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const iconUrl = useIconSrc(picked);
  if (iconUrl && broken !== iconUrl)
    return (
      <Box
        component="img"
        src={iconUrl}
        alt=""
        onError={() => setBroken(iconUrl)}
        sx={{ width: size, height: size, objectFit: "contain" }}
      />
    );
  return <ExtensionOutlinedIcon sx={{ fontSize: size }} />;
}

type Props = {
  widget: CustomWidget;
  instanceId: string;
  settings: ResolvedSettings;
};

/**
 * Runs a custom widget's script in its panel. The script's default export gets the `thingport` object from
 * `sdk/widgetSdk.ts` — the element to draw into, its size, the panel's settings, the theme, the widget's own words
 * in the user's language, the user's library and `fetch` through the server to the hosts the widget declares. It
 * runs again when the settings, the theme or the language change, after its cleanup.
 */
export default function CustomWidgetCard({ widget, instanceId, settings }: Props) {
  const { t, i18n } = useTranslation("app");
  const muiTheme = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Unique on the page, and a valid CSS id, so a widget can scope its styles to `selector`.
  const rootId = `tp-widget-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const settingsKey = JSON.stringify(settings);
  const theme = sdkTheme(muiTheme);
  const themeKey = JSON.stringify(theme);
  // The language a widget is handed, matched to one Thingport has; changing it draws it again, as the theme does.
  const language = matchLanguage(i18n.language);
  // Read through refs, so the script isn't run again when the dashboard's own callbacks change.
  const latest = useRef({ navigate, toast, confirm });
  useEffect(() => {
    latest.current = { navigate, toast, confirm };
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const listeners = new Set<(size: WidgetSize) => void>();
    const measure = (): WidgetSize => {
      // Its layout size, not its drawn one, which the editor's preview scales down.
      const width = root.offsetWidth;
      const height = root.offsetHeight;
      const colWidth = parseFloat(getComputedStyle(root).getPropertyValue("--tp-col-width")) || ROW_HEIGHT;
      return {
        width: Math.round(width),
        height: Math.round(height),
        cols: Math.max(1, Math.round((width + GRID_GAP) / (colWidth + GRID_GAP))),
        rows: Math.max(1, Math.round((height + GRID_GAP) / (ROW_HEIGHT + GRID_GAP))),
      };
    };
    let size = measure();
    const observer = new ResizeObserver(() => {
      size = measure();
      listeners.forEach((listener) => listener(size));
    });
    observer.observe(root);

    setError(null);
    // The theme as CSS variables on the panel itself, before the widget's HTML goes in, so a widget's stylesheet
    // can use `var(--tp-accent)` without copying the theme across in script first.
    setThemeVariables(root, JSON.parse(themeKey) as typeof theme);
    root.innerHTML = widget.html ?? "";
    const thingport = buildWidgetSdk({
      widget,
      instanceId,
      root,
      selector: `#${rootId}`,
      settings: JSON.parse(settingsKey) as ResolvedSettings,
      theme: JSON.parse(themeKey) as typeof theme,
      language,
      languages: SUPPORTED_LANGUAGES,
      size: () => size,
      onResize(listener: (next: WidgetSize) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      ui: {
        toast: (message, severity = "info") => latest.current.toast({ message: String(message), severity }),
        confirm: async (options) =>
          (await latest.current.confirm({
            title: options.title,
            message: options.message,
            confirmLabel: options.confirmLabel,
            destructive: options.destructive,
          })) === true,
        openModel: (id) => latest.current.navigate(`/models/${encodeURIComponent(id)}`),
      },
    });

    void (async () => {
      try {
        const module = await loadModule(widget);
        if (cancelled) return;
        if (typeof module.default !== "function") throw new Error(t("dashboard.custom.noExport"));
        const returned = await module.default(thingport as unknown as Record<string, unknown>);
        if (cancelled) {
          if (typeof returned === "function") returned();
          return;
        }
        if (typeof returned === "function") cleanup = returned as () => void;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      observer.disconnect();
      listeners.clear();
      try {
        cleanup?.();
      } catch {
        // A widget's own cleanup failing mustn't stop the next one from drawing.
      }
      root.innerHTML = "";
    };
    // The widget redraws when its code, settings, the theme or the language change; the objects themselves are
    // rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.sha, widget.id, instanceId, settingsKey, themeKey, language, rootId]);

  return (
    <DashboardCard scroll={false} sx={{ p: 0, position: "relative" }}>
      <Box id={rootId} ref={rootRef} sx={{ height: "100%", overflow: "auto" }} />
      {error && (
        <Box
          role="alert"
          sx={{
            position: "absolute",
            inset: 0,
            p: 2,
            display: "flex",
            flexDirection: "column",
            gap: 1,
            bgcolor: "background.paper",
            overflow: "auto",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "error.main" }}>
            <ErrorOutlineIcon fontSize="small" />
            <Typography variant="body2" fontWeight={600}>
              {t("dashboard.custom.failed", { name: widget.manifest.name })}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
            {error}
          </Typography>
        </Box>
      )}
    </DashboardCard>
  );
}

/** A panel whose custom widget isn't there: still loading, removed since, or turned off by an admin. */
export function MissingCustomWidget({ state }: { state: "loading" | "removed" | "off" }) {
  const { t } = useTranslation("app");
  return (
    <DashboardCard sx={{ p: 2, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      {state === "loading" ? null : (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, color: "text.secondary" }}>
          <ExtensionOutlinedIcon />
          <Typography variant="body2">{t(`dashboard.custom.${state}`)}</Typography>
        </Box>
      )}
    </DashboardCard>
  );
}
