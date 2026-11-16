import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useConfirm } from "../ConfirmProvider";
import { useToast } from "../ToastProvider";
import CollectionPickerDialog from "./CollectionPickerDialog";
import ToolShareDialog from "./ToolShareDialog";
import type { SdkAudience } from "../../sdk/types";
import { sdkTheme, setThemeVariables } from "../../sdk/theme";
import {
  buildToolSdk,
  PLACE_EXPORTS,
  type ModelPagePlace,
  type RunnableTool,
  type ToolCollection,
  type ToolContext,
  type ToolTheme,
} from "./toolSdk";
import { loadToolModule } from "./toolModule";
import { useModelPageTools } from "./modelPageTools";
import { useAskQueue } from "./useAskQueue";
import { scriptToast } from "../../sdk/toast";
import { SUPPORTED_LANGUAGES, matchLanguage } from "../../constants/languages";

type Props = {
  tool: RunnableTool;
  /** What it was opened on, where it was opened from something rather than from the Tools page. */
  context?: ToolContext;
  /** A part of a model's page rather than the window: drawn by that place's export, into an empty element, as tall as
   *  what the tool draws. */
  place?: ModelPagePlace;
  /** Closes the window it runs in; the tool's `thingport.close()`. */
  onClose: () => void;
  onUnauthorized?: () => void;
};

type ShownPopover = {
  id: number;
  anchor: Element;
  draw: (root: HTMLElement) => void | (() => void);
  placement: "bottom" | "top" | "left" | "right";
  width: number;
};

const ORIGINS = {
  bottom: [
    { vertical: "bottom", horizontal: "left" },
    { vertical: "top", horizontal: "left" },
  ],
  top: [
    { vertical: "top", horizontal: "left" },
    { vertical: "bottom", horizontal: "left" },
  ],
  left: [
    { vertical: "center", horizontal: "left" },
    { vertical: "center", horizontal: "right" },
  ],
  right: [
    { vertical: "center", horizontal: "right" },
    { vertical: "center", horizontal: "left" },
  ],
} as const;

/**
 * Runs a tool's script, as a custom widget runs in its panel: in its window, its HTML goes in and its default export is
 * called with `thingport` (toolSdk.ts); in a part of a model's page, that place's export is called with an empty
 * element. What it returns is called as its cleanup when the window closes or the part goes, the theme, the language,
 * the picked file or the script changes.
 */
export default function ToolRunner({ tool, context, place, onClose, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation("app");
  const muiTheme = useTheme();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const picks = useAskQueue<{ title?: string }, ToolCollection | null>();
  const shares = useAskQueue<object, SdkAudience | null>();
  const page = useModelPageTools();
  // The one popover the tool has open, kept while it closes so it can fade out.
  const [popover, setPopover] = useState<ShownPopover | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popovers = useRef(0);
  const shownPopover = useRef<number | null>(null);
  const popoverCleanup = useRef<(() => void) | null>(null);
  const rootId = `tp-tool-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const theme: ToolTheme = sdkTheme(muiTheme);
  const themeKey = JSON.stringify(theme);
  const contextKey = JSON.stringify(context ?? {});
  // The language a tool is handed, matched to one Thingport has; changing it runs the tool again, as the theme does.
  const language = matchLanguage(i18n.language);
  // Read through refs, so the script isn't run again when the window's own callbacks change.
  const latest = useRef({ onClose, navigate, toast, confirm, t, page });
  useEffect(() => {
    latest.current = { onClose, navigate, toast, confirm, t, page };
  });

  const closePopover = useCallback((id?: number) => {
    if (shownPopover.current === null || (id !== undefined && shownPopover.current !== id)) return;
    shownPopover.current = null;
    setPopoverOpen(false);
    try {
      popoverCleanup.current?.();
    } catch {
      // A tool's own cleanup failing mustn't keep the popover open.
    }
    popoverCleanup.current = null;
  }, []);

  // The tool draws into the popover once its element is there, the theme on it as on the tool's own root.
  const drawPopover = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !popover || node.dataset.drawn === String(popover.id)) return;
      node.dataset.drawn = String(popover.id);
      node.innerHTML = "";
      setThemeVariables(node, JSON.parse(themeKey) as ToolTheme);
      try {
        const out = popover.draw(node);
        popoverCleanup.current = typeof out === "function" ? out : null;
      } catch (err) {
        node.textContent = err instanceof Error ? err.message : String(err);
      }
    },
    [popover, themeKey],
  );

  useEffect(() => {
    const frame = rootRef.current;
    if (!frame) return;
    // Each run draws into an element of its own, so one that's stopped, as for another picked file, and finishes late
    // draws into nothing on the page rather than over the run after it.
    const root = document.createElement("div");
    root.id = rootId;
    if (!place) root.style.height = "100%";
    frame.replaceChildren(root);
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    // This run's questions, dropped when it stops so the next run's don't wait behind them.
    const asks = picks.session();
    const shareAsks = shares.session();
    const listeners = new Set<(size: { width: number; height: number }) => void>();
    const measure = () => ({ width: Math.round(frame.offsetWidth), height: Math.round(frame.offsetHeight) });
    let size = measure();
    const observer = new ResizeObserver(() => {
      size = measure();
      listeners.forEach((listener) => listener(size));
    });
    observer.observe(frame);

    setError(null);
    // The theme as CSS variables on the window itself, before the tool's HTML goes in, so a tool's stylesheet can
    // use `var(--tp-accent)` without copying the theme across in script first. Copying it by hand is where a tool
    // picks the wrong colour for text on the accent — the paper colour is white in the light theme and dark in the
    // dark one, while what reads on an accent is its own contrast colour.
    setThemeVariables(root, theme);
    // A part of a page has no HTML of the tool's: it draws all of it.
    root.innerHTML = place ? "" : (tool.html ?? "");
    const openModel = (id: string) => {
      latest.current.onClose();
      latest.current.navigate(`/models/${encodeURIComponent(id)}`);
    };
    const thingport = buildToolSdk({
      tool,
      context: place ? { ...context, place } : context,
      root,
      selector: `#${rootId}`,
      theme: JSON.parse(themeKey) as ToolTheme,
      language,
      languages: SUPPORTED_LANGUAGES,
      size: () => size,
      onResize: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      ui: {
        toast: (message, severity = "info", options) =>
          latest.current.toast(
            scriptToast(message, severity, options, { label: latest.current.t("common:open"), openModel }),
          ),
        confirm: async (options) =>
          (await latest.current.confirm({
            title: options.title,
            message: options.message,
            confirmLabel: options.confirmLabel,
            destructive: options.destructive,
          })) === true,
        pickCollection: (options) => asks.ask({ title: options?.title }),
        openModel,
        // A part of a page isn't the tool's to close.
        close: () => (place ? undefined : latest.current.onClose()),
        popover: (anchor, draw, options) => {
          const id = ++popovers.current;
          closePopover();
          shownPopover.current = id;
          setPopover({
            id,
            anchor,
            draw,
            placement: options?.placement ?? "bottom",
            width: Math.min(Math.max(options?.width ?? 320, 160), 640),
          });
          setPopoverOpen(true);
          return { close: () => closePopover(id) };
        },
        showTab: () => {
          if (tool.id && tool.manifest.modelPage?.tab) latest.current.page?.showTab(tool.id);
        },
        selectFile: (fileId) => latest.current.page?.selectFile(fileId),
        openWindow: () => latest.current.page?.openWindow(tool),
      },
      pickAudience: () => shareAsks.ask({}),
    });

    void (async () => {
      try {
        const module = await loadToolModule(tool);
        if (cancelled) return;
        const name = place ? PLACE_EXPORTS[place] : "default";
        const draw = module[name];
        if (typeof draw !== "function")
          throw new Error(
            place ? latest.current.t("tools.runner.noPartExport", { name }) : latest.current.t("tools.runner.noExport"),
          );
        const returned = await draw(thingport);
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
      asks.end();
      shareAsks.end();
      closePopover();
      observer.disconnect();
      listeners.clear();
      try {
        cleanup?.();
      } catch {
        // A tool's own cleanup failing mustn't stop the next run.
      }
      root.remove();
    };
    // The tool runs again when its code, the theme, the language or what it's on changes; the objects themselves are
    // rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.sha, tool.id, themeKey, language, rootId, contextKey, place]);

  const [anchorOrigin, transformOrigin] = ORIGINS[popover?.placement ?? "bottom"];
  const popoverElement = popover && (
    <Popover
      open={popoverOpen}
      anchorEl={popover.anchor}
      onClose={() => closePopover(popover.id)}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      slotProps={{
        paper: { sx: { width: popover.width, maxWidth: "calc(100vw - 32px)", mt: 0.5, borderRadius: 2 } },
        transition: { onExited: () => setPopover((shown) => (shown?.id === popover.id ? null : shown)) },
      }}
    >
      <Box key={popover.id} ref={drawPopover} />
    </Popover>
  );

  if (place) {
    return (
      <>
        <Box ref={rootRef} data-tool-frame hidden={Boolean(error)} />
        {error && (
          <Typography
            variant="caption"
            role="alert"
            title={error}
            sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "error.main" }}
          >
            <ErrorOutlineIcon sx={{ fontSize: 16 }} />
            {t("tools.runner.partFailed", { name: tool.manifest.name })}
          </Typography>
        )}
        {popoverElement}
        <CollectionPickerDialog
          key={picks.shown?.id ?? 0}
          open={picks.open}
          title={picks.shown?.title}
          onUnauthorized={onUnauthorized}
          onClose={picks.answer}
        />
        <ToolShareDialog
          key={`share-${shares.shown?.id ?? 0}`}
          open={shares.open}
          tool={tool.id ? { id: tool.id, name: tool.manifest.name } : null}
          onUnauthorized={onUnauthorized}
          onClose={shares.answer}
        />
      </>
    );
  }

  return (
    <Box sx={{ position: "relative", height: "100%", minHeight: 0 }}>
      <Box ref={rootRef} data-tool-frame sx={{ height: "100%", overflow: "auto" }} />
      {popoverElement}
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
        key={picks.shown?.id ?? 0}
        open={picks.open}
        title={picks.shown?.title}
        onUnauthorized={onUnauthorized}
        onClose={picks.answer}
      />
      <ToolShareDialog
        key={`share-${shares.shown?.id ?? 0}`}
        open={shares.open}
        tool={tool.id ? { id: tool.id, name: tool.manifest.name } : null}
        onUnauthorized={onUnauthorized}
        onClose={shares.answer}
      />
    </Box>
  );
}
