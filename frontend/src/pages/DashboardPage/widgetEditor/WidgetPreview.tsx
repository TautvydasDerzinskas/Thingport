import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { alpha, keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ReplayIcon from "@mui/icons-material/Replay";
import type { CustomWidget, WidgetLocales, WidgetManifest } from "../../../api/widgets";
import Segmented from "../../../components/controls/Segmented";
import HelpTip from "../../../components/HelpTip";
import CustomWidgetCard from "../CustomWidgetCard";
import { GRID_GAP, ROW_HEIGHT } from "../templates";
import { customDefaults } from "../widgets";

// A ring of cells around the panel, so it reads as one panel on the dashboard.
const RING = 1;
// A wide dashboard's column, when there's none on the page to measure.
const FALLBACK_COL_WIDTH = 86;
// Waits for a pause in typing before running the script again.
const DEBOUNCE_MS = 450;

const appear = keyframes`from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: none; }`;

/** The dashboard's column width, so the preview is the size the panel will be. */
function dashboardColWidth(): number {
  const grid = document.querySelector<HTMLElement>("[style*='--tp-col-width']");
  const width = grid ? parseFloat(grid.style.getPropertyValue("--tp-col-width")) : NaN;
  return Number.isFinite(width) && width > 0 ? width : FALLBACK_COL_WIDTH;
}

// A cheap fingerprint of the code, so a module runs again only when the code has changed.
function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

type Props = {
  manifest: WidgetManifest;
  script: string;
  html: string;
  /** Its words by language, so the preview shows them in the user's language as the dashboard will. */
  locales: WidgetLocales;
  /** The saved widget's id, so requests through Thingport use its declared hosts; null for one not saved yet. */
  widgetId: string | null;
};

/** The widget running in a stand-in for the dashboard's grid, at its minimum size or the size it's added at. */
export default function WidgetPreview({ manifest, script, html, locales, widgetId }: Props) {
  const { t } = useTranslation("app");
  const [sizing, setSizing] = useState<"min" | "default">("min");
  const [run, setRun] = useState(0);
  const [colWidth] = useState(dashboardColWidth);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState({ width: 0, height: 0 });

  // What the panel runs: the editor's text after a pause in typing.
  const [shown, setShown] = useState({ manifest, script, html, locales });
  useEffect(() => {
    const timer = window.setTimeout(() => setShown({ manifest, script, html, locales }), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [manifest, script, html, locales]);

  const widget = useMemo((): CustomWidget => {
    const sha = `draft-${fingerprint(`${shown.script}\0${shown.html}\0${JSON.stringify(shown.locales)}\0${run}`)}`;
    return {
      id: widgetId ?? "draft",
      source: "own",
      slug: "draft",
      manifest: shown.manifest,
      script: shown.script,
      html: shown.html.trim() ? shown.html : null,
      locales: shown.locales,
      sha,
      updatedAt: "",
    };
  }, [shown, widgetId, run]);
  const settings = useMemo(() => customDefaults(shown.manifest.settings), [shown.manifest.settings]);

  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setRoom({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { size } = manifest;
  const w = Math.max(1, sizing === "min" ? (size.minW ?? 1) : size.w);
  const h = Math.max(1, sizing === "min" ? (size.minH ?? 1) : size.h);
  const cols = w + RING * 2;
  const rows = h + RING * 2;
  const span = (cells: number, cell: number) => cells * cell + (cells - 1) * GRID_GAP;
  const stage = { width: span(cols, colWidth), height: span(rows, ROW_HEIGHT) };
  // Drawn at its real size, then scaled down to fit when it's bigger than the pane.
  const scale = room.width ? Math.min(1, room.width / stage.width, room.height / stage.height) : 1;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.25, flexShrink: 0 }}>
        <Typography variant="subtitle2" sx={{ color: (theme) => theme.thingport.headingText }}>
          {t("dashboard.custom.editor.preview")}
        </Typography>
        <HelpTip text={t("dashboard.custom.editor.previewHelp")} />
        <Box sx={{ flex: 1 }} />
        <Segmented
          label={t("dashboard.custom.editor.previewSize")}
          value={sizing}
          onChange={setSizing}
          options={[
            { value: "min", label: t("dashboard.custom.editor.previewMin", { w: size.minW ?? 1, h: size.minH ?? 1 }) },
            { value: "default", label: t("dashboard.custom.editor.previewDefault", { w: size.w, h: size.h }) },
          ]}
        />
        <Tooltip title={t("dashboard.custom.editor.rerun")}>
          <IconButton size="small" aria-label={t("dashboard.custom.editor.rerun")} onClick={() => setRun((n) => n + 1)}>
            <ReplayIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        ref={stageRef}
        sx={{ flex: 1, minHeight: 0, mx: 2, mb: 2, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <Box sx={{ width: stage.width * scale, height: stage.height * scale, position: "relative", flexShrink: 0 }}>
          <Box
            style={{ "--tp-col-width": `${colWidth}px` } as React.CSSProperties}
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              width: stage.width,
              height: stage.height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, ${colWidth}px)`,
              gridTemplateRows: `repeat(${rows}, ${ROW_HEIGHT}px)`,
              gap: `${GRID_GAP}px`,
            }}
          >
            {/* The neighbouring cells, fading out from the panel. */}
            {Array.from({ length: cols * rows }, (_, index) => {
              const col = index % cols;
              const row = Math.floor(index / cols);
              const inside = col >= RING && col < RING + w && row >= RING && row < RING + h;
              return inside ? null : (
                <Box
                  key={index}
                  aria-hidden
                  sx={{
                    gridColumn: col + 1,
                    gridRow: row + 1,
                    borderRadius: "12px",
                    border: 1,
                    borderStyle: "dashed",
                    borderColor: (theme) => alpha(theme.palette.text.primary, 0.12),
                    bgcolor: (theme) => alpha(theme.palette.text.primary, 0.025),
                  }}
                />
              );
            })}
            <Box
              key={`${widget.sha}-${w}x${h}`}
              sx={{
                gridColumn: `${RING + 1} / span ${w}`,
                gridRow: `${RING + 1} / span ${h}`,
                minWidth: 0,
                minHeight: 0,
                animation: `${appear} 200ms ease-out`,
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }}
            >
              <CustomWidgetCard widget={widget} instanceId="preview" settings={settings} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
