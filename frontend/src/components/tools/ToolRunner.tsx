import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useConfirm } from "../ConfirmProvider";
import { useToast } from "../ToastProvider";
import CollectionPickerDialog from "./CollectionPickerDialog";
import { buildToolSdk, type RunnableTool, type ToolCollection, type ToolTheme } from "./toolSdk";

type Mount = (thingport: Record<string, unknown>) => unknown;

// One module per version of a tool's script, shared by every window running it.
const modules = new Map<string, Promise<{ default?: Mount }>>();

function loadModule(tool: RunnableTool): Promise<{ default?: Mount }> {
  let loaded = modules.get(tool.sha);
  if (!loaded) {
    const url = URL.createObjectURL(new Blob([tool.script], { type: "text/javascript" }));
    loaded = import(/* @vite-ignore */ url);
    modules.set(tool.sha, loaded);
    // A script that fails to load is tried afresh next time.
    loaded.catch(() => modules.delete(tool.sha)).finally(() => URL.revokeObjectURL(url));
  }
  return loaded;
}

type Props = {
  tool: RunnableTool;
  /** Closes the window it runs in; the tool's `thingport.close()`. */
  onClose: () => void;
};

/**
 * Runs a tool's script in its window, as a custom widget runs in its panel: its HTML goes into the window, then its
 * default export is called with `thingport` (toolSdk.ts), and what it returns is called as its cleanup when the window
 * closes, the theme changes or the script does.
 */
export default function ToolRunner({ tool, onClose }: Props) {
  const { t } = useTranslation("app");
  const muiTheme = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ title?: string; resolve: (picked: ToolCollection | null) => void } | null>(
    null,
  );
  const rootId = `tp-tool-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const theme: ToolTheme = {
    mode: muiTheme.palette.mode,
    primary: muiTheme.palette.primary.main,
    primaryContrast: muiTheme.palette.primary.contrastText,
    background: muiTheme.thingport.pageBackground,
    paper: muiTheme.palette.background.paper,
    text: muiTheme.palette.text.primary,
    textSecondary: muiTheme.palette.text.secondary,
    divider: muiTheme.palette.divider,
    error: muiTheme.palette.error.main,
    warning: muiTheme.palette.warning.main,
    success: muiTheme.palette.success.main,
    fontFamily: String(muiTheme.typography.fontFamily),
  };
  const themeKey = JSON.stringify(theme);
  // Read through refs, so the script isn't run again when the window's own callbacks change.
  const latest = useRef({ onClose, navigate, toast, confirm, t });
  useEffect(() => {
    latest.current = { onClose, navigate, toast, confirm, t };
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const listeners = new Set<(size: { width: number; height: number }) => void>();
    const measure = () => ({ width: Math.round(root.offsetWidth), height: Math.round(root.offsetHeight) });
    let size = measure();
    const observer = new ResizeObserver(() => {
      size = measure();
      listeners.forEach((listener) => listener(size));
    });
    observer.observe(root);

    setError(null);
    // The theme as CSS variables on the window itself, before the tool's HTML goes in, so a tool's stylesheet can
    // use `var(--tp-accent)` without copying the theme across in script first. Copying it by hand is where a tool
    // picks the wrong colour for text on the accent — the paper colour is white in the light theme and dark in the
    // dark one, while what reads on an accent is its own contrast colour.
    for (const [name, value] of Object.entries({
      "--tp-accent": theme.primary,
      "--tp-accent-ink": theme.primaryContrast,
      "--tp-background": theme.background,
      "--tp-paper": theme.paper,
      "--tp-text": theme.text,
      "--tp-text-muted": theme.textSecondary,
      "--tp-divider": theme.divider,
      "--tp-error": theme.error,
      "--tp-warning": theme.warning,
      "--tp-success": theme.success,
      "--tp-font": theme.fontFamily,
    })) {
      root.style.setProperty(name, value);
    }
    root.innerHTML = tool.html ?? "";
    const thingport = buildToolSdk({
      tool,
      root,
      selector: `#${rootId}`,
      theme: JSON.parse(themeKey) as ToolTheme,
      size: () => size,
      onResize: (listener) => {
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
        pickCollection: (options) => new Promise((resolve) => setPicker({ title: options?.title, resolve })),
        openModel: (id) => {
          latest.current.onClose();
          latest.current.navigate(`/models/${encodeURIComponent(id)}`);
        },
        close: () => latest.current.onClose(),
      },
    });

    void (async () => {
      try {
        const module = await loadModule(tool);
        if (cancelled) return;
        if (typeof module.default !== "function") throw new Error(latest.current.t("tools.runner.noExport"));
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
        // A tool's own cleanup failing mustn't stop the next run.
      }
      root.innerHTML = "";
    };
    // The tool runs again when its code or the theme changes; the objects themselves are rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.sha, tool.id, themeKey, rootId]);

  return (
    <Box sx={{ position: "relative", height: "100%", minHeight: 0 }}>
      <Box id={rootId} ref={rootRef} sx={{ height: "100%", overflow: "auto" }} />
      {error && (
        <Box
          role="alert"
          sx={{
            position: "absolute",
            inset: 0,
            p: 2.5,
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
              {t("tools.runner.failed", { name: tool.manifest.name })}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
            {error}
          </Typography>
        </Box>
      )}
      <CollectionPickerDialog
        open={Boolean(picker)}
        title={picker?.title}
        onClose={(picked) => {
          picker?.resolve(picked);
          setPicker(null);
        }}
      />
    </Box>
  );
}
