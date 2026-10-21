import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import { useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import LayersIcon from "@mui/icons-material/Layers";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { type Print, printsApi } from "../../api/prints";
import { MODEL_EXTS } from "../../constants/fileTypes";
import { extOf } from "../../utils/fileExtensions";
import PlateThumbnail from "../../components/media/PlateThumbnail";
import ModelViewer, {
  type CameraView,
  type ModelViewerHandle,
  type RenderStyle,
} from "../../components/media/ModelViewer";
import type { PlateSummary } from "../../utils/bambuThreeMf";
import PreviewToolbar from "./PreviewToolbar";
import type { RenderColor } from "../../constants/settingsOptions";
import { useRenderColor } from "../../hooks/useAccentColor";
import { renderSwatch } from "../../theme";
import { fileRowText } from "./fileRowText";

// Light mode keeps a product-shot style grey; dark mode uses the page background so it doesn't glare.
const LIGHT_PREVIEW_BG = "#e7e7ea";

const ZOOM_STEP = 1.25;

const overlayButtonSx = {
  bgcolor: "rgba(0, 0, 0, 0.45)",
  color: "#fff",
  "&:hover": { bgcolor: "rgba(0, 0, 0, 0.65)" },
};

type Props = {
  print: Print;
  onClose: () => void;
};

/** The plate list is always shown, even for one plate, so the layout doesn't jump. */
export default function Model3DPreviewModal({ print, onClose }: Props) {
  const { t } = useTranslation(["models", "library", "common"]);
  const muiTheme = useTheme();
  const themeMode = muiTheme.palette.mode;
  const previewBg = themeMode === "dark" ? muiTheme.thingport.pageBackground : LIGHT_PREVIEW_BG;
  const sortedPlates = useMemo(() => print.plates.toSorted((a, b) => a.position - b.position), [print.plates]);
  const [activePlateId, setActivePlateId] = useState<string | null>(sortedPlates[0]?.id ?? null);
  const activePlate = sortedPlates.find((p) => p.id === activePlateId) || sortedPlates[0];
  const ext = activePlate ? extOf(activePlate.filename) : "";
  const is3d = Boolean(activePlate) && MODEL_EXTS.has(ext);

  // Plates inside the active .3mf, reset when the file changes.
  const [internalPlates, setInternalPlates] = useState<PlateSummary[]>([]);
  const [internalThumbnails, setInternalThumbnails] = useState<Record<number, string | null>>({});
  const [selectedInternalPlateId, setSelectedInternalPlateId] = useState<number | null>(null);

  // Lives here so it survives the viewer remounting per file.
  const viewerRef = useRef<ModelViewerHandle>(null);
  const [renderStyle, setRenderStyle] = useState<RenderStyle>("solid");
  // Follows the render colour until another is picked for this viewing.
  const renderColor = useRenderColor();
  const [pickedColor, setPickedColor] = useState<RenderColor | null>(null);
  const modelColor = pickedColor ?? renderColor;
  const [cameraView, setCameraView] = useState<CameraView>("topFront");
  const [showGrid, setShowGrid] = useState(true);
  const [spin, setSpin] = useState(true);

  const handleCameraView = (view: CameraView) => {
    setCameraView(view);
    viewerRef.current?.setCameraView(view);
  };

  // A lone multi-plate file doesn't need its own row above its plates.
  const showFileRows = sortedPlates.length > 1 || internalPlates.length === 0;

  const handlePlatesDetected = (plates: PlateSummary[], getThumbnail: (index: number) => Promise<string | null>) => {
    setInternalPlates(plates);
    setSelectedInternalPlateId(plates[0]?.index ?? null);
    setInternalThumbnails({});
    Promise.all(plates.map(async (plate) => [plate.index, await getThumbnail(plate.index)] as const)).then((pairs) => {
      setInternalThumbnails(Object.fromEntries(pairs));
    });
  };

  const selectPlate = (plateId: string) => {
    // The viewer won't remount for the same file, so its plates wouldn't be re-reported.
    if (plateId === activePlate?.id) return;
    setActivePlateId(plateId);
    setInternalPlates([]);
    setInternalThumbnails({});
    setSelectedInternalPlateId(null);
  };

  return (
    <Dialog
      open
      fullWidth
      maxWidth="lg"
      onClose={onClose}
      slotProps={{ paper: { sx: { height: "85vh", bgcolor: previewBg, backgroundImage: "none" } } }}
    >
      <IconButton
        onClick={onClose}
        aria-label={t("common:close") ?? undefined}
        sx={{ position: "absolute", top: 10, right: 10, zIndex: 2, ...overlayButtonSx }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>

      <Box sx={{ position: "relative", flex: 1, height: "100%" }}>
        <Paper
          elevation={3}
          sx={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 2,
            width: 240,
            maxHeight: "calc(100% - 32px)",
            overflow: "auto",
            p: 1,
            borderRadius: "12px",
            ...(themeMode === "dark" && { "& .MuiListItemText-primary": { color: "#FFFFFF" } }),
          }}
        >
          {showFileRows && (
            <List disablePadding>
              {sortedPlates.map((plate, idx) => (
                // Named by file: "plate" is kept for the build plates inside a 3MF.
                <ListItemButton
                  key={plate.id}
                  selected={plate.id === activePlate?.id}
                  onClick={() => selectPlate(plate.id)}
                  title={plate.filename}
                  sx={{ borderRadius: 1, mb: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <PlateThumbnail plate={plate} />
                  </ListItemIcon>
                  <ListItemText
                    {...fileRowText(t, plate.filename, idx)}
                    primaryTypographyProps={{ variant: "body2", noWrap: true }}
                    secondaryTypographyProps={{ variant: "caption", noWrap: true }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}

          {internalPlates.length > 0 && (
            <>
              {showFileRows && (
                <Divider sx={{ my: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("models:detail.internalPlatesDivider", { count: internalPlates.length })}
                  </Typography>
                </Divider>
              )}
              <List disablePadding>
                {internalPlates.map((plate) => (
                  <ListItemButton
                    key={plate.index}
                    selected={plate.index === selectedInternalPlateId}
                    onClick={() => setSelectedInternalPlateId(plate.index)}
                    sx={{ borderRadius: 1, mb: 0.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      {internalThumbnails[plate.index] ? (
                        <Box
                          component="img"
                          src={internalThumbnails[plate.index] ?? undefined}
                          alt=""
                          sx={{ width: 32, height: 32, borderRadius: 0.75, objectFit: "cover" }}
                        />
                      ) : (
                        <Box
                          sx={{
                            width: 32,
                            height: 32,
                            borderRadius: 0.75,
                            bgcolor: "action.hover",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <LayersIcon fontSize="small" color="disabled" />
                        </Box>
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        plate.name
                          ? t("models:detail.plateLabel", { n: plate.index }) + ` — ${plate.name}`
                          : t("models:detail.plateLabel", { n: plate.index })
                      }
                      secondary={t("models:detail.internalPlateObjectCount", { count: plate.objectCount })}
                      primaryTypographyProps={{ variant: "body2", noWrap: true }}
                      secondaryTypographyProps={{ variant: "caption" }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </>
          )}
        </Paper>

        <Box sx={{ width: "100%", height: "100%" }}>
          {is3d && activePlate ? (
            <ModelViewer
              ref={viewerRef}
              key={activePlate.id}
              url={printsApi.fileUrl(activePlate.url)}
              ext={ext}
              initialCameraView={cameraView}
              theme={themeMode}
              colorOverride={renderSwatch(modelColor).color}
              renderStyle={renderStyle}
              showBuildPlate={showGrid}
              buildPlateForMeshes
              autoRotate={spin}
              selectedPlateId={selectedInternalPlateId}
              previewGlbUrl={activePlate.preview_glb_url ? printsApi.fileUrl(activePlate.preview_glb_url) : null}
              onPlatesDetected={handlePlatesDetected}
            />
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <Typography color="text.secondary">{t("library:modelViewer.previewUnavailable")}</Typography>
            </Box>
          )}
        </Box>

        {is3d && (
          // Lined up with the close button, just above the viewer's orientation cube (72px, 12px from the corner).
          <Stack spacing={1} sx={{ position: "absolute", bottom: 92, right: 10, zIndex: 2 }}>
            <IconButton
              onClick={() => viewerRef.current?.zoom(1 / ZOOM_STEP)}
              aria-label={t("models:detail.previewToolbar.zoomIn") ?? undefined}
              sx={overlayButtonSx}
            >
              <AddIcon fontSize="small" />
            </IconButton>
            <IconButton
              onClick={() => viewerRef.current?.zoom(ZOOM_STEP)}
              aria-label={t("models:detail.previewToolbar.zoomOut") ?? undefined}
              sx={overlayButtonSx}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
          </Stack>
        )}

        {is3d && (
          <PreviewToolbar
            cameraView={cameraView}
            onCameraView={handleCameraView}
            renderStyle={renderStyle}
            onRenderStyleChange={setRenderStyle}
            color={modelColor}
            onColorChange={setPickedColor}
            showGrid={showGrid}
            onShowGridChange={setShowGrid}
            spin={spin}
            onSpinChange={setSpin}
          />
        )}
      </Box>
    </Dialog>
  );
}
