import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
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
import { keyframes, type Theme } from "@mui/material/styles";
import AddBoxOutlinedIcon from "@mui/icons-material/AddBoxOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DriveFileRenameOutlineOutlinedIcon from "@mui/icons-material/DriveFileRenameOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { UnauthorizedError } from "../../api/client";
import { studioApi, type StudioAiModel } from "../../api/studio";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import {
  consumerOf,
  featureById,
  isBody,
  topLevel,
  type SketchFeature,
  type SketchPlane,
  type SketchShape,
  type Transform,
} from "../../studio/document";
import DesignsDialog from "./DesignsDialog";
import { designStl } from "./exportStl";
import FeatureTree from "./FeatureTree";
import { featureLabel } from "./labels";
import PromptOverlay from "./PromptOverlay";
import PropertiesPanel from "./PropertiesPanel";
import RenameDialog from "./RenameDialog";
import StudioToolbar, { type BooleanKind, type Primitive, type StudioPanel } from "./StudioToolbar";
import StudioViewport, { type SketchTool, type StudioMode, type StudioViewportHandle } from "./StudioViewport";
import { BoxIcon, ExtrudeIcon } from "./studioIcons";
import { useStudioDesign } from "./useStudioDesign";

// Studio: a small parametric CAD. Everything that changes a design here is a command (frontend/src/studio/commands.ts)
// run through useStudioDesign, so an AI connected over MCP, or later through the prompt below, can do all of it too.

type Props = {
  isAdmin: boolean;
  onUnauthorized?: () => void;
};

// What a new body or sketch extrude starts at, in mm; the properties panel takes it from there.
const EXTRUDE_MM = 10;
// How far a copy lands from the original, so it isn't hidden inside it.
const COPY_OFFSET: [number, number, number] = [10, 10, 0];
const PANELS_KEY = "thingport_studio_panels";
const BOTH_PANELS: Record<StudioPanel, boolean> = { features: true, properties: true };

// A panel slides in from its side as it's shown again.
const fromLeft = keyframes`from { opacity: 0; transform: translateX(-12px); }`;
const fromRight = keyframes`from { opacity: 0; transform: translateX(12px); }`;

/** Which side panels this browser last showed. */
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
  const { t } = useTranslation("app");
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const designId = searchParams.get("design");
  const viewport = useRef<StudioViewportHandle>(null);

  const showError = useCallback(
    (error: unknown) => {
      if (error instanceof UnauthorizedError) onUnauthorized?.();
      else toast({ message: error instanceof Error ? error.message : String(error), severity: "error" });
    },
    [onUnauthorized, toast],
  );
  const onError = useCallback((message: string) => toast({ message, severity: "error" }), [toast]);
  const { design, loadFailed, run } = useStudioDesign(designId, { onError, onUnauthorized });
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

  const [models, setModels] = useState<StudioAiModel[] | null>(null);
  useEffect(() => {
    studioApi.aiModels().then(setModels, () => setModels([]));
  }, []);

  const [selected, setSelected] = useState<string[]>([]);
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
  const [renaming, setRenaming] = useState<{ kind: "design" } | { kind: "feature"; id: string } | null>(null);

  // Another design starts with nothing selected; a feature that's gone is let go of.
  const [shownDesign, setShownDesign] = useState(designId);
  if (shownDesign !== designId) {
    setShownDesign(designId);
    setSelected([]);
    setSketch(null);
    setErrors({});
  }
  useEffect(() => {
    if (!doc) return;
    setSelected((prev) =>
      prev.every((id) => featureById(doc, id)) ? prev : prev.filter((id) => featureById(doc, id)),
    );
    setSketch((prev) => (prev && featureById(doc, prev.id)?.type !== "sketch" ? null : prev));
  }, [doc]);

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
      return true;
    }
    try {
      const created = await studioApi.create(model.title.slice(0, 120) || t("studio.design.untitled"));
      try {
        await studioApi.run(created.id, "import_model", { model_id: model.id, file_id: fileId });
      } catch (error) {
        // A design that couldn't take the model isn't left behind, empty.
        await studioApi.remove(created.id).catch(() => undefined);
        throw error;
      }
      setNoDesigns(false);
      setDesignsOpen(false);
      setSearchParams({ design: created.id });
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
              : await run("add_torus", { major_radius: 15, minor_radius: 5 });
    selectCreated(created);
  };

  const startSketch = async (plane: SketchPlane) => {
    const created = await run("add_sketch", { plane });
    if (!created?.[0]) return;
    setSelected([created[0]]);
    setSketch({ id: created[0], tool: "rectangle" });
  };

  const extrude = async (sketchId = extrudable?.id) => {
    if (!sketchId) return;
    const created = await run("extrude", { sketch_id: sketchId, distance: EXTRUDE_MM });
    if (!created) return;
    setSketch(null);
    selectCreated(created);
  };

  const combine = async (operation: BooleanKind) => {
    const [target, ...tools] = selectedBodies;
    if (!target || !tools.length) return;
    selectCreated(await run("boolean", { operation, target_id: target, tool_ids: tools }));
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
      if (viewport.current?.cancelDrawing()) return;
      if (sketch) setSketch(null);
      else setSelected([]);
    } else if ((event.key === "Delete" || event.key === "Backspace") && !sketch && selected.length) {
      event.preventDefault();
      void deleteSelected();
    } else if (!sketch && (key === "q" || key === "w" || key === "e" || key === "r")) {
      setMode(key === "q" ? "select" : key === "w" ? "translate" : key === "e" ? "rotate" : "scale");
    } else if (key === "f") {
      viewport.current?.fit();
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
          document={doc}
          selected={selected}
          mode={mode}
          sketch={sketch}
          onSelect={select}
          onBoxSelect={boxSelect}
          onTransform={(id: string, transform: Transform) =>
            void run("set_transform", { feature_id: id, ...transform })
          }
          onShape={(sketchId: string, shape: SketchShape) =>
            void run("add_sketch_shape", { sketch_id: sketchId, shape })
          }
          onContextMenu={(id, at) => {
            setSelected((prev) => (prev.includes(id) ? prev : [id]));
            setMenu({ id, at });
          }}
          onErrors={setErrors}
        />
        {topLevel(doc).length === 0 && !sketch && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ position: "absolute", top: 16, left: 0, right: 0, textAlign: "center", pointerEvents: "none", px: 2 }}
          >
            {t("studio.emptyDesign")}
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
        <PromptOverlay models={models} isAdmin={isAdmin} />
      </>
    );
  })();

  return (
    <Paper
      ref={root}
      variant="outlined"
      sx={{
        height: { xs: "auto", md: height ?? "calc(100vh - 120px)" },
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 2,
      }}
    >
      <StudioToolbar
        designName={design?.name ?? null}
        canUndo={Boolean(design?.can_undo)}
        canRedo={Boolean(design?.can_redo)}
        canCombine={selectedBodies.length >= 2}
        canExtrude={Boolean(extrudable)}
        mode={mode}
        panels={panels}
        sketch={sketch && sketchFeature?.type === "sketch" ? { plane: sketchFeature.plane, tool: sketch.tool } : null}
        busy={!doc}
        onNewDesign={() => void newDesign()}
        onOpenDesign={() => setDesignsOpen(true)}
        onRenameDesign={() => setRenaming({ kind: "design" })}
        onExport={() => void exportStl()}
        onDeleteDesign={() => void deleteDesign()}
        onAdd={(kind) => void add(kind)}
        onStartSketch={(plane) => void startSketch(plane)}
        onSketchTool={(tool) => setSketch((prev) => (prev ? { ...prev, tool } : prev))}
        onFinishSketch={() => setSketch(null)}
        onExtrude={() => void extrude()}
        onCombine={(kind) => void combine(kind)}
        onMode={setMode}
        onTogglePanel={togglePanel}
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
            md: [panels.features && "220px", "minmax(0, 1fr)", panels.properties && "270px"].filter(Boolean).join(" "),
          },
          gridTemplateRows: { xs: "minmax(360px, 60vh) auto auto", md: "minmax(0, 1fr)" },
        }}
      >
        {panels.features && (
          <Box sx={(theme) => ({ ...panelSx(theme, "right", 2), ...slideIn(fromLeft) })}>
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
        {panels.properties && (
          <Box sx={(theme) => ({ ...panelSx(theme, "left", 3), ...slideIn(fromRight) })}>
            {doc && (
              <PropertiesPanel
                document={doc}
                selected={selected}
                errors={errors}
                run={run}
                onSelect={(id) => setSelected([id])}
                onEditSketch={(id) => {
                  setSelected([id]);
                  setSketch({ id, tool: "rectangle" });
                }}
              />
            )}
          </Box>
        )}
      </Box>

      <Menu open={Boolean(menuFeature)} onClose={closeMenu} anchorReference="anchorPosition" anchorPosition={menu?.at}>
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
              onClick={menuAction(() => void extrude(menuFeature.id))}
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
  );
}
