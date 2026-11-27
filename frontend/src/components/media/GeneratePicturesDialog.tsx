import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Skeleton from "@mui/material/Skeleton";
import Alert from "@mui/material/Alert";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import { keyframes } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import HelpTip from "../HelpTip";
import Segmented from "../controls/Segmented";
import {
  ANGLES,
  FILAMENT_COLOURS,
  MAX_SHOTS,
  SCENES,
  nextShot,
  pictureFilename,
  rememberShots,
  rememberedShots,
  swatchUrl,
  type AngleId,
  type ColourChoice,
  type SceneId,
  type Shot,
} from "../../utils/scenePictures/scenes";
import type { SceneModel, ScenePictureRenderer } from "../../utils/scenePictures/render";

/** A file the model can be pictured from; `url` opens it (token included). */
export type PictureSourceFile = { id: string; filename: string; url: string };

type Props = {
  open: boolean;
  onClose: () => void;
  modelName: string;
  /** What to render. Without any, the dialog only chooses the pictures (`onChoose`), as Studio does before its
   *  model exists; each row then shows its background's swatch instead of a render. */
  files: PictureSourceFile[];
  /** How many pictures the model has already, for the note on where these go. */
  existingCount: number;
  onAdd?: (files: File[]) => void;
  onChoose?: (shots: Shot[]) => void;
  initialShots?: Shot[];
};

const PREVIEW = { width: 480, height: 360 };
const FULL = { width: 1600, height: 1200 };

const fadeIn = keyframes`
  from { opacity: 0; transform: scale(0.985); }
  to { opacity: 1; transform: scale(1); }
`;

const rowIn = keyframes`
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
`;

// The renderer and its three.js post-processing load only when the dialog is opened.
const loadRender = () => import("../../utils/scenePictures/render");

/** Pictures of a model on photo-scanned surfaces: a list of shots, each with its own angle and background. */
export default function GeneratePicturesDialog({
  open,
  onClose,
  modelName,
  files,
  existingCount,
  onAdd,
  onChoose,
  initialShots,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const chooseOnly = files.length === 0;
  const [shots, setShots] = useState<Shot[]>(() => initialShots ?? rememberedShots());
  const [rowIds, setRowIds] = useState<number[]>(() => shots.map((_, i) => i));
  const nextRowId = useRef(shots.length);
  const [fileId, setFileId] = useState(files[0]?.id ?? "");
  const [plate, setPlate] = useState<number | null>(null);
  const [colour, setColour] = useState<ColourChoice>("white");
  const [model, setModel] = useState<SceneModel | null>(null);
  const [loadingModel, setLoadingModel] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [renderer, setRenderer] = useState<ScenePictureRenderer | null>(null);
  const urlsRef = useRef<string[]>([]);

  const file = files.find((f) => f.id === fileId) ?? files[0];
  const previewKey = (shot: Shot) => `${fileId}|${plate}|${colour}|${shot.scene}|${shot.angle}`;

  // One WebGL context for the dialog's life.
  useEffect(() => {
    if (!open || chooseOnly) return;
    let cancelled = false;
    let made: ScenePictureRenderer | null = null;
    void loadRender().then(({ ScenePictureRenderer }) => {
      if (cancelled) return;
      made = new ScenePictureRenderer();
      setRenderer(made);
    });
    return () => {
      cancelled = true;
      made?.dispose();
      setRenderer(null);
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
      setPreviews({});
    };
  }, [open, chooseOnly]);

  // The model, again whenever the file or plate changes.
  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    let loaded: SceneModel | null = null;
    setLoadingModel(true);
    setError(null);
    void loadRender()
      .then(({ loadSceneModel }) => loadSceneModel(file.url, file.filename, plate))
      .then((result) => {
        loaded = result;
        if (cancelled) return result.dispose();
        setModel(result);
        setColour(result.hasColour ? "own" : "white");
      })
      .catch(() => !cancelled && setError(t("models:scenePictures.loadFailed", { file: file.filename })))
      .finally(() => !cancelled && setLoadingModel(false));
    return () => {
      cancelled = true;
      loaded?.dispose();
      setModel(null);
    };
  }, [open, file, plate, t]);

  // Previews, each rendered once per file, plate, colour, background and angle.
  useEffect(() => {
    if (!model || !renderer) return;
    let cancelled = false;
    void (async () => {
      const { colourModel } = await loadRender();
      colourModel(model, colour);
      for (const shot of shots) {
        const key = previewKey(shot);
        if (cancelled) return;
        if (previews[key]) continue;
        try {
          const blob = await renderer.render(model, shot, PREVIEW.width, PREVIEW.height);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          urlsRef.current.push(url);
          setPreviews((prev) => ({ ...prev, [key]: url }));
        } catch {
          if (!cancelled) setError(t("models:scenePictures.renderFailed"));
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // previews is read, not watched: a finished preview mustn't start the loop again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, renderer, shots, colour]);

  const sceneLabel = (id: SceneId) => t(`models:scenePictures.scenes.${id}`);
  const angleOptions = useMemo(
    () => ANGLES.map((a) => ({ value: a.id, label: t(`models:scenePictures.angles.${a.id}`) })),
    [t],
  );

  const updateShot = (index: number, change: Partial<Shot>) =>
    setShots((prev) => prev.map((shot, i) => (i === index ? { ...shot, ...change } : shot)));
  const removeShot = (index: number) => {
    setShots((prev) => prev.filter((_, i) => i !== index));
    setRowIds((prev) => prev.filter((_, i) => i !== index));
  };
  const addShot = () => {
    setShots((prev) => [...prev, nextShot(prev)]);
    setRowIds((prev) => [...prev, nextRowId.current++]);
  };

  const busy = progress !== null;
  const generate = async () => {
    if (chooseOnly) {
      rememberShots(shots);
      onChoose?.(shots);
      onClose();
      return;
    }
    if (!renderer || !model) return;
    setError(null);
    setProgress({ done: 0, total: shots.length });
    try {
      const out: File[] = [];
      for (const [index, shot] of shots.entries()) {
        const blob = await renderer.render(model, shot, FULL.width, FULL.height);
        out.push(new File([blob], pictureFilename(modelName, shot, index), { type: "image/jpeg" }));
        setProgress({ done: index + 1, total: shots.length });
      }
      rememberShots(shots);
      onAdd?.(out);
      onClose();
    } catch {
      setError(t("models:scenePictures.renderFailed"));
    } finally {
      setProgress(null);
    }
  };

  const colourChoices: { id: ColourChoice; hex: string | null }[] = [
    ...(model?.hasColour ? [{ id: "own" as const, hex: null }] : []),
    ...FILAMENT_COLOURS.map((c) => ({ id: c.id, hex: c.hex })),
  ];

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 0.5, pr: 6 }}>
        {t("models:scenePictures.title")}
        <HelpTip text={t("models:scenePictures.help")} />
        <IconButton
          aria-label={t("common:close")}
          onClick={onClose}
          disabled={busy}
          sx={{ position: "absolute", right: 8, top: 8 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {error && <Alert severity="error">{error}</Alert>}
          {!chooseOnly && (
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
              {files.length > 1 && (
                <TextField
                  select
                  size="small"
                  label={t("models:scenePictures.file")}
                  value={fileId}
                  onChange={(e) => {
                    setFileId(e.target.value);
                    setPlate(null);
                  }}
                  disabled={busy}
                  sx={{ minWidth: 180, maxWidth: "100%" }}
                >
                  {files.map((f) => (
                    <MenuItem key={f.id} value={f.id}>
                      {f.filename}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {model && model.plates.length > 1 && (
                <TextField
                  select
                  size="small"
                  label={t("models:scenePictures.plate")}
                  value={model.plate ?? ""}
                  onChange={(e) => setPlate(Number(e.target.value))}
                  disabled={busy}
                  sx={{ minWidth: 140 }}
                >
                  {model.plates.map((p) => (
                    <MenuItem key={p.index} value={p.index}>
                      {p.name || t("models:scenePictures.plateNumber", { number: p.index })}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <Typography variant="caption" color="text.secondary" aria-hidden>
                {t("models:scenePictures.colour")}
              </Typography>
              <Box
                component="fieldset"
                aria-label={t("models:scenePictures.colour")}
                sx={{ display: "flex", gap: 0.75, border: 0, m: 0, p: 0, minWidth: 0 }}
              >
                {colourChoices.map((choice) => {
                  const name =
                    choice.id === "own"
                      ? t("models:scenePictures.ownColour")
                      : t(`models:scenePictures.colours.${choice.id}`);
                  const chosen = colour === choice.id;
                  return (
                    <Tooltip key={choice.id} title={name}>
                      <ButtonBase
                        aria-label={name}
                        aria-pressed={chosen}
                        disabled={busy || !model}
                        onClick={() => setColour(choice.id)}
                        sx={{
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          border: 2,
                          borderColor: chosen ? "primary.main" : "divider",
                          outlineOffset: 2,
                          background: choice.hex ?? "conic-gradient(#e33, #ec3, #3c5, #36d, #c3c, #e33)",
                          transition: "transform 150ms",
                          "&:hover": { transform: "scale(1.12)" },
                          "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" },
                          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                        }}
                      />
                    </Tooltip>
                  );
                })}
              </Box>
            </Stack>
          )}

          {shots.map((shot, index) => {
            const src = chooseOnly ? null : previews[previewKey(shot)];
            return (
              <Box
                key={rowIds[index]}
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "168px 1fr auto" },
                  gap: 1.5,
                  alignItems: "center",
                  pt: index ? 1.5 : 0,
                  borderTop: index ? 1 : 0,
                  borderColor: "divider",
                  animation: `${rowIn} 200ms ease-out`,
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }}
              >
                <Box
                  sx={{
                    position: "relative",
                    width: { xs: "100%", sm: 168 },
                    aspectRatio: "4 / 3",
                    borderRadius: 1,
                    overflow: "hidden",
                    bgcolor: "action.hover",
                  }}
                >
                  {chooseOnly ? (
                    <Box
                      component="img"
                      src={swatchUrl(shot.scene)}
                      alt=""
                      sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : src ? (
                    <Box
                      key={src}
                      component="img"
                      src={src}
                      alt={t("models:scenePictures.previewAlt", {
                        background: sceneLabel(shot.scene),
                        angle: t(`models:scenePictures.angles.${shot.angle}`),
                      })}
                      sx={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                        animation: `${fadeIn} 220ms ease-out`,
                        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                      }}
                    />
                  ) : (
                    <Skeleton variant="rectangular" sx={{ width: "100%", height: "100%" }} />
                  )}
                  {loadingModel && !chooseOnly && (
                    <CircularProgress
                      size={20}
                      sx={{ position: "absolute", left: "calc(50% - 10px)", top: "calc(50% - 10px)" }}
                    />
                  )}
                </Box>
                <Stack spacing={1} sx={{ minWidth: 0 }}>
                  <Segmented<AngleId>
                    value={shot.angle}
                    options={angleOptions}
                    onChange={(angle) => updateShot(index, { angle })}
                    label={t("models:scenePictures.angle")}
                    disabled={busy}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {sceneLabel(shot.scene)}
                  </Typography>
                  <Box
                    component="fieldset"
                    aria-label={t("models:scenePictures.background")}
                    sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", border: 0, m: 0, p: 0, minWidth: 0 }}
                  >
                    {SCENES.map((scene) => {
                      const chosen = scene.id === shot.scene;
                      return (
                        <Tooltip key={scene.id} title={sceneLabel(scene.id)}>
                          <ButtonBase
                            aria-label={sceneLabel(scene.id)}
                            aria-pressed={chosen}
                            disabled={busy}
                            onClick={() => updateShot(index, { scene: scene.id })}
                            sx={{
                              width: 32,
                              height: 32,
                              borderRadius: 0.75,
                              overflow: "hidden",
                              border: 2,
                              borderColor: chosen ? "primary.main" : "transparent",
                              boxShadow: chosen ? 0 : (theme) => `inset 0 0 0 1px ${theme.palette.divider}`,
                              transition: "transform 150ms, border-color 150ms",
                              "&:hover": { transform: "translateY(-1px)" },
                              "&.Mui-focusVisible": {
                                outline: "2px solid",
                                outlineColor: "primary.main",
                                outlineOffset: 1,
                              },
                              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                            }}
                          >
                            <Box
                              component="img"
                              src={swatchUrl(scene.id)}
                              alt=""
                              sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                            />
                          </ButtonBase>
                        </Tooltip>
                      );
                    })}
                  </Box>
                </Stack>
                <Tooltip title={t("models:scenePictures.removePicture")}>
                  <span>
                    <IconButton
                      aria-label={t("models:scenePictures.removePicture")}
                      onClick={() => removeShot(index)}
                      disabled={busy || shots.length === 1}
                      size="small"
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            );
          })}
          <Box>
            <Button startIcon={<AddIcon />} onClick={addShot} disabled={busy || shots.length >= MAX_SHOTS} size="small">
              {t("models:scenePictures.addPicture")}
            </Button>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="caption" color="text.secondary">
          {busy
            ? t("models:scenePictures.rendering", progress)
            : existingCount > 0
              ? t("models:scenePictures.afterExisting", { count: existingCount })
              : t("models:scenePictures.firstPictures")}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose} disabled={busy}>
            {t("common:cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={() => void generate()}
            disabled={busy || (!chooseOnly && (!model || !renderer || loadingModel))}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {chooseOnly ? t("models:scenePictures.done") : t("models:scenePictures.addCount", { count: shots.length })}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
