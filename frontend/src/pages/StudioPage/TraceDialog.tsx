import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import AddPhotoAlternateOutlinedIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import { studioApi, type StudioPicture } from "../../api/studio";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import {
  bright,
  traceContours,
  tracePicture,
  type Brightness,
  type TraceDetail,
  type TraceShape,
} from "../../studio/trace";
import { NumberField } from "./fields";

// Turning a picture into an outline to make solid: the picture beside what it traces to, as its settings change. The
// page traces a smaller copy for the preview; OK keeps the picture with the design and the server traces it in full,
// with trace_picture, as an assistant would.

// The preview's copy, along its longer side: quick enough to trace again as a slider moves.
const PREVIEW_PX = 1024;

export type TraceRequest = {
  picture_id: string;
  width: number;
  plane: "XY" | "XZ" | "YZ";
  threshold: number | null;
  invert: boolean;
  detail: TraceDetail;
  height?: number;
};

type Props = {
  designId: string;
  onClose: () => void;
  /** Runs trace_picture; false when it didn't go through, which leaves the dialog open. */
  onTrace: (request: TraceRequest) => Promise<boolean>;
  onError: (error: unknown) => void;
};

async function brightnessOf(file: File): Promise<Brightness> {
  const image = await createImageBitmap(file);
  const fit = Math.min(1, PREVIEW_PX / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * fit));
  const height = Math.max(1, Math.round(image.height * fit));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, width, height);
  image.close();
  return bright(context.getImageData(0, 0, width, height).data, width, height);
}

export default function TraceDialog({ designId, onClose, onTrace, onError }: Props) {
  const { t } = useTranslation("app");
  const theme = useTheme();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [picture, setPicture] = useState<Brightness | null>(null);
  const [uploaded, setUploaded] = useState<{ file: File; picture: StudioPicture } | null>(null);
  const [auto, setAuto] = useState(true);
  const [threshold, setThreshold] = useState(128);
  const [invert, setInvert] = useState(false);
  const [detail, setDetail] = useState<TraceDetail>("medium");
  const [width, setWidth] = useState(80);
  const [plane, setPlane] = useState<TraceRequest["plane"]>("XY");
  const [solid, setSolid] = useState(true);
  const [height, setHeight] = useState(3);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const choose = (files: ArrayLike<File>) => {
    const next = Array.from(files).find((each) => each.type.startsWith("image/"));
    if (!next) return;
    setFile(next);
    setUrl(URL.createObjectURL(next));
    setPicture(null);
    brightnessOf(next).then(setPicture, onError);
  };

  // The slider's threshold settles before it's traced again.
  const [settled, setSettled] = useState(threshold);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(threshold), 120);
    return () => window.clearTimeout(timer);
  }, [threshold]);

  const traced = useMemo(() => {
    if (!picture) return null;
    try {
      const result = tracePicture(picture, { threshold: auto ? null : settled, invert, detail });
      return { result, error: null };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [picture, auto, settled, invert, detail]);
  // The threshold found, shown on the slider while it's left to find it.
  const found = traced?.result?.threshold;
  useEffect(() => {
    if (auto && found !== undefined) setThreshold(found);
  }, [auto, found]);

  const outline = useMemo(() => {
    const result = traced?.result;
    if (!result) return null;
    const loops = traceContours({
      outline: result.outline,
      center: [0.5, result.aspect / 2],
      width: 1,
      height: result.aspect,
    } as TraceShape);
    // On screen y runs down.
    const d = loops
      .map((loop) => `M${loop.map(([x, y]) => `${x.toFixed(4)} ${(result.aspect - y).toFixed(4)}`).join("L")}Z`)
      .join("");
    return { d, aspect: result.aspect };
  }, [traced]);

  const trace = async () => {
    if (!file || !traced?.result) return;
    setBusy(true);
    try {
      const kept = uploaded?.file === file ? uploaded.picture : await studioApi.addPicture(designId, file);
      setUploaded({ file, picture: kept });
      const ok = await onTrace({
        picture_id: kept.id,
        width,
        plane,
        threshold: auto ? null : threshold,
        invert,
        detail,
        ...(solid ? { height } : {}),
      });
      if (ok) onClose();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  const pane = {
    flex: 1,
    minWidth: 0,
    height: 260,
    borderRadius: 2,
    border: 1,
    borderColor: "divider",
    bgcolor: "background.default",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    p: 1,
  } as const;

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {t("studio.trace.title")}
        <HelpTip text={t("studio.trace.help")} />
      </DialogTitle>
      <DialogContent
        onPaste={(event) => {
          if (event.clipboardData.files.length) choose(event.clipboardData.files);
        }}
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2 }}>
          <Box
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              choose(event.dataTransfer.files);
            }}
            sx={{
              ...pane,
              borderStyle: file ? "solid" : "dashed",
              borderColor: dragging ? "primary.main" : "divider",
              transition: "border-color 150ms",
              // On white, as it's traced: see-through counts as paper.
              ...(url ? { bgcolor: "common.white" } : {}),
            }}
          >
            {url ? (
              <Box
                component="img"
                src={url}
                alt={t("studio.trace.picture")}
                sx={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              />
            ) : (
              <Stack alignItems="center" spacing={1} sx={{ textAlign: "center", px: 2 }}>
                <AddPhotoAlternateOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
                <Typography variant="body2" color="text.secondary">
                  {t("studio.trace.drop")}
                </Typography>
                <Button size="small" variant="outlined" onClick={() => picker.current?.click()}>
                  {t("studio.trace.choose")}
                </Button>
              </Stack>
            )}
          </Box>
          <Box sx={pane}>
            {outline ? (
              <Box
                component="svg"
                aria-hidden
                viewBox={`-0.02 -0.02 1.04 ${outline.aspect + 0.04}`}
                preserveAspectRatio="xMidYMid meet"
                sx={{ width: "100%", height: "100%", display: "block" }}
              >
                <path
                  d={outline.d}
                  fillRule="nonzero"
                  fill={alpha(theme.palette.primary.main, 0.85)}
                  stroke={theme.palette.primary.dark}
                  strokeWidth={0.002}
                />
              </Box>
            ) : file && !traced?.error ? (
              <CircularProgress size={24} aria-label={t("studio.working")} />
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, textAlign: "center" }}>
                {traced?.error ?? t("studio.trace.resultEmpty")}
              </Typography>
            )}
          </Box>
        </Stack>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            choose(event.target.files ?? []);
            event.target.value = "";
          }}
        />
        {traced?.error && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {traced.error}
          </Alert>
        )}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
          <Stack spacing={1.25}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="body2" sx={{ minWidth: 90 }}>
                {t("studio.trace.threshold")}
              </Typography>
              <Slider
                size="small"
                min={1}
                max={255}
                value={threshold}
                disabled={!picture}
                onChange={(_event, value) => {
                  setAuto(false);
                  setThreshold(value as number);
                }}
                aria-label={t("studio.trace.threshold")}
                valueLabelDisplay="auto"
              />
            </Stack>
            <Stack direction="row" spacing={1}>
              <FormControlLabel
                sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.85rem" } }}
                control={<Switch size="small" checked={auto} onChange={(event) => setAuto(event.target.checked)} />}
                label={t("studio.trace.auto")}
              />
              <FormControlLabel
                sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.85rem" } }}
                control={<Switch size="small" checked={invert} onChange={(event) => setInvert(event.target.checked)} />}
                label={t("studio.trace.invert")}
              />
            </Stack>
            <Segmented
              fullWidth
              label={t("studio.trace.detail")}
              value={detail}
              options={(["low", "medium", "high"] as const).map((each) => ({
                value: each,
                label: t(`studio.trace.details.${each}`),
              }))}
              onChange={setDetail}
            />
            {traced?.result && (
              <Typography variant="caption" color="text.secondary">
                {t("studio.trace.found", { count: traced.result.loops })}
                {traced.result.holes > 0 && ` · ${t("studio.trace.holes", { count: traced.result.holes })}`}
              </Typography>
            )}
          </Stack>
          <Stack spacing={1.25}>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
              <NumberField
                live
                label={t("studio.properties.fields.width")}
                value={width}
                unit="mm"
                onCommit={(next) => next > 0 && setWidth(next)}
              />
              <Typography variant="caption" color="text.secondary" sx={{ alignSelf: "center" }}>
                {traced?.result ? `× ${Number((width * traced.result.aspect).toFixed(1))} mm` : ""}
              </Typography>
            </Box>
            <Segmented
              fullWidth
              label={t("studio.properties.plane")}
              value={plane}
              options={(["XY", "XZ", "YZ"] as const).map((each) => ({ value: each, label: each }))}
              onChange={setPlane}
            />
            <Segmented
              fullWidth
              label={t("studio.trace.make")}
              value={solid ? "solid" : "sketch"}
              options={[
                { value: "solid", label: t("studio.trace.solid") },
                { value: "sketch", label: t("studio.trace.sketch") },
              ]}
              onChange={(value) => setSolid(value === "solid")}
            />
            {solid && (
              <NumberField
                live
                label={t("studio.properties.fields.height")}
                value={height}
                unit="mm"
                onCommit={(next) => next > 0 && setHeight(next)}
              />
            )}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {file && (
          <Button onClick={() => picker.current?.click()} disabled={busy} sx={{ mr: "auto" }}>
            {t("studio.trace.another")}
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          {t("studio.ops.cancel")}
        </Button>
        <Button
          variant="contained"
          disableElevation
          disabled={!traced?.result || busy}
          onClick={() => void trace()}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {t("studio.trace.ok")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
