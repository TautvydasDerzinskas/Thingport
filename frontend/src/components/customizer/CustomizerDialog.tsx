import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { alpha, useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import LaunchIcon from "@mui/icons-material/Launch";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import { type Print, printsApi } from "../../api/prints";
import { UnauthorizedError } from "../../api/client";
import { useToast } from "../ToastProvider";
import ModelViewer from "../media/ModelViewer";
import { scadParameters, scadRender, type ScadParameter } from "../../sdk/openscad";
import { writeStl } from "../../sdk/stl";
import type { Mesh } from "../../sdk/threeMf";
import { saveBytesToDisk } from "../../utils/downloadResponse";
import { useRenderColor } from "../../hooks/useAccentColor";
import { renderSwatch } from "../../theme";
import CustomizePane from "./CustomizePane";
import ModelPane from "./ModelPane";
import ScriptCodeDialog from "./ScriptCodeDialog";
import { changedValues, defaultValues, generatedName, hasChanges, readableWarnings, readyScript } from "./parameters";
import { useValueHistory } from "./useValueHistory";

/** The left column's width on a window wide enough to float it over the model. */
const COLUMN_WIDTH = 348;

type Script = { id: string; filename: string };

type Loaded = { script: Script; source: string; parameters: ScadParameter[] };

type Generated = {
  /** What a save and a 3MF download hand over, straight from the engine's run. */
  threeMf: Uint8Array;
  mesh: Mesh;
  /** A blob of the same geometry as STL, which is what the viewer loads. */
  url: string;
  name: string;
  seconds: number;
  warnings: string[];
};

type Props = {
  print: Print;
  /** Which of the model's scripts to open; the first when not given. */
  scriptId?: string;
  onClose: () => void;
  onUnauthorized?: () => void;
};

/**
 * Thingport's own customizer: a model's generator script, its parameters, and what they make.
 *
 * Everything runs in this tab -- the engine is WebAssembly carried by the app, so neither the script nor the
 * model it makes is sent anywhere. One render produces the 3MF a save keeps and the geometry the viewer draws,
 * so looking at a result costs nothing beyond making it.
 */
export default function CustomizerDialog({ print, scriptId, onClose, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const theme = useTheme();
  const navigate = useNavigate();
  const showToast = useToast();
  const renderColor = useRenderColor();
  // Below this the panes would cover the model, so the column sits above it instead of over it.
  const narrow = useMediaQuery(theme.breakpoints.down("md"));

  const scripts = useMemo<Script[]>(() => print.generator_scripts ?? [], [print.generator_scripts]);
  const [currentId, setCurrentId] = useState(() => scriptId ?? scripts[0]?.id ?? "");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [busy, setBusy] = useState<"reading" | "generating" | "saving" | null>("reading");
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [modelCollapsed, setModelCollapsed] = useState(false);
  const [downloadAnchor, setDownloadAnchor] = useState<HTMLElement | null>(null);

  const history = useValueHistory({});
  const { values, set, replace, restart, undo, redo, canUndo, canRedo } = history;

  // The values the model on screen was made from, to tell a stale view from a current one.
  const [renderedValues, setRenderedValues] = useState<string | null>(null);
  const stale = Boolean(loaded) && renderedValues !== null && JSON.stringify(values) !== renderedValues;

  // Only the newest load or render may touch the state: switching scripts mid-render must not be overwritten
  // by the render it interrupted.
  const run = useRef(0);
  // Revoked as the next result replaces it, and when the dialog goes.
  const url = useRef<string | null>(null);
  const showMesh = useCallback((mesh: Mesh) => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = URL.createObjectURL(new Blob([writeStl(mesh) as BlobPart], { type: "model/stl" }));
    return url.current;
  }, []);
  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  const reportFailure = useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      setFailure(err instanceof Error ? err.message : String(err));
    },
    [onUnauthorized],
  );

  /** Runs the script as the form stands and shows what comes out. */
  const generate = useCallback(
    async (current: Loaded, wanted: Record<string, unknown>, token: number) => {
      setBusy("generating");
      setFailure(null);
      setSaved(null);
      try {
        const changed = changedValues(current.parameters, wanted);
        const name = generatedName(current.script.filename, print.title || print.name, changed);
        const result = await scadRender(current.source, { parameters: changed, name });
        if (token !== run.current) return;
        // 3MF is the default format, so the geometry behind it comes back parsed with it.
        if (!result.mesh) throw new Error("The engine returned no geometry.");
        setGenerated({
          threeMf: result.bytes,
          mesh: result.mesh,
          url: showMesh(result.mesh),
          name,
          seconds: result.seconds,
          warnings: [
            ...readableWarnings(result.log),
            // The 3MF carries the shape but not the script's colours, which is better said than discovered
            // in a slicer.
            ...(result.mesh.colored ? [t("models:customizer.warning.colorsDropped")] : []),
          ],
        });
        setRenderedValues(JSON.stringify(wanted));
      } catch (err) {
        if (token !== run.current) return;
        setGenerated(null);
        // The engine's own words: a missing font or an unbalanced bracket is said here and nowhere else.
        setFailure(err instanceof Error ? err.message : String(err));
      } finally {
        if (token === run.current) setBusy(null);
      }
    },
    [print.name, print.title, showMesh, t],
  );

  // Reading the chosen script, then generating it once on its own values, so the dialog opens on a model
  // rather than on an empty stage.
  useEffect(() => {
    const token = ++run.current;
    const script = scripts.find((candidate) => candidate.id === currentId);
    // Nothing to open: the model's scripts went while the dialog was up, or it never had one.
    if (!script) {
      setLoaded(null);
      setBusy(null);
      return;
    }

    setBusy("reading");
    setFailure(null);
    setGenerated(null);
    setRenderedValues(null);
    void (async () => {
      try {
        const source = readyScript(await printsApi.supportingText(print.id, script.id));
        const { parameters } = await scadParameters(source);
        if (token !== run.current) return;
        const current = { script, source, parameters };
        const initial = defaultValues(parameters);
        setLoaded(current);
        restart(initial);
        await generate(current, initial, token);
      } catch (err) {
        if (token !== run.current) return;
        setLoaded(null);
        setBusy(null);
        reportFailure(err);
      }
    })();
  }, [currentId, print.id, scripts, restart, generate, reportFailure]);

  const onGenerate = () => {
    if (loaded) void generate(loaded, values, ++run.current);
  };

  const onReset = () => {
    if (loaded) replace(defaultValues(loaded.parameters));
  };

  // Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z, as any form with a history answers to.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      // Inside a field, undo belongs to what is being typed there, not to the form as a whole.
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA"].includes(target?.tagName ?? "")) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const download = (format: "3mf" | "stl") => {
    setDownloadAnchor(null);
    if (!generated) return;
    if (format === "3mf") {
      void saveBytesToDisk(generated.threeMf, `${generated.name}.3mf`, "model/3mf");
    } else {
      void saveBytesToDisk(writeStl(generated.mesh), `${generated.name}.stl`, "model/stl");
    }
  };

  /**
   * Keeps the result as a model of its own, with the script that made it beside it.
   *
   * The script comes along so the saved model can be customised in turn: a 3MF on its own is the end of the
   * line, while the pair is another starting point.
   */
  const save = async () => {
    if (!generated || !loaded) return;
    setBusy("saving");
    try {
      const files = [
        new File([generated.threeMf as BlobPart], `${generated.name}.3mf`, { type: "model/3mf" }),
        new File([loaded.source], loaded.script.filename, { type: "text/plain" }),
      ];
      const result = await printsApi.upload(files, {
        title: generated.name,
        notes: t("models:customizer.save.description", {
          model: print.title || print.name,
          script: loaded.script.filename,
        }),
        // One model holding both, rather than one per file.
        mode: "multiplate",
      });
      const created = result.prints[0];
      if (created) setSaved({ id: created.id, name: created.title || created.name });
      showToast({ message: t("models:customizer.save.done", { name: generated.name }), severity: "success" });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : String(err), severity: "error" });
    } finally {
      setBusy(null);
    }
  };

  const column = (
    <Stack
      spacing={1.5}
      sx={
        narrow
          ? { p: 1.5, minHeight: 0 }
          : {
              position: "absolute",
              zIndex: 2,
              top: 12,
              left: 12,
              bottom: 12,
              width: COLUMN_WIDTH,
              maxWidth: "calc(100% - 24px)",
              minHeight: 0,
            }
      }
    >
      <ModelPane
        print={print}
        scripts={scripts}
        scriptId={currentId}
        onScriptChange={setCurrentId}
        collapsed={modelCollapsed}
        onCollapsedChange={setModelCollapsed}
        disabled={busy !== null}
      />
      {loaded && (
        <CustomizePane
          scriptName={loaded.script.filename}
          parameters={loaded.parameters}
          values={values}
          onChange={set}
          onGenerate={onGenerate}
          onReset={onReset}
          onShowCode={() => setShowCode(true)}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          canReset={hasChanges(loaded.parameters, values)}
          busy={busy !== null}
          stale={stale}
        />
      )}
    </Stack>
  );

  const stage = (
    <Box
      sx={{
        position: "relative",
        flex: 1,
        minHeight: narrow ? 260 : 0,
        bgcolor: theme.palette.mode === "dark" ? theme.thingport.pageBackground : "#e7e7ea",
      }}
    >
      {generated ? (
        // No key: the viewer reloads on a new url, so each generate reuses the WebGL context rather than
        // tearing the canvas down and building another.
        <ModelViewer
          url={generated.url}
          ext="stl"
          theme={theme.palette.mode}
          colorOverride={renderSwatch(renderColor).color}
          buildPlateForMeshes
          initialCameraView="topFront"
          background="transparent"
        />
      ) : (
        <Stack
          alignItems="center"
          justifyContent="center"
          spacing={1.5}
          sx={{ position: "absolute", inset: 0, color: "text.secondary", px: 2, textAlign: "center" }}
        >
          {busy ? <CircularProgress size={28} /> : <ViewInArIcon sx={{ fontSize: 44, opacity: 0.4 }} />}
          <Typography variant="body2">
            {busy === "reading"
              ? t("models:customizer.busy.reading")
              : busy === "generating"
                ? t("models:customizer.busy.generating")
                : t("models:customizer.stage.empty")}
          </Typography>
        </Stack>
      )}

      {/* What the engine said, and what came of it: over the model rather than beside it, so the stage keeps
          the whole window. */}
      <Stack
        spacing={1}
        sx={{
          position: "absolute",
          zIndex: 2,
          right: 12,
          bottom: 12,
          left: narrow ? 12 : COLUMN_WIDTH + 24,
          alignItems: "flex-end",
          pointerEvents: "none",
          "& > *": { pointerEvents: "auto" },
        }}
      >
        {failure && (
          <Alert severity="error" variant="filled" sx={{ maxWidth: 560, width: "100%", alignSelf: "flex-start" }}>
            <AlertTitle sx={{ mb: 0.25 }}>{t("models:customizer.error.failed")}</AlertTitle>
            <Typography variant="caption" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {failure.split("\n").slice(0, 6).join("\n")}
            </Typography>
          </Alert>
        )}
        {!failure && generated?.warnings.length ? (
          <Alert severity="warning" sx={{ maxWidth: 560, width: "100%", alignSelf: "flex-start" }}>
            <Typography variant="caption" component="div" sx={{ whiteSpace: "pre-wrap" }}>
              {generated.warnings.slice(0, 4).join("\n")}
            </Typography>
          </Alert>
        ) : null}

        {generated && (
          <Paper
            elevation={6}
            sx={{
              borderRadius: 2,
              px: 1,
              py: 0.75,
              bgcolor: (muiTheme) => alpha(muiTheme.palette.background.paper, 0.92),
              backdropFilter: "blur(10px)",
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="caption" sx={{ color: "text.secondary", px: 0.5 }}>
                {t("models:customizer.status.generated", {
                  seconds: generated.seconds.toFixed(1),
                  size: Math.max(1, Math.round(generated.threeMf.length / 1024)),
                })}
              </Typography>
              {saved && (
                <Button
                  size="small"
                  startIcon={<LaunchIcon fontSize="small" />}
                  onClick={() => {
                    onClose();
                    navigate(`/models/${saved.id}`);
                  }}
                >
                  {t("models:customizer.save.open")}
                </Button>
              )}
              <Button
                size="small"
                startIcon={<DownloadIcon fontSize="small" />}
                disabled={busy !== null}
                onClick={(event) => setDownloadAnchor(event.currentTarget)}
              >
                {t("common:download")}
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<SaveOutlinedIcon fontSize="small" />}
                disabled={busy !== null}
                onClick={() => void save()}
              >
                {t("models:customizer.save.action")}
              </Button>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Box>
  );

  return (
    <>
      <Dialog
        open
        onClose={busy === "saving" ? undefined : onClose}
        fullScreen
        aria-label={t("models:customizer.title", { model: print.title || print.name })}
      >
        <Box sx={{ position: "relative", height: "100%", display: "flex", flexDirection: "column" }}>
          <Tooltip title={t("common:close")}>
            <IconButton
              onClick={onClose}
              aria-label={t("common:close")}
              sx={{
                position: "absolute",
                zIndex: 3,
                top: 12,
                right: 12,
                bgcolor: (muiTheme) => alpha(muiTheme.palette.background.paper, 0.9),
                backdropFilter: "blur(10px)",
                "&:hover": { bgcolor: "background.paper" },
              }}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>

          {stage}
          {/* Floated over the model where there is room for it, stacked under it where there isn't. */}
          {narrow ? <Box sx={{ flexShrink: 0, maxHeight: "58%", overflowY: "auto" }}>{column}</Box> : column}
        </Box>
      </Dialog>

      <Menu anchorEl={downloadAnchor} open={Boolean(downloadAnchor)} onClose={() => setDownloadAnchor(null)}>
        <MenuItem onClick={() => download("3mf")}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:customizer.download.threeMf")}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => download("stl")}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("models:customizer.download.stl")}</ListItemText>
        </MenuItem>
      </Menu>

      {showCode && loaded && (
        <ScriptCodeDialog name={loaded.script.filename} source={loaded.source} onClose={() => setShowCode(false)} />
      )}
    </>
  );
}
