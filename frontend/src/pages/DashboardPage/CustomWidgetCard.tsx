import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { apiBase } from "../../api/client";
import { headerRecord, widgetsApi, type CustomWidget } from "../../api/widgets";
import { authHeaders } from "../../utils/auth";
import { GRID_GAP, ROW_HEIGHT } from "./templates";
import DashboardCard from "./DashboardCard";
import type { ResolvedSettings } from "./widgets";

type Size = { width: number; height: number; cols: number; rows: number };
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

/** A custom widget's icon: an image address, or an emoji or a few letters as text. */
export function WidgetIcon({ icon, size = 20 }: { icon?: string; size?: number }) {
  if (!icon) return <ExtensionOutlinedIcon sx={{ fontSize: size }} />;
  if (/^(https:|data:image\/)/i.test(icon))
    return <Box component="img" src={icon} alt="" sx={{ width: size, height: size, objectFit: "contain" }} />;
  return (
    <Box component="span" aria-hidden sx={{ fontSize: size * 0.9, lineHeight: 1, width: size, textAlign: "center" }}>
      {icon}
    </Box>
  );
}

type Props = {
  widget: CustomWidget;
  instanceId: string;
  settings: ResolvedSettings;
};

/**
 * Runs a custom widget's script in its panel. The script's default export gets a `thingport` object: the element to
 * draw into, its size (and a way to hear when it changes), the panel's settings, the theme, and `fetch` through the
 * server to the hosts the widget declares. It runs again when the settings or the theme change, after its cleanup.
 */
export default function CustomWidgetCard({ widget, instanceId, settings }: Props) {
  const { t } = useTranslation("app");
  const muiTheme = useTheme();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Unique on the page, and a valid CSS id, so a widget can scope its styles to `selector`.
  const rootId = `tp-widget-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const settingsKey = JSON.stringify(settings);
  const theme = {
    mode: muiTheme.palette.mode,
    primary: muiTheme.palette.primary.main,
    background: muiTheme.thingport.pageBackground,
    paper: muiTheme.palette.background.paper,
    text: muiTheme.palette.text.primary,
    textSecondary: muiTheme.palette.text.secondary,
    divider: muiTheme.palette.divider,
    fontFamily: String(muiTheme.typography.fontFamily),
  };
  const themeKey = JSON.stringify(theme);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const listeners = new Set<(size: Size) => void>();
    const measure = (): Size => {
      const { width, height } = root.getBoundingClientRect();
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
    root.innerHTML = widget.html ?? "";
    const thingport = {
      root,
      selector: `#${rootId}`,
      get size() {
        return size;
      },
      onResize(listener: (next: Size) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      settings: JSON.parse(settingsKey) as ResolvedSettings,
      theme: JSON.parse(themeKey) as typeof theme,
      fetch: (url: string, init?: RequestInit) => widgetsApi.fetchVia(widget.id, url, init),
      api: (path: string, init: RequestInit = {}) =>
        fetch(`${apiBase()}${path.startsWith("/") ? path : `/${path}`}`, {
          ...init,
          headers: { ...authHeaders(), ...headerRecord(init.headers) },
        }),
      widgetId: widget.id,
      instanceId,
    };

    void (async () => {
      try {
        const module = await loadModule(widget);
        if (cancelled) return;
        if (typeof module.default !== "function") throw new Error(t("dashboard.custom.noExport"));
        const returned = await module.default(thingport);
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
    // The widget redraws when its code, settings or the theme change; the objects themselves are rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.sha, widget.id, instanceId, settingsKey, themeKey, rootId]);

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
