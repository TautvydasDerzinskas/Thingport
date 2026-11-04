import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { type PlateProfile, type Print, printsApi } from "../../api/prints";
import { MODEL_EXTS } from "../../constants/fileTypes";
import { extOf, stemOf } from "../../utils/fileExtensions";
import PlateThumbnail from "../../components/media/PlateThumbnail";
import ProfileDetails, { plateStatText, platesToList, statForPlate } from "../../components/ProfileDetails";
import ModelViewer, {
  type CameraView,
  type ModelViewerHandle,
  type RenderStyle,
} from "../../components/media/ModelViewer";
import type { PlateSummary } from "../../utils/bambuThreeMf";
import { profileSummary } from "./fileRowText";
import PreviewToolbar from "./PreviewToolbar";
import type { RenderColor } from "../../constants/settingsOptions";
import { useRenderColor } from "../../hooks/useAccentColor";
import { renderSwatch } from "../../theme";

// Light mode keeps a product-shot style grey; dark mode uses the page background so it doesn't glare.
const LIGHT_PREVIEW_BG = "#e7e7ea";

const ZOOM_STEP = 1.25;

const overlayButtonSx = {
  bgcolor: "rgba(0, 0, 0, 0.45)",
  color: "#fff",
  "&:hover": { bgcolor: "rgba(0, 0, 0, 0.65)" },
};

// The profile of the active file sits below in ProfileDetails, so a row only needs to tell the files apart.
function compactFileText(
  t: TFunction,
  filename: string,
  index: number,
  profile: PlateProfile | null | undefined,
  locale: string,
) {
  const title = (profile && profileSummary(t, profile, locale)) || profile?.title || null;
  const stem = stemOf(filename);
  const type = extOf(filename).toUpperCase();
  const plain = type
    ? t("models:detail.fileMeta", { n: index + 1, type })
    : t("models:detail.fileLabel", { n: index + 1 });
  return { primary: title || stem, secondary: title ? stem : plain };
}

// A few rows are visible, the rest scrolls inside the panel.
const scrollListSx = { overflowY: "auto", minHeight: 0, maxHeight: 240 } as const;

type Props = {
  print: Print;
  onClose: () => void;
};

/** The plate list is always shown, even for one plate, so the layout doesn't jump. */
export default function Model3DPreviewModal({ print, onClose }: Props) {
  const { t, i18n } = useTranslation(["models", "library", "common"]);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const muiTheme = useTheme();
  const themeMode = muiTheme.palette.mode;
  const previewBg = themeMode === "dark" ? muiTheme.thingport.pageBackground : LIGHT_PREVIEW_BG;
  const sortedPlates = useMemo(() => print.plates.toSorted((a, b) => a.position - b.position), [print.plates]);
  const [activePlateId, setActivePlateId] = useState<string | null>(sortedPlates[0]?.id ?? null);
  const activePlate = sortedPlates.find((p) => p.id === activePlateId) || sortedPlates[0];
  const ext = activePlate ? extOf(activePlate.filename) : "";
  const is3d = Boolean(activePlate) && MODEL_EXTS.has(ext);

  // Plates inside the active .3mf, reset when the file changes.
  const [viewerPlates, setViewerPlates] = useState<PlateSummary[]>([]);
  // The file loaded but holds no model (a sliced .gcode.3mf): the plate list then comes from its profile.
  const [noGeometry, setNoGeometry] = useState(false);
  const internalPlates = useMemo(
    () => platesToList(viewerPlates, activePlate?.profile, noGeometry),
    [viewerPlates, activePlate?.profile, noGeometry],
  );
  const [internalThumbnails, setInternalThumbnails] = useState<Record<number, string | null>>({});
  const [selectedInternalPlateId, setSelectedInternalPlateId] = useState<number | null>(null);

  // Lives here so it survives the viewer remounting per file.
  const viewerRef = useRef<ModelViewerHandle>(null);
  const [renderStyle, setRenderStyle] = useState<RenderStyle>("solid");
  // Follows the render colour until another is picked for this viewing.
  const renderColor = useRenderColor();
  const [pickedColor, setPickedColor] = useState<RenderColor | null>(null);
  const modelColor = pickedColor ?? renderColor;
  // A model printed in colours of its own is shown in those, so the palette has nothing left to offer.
  const [ownColor, setOwnColor] = useState(false);
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
    setViewerPlates(plates);
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
    // The next file answers for itself; until it does, the palette shouldn't stay disabled on the strength
    // of the last one.
    setOwnColor(false);
    setViewerPlates([]);
    setNoGeometry(false);
    setInternalThumbnails({});
    setSelectedInternalPlateId(null);
  };

  const handleNoGeometry = () => {
    setNoGeometry(true);
    setOwnColor(false);
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
            width: 280,
            // Leaves the bottom toolbar free; the lists scroll, the profile details stay in view.
            maxHeight: "calc(100% - 104px)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            p: 1,
            borderRadius: "12px",
            ...(themeMode === "dark" && { "& .MuiListItemText-primary": { color: "#FFFFFF" } }),
          }}
        >
          {showFileRows && (
            <List disablePadding sx={{ ...scrollListSx, flex: "0 1 auto" }}>
              {sortedPlates.map((plate, idx) => (
                // Named by file: "plate" is kept for the build plates inside a 3MF.
                <ListItemButton
                  key={plate.id}
                  selected={plate.id === activePlate?.id}
                  onClick={() => selectPlate(plate.id)}
                  title={plate.filename}
                  sx={{ borderRadius: 1, mb: 0.25, py: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <PlateThumbnail plate={plate} />
                  </ListItemIcon>
                  <ListItemText
                    {...compactFileText(t, plate.filename, idx, plate.profile, locale)}
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
              {/* Four rows fit whole; more scroll with the next row peeking out (168 hid the 4th plate completely, B-16). */}
              <List disablePadding sx={{ ...scrollListSx, flex: "0 1 auto" }}>
                {internalPlates.map((plate) => (
                  <ListItemButton
                    key={plate.index}
                    selected={plate.index === (selectedInternalPlateId ?? internalPlates[0]?.index)}
                    onClick={() => setSelectedInternalPlateId(plate.index)}
                    sx={{ borderRadius: 1, mb: 0.25, py: 0.5 }}
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
                      secondary={[
                        noGeometry ? null : t("models:detail.internalPlateObjectCount", { count: plate.objectCount }),
                        plateStatText(statForPlate(activePlate?.profile, plate.index), locale),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      primaryTypographyProps={{ variant: "body2", noWrap: true }}
                      secondaryTypographyProps={{ variant: "caption", noWrap: true }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </>
          )}

          {activePlate && (
            <Box sx={{ flexShrink: 0 }}>
              <Divider sx={{ my: 1 }} />
              <ProfileDetails filename={activePlate.filename} profile={activePlate.profile} />
            </Box>
          )}
        </Paper>

        <Box sx={{ width: "100%", height: "100%" }}>
          {is3d && activePlate && noGeometry ? (
            // Centred in the space right of the 280px side panel, so it isn't half under it.
            <Stack
              spacing={0.5}
              alignItems="center"
              justifyContent="center"
              sx={{ height: "100%", pl: "312px", pr: 2, textAlign: "center" }}
            >
              <ViewInArOutlinedIcon color="disabled" sx={{ fontSize: 40 }} />
              <Typography color="text.primary" fontWeight={600}>
                {t("models:detail.noGeometry")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("models:detail.noGeometryHint")}
              </Typography>
            </Stack>
          ) : is3d && activePlate ? (
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
              onNoGeometry={handleNoGeometry}
              onOwnColorChange={setOwnColor}
            />
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <Typography color="text.secondary">{t("library:modelViewer.previewUnavailable")}</Typography>
            </Box>
          )}
        </Box>

        {is3d && !noGeometry && (
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

        {is3d && !noGeometry && (
          <PreviewToolbar
            cameraView={cameraView}
            onCameraView={handleCameraView}
            renderStyle={renderStyle}
            onRenderStyleChange={setRenderStyle}
            color={modelColor}
            onColorChange={setPickedColor}
            ownColor={ownColor}
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
