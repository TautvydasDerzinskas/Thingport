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
import { studioApi, type StudioAiModels, type StudioExport } from "../../api/studio";
import { useConfirm } from "../../components/ConfirmProvider";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import PanelTab from "../../components/PanelTab";
import { useToast } from "../../components/ToastProvider";
import {
  consumerOf,
  DEFAULT_PLATE_ID,
  plateOf,
  studioPlates,
  featureById,
  inputsOf,
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
import ArrangeDialog from "./ArrangeDialog";
import FitTestDialog from "./FitTestDialog";
import type { BodyCheck } from "../../studio/printCheck";
import DesignsDialog from "./DesignsDialog";
import StudioDesignMenu from "./StudioDesignMenu";
import StudioExportDialog from "./StudioExportDialog";
import StudioSlicerDialog, { studioExportName } from "./StudioSlicerDialog";
import { saveResponseToDisk } from "../../utils/downloadResponse";
import { onTopBarHeight } from "../../utils/topBarHeight";
import ObjectsPanel from "./ObjectsPanel";
import { featureLabel, plateLabel } from "./labels";
import { AssistantPanel } from "./AssistantThread";
import PromptOverlay from "./PromptOverlay";
import PropertiesPanel from "./PropertiesPanel";
import RenameDialog from "../../components/RenameDialog";
import SidePanel from "./SidePanel";
import ResizeHandle, { useResizableWidth } from "../../components/ResizeHandle";
import PrintProfilePanel from "./PrintProfilePanel";
import StudioSaveDialog, { type StudioSaveDraft, type StudioSaveRequest } from "./StudioSaveDialog";
import { profileAiPrompt } from "./printProfileUi";
import { useSlicerSettings } from "../../hooks/useSlicerPreference";
import { useUserPrinters } from "../../hooks/useUserPrinters";
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
import StudioSourcePlate, { useSourcePlate } from "./StudioSourcePlate";
import HiddenPlateNotice from "./HiddenPlateNotice";
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
// Which of the right panel's two the browser last showed.
const RIGHT_TAB_KEY = "thingport_studio_right_tab";
type RightTab = "properties" | "print";
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

/** The Objects / Plates panel's width in px, and the most of the window it takes so the view keeps the rest. A changed
 *  width lasts while Studio stays open. */
const OBJECTS_WIDTH = { default: 220, min: 180, max: 480, share: 0.4 };

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
  const slicerSettings = useSlicerSettings();
  const { printers: userPrinters } = useUserPrinters();
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
  const { design, loadFailed, run, reload, waitForSaves } = useStudioDesign(designId, { onError, onUnauthorized });
  const openDesignId = design?.id;
  const designName = design?.name;
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
  // How much of the bottom of the view the prompt covers, which the view keeps the model above.
  const [promptInset, setPromptInset] = useState(0);

  const [selected, setSelected] = useState<string[]>([]);
  const [pickedPlate, setPickedPlate] = useState(DEFAULT_PLATE_ID);
  const activePlate =
    doc && studioPlates(doc).some((plate) => plate.id === pickedPlate) ? pickedPlate : DEFAULT_PLATE_ID;
  const plateInView = doc ? studioPlates(doc).find((plate) => plate.id === activePlate) : undefined;
  const plateSource = plateInView?.source;
  const [slicerOpen, setSlicerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Edit adds the design tools and side panels.
  const [editing, setEditing] = useState(false);
  const [editHandMode, setEditHandMode] = useState(false);
  const assistant = useStudioAssistant({
    designId: design?.id ?? null,
    offered: aiModels,
    selected,
    activePlate,
    onProgress: followAssistant,
    onError,
    onUnauthorized,
  });
  const [mode, setMode] = useState<StudioMode>("select");
  const [panels, setPanels] = useState(storedPanels);
  const objectsWidth = useResizableWidth(OBJECTS_WIDTH.default, OBJECTS_WIDTH);
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
  const [arranging, setArranging] = useState<{ designId: string; plate: string } | null>(null);
  const [fitTest, setFitTest] = useState<{ designId: string; id: string } | null>(null);
  const [fitArrival, setFitArrival] = useState<{ designId: string; id: string } | null>(null);
  const fitJoint = fitTest && fitTest.designId === designId && doc ? featureById(doc, fitTest.id) : null;
  const [printIssue, setPrintIssue] = useState<{
    doc: StudioDocument;
    id: string;
    highlights?: BodyCheck["highlights"];
  } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: "design" } | { kind: "feature"; id: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveDraft, setSaveDraft] = useState<StudioSaveDraft | null>(null);
  const [rightTab, setRightTabState] = useState<RightTab>(() => {
    try {
      return window.localStorage.getItem(RIGHT_TAB_KEY) === "print" ? "print" : "properties";
    } catch {
      return "properties";
    }
  });
  const setRightTab = (tab: RightTab) => {
    setRightTabState(tab);
    try {
      window.localStorage.setItem(RIGHT_TAB_KEY, tab);
    } catch {}
  };
  // A tool that takes more than a click, while its panel is open, and what making its preview said.
  const [operation, setOperation] = useState<Operation | null>(null);
  const handModeSuspended = Boolean(operation || sketch || measureTool);
  const handMode = !editing || (editHandMode && !handModeSuspended);
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
  const sourcePlate = useSourcePlate(
    designId,
    // A hidden plate isn't drawn, so there's no need to load it.
    plateInView?.hidden ? undefined : plateInView,
    design?.undone_source_plate_ids?.includes(activePlate) ?? false,
    run,
    setPartsHint,
  );

  // Another design starts with nothing selected; a feature that's gone is let go of.
  const [shownDesign, setShownDesign] = useState(designId);
  if (shownDesign !== designId) {
    setShownDesign(designId);
    setPickedPlate(DEFAULT_PLATE_ID);
    setSlicerOpen(false);
    setExportOpen(false);
    setSaveOpen(false);
    setSaveDraft(null);
    setSelected([]);
    setSketch(null);
    setErrors({});
    setOperation(null);
  }
  useEffect(() => {
    if (!doc) return;
    const onPlate = (id: string) => {
      let feature = featureById(doc, id);
      while (feature) {
        const parent = consumerOf(doc, feature.id);
        if (!parent) return plateOf(feature) === activePlate;
        feature = parent;
      }
      return false;
    };
    setSelected((prev) => (prev.every(onPlate) ? prev : prev.filter(onPlate)));
    // Hiding the plate, from here or by an assistant, ends drawing on a sketch the view no longer shows.
    const plateHidden = studioPlates(doc).some((plate) => plate.id === activePlate && plate.hidden);
    setSketch((prev) =>
      prev && !plateHidden && onPlate(prev.id) && featureById(doc, prev.id)?.type === "sketch" ? prev : null,
    );
  }, [doc, activePlate]);

  const changePlate = (id: string) => {
    if (id === activePlate) return;
    setPickedPlate(id);
    setSelected([]);
    setSketch(null);
    setOperation(null);
    setMeasureTool(null);
    setMenu(null);
  };
  useEffect(() => {
    if (!fitArrival || !doc || fitArrival.designId !== designId) return;
    const body = featureById(doc, fitArrival.id);
    if (!body) return;
    setPickedPlate(plateOf(body));
    setSelected([body.id]);
    setFitArrival(null);
  }, [doc, fitArrival, designId]);

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

  // A new design is named first, as designs are found again by name.
  const [naming, setNaming] = useState(false);
  const newDesign = useCallback(() => setNaming(true), []);
  const createDesign = useCallback(
    async (name: string) => {
      try {
        const created = await studioApi.create(name);
        setNoDesigns(false);
        setDesignsOpen(false);
        setSearchParams({ design: created.id });
      } catch (error) {
        showError(error);
      }
    },
    [setSearchParams, showError],
  );

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
      const created = await run("import_model", { model_id: model.id, file_id: fileId, plate_id: activePlate });
      if (!created) return false;
      setDesignsOpen(false);
      setSelected(created.slice(0, 1));
      if (design && created.length === 1) setPartsHint({ design: design.id, mesh: created[0] });
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
        ? await run("add_box", { plate_id: activePlate, width: 20, depth: 20, height: 20 })
        : kind === "cylinder"
          ? await run("add_cylinder", { plate_id: activePlate, radius: 10, height: 20 })
          : kind === "cone"
            ? await run("add_cone", { plate_id: activePlate, radius_bottom: 10, radius_top: 0, height: 20 })
            : kind === "sphere"
              ? await run("add_sphere", { plate_id: activePlate, radius: 10 })
              : kind === "thread"
                ? await run("add_thread", { plate_id: activePlate, diameter: 8, length: 20 })
                : await run("add_torus", { plate_id: activePlate, major_radius: 15, minor_radius: 5 });
    selectCreated(created);
  };

  const startSketch = async (plane: Exclude<SketchPlane, "FACE">) => {
    const created = await run("add_sketch", { plate_id: activePlate, plane });
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
  const operationCommand = operation ? commandOf(operation) : null;
  const draft =
    operationCommand?.name === "add_text"
      ? { ...operationCommand, args: { ...operationCommand.args, plate_id: activePlate } }
      : operationCommand;
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
      const outcome = applyCommand(
        doc,
        draft.name,
        draft.name === "split" ? { ...draft.args, separate_plates: false } : draft.args,
      );
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
    if (operation.kind === "split" && operation.separatePlates) return setSelected(created.slice(0, 1));
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
      void run(command.name, { ...command.args, plate_id: activePlate } as never).then((created) => {
        setOperation(null);
        if (!created?.[0]) return;
        setSelected([created[0]]);
        setSketch({ id: created[0], tool: "rectangle" });
      });
    }
  };

  /** A traced picture: selected once it's in, and a sketch alone goes straight on to its extrude. */
  const tracePicture = async (request: TraceRequest): Promise<boolean> => {
    const created = await run("trace_picture", { ...request, plate_id: activePlate });
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

  // A person's delete asks first, saying when what a feature is made from stays behind; undo brings it all back.
  const confirmDelete = (ids: string[]) => {
    const features = doc ? ids.flatMap((id) => featureById(doc, id) ?? []) : [];
    if (!features.length) return Promise.resolve(false);
    return confirm({
      title:
        features.length === 1
          ? t("studio.actions.deleteTitle", { name: featureLabel(features[0], t) })
          : t("studio.actions.deleteManyTitle", { count: features.length }),
      message: features.some((feature) => inputsOf(feature).length)
        ? t("studio.actions.deleteGivesBack")
        : t("studio.actions.deleteHint"),
      confirmLabel: t("studio.actions.delete"),
      destructive: true,
    });
  };

  const deleteSelected = async () => {
    if (!doc) return;
    // What's part of another feature waits for it: deleting the boolean gives its parts back first.
    const ids = selected.filter((id) => !consumerOf(doc, id));
    if (!(await confirmDelete(ids))) return;
    for (const id of ids) await run("delete_feature", { feature_id: id });
    setSelected([]);
  };

  const [exporting, setExporting] = useState(false);
  const downloadDesign = async (options?: StudioExport) => {
    if (!design || exporting) return;
    setExporting(true);
    try {
      const saved = await waitForSaves(design.id);
      if (!saved) return;
      const plateId = options?.plate;
      const plate = plateId ? studioPlates(saved.document).find((entry) => entry.id === plateId) : undefined;
      const name = plate ? `${saved.name} - ${plateLabel(plate, t)}` : saved.name;
      const extension = options?.format === "stl-zip" ? "zip" : options?.format;
      const filename = studioExportName(name, extension);
      await saveResponseToDisk(await studioApi.export(saved.id, filename, options), filename);
    } catch (error) {
      showError(error);
    } finally {
      setExporting(false);
    }
  };

  // Saving to the library: the view as it is, kept with the design, is the model's picture.
  const [saving, setSaving] = useState(false);
  // The view as shown, for the save dialog's picture of the plate in view.
  const snapshotView = useCallback(() => viewport.current?.snapshot() ?? Promise.resolve(null), []);
  const saveToLibrary = async ({ name, modelId, profileName, picturePlate }: StudioSaveRequest) => {
    if (!design || saving) return;
    setSaving(true);
    try {
      const saved = await waitForSaves(design.id);
      if (!saved) return;
      // A new model pictured by the plate in view is shown by the view as it is; by another plate, the server
      // pictures that one. A profile added to a model leaves its pictures alone. A hidden plate draws nothing, so it
      // gives no picture.
      const plateHasBodies =
        !modelId &&
        (picturePlate ?? activePlate) === activePlate &&
        !studioPlates(saved.document).some((plate) => plate.id === activePlate && plate.hidden) &&
        topLevel(saved.document).some(
          (feature) => isBody(feature) && feature.visible && plateOf(feature) === activePlate,
        );
      const snapshot = plateHasBodies ? await viewport.current?.snapshot() : null;
      const picture = snapshot ? await studioApi.addPicture(saved.id, snapshot) : null;
      const { model } = await studioApi.saveToLibrary(saved.id, {
        ...(name ? { name } : {}),
        picture_id: picture?.id,
        ...(modelId ? { model_id: modelId } : {}),
        ...(profileName ? { profile_name: profileName } : {}),
        ...(picturePlate && !modelId ? { picture_plate_id: picturePlate } : {}),
      });
      setSaveOpen(false);
      setSaveDraft(null);
      toast({
        message: modelId
          ? t("studio.save.addedProfile", { profile: profileName, name: model.title || model.name })
          : t("studio.design.saved", { name: model.title || model.name }),
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

  const openSlicer = useCallback(async () => {
    if (openDesignId && (await waitForSaves(openDesignId))) setSlicerOpen(true);
  }, [openDesignId, waitForSaves]);

  const deleteDesign = useCallback(async () => {
    if (!openDesignId || designName === undefined) return;
    const ok = await confirm({
      title: t("studio.design.deleteTitle", { name: designName }),
      message: t("studio.design.deleteMessage"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await studioApi.remove(openDesignId);
      setSearchParams({}, { replace: true });
    } catch (error) {
      showError(error);
    }
  }, [confirm, designName, openDesignId, setSearchParams, showError, t]);

  const headerActions = useMemo(
    () => (
      <StudioDesignMenu
        key={openDesignId}
        designId={openDesignId ?? null}
        onNewDesign={newDesign}
        onBrowseDesigns={() => setDesignsOpen(true)}
        onSwitchDesign={(id) => setSearchParams({ design: id })}
        onRenameDesign={() => setRenaming({ kind: "design" })}
        onExport={() => setExportOpen(true)}
        onOpenSlicer={() => void openSlicer()}
        onDeleteDesign={() => void deleteDesign()}
      />
    ),
    [deleteDesign, newDesign, openDesignId, openSlicer, setSearchParams],
  );
  usePageHeader({
    title: designName,
    subtitle: designName ? t("sidebar.studio") : undefined,
    actions: headerActions,
  });

  /** Leaving edit mode lets go of what was being made: a tool's panel, a sketch being drawn, the gizmo. */
  const toggleEditing = () => {
    if (editing) {
      setOperation(null);
      setSketch(null);
      setMeasureTool(null);
      setMode("select");
      setEditHandMode(false);
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
    const stopListening = onTopBarHeight(update);
    return () => {
      window.removeEventListener("resize", update);
      stopListening();
    };
  }, []);

  const menuFeature = menu && doc ? featureById(doc, menu.id) : undefined;
  const closeMenu = () => setMenu(null);
  const menuAction = (action: () => void) => () => {
    closeMenu();
    action();
  };
  const sketchFeature = sketch && doc ? featureById(doc, sketch.id) : undefined;
  const renamingFeature = renaming?.kind === "feature" && doc ? featureById(doc, renaming.id) : undefined;
  const assistantPanel =
    !editing && Boolean(doc) && !assistant.minimized && (assistant.messages.length > 0 || assistant.running);

  // The print profile: who may be asked to choose one, and what the design is for, in words.
  const canAskAi = Boolean(assistant.models?.length);
  const aiBusy = assistant.running || assistant.sending;
  const madeByPrompts = assistant.messages.some((message) => message.role === "user");
  const aboutDesign = [
    design?.name,
    ...(doc?.features.flatMap((feature) => (feature.type === "mesh" ? [feature.source.model_title] : [])) ?? []),
    ...assistant.messages.filter((message) => message.role === "user").map((message) => message.text),
  ]
    .filter(Boolean)
    .join("\n");
  const suggestProfile = () => {
    if (!design || aiBusy) return;
    void assistant.send(profileAiPrompt(t, design.document.print_profile, slicerSettings, userPrinters));
  };
  // A profile an AI chose or changed marks the Print tab until it's looked at; nothing opens by itself.
  const [printBadge, setPrintBadge] = useState(false);
  const printShown = editing && panels.properties && rightTab === "print";
  const profileStamp = `${design?.id ?? ""}:${doc?.print_profile ? JSON.stringify(doc.print_profile) : ""}`;
  const seenProfile = useRef(profileStamp);
  useEffect(() => {
    if (profileStamp === seenProfile.current) return;
    const sameDesign = seenProfile.current.split(":")[0] === profileStamp.split(":")[0];
    seenProfile.current = profileStamp;
    const by = doc?.print_profile?.by;
    if (sameDesign && by && by !== "person" && !printShown) setPrintBadge(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileStamp]);
  useEffect(() => {
    if (printShown) setPrintBadge(false);
  }, [printShown]);
  const openPrintTab = () => {
    setEditing(true);
    if (!panels.properties) togglePanel("properties");
    setRightTab("print");
  };

  const viewportArea = (() => {
    if (plateInView && plateSource && !plateInView.hidden)
      return <StudioSourcePlate plate={plateInView} {...sourcePlate} />;
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
            <Button variant="contained" disableElevation startIcon={<AddBoxOutlinedIcon />} onClick={newDesign}>
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
          handMode={handMode}
          activePlate={activePlate}
          printIssue={
            printIssue && printIssue.doc === shown && selected.includes(printIssue.id) ? printIssue : undefined
          }
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
        {plateInView?.hidden && (
          <HiddenPlateNotice
            plate={plateInView}
            onShow={() => void run("set_plate_visibility", { plate_id: plateInView.id, visible: true })}
          />
        )}
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
        {(busy || saving || exporting) && !operation && (
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
        <PromptOverlay assistant={assistant} isAdmin={isAdmin} editing={editing} onInset={setPromptInset} />
      </>
    );
  })();

  const showObjectsPanel = editing || (doc !== null && studioPlates(doc).length > 1);
  const objectsLabel = t("studio.panels.features");

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
          // In view mode the toolbar sits on the view's background.
          ...(editing ? {} : { borderColor: "transparent", bgcolor: theme.thingport.pageBackground }),
        })}
      >
        <StudioToolbar
          editing={editing}
          onToggleEditing={toggleEditing}
          handMode={handMode}
          handModeSuspended={handModeSuspended}
          onToggleHandMode={() => setEditHandMode((active) => !active)}
          hasDesign={Boolean(design)}
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
          busy={!doc || Boolean(plateSource)}
          exporting={exporting}
          saving={saving}
          onSaveDesign={() => void downloadDesign()}
          onSaveToLibrary={() => setSaveOpen(true)}
          onParameters={() => setParametersOpen(true)}
          measuring={Boolean(measureTool)}
          onMeasure={toggleMeasure}
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
              // A hidden panel leaves a strip with its tab.
              md: [
                showObjectsPanel && (panels.features ? `${objectsWidth.width}px` : "36px"),
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
          {showObjectsPanel && (
            <Box
              sx={(theme) => ({
                ...panelSx(theme, "right", 2),
                ...slideIn(fromLeft),
                // Above the view, which the resize handle reaches over.
                position: "relative",
                zIndex: 1,
              })}
            >
              {panels.features && (
                <Box sx={{ display: { xs: "none", md: "block" } }}>
                  <ResizeHandle
                    edge="right"
                    width={objectsWidth.width}
                    min={OBJECTS_WIDTH.min}
                    max={objectsWidth.max}
                    defaultWidth={OBJECTS_WIDTH.default}
                    onChange={objectsWidth.setWidth}
                    label={t("studio.panels.resize", { panel: objectsLabel })}
                    hint={t("studio.panels.resizeHint")}
                  />
                </Box>
              )}
              {panels.features ? (
                <ObjectsPanel
                  key={designId}
                  document={doc}
                  activePlate={activePlate}
                  editing={editing}
                  exporting={exporting}
                  selected={selected}
                  errors={errors}
                  onHide={() => togglePanel("features")}
                  onChangePlate={changePlate}
                  onExportPlate={(plate) => void downloadDesign({ format: "stl", plate })}
                  onArrange={(plate) => {
                    if (!design) return;
                    changePlate(plate);
                    setArranging({ designId: design.id, plate });
                  }}
                  onSelect={(plate, id, additive) => {
                    changePlate(plate);
                    select(id, plate === activePlate && additive);
                  }}
                  onMenu={(plate, id, at) => {
                    changePlate(plate);
                    setMenu({ id, at });
                  }}
                  run={run}
                />
              ) : (
                <PanelTab
                  side="left"
                  label={objectsLabel}
                  ariaLabel={t("studio.panels.show", { panel: objectsLabel })}
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
                  title={t("studio.panels.rightPanel")}
                  tabs={{
                    items: [
                      { id: "properties", label: t("studio.panels.properties") },
                      { id: "print", label: t("studio.panels.print"), badge: printBadge },
                    ],
                    value: rightTab,
                    onChange: (tab) => setRightTab(tab as RightTab),
                  }}
                  side="right"
                  hideLabel={t("studio.panels.hide", { panel: t("studio.panels.rightPanel") })}
                  onHide={() => togglePanel("properties")}
                >
                  {doc && rightTab === "properties" && (
                    <PropertiesPanel
                      designId={design!.id}
                      document={doc}
                      selected={selected}
                      errors={errors}
                      run={run}
                      onSelect={(id) => setSelected([id])}
                      onSeparate={separateBody}
                      onFitTest={(id) => setFitTest({ designId: design!.id, id })}
                      onEditSketch={(id) => {
                        setSelected([id]);
                        setSketch({ id, tool: "rectangle" });
                      }}
                    />
                  )}
                  {doc && design && rightTab === "print" && (
                    <Box sx={{ height: "100%", overflowY: "auto" }}>
                      <PrintProfilePanel
                        design={design}
                        run={run}
                        canAskAi={canAskAi}
                        aiBusy={aiBusy}
                        onSuggestAi={suggestProfile}
                        about={aboutDesign}
                      />
                    </Box>
                  )}
                </SidePanel>
              ) : (
                <Box
                  sx={{ display: "flex", flexDirection: { xs: "row", md: "column" }, gap: { md: 1 }, height: "100%" }}
                >
                  {(["properties", "print"] as const).map((tab) => {
                    const label = t(`studio.panels.${tab}`);
                    return (
                      <PanelTab
                        key={tab}
                        side="right"
                        stacked
                        label={label}
                        badge={tab === "print" && printBadge}
                        ariaLabel={t("studio.panels.show", { panel: label })}
                        onOpen={() => {
                          setRightTab(tab);
                          togglePanel("properties");
                        }}
                      />
                    );
                  })}
                </Box>
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
          onLocate={(id, highlights, startLayFlat) => {
            const feature = doc && featureById(doc, id);
            if (!feature || !doc) return;
            changePlate(plateOf(feature));
            setSelected([id]);
            setPrintIssue({ doc, id, highlights });
            setChecking(false);
            if (startLayFlat) {
              setSketch(null);
              setOperation(startOperation("lay_flat", id));
            }
          }}
        />
        {arranging && design && arranging.designId === design.id && doc && (
          <ArrangeDialog
            doc={doc}
            designId={design.id}
            plateId={arranging.plate}
            run={run}
            onClose={() => setArranging(null)}
          />
        )}
        {fitJoint?.type === "split" && design && doc && (
          <FitTestDialog
            key={`${design.id}:${fitJoint.id}`}
            joint={fitJoint}
            run={run}
            onClose={() => setFitTest(null)}
            onCreated={(ids) => {
              setFitTest(null);
              if (ids[0]) setFitArrival({ designId: design.id, id: ids[0] });
            }}
          />
        )}
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
          // The menu overlay can receive the browser's contextmenu event after pointerup.
          onContextMenu={(event) => event.preventDefault()}
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
              <MenuItem
                key="lock"
                onClick={menuAction(
                  () =>
                    void run("lock_plate_positions", {
                      feature_ids: [menuFeature.id],
                      locked: !doc?.locked_layout?.includes(menuFeature.id),
                    }),
                )}
              >
                <ListItemText>
                  {t(
                    doc?.locked_layout?.includes(menuFeature.id)
                      ? "studio.print.unlockPosition"
                      : "studio.print.lockPosition",
                  )}
                </ListItemText>
              </MenuItem>
            ),
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
              onClick={menuAction(() => {
                const id = menuFeature.id;
                void confirmDelete([id]).then((ok) => {
                  if (ok) void run("delete_feature", { feature_id: id });
                });
              })}
              sx={{ color: "error.main" }}
            >
              <ListItemIcon sx={{ color: "inherit" }}>
                <DeleteOutlineIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("studio.actions.delete")}</ListItemText>
            </MenuItem>,
          ]}
        </Menu>

        {slicerOpen && design && (
          <StudioSlicerDialog
            design={design}
            activePlate={activePlate}
            run={run}
            onClose={() => setSlicerOpen(false)}
            onError={showError}
          />
        )}
        {exportOpen && doc && (
          <StudioExportDialog
            document={doc}
            downloading={exporting}
            onDownload={(exportFormat) => void downloadDesign({ format: exportFormat })}
            onClose={() => setExportOpen(false)}
          />
        )}
        <DesignsDialog
          open={designsOpen}
          currentId={design?.id ?? null}
          onClose={() => setDesignsOpen(false)}
          onOpen={(id) => {
            setDesignsOpen(false);
            setSearchParams({ design: id });
          }}
          onNew={newDesign}
          onImport={importModel}
          onError={showError}
        />
        <RenameDialog
          value={naming ? t("studio.design.untitled") : null}
          title={t("studio.design.new")}
          maxLength={120}
          saveLabel={t("studio.design.create")}
          selectOnOpen
          onClose={() => setNaming(false)}
          onSave={(name) => void createDesign(name)}
        />
        {saveOpen && design && (
          <StudioSaveDialog
            design={design}
            run={run}
            canAskAi={canAskAi}
            aiBusy={aiBusy}
            onSuggestAi={suggestProfile}
            madeByPrompts={madeByPrompts}
            about={aboutDesign}
            saving={saving}
            draft={saveDraft}
            activePlate={activePlate}
            snapshot={snapshotView}
            onEditProfile={(left) => {
              setSaveDraft(left);
              setSaveOpen(false);
              openPrintTab();
            }}
            onSave={(request) => void saveToLibrary(request)}
            onClose={() => {
              setSaveDraft(null);
              setSaveOpen(false);
            }}
            onUnauthorized={onUnauthorized}
          />
        )}
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
