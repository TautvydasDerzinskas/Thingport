import { useTranslation } from "react-i18next";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import GridOnIcon from "@mui/icons-material/GridOn";
import ThreeSixtyIcon from "@mui/icons-material/ThreeSixty";
import type { CameraView, RenderStyle } from "../../components/media/ModelViewer";

export const PREVIEW_COLORS = [
  { key: "red", value: "#d32f2f" },
  { key: "orange", value: "#f57c00" },
  { key: "yellow", value: "#fbc02d" },
  { key: "green", value: "#00b800" },
  { key: "blue", value: "#1976d2" },
  { key: "purple", value: "#7b1fa2" },
  { key: "grey", value: "#78909c" },
] as const;

export const DEFAULT_PREVIEW_COLOR = "#00b800";

const CAMERA_VIEWS: CameraView[] = ["top", "front", "side"];
const RENDER_STYLES: RenderStyle[] = ["solid", "wire", "xray"];

type Props = {
  cameraView: CameraView;
  onCameraView: (view: CameraView) => void;
  renderStyle: RenderStyle;
  onRenderStyleChange: (style: RenderStyle) => void;
  color: string;
  onColorChange: (color: string) => void;
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
  spin: boolean;
  onSpinChange: (spin: boolean) => void;
};

const sectionDivider = <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />;

/** Bottom overlay of the 3D preview modal: camera presets, render style, model color, and the
 *  grid/spin toggles. Stateless -- the modal owns every value and passes it to ModelViewer. */
export default function PreviewToolbar({
  cameraView,
  onCameraView,
  renderStyle,
  onRenderStyleChange,
  color,
  onColorChange,
  showGrid,
  onShowGridChange,
  spin,
  onSpinChange,
}: Props) {
  const { t } = useTranslation(["models"]);

  return (
    <Paper
      elevation={3}
      role="toolbar"
      aria-label={t("models:detail.previewToolbar.label") ?? undefined}
      sx={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2,
        maxWidth: "calc(100% - 32px)",
        overflowX: "auto",
        px: 1,
        py: 0.75,
        borderRadius: "12px",
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ width: "max-content" }}>
        {/* Re-clicking the selected preset yields null here -- still re-frame to it, since the
            camera may have been orbited away since. */}
        <ToggleButtonGroup
          size="small"
          exclusive
          value={cameraView}
          onChange={(_, value: CameraView | null) => onCameraView(value ?? cameraView)}
        >
          {CAMERA_VIEWS.map(view => (
            <ToggleButton key={view} value={view} sx={{ px: 1.25, py: 0.5, textTransform: "none" }}>
              {t(`models:detail.previewToolbar.${view}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {sectionDivider}

        <ToggleButtonGroup
          size="small"
          exclusive
          value={renderStyle}
          onChange={(_, value: RenderStyle | null) => value && onRenderStyleChange(value)}
        >
          {RENDER_STYLES.map(style => (
            <ToggleButton key={style} value={style} sx={{ px: 1.25, py: 0.5, textTransform: "none" }}>
              {t(`models:detail.previewToolbar.${style}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {sectionDivider}

        <Stack direction="row" spacing={0.75} sx={{ px: 0.5 }}>
          {PREVIEW_COLORS.map(({ key, value }) => {
            const name = t(`models:detail.previewToolbar.colors.${key}`);
            const selected = value === color;
            return (
              <Tooltip key={key} title={name}>
                <ButtonBase
                  aria-label={t("models:detail.previewToolbar.colorLabel", { name }) ?? undefined}
                  aria-pressed={selected}
                  onClick={() => onColorChange(value)}
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    bgcolor: value,
                    boxShadow: theme =>
                      selected
                        ? `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 4px ${theme.palette.text.primary}`
                        : `inset 0 0 0 1px rgba(0, 0, 0, 0.2)`,
                  }}
                />
              </Tooltip>
            );
          })}
        </Stack>

        {sectionDivider}

        <ToggleButton
          size="small"
          value="grid"
          selected={showGrid}
          onChange={() => onShowGridChange(!showGrid)}
          sx={{ px: 1.25, py: 0.5, textTransform: "none", gap: 0.5 }}
        >
          <GridOnIcon fontSize="small" />
          {t("models:detail.previewToolbar.grid")}
        </ToggleButton>

        {sectionDivider}

        <ToggleButton
          size="small"
          value="spin"
          selected={spin}
          onChange={() => onSpinChange(!spin)}
          sx={{ px: 1.25, py: 0.5, textTransform: "none", gap: 0.5 }}
        >
          <ThreeSixtyIcon fontSize="small" />
          {t("models:detail.previewToolbar.spin")}
        </ToggleButton>
      </Stack>
    </Paper>
  );
}
