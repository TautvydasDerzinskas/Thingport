import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddBoxOutlinedIcon from "@mui/icons-material/AddBoxOutlined";
import AspectRatioIcon from "@mui/icons-material/AspectRatio";
import CenterFocusStrongOutlinedIcon from "@mui/icons-material/CenterFocusStrongOutlined";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DriveFileRenameOutlineOutlinedIcon from "@mui/icons-material/DriveFileRenameOutlineOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import HighlightAltOutlinedIcon from "@mui/icons-material/HighlightAltOutlined";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import PentagonOutlinedIcon from "@mui/icons-material/PentagonOutlined";
import RectangleOutlinedIcon from "@mui/icons-material/RectangleOutlined";
import RedoIcon from "@mui/icons-material/Redo";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import WallpaperOutlinedIcon from "@mui/icons-material/WallpaperOutlined";
import ThreeSixtyIcon from "@mui/icons-material/ThreeSixty";
import UndoIcon from "@mui/icons-material/Undo";
import VideocamOutlinedIcon from "@mui/icons-material/VideocamOutlined";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import type { SketchPlane } from "../../studio/document";
import type { CameraView, SketchTool, StudioMode } from "./StudioViewport";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { OperationKind } from "./operations";
import {
  ChamferIcon,
  FilletIcon,
  HoleIcon,
  PressPullIcon,
  RevolveIcon,
  ShellIcon,
  SeparateIcon,
  SplitIcon,
  BoxIcon,
  ConeIcon,
  CylinderIcon,
  ExtrudeIcon,
  IntersectIcon,
  SketchIcon,
  SphereIcon,
  SubtractIcon,
  TorusIcon,
  UnionIcon,
} from "./studioIcons";

export type Primitive = "box" | "cylinder" | "cone" | "sphere" | "torus";
export type StudioPanel = "features" | "properties";
export type BooleanKind = "union" | "subtract" | "intersect";

type Props = {
  designName: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Booleans need two bodies or more, selected; the first is the one the others act on. */
  canCombine: boolean;
  canExtrude: boolean;
  mode: StudioMode;
  /** Which side panels show. */
  panels: Record<StudioPanel, boolean>;
  /** While a sketch is being drawn: its plane, and the tool drawing it. */
  sketch: { plane: SketchPlane; tool: SketchTool } | null;
  busy: boolean;
  onNewDesign: () => void;
  onOpenDesign: () => void;
  onRenameDesign: () => void;
  onExport: () => void;
  onDeleteDesign: () => void;
  onAdd: (primitive: Primitive) => void;
  onStartSketch: (plane: Exclude<SketchPlane, "FACE">) => void;
  onSketchTool: (tool: SketchTool) => void;
  /** Adds a text to the sketch being drawn, for its words to be typed in the Properties panel. */
  onSketchText: () => void;
  onFinishSketch: () => void;
  onExtrude: () => void;
  /** Opens a tool's panel. */
  onOperation: (kind: OperationKind) => void;
  /** Opens the dialog that traces a picture into an outline. */
  onTrace: () => void;
  onCombine: (kind: BooleanKind) => void;
  onMode: (mode: StudioMode) => void;
  onTogglePanel: (panel: StudioPanel) => void;
  onUndo: () => void;
  onRedo: () => void;
  onView: (view: CameraView) => void;
  onFit: () => void;
};

const PRIMITIVES: { kind: Primitive; Icon: typeof BoxIcon }[] = [
  { kind: "box", Icon: BoxIcon },
  { kind: "cylinder", Icon: CylinderIcon },
  { kind: "cone", Icon: ConeIcon },
  { kind: "sphere", Icon: SphereIcon },
  { kind: "torus", Icon: TorusIcon },
];

const MODIFY: { kind: OperationKind; Icon: React.ComponentType<SvgIconProps> }[] = [
  { kind: "press_pull", Icon: PressPullIcon },
  { kind: "fillet", Icon: FilletIcon },
  { kind: "chamfer", Icon: ChamferIcon },
  { kind: "shell", Icon: ShellIcon },
  { kind: "split", Icon: SplitIcon },
  { kind: "separate", Icon: SeparateIcon },
  { kind: "scale", Icon: AspectRatioIcon },
];

const BOOLEANS: { kind: BooleanKind; Icon: typeof BoxIcon }[] = [
  { kind: "union", Icon: UnionIcon },
  { kind: "subtract", Icon: SubtractIcon },
  { kind: "intersect", Icon: IntersectIcon },
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

/** An icon button with its name in a tooltip, and the key that does the same where there is one. */
function Tool({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip title={shortcut ? `${label} (${shortcut})` : label}>
      <span>
        <IconButton size="small" aria-label={label} disabled={disabled} onClick={onClick} sx={{ borderRadius: 1.5 }}>
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

const Gap = () => <Divider orientation="vertical" flexItem sx={{ mx: 0.75, my: 0.5 }} />;

export default function StudioToolbar(props: Props) {
  const { t } = useTranslation("app");
  const [designMenu, setDesignMenu] = useState<HTMLElement | null>(null);
  const [sketchMenu, setSketchMenu] = useState<HTMLElement | null>(null);
  const [viewMenu, setViewMenu] = useState<HTMLElement | null>(null);
  const [panelMenu, setPanelMenu] = useState<HTMLElement | null>(null);
  const [shapesMenu, setShapesMenu] = useState<HTMLElement | null>(null);
  const [modifyMenu, setModifyMenu] = useState<HTMLElement | null>(null);
  const noDesign = props.designName === null;

  const menuItem = (icon: React.ReactNode, label: string, onClick: () => void, close: () => void) => (
    <MenuItem
      onClick={() => {
        close();
        onClick();
      }}
    >
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText>{label}</ListItemText>
    </MenuItem>
  );
  const closeDesign = () => setDesignMenu(null);

  return (
    <Box
      role="toolbar"
      aria-label={t("studio.toolbar.label")}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.25,
        px: 1,
        py: 0.5,
        minHeight: 48,
        borderBottom: 1,
        borderColor: "divider",
        overflowX: "auto",
        "& svg": { fontSize: 20 },
      }}
    >
      <Button
        size="small"
        color="inherit"
        endIcon={<KeyboardArrowDownIcon />}
        onClick={(event) => setDesignMenu(event.currentTarget)}
        aria-haspopup="menu"
        sx={{ textTransform: "none", fontWeight: 600, maxWidth: 220, flexShrink: 0 }}
      >
        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
          {props.designName ?? t("studio.design.none")}
        </Typography>
      </Button>
      <Menu anchorEl={designMenu} open={Boolean(designMenu)} onClose={closeDesign}>
        {menuItem(<AddBoxOutlinedIcon fontSize="small" />, t("studio.design.new"), props.onNewDesign, closeDesign)}
        {menuItem(
          <FolderOpenOutlinedIcon fontSize="small" />,
          t("studio.design.open"),
          props.onOpenDesign,
          closeDesign,
        )}
        {!noDesign &&
          menuItem(
            <DriveFileRenameOutlineOutlinedIcon fontSize="small" />,
            t("studio.design.rename"),
            props.onRenameDesign,
            closeDesign,
          )}
        {!noDesign &&
          menuItem(
            <FileDownloadOutlinedIcon fontSize="small" />,
            t("studio.design.export"),
            props.onExport,
            closeDesign,
          )}
        {!noDesign && <Divider />}
        {!noDesign && (
          <MenuItem
            onClick={() => {
              closeDesign();
              props.onDeleteDesign();
            }}
            sx={{ color: "error.main" }}
          >
            <ListItemIcon sx={{ color: "inherit" }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("studio.design.delete")}</ListItemText>
          </MenuItem>
        )}
      </Menu>
      <Gap />

      {props.sketch ? (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, whiteSpace: "nowrap" }}>
            {t("studio.sketch.on", { plane: t(`studio.planes.${props.sketch.plane}`) })}
          </Typography>
          <Segmented
            label={t("studio.sketch.tool")}
            value={props.sketch.tool}
            options={[
              { value: "rectangle", label: t("studio.shapes.rectangle"), icon: <RectangleOutlinedIcon /> },
              { value: "circle", label: t("studio.shapes.circle"), icon: <CircleOutlinedIcon /> },
              { value: "polygon", label: t("studio.shapes.polygon"), icon: <PentagonOutlinedIcon /> },
            ]}
            onChange={props.onSketchTool}
          />
          <Tool label={t("studio.text.add")} onClick={props.onSketchText}>
            <TextFieldsIcon />
          </Tool>
          <Tool label={t("studio.actions.extrude")} disabled={!props.canExtrude} onClick={props.onExtrude}>
            <ExtrudeIcon />
          </Tool>
          <Button
            size="small"
            variant="contained"
            disableElevation
            startIcon={<CheckRoundedIcon />}
            onClick={props.onFinishSketch}
            sx={{ ml: 0.5, flexShrink: 0 }}
          >
            {t("studio.sketch.finish")}
          </Button>
        </>
      ) : (
        <>
          <Tool
            label={t("studio.actions.sketch")}
            disabled={noDesign || props.busy}
            onClick={(event) => setSketchMenu(event.currentTarget)}
          >
            <SketchIcon />
          </Tool>
          <Menu anchorEl={sketchMenu} open={Boolean(sketchMenu)} onClose={() => setSketchMenu(null)}>
            {(["XY", "XZ", "YZ"] as const).map((plane) => (
              <MenuItem
                key={plane}
                onClick={() => {
                  setSketchMenu(null);
                  props.onStartSketch(plane);
                }}
              >
                <ListItemText primary={t(`studio.planes.${plane}`)} secondary={plane} />
              </MenuItem>
            ))}
            <Divider />
            <MenuItem
              onClick={() => {
                setSketchMenu(null);
                props.onOperation("sketch_face");
              }}
            >
              <ListItemText primary={t("studio.planes.FACE")} secondary={t("studio.planes.faceHint")} />
            </MenuItem>
          </Menu>
          <Tool label={t("studio.actions.extrude")} disabled={!props.canExtrude} onClick={props.onExtrude}>
            <ExtrudeIcon />
          </Tool>
          <Tool
            label={t("studio.actions.revolve")}
            disabled={!props.canExtrude}
            onClick={() => props.onOperation("revolve")}
          >
            <RevolveIcon />
          </Tool>
          <Tool
            label={t("studio.ops.hole.title")}
            disabled={noDesign || props.busy}
            onClick={() => props.onOperation("hole")}
          >
            <HoleIcon />
          </Tool>
          <Tool
            label={t("studio.ops.text.title")}
            disabled={noDesign || props.busy}
            onClick={() => props.onOperation("text")}
          >
            <TextFieldsIcon />
          </Tool>
          <Tool label={t("studio.trace.title")} disabled={noDesign || props.busy} onClick={props.onTrace}>
            <WallpaperOutlinedIcon />
          </Tool>
          <Gap />
          <Tool
            label={t("studio.toolbar.shapes")}
            disabled={noDesign || props.busy}
            onClick={(event) => setShapesMenu(event.currentTarget)}
          >
            <BoxIcon />
            <KeyboardArrowDownIcon sx={{ fontSize: "14px !important", ml: -0.25 }} />
          </Tool>
          <Menu anchorEl={shapesMenu} open={Boolean(shapesMenu)} onClose={() => setShapesMenu(null)}>
            {PRIMITIVES.map(({ kind, Icon }) => (
              <MenuItem
                key={kind}
                onClick={() => {
                  setShapesMenu(null);
                  props.onAdd(kind);
                }}
              >
                <ListItemIcon>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t(`studio.types.${kind}`)}</ListItemText>
              </MenuItem>
            ))}
          </Menu>
          <Tool
            label={t("studio.toolbar.modify")}
            disabled={noDesign || props.busy}
            onClick={(event) => setModifyMenu(event.currentTarget)}
          >
            <FilletIcon />
            <KeyboardArrowDownIcon sx={{ fontSize: "14px !important", ml: -0.25 }} />
          </Tool>
          <Menu anchorEl={modifyMenu} open={Boolean(modifyMenu)} onClose={() => setModifyMenu(null)}>
            {MODIFY.map(({ kind, Icon }) => (
              <MenuItem
                key={kind}
                onClick={() => {
                  setModifyMenu(null);
                  props.onOperation(kind);
                }}
              >
                <ListItemIcon>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t(`studio.ops.${kind}.title`)}</ListItemText>
              </MenuItem>
            ))}
          </Menu>
          <Gap />
          {BOOLEANS.map(({ kind, Icon }) => (
            <Tool
              key={kind}
              label={t(`studio.actions.${kind}`)}
              disabled={!props.canCombine}
              onClick={() => props.onCombine(kind)}
            >
              <Icon />
            </Tool>
          ))}
          <Gap />
          <Segmented
            label={t("studio.transform.label")}
            value={props.mode}
            options={[
              { value: "select", label: `${t("studio.transform.select")} (Q)`, icon: <HighlightAltOutlinedIcon /> },
              { value: "translate", label: `${t("studio.transform.translate")} (W)`, icon: <OpenWithIcon /> },
              { value: "rotate", label: `${t("studio.transform.rotate")} (E)`, icon: <ThreeSixtyIcon /> },
              { value: "scale", label: `${t("studio.transform.scale")} (R)`, icon: <AspectRatioIcon /> },
            ]}
            onChange={props.onMode}
          />
        </>
      )}
      <Gap />
      <Tool label={t("studio.actions.undo")} shortcut={`${mod}Z`} disabled={!props.canUndo} onClick={props.onUndo}>
        <UndoIcon />
      </Tool>
      <Tool
        label={t("studio.actions.redo")}
        shortcut={isMac ? "⇧⌘Z" : "Ctrl+Y"}
        disabled={!props.canRedo}
        onClick={props.onRedo}
      >
        <RedoIcon />
      </Tool>
      <Box sx={{ flex: 1 }} />
      <HelpTip text={t("studio.view.navigation")} />
      <Tool label={t("studio.panels.label")} onClick={(event) => setPanelMenu(event.currentTarget)}>
        <ViewSidebarOutlinedIcon />
      </Tool>
      <Menu anchorEl={panelMenu} open={Boolean(panelMenu)} onClose={() => setPanelMenu(null)}>
        {(["features", "properties"] as const).map((panel) => (
          <MenuItem
            key={panel}
            role="menuitemcheckbox"
            aria-checked={props.panels[panel]}
            onClick={() => props.onTogglePanel(panel)}
          >
            <ListItemIcon>{props.panels[panel] && <CheckRoundedIcon fontSize="small" />}</ListItemIcon>
            <ListItemText>{t(`studio.panels.${panel}`)}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
      <Tool label={t("studio.view.label")} onClick={(event) => setViewMenu(event.currentTarget)}>
        <VideocamOutlinedIcon />
      </Tool>
      <Menu anchorEl={viewMenu} open={Boolean(viewMenu)} onClose={() => setViewMenu(null)}>
        {(["iso", "top", "front", "right"] as const).map((view) => (
          <MenuItem
            key={view}
            onClick={() => {
              setViewMenu(null);
              props.onView(view);
            }}
          >
            {t(`studio.view.${view}`)}
          </MenuItem>
        ))}
      </Menu>
      <Tool label={t("studio.view.fit")} shortcut="F" onClick={props.onFit}>
        <CenterFocusStrongOutlinedIcon />
      </Tool>
    </Box>
  );
}
