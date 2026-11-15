import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import { keyframes, type Theme } from "@mui/material/styles";
import AddBoxOutlinedIcon from "@mui/icons-material/AddBoxOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DriveFileRenameOutlineOutlinedIcon from "@mui/icons-material/DriveFileRenameOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { UnauthorizedError } from "../../api/client";
import { studioApi, type StudioAiModels } from "../../api/studio";
import { useConfirm } from "../../components/ConfirmProvider";
import PanelTab from "../../components/PanelTab";
import { useToast } from "../../components/ToastProvider";
import {
  consumerOf,
  featureById,
  isBody,
  topLevel,
  type PartMeasure,
  type SketchFeature,
  type SketchPlane,
  type OutlineShape,
  type PathShape,
  type StudioDocument,
  type Transform,
} from "../../studio/document";
import CheckDialog from "./CheckDialog";
import DesignsDialog from "./DesignsDialog";
import { designStl } from "./exportStl";
import FeatureTree from "./FeatureTree";
import { featureLabel } from "./labels";
import { AssistantPanel } from "./AssistantThread";
import PromptOverlay from "./PromptOverlay";
import PropertiesPanel from "./PropertiesPanel";
import RenameDialog from "./RenameDialog";
import SidePanel from "./SidePanel";
import StudioToolbar, { type BooleanKind, type Primitive, type StudioPanel } from "./StudioToolbar";
import StudioViewport, {
  type BodyStats,
  type Picked,
  type SketchTool,
  type StudioMode,
  type StudioViewportHandle,
} from "./StudioViewport";
import StatusBar from "./StatusBar";
import MeasurePanel from "./MeasurePanel";
import { readingsOf, type BodyGap, type MeasureFilter } from "./measureTool";
import { StudioUnitsContext, unitFormat } from "./units";
import { BoxIcon, ExtrudeIcon, SeparateIcon } from "./studioIcons";
import { measureBetweenInWorker, measureBoundsInWorker, measurePartsInWorker } from "./geometryClient";
import { openModelAsDesign, type StudioArrival } from "./openModel";
import OperationPanel from "./OperationPanel";
import ParametersDialog from "./ParametersDialog";
import StudioSettingsDialog from "./StudioSettingsDialog";
import PathDialog from "./PathDialog";
import TraceDialog, { type TraceRequest } from "./TraceDialog";
import {
  commandOf,
  pickOf,
  startingPath,
  startOperation,
  withPick,
  type Operation,
  type OperationKind,
} from "./operations";
import {
  addParts,
  alignBody,
  alignMeasures,
  applyCommand,
  CommandError,
  layFlat,
  layFlatTurn,
  type Bounds,
} from "../../studio/commands";
import { useStudioDesign } from "./useStudioDesign";
import { fontsLoadedFor, loadFontsFor } from "./studioFonts";
import { useStudioAssistant } from "./useStudioAssistant";
import { useStudioSettings } from "../../hooks/useStudioSettings";

// Studio: a small parametric CAD. Everything that changes a design here is a command (frontend/src/studio/commands.ts)
// run through useStudioDesign, so an AI connected over MCP, or later through the prompt below, can do all of it too.

type Props = {
  isAdmin: boolean;
  onUnauthorized?: () => void;
};

// How far a copy lands from the original, so it isn't hidden inside it.
const COPY_OFFSET: [number, number, number] = [10, 10, 0];
const PANELS_KEY = "thingport_studio_panels";
const BOTH_PANELS: Record<StudioPanel, boolean> = { features: true, properties: true };

// A panel slides in from its side as it's shown again.
const fromLeft = keyframes`from { opacity: 0; transform: translateX(-12px); }`;
const fromRight = keyframes`from { opacity: 0; transform: translateX(12px); }`;

/** Which side panels this browser last showed. */
const SKETCH_KEYS: Record<string, SketchTool> = { l: "line", a: "arc", r: "rectangle", c: "circle", p: "polygon" };

function storedPanels(): Record<StudioPanel, boolean> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PANELS_KEY) ?? "null");
    if (value && typeof value === "object") {
      const { features, properties } = value as Record<string, unknown>;
      if (typeof features === "boolean" && typeof properties === "boolean") return { features, properties };
    }
  } catch {}
  return BOTH_PANELS;
}

/**
 * A side panel: beside the view on a wide screen, stacked under it on a narrow one, in `order`. Its wide-screen styles
 * all go in one breakpoint block: a responsive border shorthand would land after borderColor and reset it to the text
 * colour, and a responsive `order` beside an explicit block for the same breakpoint loses its value there.
 */
function panelSx(theme: Theme, side: "left" | "right", order: number) {
  const line = `1px solid ${theme.palette.divider}`;
  return {
    order,
    minHeight: 0,
    maxHeight: side === "right" ? 320 : "none",
    borderTop: line,
    [theme.breakpoints.up("md")]: {
      order: 0,
      maxHeight: "none",
      borderTop: 0,
      [side === "left" ? "borderLeft" : "borderRight"]: line,
    },
  };
}

function slideIn(frames: ReturnType<typeof keyframes>) {
  return {
    animation: `${frames} 200ms ease-out`,
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  };
}

/** Typing in a field, or in a dialog or menu: the page's keys stay out of the way. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox']",
    ),
  );
}

export default function StudioPage({ isAdmin, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation("app");
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const designId = searchParams.get("design");
  const location = useLocation();
  const navigate = useNavigate();
  const viewport = useRef<StudioViewportHandle>(null);

  const showError = useCallback(
    (error: unknown) => {
      if (error instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: error instanceof Error ? error.message : String(error), severity: "error" });
    },
    [onUnauthorized, toast],
  );
  const onError = useCallback((message: string) => toast({ message, severity: "error" }), [toast]);
  const { design, loadFailed, run, reload } = useStudioDesign(designId, { onError, onUnauthorized });
  const doc = design?.document ?? null;

  // With no design asked for, the latest one opens; with none at all, the empty state offers a new one.
  const [noDesigns, setNoDesigns] = useState(false);
  useEffect(() => {
    if (designId) return;
    let cancelled = false;
    studioApi.list().then(
      (designs) => {
        if (cancelled) return;
        if (designs[0]) setSearchParams({ design: designs[0].id }, { replace: true });
        else setNoDesigns(true);
      },
      (error: unknown) => !cancelled && showError(error),
    );
    return () => {
      cancelled = true;
    };
  }, [designId, setSearchParams, showError]);

  const [aiModels, setAiModels] = useState<StudioAiModels | null>(null);
  useEffect(() => {
    studioApi.aiModels().then(setAiModels, () => setAiModels({ enabled: false, models: [] }));
  }, []);
  // The assistant's steps land on the server: the design is read again as they do.
  const followAssistant = useCallback(() => {
    if (designId) void reload(designId);
  }, [designId, reload]);
  const [studioSettings, setStudioSettings] = useStudioSettings();
  const promptLayout = studioSettings.prompt_layout;
  // How much of the bottom of the view the prompt covers, which the view keeps the model above.
  const [promptInset, setPromptInset] = useState(0);

  const [selected, setSelected] = useState<string[]>([]);
  // The page opens on the design and the prompt alone; Edit brings in the toolbar and the side panels.
  const [editing, setEditing] = useState(false);
  const assistant = useStudioAssistant({
    designId: design?.id ?? null,
    offered: aiModels,
    selected,
    onProgress: followAssistant,
    onError,
    onUnauthorized,
  });
  const [mode, setMode] = useState<StudioMode>("select");
  const [panels, setPanels] = useState(storedPanels);
  const togglePanel = (panel: StudioPanel) =>
    setPanels((prev) => {
      const next = { ...prev, [panel]: !prev[panel] };
      try {
        window.localStorage.setItem(PANELS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  const [sketch, setSketch] = useState<{ id: string; tool: SketchTool } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{ id: string; at: { top: number; left: number } } | null>(null);
  const [designsOpen, setDesignsOpen] = useState(false);
  const [tracing, setTracing] = useState(false);
  const [pathing, setPathing] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The design's units, which every size on the page reads and is typed in; and each body's size and volume as the view
  // has them.
  const units = doc?.units ?? "mm";
  const format = useMemo(() => unitFormat(units, i18n.language), [units, i18n.language]);
  const [stats, setStats] = useState<BodyStats[]>([]);
  const statsById = useMemo(() => new Map(stats.map((body) => [body.id, body])), [stats]);
  // The measure tool: what it picks, and what's been picked (two at most).
  const [measureTool, setMeasureTool] = useState<{ filter: MeasureFilter; picks: Picked[] } | null>(null);
  const [bodyGap, setBodyGap] = useState<BodyGap | null>(null);
  const [checking, setChecking] = useState(false);
  const [renaming, setRenaming] = useState<{ kind: "design" } | { kind: "feature"; id: string } | null>(null);
  // A tool that takes more than a click, while its panel is open, and what making its preview said.
  const [operation, setOperation] = useState<Operation | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewFailure, setPreviewFailure] = useState<{ key: string; message: string } | null>(null);
  // A command the server works out, on its way: OK waits for it.
  const [finishing, setFinishing] = useState(false);
  // A body's loose parts, found for the Separate tool's preview, for the design as it was then.
  const [measured, setMeasured] = useState<{
    doc: StudioDocument;
    target: string;
    parts: PartMeasure[] | null;
    error: string | null;
  } | null>(null);
  // A model just brought in, to say so if it's in several parts.
  const [partsHint, setPartsHint] = useState<{ design: string; mesh: string } | null>(null);

  // Another design starts with nothing selected; a feature that's gone is let go of.
  const [shownDesign, setShownDesign] = useState(designId);
  if (shownDesign !== designId) {
    setShownDesign(designId);
    setSelected([]);
    setSketch(null);
    setErrors({});
    setOperation(null);
  }
  useEffect(() => {
    if (!doc) return;
    setSelected((prev) =>
      prev.every((id) => featureById(doc, id)) ? prev : prev.filter((id) => featureById(doc, id)),
    );
    setSketch((prev) => (prev && featureById(doc, prev.id)?.type !== "sketch" ? null : prev));
  }, [doc]);

  // A model opened here from its own page: the mesh it brought in, to say if it's in parts. Taken once, so going back
  // or reloading doesn't say it again.
  useEffect(() => {
    const imported = (location.state as StudioArrival | null)?.imported;
    if (!imported || !designId) return;
    setPartsHint({ design: designId, mesh: imported });
    navigate({ search: location.search }, { replace: true, state: null });
  }, [location.state, location.search, designId, navigate]);

  // A model that came in as one body of several parts says so once it shows, with the way to separate them.
  useEffect(() => {
    if (!partsHint || !doc || design?.id !== partsHint.design) return;
    setPartsHint(null);
    const mesh = featureById(doc, partsHint.mesh);
    if (mesh?.type !== "mesh" || !mesh.parts || mesh.parts < 2 || consumerOf(doc, mesh.id)) return;
    toast({
      message: t("studio.imported.parts", { count: mesh.parts }),
      severity: "info",
      autoHideMs: 10_000,
      action: { label: t("studio.imported.separate"), onClick: () => separateBody(mesh.id) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsHint, doc, design?.id]);

  const newDesign = useCallback(async () => {
    try {
      const created = await studioApi.create(t("studio.design.untitled"));
      setNoDesigns(false);
      setDesignsOpen(false);
      setSearchParams({ design: created.id });
    } catch (error) {
      showError(error);
    }
  }, [setSearchParams, showError, t]);

  const selectedBodies = useMemo(
    () =>
      doc
        ? selected.filter((id) => {
            const feature = featureById(doc, id);
            return feature && isBody(feature) && !consumerOf(doc, id);
          })
        : [],
    [doc, selected],
  );

  // The sketch an extrude would use: the one being drawn, else the one selected, if it has something to pull up.
  const extrudable = useMemo((): SketchFeature | null => {
    if (!doc) return null;
    const id = sketch?.id ?? (selected.length === 1 ? selected[0] : null);
    const feature = id ? featureById(doc, id) : undefined;
    if (feature?.type !== "sketch" || consumerOf(doc, feature.id)) return null;
    return feature.shapes.some((shape) => !shape.hole) ? feature : null;
  }, [doc, selected, sketch]);

  const select = useCallback((id: string | null, additive: boolean) => {
    if (!id) {
      if (!additive) setSelected([]);
      return;
    }
    setSelected((prev) => {
      if (!additive) return [id];
      return prev.includes(id) ? prev.filter((each) => each !== id) : [...prev, id];
    });
  }, []);

  const boxSelect = useCallback(
    (ids: string[], additive: boolean) =>
      setSelected((prev) => (additive ? [...prev, ...ids.filter((id) => !prev.includes(id))] : ids)),
    [],
  );

  const selectCreated = (created: string[] | null) => {
    if (created?.length) setSelected(created.slice(-1));
  };

  /** A library model's file: as a design of its own, named after the model, or into the one open. False if it failed. */
  const importModel = async (
    model: { id: string; title: string },
    fileId: string,
    into: "new" | "current",
  ): Promise<boolean> => {
    if (into === "current") {
      const created = await run("import_model", { model_id: model.id, file_id: fileId });
      if (!created) return false;
      setDesignsOpen(false);
      selectCreated(created);
      if (design && created[0]) setPartsHint({ design: design.id, mesh: created[0] });
      return true;
    }
    try {
      const created = await openModelAsDesign(model, fileId, t("studio.design.untitled"));
      setNoDesigns(false);
      setDesignsOpen(false);
      setSearchParams({ design: created.id });
      if (created.mesh) setPartsHint({ design: created.id, mesh: created.mesh });
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  };

  const add = async (kind: Primitive) => {
    const created =
      kind === "box"
        ? await run("add_box", { width: 20, depth: 20, height: 20 })
        : kind === "cylinder"
          ? await run("add_cylinder", { radius: 10, height: 20 })
          : kind === "cone"
            ? await run("add_cone", { radius_bottom: 10, radius_top: 0, height: 20 })
            : kind === "sphere"
              ? await run("add_sphere", { radius: 10 })
              : kind === "thread"
                ? await run("add_thread", { diameter: 8, length: 20 })
                : await run("add_torus", { major_radius: 15, minor_radius: 5 });
    selectCreated(created);
  };

  const startSketch = async (plane: Exclude<SketchPlane, "FACE">) => {
    const created = await run("add_sketch", { plane });
    if (!created?.[0]) return;
    setSelected([created[0]]);
    setSketch({ id: created[0], tool: "rectangle" });
  };

  // --- Tools with a panel: a preview of what they'd make, and OK makes it ---
  /** The one top-level body selected, which a tool starts on. */
  const selectedBody = selectedBodies.length === 1 ? selectedBodies[0] : null;
  const begin = (kind: OperationKind, sketchId = extrudable?.id) => {
    if (kind === "sweep") {
      const sketchFeature = sketchId && doc ? featureById(doc, sketchId) : undefined;
      if (sketchFeature?.type === "sketch")
        setOperation(startOperation(kind, sketchFeature.id, startingPath(sketchFeature)));
      return;
    }
    if (kind === "extrude" || kind === "revolve") {
      if (sketchId) setOperation(startOperation(kind, sketchId));
      return;
    }
    setSketch(null);
    setOperation(startOperation(kind, selectedBody));
  };
  const separateBody = (id: string) => {
    setEditing(true);
    setSketch(null);
    setSelected([id]);
    setOperation(startOperation("separate", id));
  };
  const draft = operation ? commandOf(operation) : null;
  const draftKey = draft ? JSON.stringify(draft) : "";
  // A text's preview is drawn in its font, fetched here the first time it's picked.
  const [fontsIn, setFontsIn] = useState(0);
  useEffect(() => {
    if (!draft || fontsLoadedFor(draft.args)) return;
    let active = true;
    loadFontsFor(draft.args).then(
      () => active && setFontsIn((n) => n + 1),
      (error: unknown) => active && showError(error),
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  // The design as the tool would leave it, shown while its panel is open; or why the command refuses it.
  const separating = operation?.kind === "separate" ? operation.target : null;
  const partsFound = measured && measured.doc === doc && measured.target === separating ? measured : null;
  // Align and lay flat move a body by what it measures: the preview measures it here, as the server will.
  const placing = draft && (draft.name === "align" || draft.name === "lay_flat") ? draft : null;
  const [boundsFound, setBoundsFound] = useState<{
    key: string;
    doc: StudioDocument;
    bounds: Record<string, Bounds> | null;
    error: string | null;
  } | null>(null);
  const placed = boundsFound && boundsFound.doc === doc && boundsFound.key === draftKey ? boundsFound : null;
  useEffect(() => {
    if (!placing || !doc || !design) return;
    const args = placing.args as Parameters<typeof alignBody>[1] & Parameters<typeof layFlat>[1];
    let measuring: { subject: StudioDocument; ids: string[] };
    try {
      measuring =
        placing.name === "align"
          ? { subject: doc, ids: alignMeasures(doc, args) }
          : { subject: layFlatTurn(doc, args), ids: [args.feature_id] };
    } catch (error) {
      setBoundsFound({
        key: draftKey,
        doc,
        bounds: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    let cancelled = false;
    measureBoundsInWorker(design.id, measuring.subject, measuring.ids).then(
      (bounds) => !cancelled && setBoundsFound({ key: draftKey, doc, bounds, error: null }),
      (error: unknown) =>
        !cancelled &&
        setBoundsFound({
          key: draftKey,
          doc,
          bounds: null,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, doc, design?.id]);
  const measuring = (Boolean(separating) && !partsFound) || (Boolean(placing) && !placed);
  const preview = useMemo(() => {
    if (!draft || !doc || draft.name === "add_sketch") return null;
    try {
      if (draft.name === "align" || draft.name === "lay_flat") {
        if (!placed) return null;
        if (!placed.bounds) return { document: null, created: [], error: placed.error };
        const args = draft.args as Parameters<typeof alignBody>[1] & Parameters<typeof layFlat>[1];
        const outcome =
          draft.name === "align"
            ? alignBody(doc, args, placed.bounds)
            : layFlat(doc, args, placed.bounds[args.feature_id]);
        return { document: outcome.document, created: outcome.created, error: null };
      }
      // The server finds a body's parts as it separates it; the preview finds them here, with the same code.
      if (draft.name === "separate_parts") {
        if (!partsFound) return null;
        if (partsFound.error) return { document: null, created: [], error: partsFound.error };
        const outcome = addParts(doc, { feature_id: partsFound.target }, partsFound.parts ?? []);
        return { document: outcome.document, created: outcome.created, error: null };
      }
      const outcome = applyCommand(doc, draft.name, draft.args);
      return { document: outcome.document, created: outcome.created, error: null };
    } catch (error) {
      return { document: null, created: [], error: error instanceof CommandError ? error.message : String(error) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, doc, partsFound, placed, fontsIn]);
  useEffect(() => {
    if (!separating || !doc || !design) return;
    let cancelled = false;
    measurePartsInWorker(design.id, doc, separating).then(
      (parts) => !cancelled && setMeasured({ doc, target: separating, parts, error: null }),
      (error: unknown) =>
        !cancelled &&
        setMeasured({
          doc,
          target: separating,
          parts: null,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, separating, design?.id]);
  const own = preview?.created ?? [];
  // A preview that couldn't be made shows the design as it is instead, so what the tool needs can still be picked.
  const previewFailed = previewFailure?.key === draftKey;
  const shown = (preview?.document && !previewFailed ? preview.document : null) ?? doc;
  const onViewErrors = (next: Record<string, string>) => {
    setErrors(next);
    const failed = own.find((id) => next[id]);
    if (operation && failed) setPreviewFailure({ key: draftKey, message: next[failed] });
  };
  const operationError = preview?.error ?? (previewFailed ? previewFailure.message : null);

  const finishOperation = async () => {
    if (!operation || !draft) return;
    setFinishing(true);
    const created = await run(draft.name, draft.args as never).finally(() => setFinishing(false));
    if (!created) return;
    setOperation(null);
    setPreviewFailure(null);
    if (operation.kind === "separate") return setSelected(created);
    if (operation.kind === "sketch_face" && created[0]) {
      setSelected([created[0]]);
      setSketch({ id: created[0], tool: "rectangle" });
      return;
    }
    if (operation.kind === "extrude" || operation.kind === "revolve" || operation.kind === "sweep") setSketch(null);
    selectCreated(created);
  };

  const onPick = (picked: Parameters<typeof withPick>[1]) => {
    if (!operation) return;
    const next = withPick(operation, picked, own);
    setOperation(next);
    // A face to sketch on is all that tool needs.
    if (next.kind === "sketch_face" && next.face) {
      const command = commandOf(next)!;
      void run(command.name, command.args as never).then((created) => {
        setOperation(null);
        if (!created?.[0]) return;
        setSelected([created[0]]);
        setSketch({ id: created[0], tool: "rectangle" });
      });
    }
  };

  /** A traced picture: selected once it's in, and a sketch alone goes straight on to its extrude. */
  const tracePicture = async (request: TraceRequest): Promise<boolean> => {
    const created = await run("trace_picture", request);
    if (!created?.length) return false;
    setSketch(null);
    setSelected(created.slice(-1));
    if (request.height === undefined) setOperation(startOperation("extrude", created[0]));
    return true;
  };

  const combine = async (kind: BooleanKind) => {
    const [target, ...tools] = selectedBodies;
    if (!target || !tools.length) return;
    selectCreated(await run("boolean", { operation: kind, target_id: target, tool_ids: tools }));
  };

  // The sketches selected, in the order they were, which a loft goes through.
  const selectedSketches = doc
    ? selected.filter((id) => featureById(doc, id)?.type === "sketch" && !consumerOf(doc, id))
    : [];
  const loftSelected = async () => {
    if (selectedSketches.length >= 2) selectCreated(await run("loft", { sketch_ids: selectedSketches }));
  };

  const hullSelected = async () => {
    if (selectedBodies.length) selectCreated(await run("hull", { feature_ids: selectedBodies }));
  };

  const deleteSelected = async () => {
    if (!doc) return;
    // What's part of another feature waits for it: deleting the boolean gives its parts back first.
    const ids = selected.filter((id) => !consumerOf(doc, id));
    for (const id of ids) await run("delete_feature", { feature_id: id });
    setSelected([]);
  };

  const exportStl = async () => {
    if (!doc || !design) return;
    try {
      const blob = await designStl(design.id, doc);
      if (!blob) return toast({ message: t("studio.design.nothingToExport"), severity: "info" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${design.name.replace(/[\\/:*?"<>|]+/g, "-") || "design"}.stl`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showError(error);
    }
  };

  // Saving to the library: the view as it is, kept with the design, is the model's picture.
  const [saving, setSaving] = useState(false);
  const saveToLibrary = async () => {
    if (!design || saving) return;
    setSaving(true);
    try {
      const snapshot = await viewport.current?.snapshot();
      const picture = snapshot ? await studioApi.addPicture(design.id, snapshot) : null;
      const { model } = await studioApi.saveToLibrary(design.id, picture ? { picture_id: picture.id } : {});
      toast({
        message: t("studio.design.saved", { name: model.title || model.name }),
        severity: "success",
        action: { label: t("studio.design.openSaved"), onClick: () => navigate(`/models/${model.id}`) },
        autoHideMs: 8000,
      });
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  const deleteDesign = async () => {
    if (!design) return;
    const ok = await confirm({
      title: t("studio.design.deleteTitle", { name: design.name }),
      message: t("studio.design.deleteMessage"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await studioApi.remove(design.id);
      setSearchParams({}, { replace: true });
    } catch (error) {
      showError(error);
    }
  };

  /** Leaving edit mode lets go of what was being made: a tool's panel, a sketch being drawn, the gizmo. */
  const toggleEditing = () => {
    if (editing) {
      setOperation(null);
      setSketch(null);
      setMeasureTool(null);
      setMode("select");
      setMenu(null);
    }
    setEditing(!editing);
  };

  // --- Measuring: only looks, so it's no command ---
  const measurePicks = measureTool?.picks;
  // A change to the design leaves what was picked behind.
  useEffect(() => {
    setMeasureTool((prev) => (prev?.picks.length ? { ...prev, picks: [] } : prev));
  }, [doc]);
  // A tool's panel or a sketch takes the clicks instead.
  useEffect(() => {
    if (operation || sketch) setMeasureTool(null);
  }, [operation, sketch]);
  useEffect(() => {
    setBodyGap(null);
    const [a, b] = measurePicks ?? [];
    if (!design || !doc || a?.kind !== "body" || b?.kind !== "body") return;
    let cancelled = false;
    measureBetweenInWorker(design.id, doc, a.body, b.body).then(
      (between) => !cancelled && setBodyGap(between),
      (error: unknown) => !cancelled && setBodyGap({ failure: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurePicks]);
  const measureReadout = useMemo(
    () => (measureTool ? readingsOf(measureTool.picks, statsById, bodyGap) : null),
    [measureTool, statsById, bodyGap],
  );
  const toggleMeasure = () => {
    if (measureTool) return setMeasureTool(null);
    setOperation(null);
    setSketch(null);
    setMeasureTool({ filter: "face", picks: [] });
  };
  const onMeasurePick = (picked: Picked) =>
    // A third pick starts again from it.
    setMeasureTool((prev) => prev && { ...prev, picks: prev.picks.length >= 2 ? [picked] : [...prev.picks, picked] });

  // --- Keys ---
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const onKey = (event: KeyboardEvent) => {
    if (!design || typing(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      event.preventDefault();
      void run(event.shiftKey ? "redo" : "undo", {});
    } else if (mod && key === "y") {
      event.preventDefault();
      void run("redo", {});
    } else if (mod) {
      return;
    } else if (event.key === "Escape") {
      if (operation) return setOperation(null);
      if (measureTool) return setMeasureTool(null);
      if (viewport.current?.cancelDrawing()) return;
      if (sketch) setSketch(null);
      else setSelected([]);
    } else if (!editing) {
      // Out of edit mode, the keys only undo and redo (above), fit the view and let go of the selection.
      if (key === "f") viewport.current?.fit();
      else if (event.key === "Escape") setSelected([]);
    } else if ((event.key === "Delete" || event.key === "Backspace") && !sketch && selected.length) {
      event.preventDefault();
      void deleteSelected();
    } else if (sketch && SKETCH_KEYS[key]) {
      // A sketch's tools by their CAD letters.
      setSketch({ ...sketch, tool: SKETCH_KEYS[key] });
    } else if (!sketch && (key === "q" || key === "w" || key === "e" || key === "r")) {
      setMode(key === "q" ? "select" : key === "w" ? "translate" : key === "e" ? "rotate" : "scale");
    } else if (key === "f") {
      viewport.current?.fit();
    } else if (key === "i" && !sketch) {
      toggleMeasure();
    }
  };
  useEffect(() => {
    keys.current = onKey;
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // --- Fills the window below the top bar ---
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      const top = root.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(480, window.innerHeight - top - 16));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const menuFeature = menu && doc ? featureById(doc, menu.id) : undefined;
  const closeMenu = () => setMenu(null);
  const menuAction = (action: () => void) => () => {
    closeMenu();
    action();
  };
  const sketchFeature = sketch && doc ? featureById(doc, sketch.id) : undefined;
  const renamingFeature = renaming?.kind === "feature" && doc ? featureById(doc, renaming.id) : undefined;
  // In the side panel layout the conversation goes beside the view, once there is one.
  const assistantPanel =
    promptLayout === "panel" &&
    Boolean(doc) &&
    !assistant.minimized &&
    (assistant.messages.length > 0 || assistant.running);

  const viewportArea = (() => {
    if (noDesigns && !designId) {
      return (
        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", p: 2 }}>
          <Box sx={{ textAlign: "center", maxWidth: 320 }}>
            <BoxIcon sx={{ fontSize: 48, color: "text.disabled" }} />
            <Typography variant="subtitle1" sx={{ mt: 1 }}>
              {t("studio.design.emptyTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
              {t("studio.design.emptyHint")}
            </Typography>
            <Button
              variant="contained"
              disableElevation
              startIcon={<AddBoxOutlinedIcon />}
              onClick={() => void newDesign()}
            >
              {t("studio.design.new")}
            </Button>
          </Box>
        </Box>
      );
    }
    if (!doc) {
      return loadFailed ? (
        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          <Button onClick={() => setDesignsOpen(true)}>{t("studio.design.open")}</Button>
        </Box>
      ) : (
        <Skeleton variant="rectangular" sx={{ position: "absolute", inset: 0, height: "auto" }} />
      );
    }
    return (
      <>
        <StudioViewport
          ref={viewport}
          designId={design!.id}
          document={shown ?? doc}
          selected={selected}
          mode={mode}
          sketch={sketch}
          onSelect={select}
          onBoxSelect={boxSelect}
          onTransform={(id: string, transform: Transform) =>
            void run("set_transform", { feature_id: id, ...transform })
          }
          onShape={(sketchId: string, shape: OutlineShape | PathShape) =>
            void run("add_sketch_shape", { sketch_id: sketchId, shape })
          }
          onContextMenu={(id, at) => {
            if (!editing) return;
            setSelected((prev) => (prev.includes(id) ? prev : [id]));
            setMenu({ id, at });
          }}
          onErrors={onViewErrors}
          pick={
            operation
              ? pickOf(operation, own)
              : measureTool
                ? {
                    kind: measureTool.filter,
                    bodies: null,
                    chosen: {
                      faces: measureTool.picks.flatMap((each) => (each.kind === "face" ? [each.face] : [])),
                      edges: measureTool.picks.flatMap((each) => (each.kind === "edge" ? [each.edge] : [])),
                      points: measureTool.picks.flatMap((each) => (each.kind === "point" ? [each.point] : [])),
                    },
                    line: measureReadout?.line ?? null,
                  }
                : null
          }
          onPick={operation ? onPick : onMeasurePick}
          onBusy={setBusy}
          onStats={setStats}
          grid={studioSettings.grid}
          tinted={operation?.kind === "separate" ? own : undefined}
          bottomInset={promptInset}
        />
        {operation && (
          <OperationPanel
            op={operation}
            onChange={setOperation}
            error={operationError}
            ready={Boolean(draft)}
            busy={busy || measuring || finishing}
            parts={partsFound?.parts}
            label={(id) => {
              const feature = featureById(doc, id);
              return feature ? featureLabel(feature, t) : id;
            }}
            onOk={() => void finishOperation()}
            onCancel={() => setOperation(null)}
          />
        )}
        {measureTool && !operation && (
          <MeasurePanel
            filter={measureTool.filter}
            onFilter={(filter) =>
              // A body is measured against a body, the rest against each other: a switch across leaves the picks.
              setMeasureTool(
                (prev) =>
                  prev && {
                    filter,
                    picks: (filter === "body") === (prev.filter === "body") ? prev.picks : [],
                  },
              )
            }
            picks={measureTool.picks}
            readings={measureReadout?.readings ?? []}
            format={format}
            label={(id) => {
              const feature = featureById(doc, id);
              return feature ? featureLabel(feature, t) : id;
            }}
            onClear={() => setMeasureTool((prev) => prev && { ...prev, picks: [] })}
            onClose={() => setMeasureTool(null)}
          />
        )}
        {(busy || saving) && !operation && (
          <Chip
            size="small"
            icon={<CircularProgress size={12} />}
            label={saving ? t("studio.design.saving") : t("studio.working")}
            // Above the prompt, however tall it is.
            sx={{
              position: "absolute",
              bottom: promptInset + 8,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1,
            }}
          />
        )}
        {topLevel(doc).length === 0 && !sketch && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ position: "absolute", top: 16, left: 0, right: 0, textAlign: "center", pointerEvents: "none", px: 2 }}
          >
            {editing ? t("studio.emptyDesign") : t("studio.emptyView")}
          </Typography>
        )}
        {sketch && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ position: "absolute", top: 12, left: 0, right: 0, textAlign: "center", pointerEvents: "none", px: 2 }}
          >
            {t(`studio.sketch.hint.${sketch.tool}`)}
          </Typography>
        )}
        <PromptOverlay assistant={assistant} isAdmin={isAdmin} layout={promptLayout} onInset={setPromptInset} />
      </>
    );
  })();

  return (
    <StudioUnitsContext.Provider value={units}>
      <Paper
        ref={root}
        variant="outlined"
        sx={(theme) => ({
          height: { xs: "auto", md: height ?? "calc(100vh - 120px)" },
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: 2,
          transition: "border-color 200ms, background-color 200ms",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          // Out of edit mode the frame is the view's own: no border, and the Edit button on the view's background.
          ...(editing ? {} : { borderColor: "transparent", bgcolor: theme.thingport.pageBackground }),
        })}
      >
        <StudioToolbar
          editing={editing}
          onToggleEditing={toggleEditing}
          designName={design?.name ?? null}
          canUndo={Boolean(design?.can_undo)}
          canRedo={Boolean(design?.can_redo)}
          canCombine={selectedBodies.length >= 2}
          canHull={selectedBodies.length >= 1}
          canLoft={selectedSketches.length >= 2}
          onLoft={() => void loftSelected()}
          onHull={() => void hullSelected()}
          canExtrude={Boolean(extrudable)}
          mode={mode}
          sketch={sketch && sketchFeature?.type === "sketch" ? { plane: sketchFeature.plane, tool: sketch.tool } : null}
          busy={!doc}
          onNewDesign={() => void newDesign()}
          onOpenDesign={() => setDesignsOpen(true)}
          onRenameDesign={() => setRenaming({ kind: "design" })}
          onExport={() => void exportStl()}
          onSaveToLibrary={() => void saveToLibrary()}
          onParameters={() => setParametersOpen(true)}
          measuring={Boolean(measureTool)}
          onMeasure={toggleMeasure}
          onDeleteDesign={() => void deleteDesign()}
          onAdd={(kind) => void add(kind)}
          onStartSketch={(plane) => void startSketch(plane)}
          onSketchTool={(tool) => setSketch((prev) => (prev ? { ...prev, tool } : prev))}
          onSketchPath={() => setPathing(true)}
          onSketchText={() =>
            sketch &&
            void run("add_sketch_shape", {
              sketch_id: sketch.id,
              shape: { type: "text", text: t("studio.text.placeholder"), size: 10, center: [0, 0] },
            })
          }
          onFinishSketch={() => setSketch(null)}
          onExtrude={() => begin("extrude")}
          onOperation={(kind) => begin(kind)}
          onTrace={() => setTracing(true)}
          onCombine={(kind) => void combine(kind)}
          onMode={setMode}
          onUndo={() => void run("undo", {})}
          onRedo={() => void run("redo", {})}
          onView={(view) => viewport.current?.view(view)}
          onFit={() => viewport.current?.fit()}
        />
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              // A hidden panel leaves a strip with its tab, while editing.
              md: [
                editing && (panels.features ? "220px" : "36px"),
                "minmax(0, 1fr)",
                editing && (panels.properties ? "270px" : "36px"),
                assistantPanel && "300px",
              ]
                .filter(Boolean)
                .join(" "),
            },
            gridTemplateRows: { xs: "minmax(360px, 60vh) auto auto auto", md: "minmax(0, 1fr)" },
          }}
        >
          {editing && (
            <Box sx={(theme) => ({ ...panelSx(theme, "right", 2), ...slideIn(fromLeft) })}>
              {panels.features ? (
                <SidePanel
                  title={t("studio.panels.features")}
                  side="left"
                  hideLabel={t("studio.panels.hide", { panel: t("studio.panels.features") })}
                  onHide={() => togglePanel("features")}
                >
                  {doc && (
                    <FeatureTree
                      document={doc}
                      selected={selected}
                      errors={errors}
                      onSelect={select}
                      onMenu={(id, at) => setMenu({ id, at })}
                      onToggleVisible={(feature) =>
                        void run("set_visibility", { feature_id: feature.id, visible: !feature.visible })
                      }
                    />
                  )}
                </SidePanel>
              ) : (
                <PanelTab
                  side="left"
                  label={t("studio.panels.features")}
                  ariaLabel={t("studio.panels.show", { panel: t("studio.panels.features") })}
                  onOpen={() => togglePanel("features")}
                />
              )}
            </Box>
          )}
          <Box
            sx={{
              order: { xs: 1, md: 0 },
              position: "relative",
              minHeight: 0,
              overflow: "hidden",
              bgcolor: (theme) => theme.thingport.pageBackground,
            }}
          >
            {viewportArea}
          </Box>
          {editing && (
            <Box sx={(theme) => ({ ...panelSx(theme, "left", 3), ...slideIn(fromRight) })}>
              {panels.properties ? (
                <SidePanel
                  title={t("studio.panels.properties")}
                  side="right"
                  hideLabel={t("studio.panels.hide", { panel: t("studio.panels.properties") })}
                  onHide={() => togglePanel("properties")}
                >
                  {doc && (
                    <PropertiesPanel
                      designId={design!.id}
                      document={doc}
                      selected={selected}
                      errors={errors}
                      run={run}
                      onSelect={(id) => setSelected([id])}
                      onSeparate={separateBody}
                      onEditSketch={(id) => {
                        setSelected([id]);
                        setSketch({ id, tool: "rectangle" });
                      }}
                    />
                  )}
                </SidePanel>
              ) : (
                <PanelTab
                  side="right"
                  label={t("studio.panels.properties")}
                  ariaLabel={t("studio.panels.show", { panel: t("studio.panels.properties") })}
                  onOpen={() => togglePanel("properties")}
                />
              )}
            </Box>
          )}
          {assistantPanel && (
            <Box
              sx={(theme) => ({
                ...panelSx(theme, "left", 4),
                ...slideIn(fromRight),
                display: "flex",
                flexDirection: "column",
                [theme.breakpoints.down("md")]: { maxHeight: 360 },
              })}
            >
              <AssistantPanel assistant={assistant} />
            </Box>
          )}
        </Box>
        {editing && doc && (
          <StatusBar
            stats={stats}
            selected={selected}
            format={format}
            onUnit={(next) => void run("set_units", { units: next })}
            panels={panels}
            onTogglePanel={togglePanel}
            onCheck={() => setChecking(true)}
            onSettings={() => setSettingsOpen(true)}
          />
        )}

        {pathing && sketch && (
          <PathDialog
            onClose={() => setPathing(false)}
            onAdd={(d) => void run("add_sketch_shape", { sketch_id: sketch.id, shape: { type: "path", d } })}
          />
        )}
        <ParametersDialog open={parametersOpen} doc={doc} run={run} onClose={() => setParametersOpen(false)} />
        <StudioSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={studioSettings}
          onChange={setStudioSettings}
          designUnits={doc ? units : null}
          onDesignUnits={(next) => void run("set_units", { units: next })}
        />
        <CheckDialog
          format={format}
          open={checking}
          designId={design?.id ?? null}
          doc={doc}
          selected={selected}
          run={run}
          onClose={() => setChecking(false)}
        />
        {tracing && design && (
          <TraceDialog
            designId={design.id}
            onClose={() => setTracing(false)}
            onTrace={tracePicture}
            onError={showError}
          />
        )}

        <Menu
          open={Boolean(menuFeature)}
          onClose={closeMenu}
          anchorReference="anchorPosition"
          anchorPosition={menu?.at}
        >
          {menuFeature && [
            <MenuItem key="rename" onClick={menuAction(() => setRenaming({ kind: "feature", id: menuFeature.id }))}>
              <ListItemIcon>
                <DriveFileRenameOutlineOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("studio.actions.rename")}</ListItemText>
            </MenuItem>,
            menuFeature.type === "sketch" && (
              <MenuItem
                key="draw"
                onClick={menuAction(() => {
                  setSelected([menuFeature.id]);
                  setSketch({ id: menuFeature.id, tool: "rectangle" });
                })}
              >
                <ListItemIcon>
                  <EditOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("studio.actions.drawOnSketch")}</ListItemText>
              </MenuItem>
            ),
            menuFeature.type === "sketch" && !consumerOf(doc!, menuFeature.id) && (
              <MenuItem
                key="extrude"
                disabled={!menuFeature.shapes.some((shape) => !shape.hole)}
                onClick={menuAction(() => begin("extrude", menuFeature.id))}
              >
                <ListItemIcon>
                  <ExtrudeIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("studio.actions.extrude")}</ListItemText>
              </MenuItem>
            ),
            <MenuItem
              key="visible"
              onClick={menuAction(
                () => void run("set_visibility", { feature_id: menuFeature.id, visible: !menuFeature.visible }),
              )}
            >
              <ListItemIcon>
                {menuFeature.visible ? (
                  <VisibilityOffOutlinedIcon fontSize="small" />
                ) : (
                  <VisibilityOutlinedIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText>{menuFeature.visible ? t("studio.actions.hide") : t("studio.actions.show")}</ListItemText>
            </MenuItem>,
            <MenuItem
              key="duplicate"
              onClick={menuAction(async () =>
                selectCreated(
                  await run("duplicate_feature", {
                    feature_id: menuFeature.id,
                    ...(isBody(menuFeature) ? { offset: COPY_OFFSET } : {}),
                  }),
                ),
              )}
            >
              <ListItemIcon>
                <ContentCopyOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("studio.actions.duplicate")}</ListItemText>
            </MenuItem>,
            isBody(menuFeature) && !consumerOf(doc!, menuFeature.id) && (
              <MenuItem key="separate" onClick={menuAction(() => separateBody(menuFeature.id))}>
                <ListItemIcon>
                  <SeparateIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("studio.actions.separate")}</ListItemText>
              </MenuItem>
            ),
            <Divider key="divider" />,
            <MenuItem
              key="delete"
              onClick={menuAction(() => void run("delete_feature", { feature_id: menuFeature.id }))}
              sx={{ color: "error.main" }}
            >
              <ListItemIcon sx={{ color: "inherit" }}>
                <DeleteOutlineIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("studio.actions.delete")}</ListItemText>
            </MenuItem>,
          ]}
        </Menu>

        <DesignsDialog
          open={designsOpen}
          currentId={design?.id ?? null}
          onClose={() => setDesignsOpen(false)}
          onOpen={(id) => {
            setDesignsOpen(false);
            setSearchParams({ design: id });
          }}
          onNew={() => void newDesign()}
          onImport={importModel}
          onError={showError}
        />
        <RenameDialog
          value={
            renaming?.kind === "design"
              ? (design?.name ?? null)
              : renamingFeature
                ? renamingFeature.name || featureLabel(renamingFeature, t)
                : null
          }
          title={renaming?.kind === "design" ? t("studio.design.rename") : t("studio.actions.rename")}
          allowEmpty={renaming?.kind === "feature"}
          maxLength={renaming?.kind === "design" ? 120 : 80}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            if (renaming?.kind === "design") void run("rename_design", { name });
            else if (renamingFeature) void run("rename_feature", { feature_id: renamingFeature.id, name });
          }}
        />
      </Paper>
    </StudioUnitsContext.Provider>
  );
}
