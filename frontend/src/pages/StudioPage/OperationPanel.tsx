import { useTranslation } from "react-i18next";
import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import { LIMITS, type PartMeasure } from "../../studio/document";
import { EdgeTreatmentField, NumberField, StudioFontField } from "./fields";
import type { Combine, HoleStyle, Operation } from "./operations";

const rise = keyframes`from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; }`;

type Props = {
  op: Operation;
  onChange: (op: Operation) => void;
  /** Why it can't be done as it is, from the command or from making it. */
  error: string | null;
  /** Whether OK has a command to run. */
  ready: boolean;
  /** Its preview is being made: OK waits for it, so what's made is what was seen, problems included. */
  busy: boolean;
  /** A body's name, for the chips that say what's been picked. */
  label: (id: string) => string;
  /** The parts a body would separate into, once they've been found. */
  parts?: PartMeasure[] | null;
  onOk: () => void;
  onCancel: () => void;
};

const pair = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 } as const;

/** A tool's settings, over the view while it's picked from: what it works on, its numbers, and OK or Cancel. */
export default function OperationPanel({ op, onChange, error, ready, busy, label, parts, onOk, onCancel }: Props) {
  const { t } = useTranslation("app");
  const set = (changes: Partial<Operation>) => onChange({ ...op, ...changes } as Operation);
  const target = "target" in op ? op.target : null;
  const canOk = ready && !busy && !error;

  const picked = (text: string, onClear?: () => void) => (
    <Chip size="small" label={text} onDelete={onClear} sx={{ maxWidth: "100%", alignSelf: "flex-start" }} />
  );
  const combine = (value: Combine, onCombine: (value: Combine) => void) => (
    <Stack spacing={1}>
      <Segmented
        fullWidth
        label={t("studio.ops.combine.label")}
        value={value}
        options={(["new", "join", "cut", "intersect"] as const).map((each) => ({
          value: each,
          label: t(`studio.ops.combine.${each}`),
        }))}
        onChange={onCombine}
      />
      {value !== "new" &&
        (target
          ? picked(label(target), () => set({ target: null } as Partial<Operation>))
          : hint(t("studio.ops.pickBody")))}
    </Stack>
  );
  const hint = (text: string) => (
    <Typography variant="caption" color="text.secondary">
      {text}
    </Typography>
  );

  const fields = (() => {
    switch (op.kind) {
      case "extrude":
        return (
          <>
            <Box sx={pair}>
              <NumberField
                live
                label={t("studio.properties.fields.distance")}
                value={op.distance}
                unit="mm"
                onCommit={(distance) => distance !== 0 && set({ distance })}
              />
              <NumberField
                live
                label={t("studio.ops.extrude.taper")}
                value={op.taper}
                unit="°"
                onCommit={(taper) => Math.abs(taper) <= 60 && set({ taper })}
              />
              <NumberField
                live
                label={t("studio.ops.extrude.startOffset")}
                value={op.start_offset}
                unit="mm"
                onCommit={(start_offset) => set({ start_offset })}
              />
            </Box>
            <FormControlLabel
              sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
              control={
                <Switch
                  size="small"
                  checked={op.symmetric}
                  onChange={(event) => set({ symmetric: event.target.checked })}
                />
              }
              label={t("studio.ops.extrude.symmetric")}
            />
            <EdgeTreatmentField
              live
              label={t("studio.ops.extrude.topEdge")}
              value={op.top_edge}
              onChange={(top_edge) => set({ top_edge })}
            />
            <EdgeTreatmentField
              live
              label={t("studio.ops.extrude.bottomEdge")}
              value={op.bottom_edge}
              onChange={(bottom_edge) => set({ bottom_edge })}
            />
            {combine(op.combine, (value) => set({ combine: value, target: value === "new" ? null : op.target }))}
          </>
        );
      case "revolve":
        return (
          <>
            <Box sx={pair}>
              <Segmented
                fullWidth
                label={t("studio.ops.revolve.axis")}
                value={op.axis}
                options={[
                  { value: "v", label: t("studio.ops.revolve.axisV") },
                  { value: "u", label: t("studio.ops.revolve.axisU") },
                ]}
                onChange={(axis) => set({ axis })}
              />
              <NumberField
                live
                label={t("studio.ops.revolve.angle")}
                value={op.angle}
                unit="°"
                onCommit={(angle) => angle >= 1 && angle <= 360 && set({ angle })}
              />
            </Box>
            {combine(op.combine, (value) => set({ combine: value, target: value === "new" ? null : op.target }))}
          </>
        );
      case "press_pull":
        return (
          <>
            {op.face ? picked(label(op.target ?? "")) : hint(t("studio.ops.press_pull.pick"))}
            <NumberField
              live
              label={t("studio.properties.fields.distance")}
              value={op.distance}
              unit="mm"
              onCommit={(distance) => distance !== 0 && set({ distance })}
            />
          </>
        );
      case "fillet":
      case "chamfer":
        return (
          <>
            {op.edges.length
              ? picked(t("studio.ops.edges", { count: op.edges.length }), () => set({ edges: [] }))
              : hint(t(`studio.ops.${op.kind}.pick`))}
            <NumberField
              live
              label={op.kind === "fillet" ? t("studio.edges.radius") : t("studio.edges.distance")}
              value={op.size}
              unit="mm"
              onCommit={(size) => size > 0 && set({ size })}
            />
          </>
        );
      case "hole":
        return (
          <>
            {op.at ? picked(label(op.target ?? "")) : hint(t("studio.ops.hole.pick"))}
            <Box sx={pair}>
              <NumberField
                live
                label={t("studio.ops.hole.diameter")}
                value={op.diameter}
                unit="mm"
                onCommit={(diameter) => diameter > 0 && set({ diameter })}
              />
              {!op.through && (
                <NumberField
                  live
                  label={t("studio.ops.hole.depth")}
                  value={op.depth}
                  unit="mm"
                  onCommit={(depth) => depth > 0 && set({ depth })}
                />
              )}
            </Box>
            <FormControlLabel
              sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
              control={
                <Switch
                  size="small"
                  checked={op.through}
                  onChange={(event) => set({ through: event.target.checked })}
                />
              }
              label={t("studio.ops.hole.through")}
            />
            <Segmented
              fullWidth
              label={t("studio.ops.hole.style")}
              value={op.style}
              options={(["simple", "counterbore", "countersink"] as HoleStyle[]).map((each) => ({
                value: each,
                label: t(`studio.ops.hole.${each}`),
              }))}
              onChange={(style) => set({ style })}
            />
            {op.style === "counterbore" && (
              <Box sx={pair}>
                <NumberField
                  live
                  label={t("studio.ops.hole.boreDiameter")}
                  value={op.bore_diameter}
                  unit="mm"
                  onCommit={(bore_diameter) => bore_diameter > 0 && set({ bore_diameter })}
                />
                <NumberField
                  live
                  label={t("studio.ops.hole.boreDepth")}
                  value={op.bore_depth}
                  unit="mm"
                  onCommit={(bore_depth) => bore_depth > 0 && set({ bore_depth })}
                />
              </Box>
            )}
            {op.style === "countersink" && (
              <Box sx={pair}>
                <NumberField
                  live
                  label={t("studio.ops.hole.sinkDiameter")}
                  value={op.sink_diameter}
                  unit="mm"
                  onCommit={(sink_diameter) => sink_diameter > 0 && set({ sink_diameter })}
                />
                <NumberField
                  live
                  label={t("studio.ops.hole.angle")}
                  value={op.sink_angle}
                  unit="°"
                  onCommit={(sink_angle) => sink_angle >= 30 && sink_angle <= 150 && set({ sink_angle })}
                />
              </Box>
            )}
          </>
        );
      case "shell":
        return (
          <>
            {op.target
              ? picked(label(op.target), () => set({ target: null, open: [] }))
              : hint(t("studio.ops.pickBody"))}
            <NumberField
              live
              label={t("studio.ops.shell.thickness")}
              value={op.thickness}
              unit="mm"
              onCommit={(thickness) => thickness > 0 && set({ thickness })}
            />
            {op.target &&
              (op.open.length
                ? picked(t("studio.ops.shell.open", { count: op.open.length }), () => set({ open: [] }))
                : hint(t("studio.ops.shell.pick")))}
          </>
        );
      case "split":
        return (
          <>
            {op.target
              ? picked(label(op.target), () => set({ target: null, tool: null, face: null }))
              : hint(t("studio.ops.pickBody"))}
            <Segmented
              fullWidth
              label={t("studio.ops.split.by")}
              value={op.by}
              options={(["plane", "face", "body"] as const).map((each) => ({
                value: each,
                label: t(`studio.ops.split.${each}`),
              }))}
              onChange={(by) => set({ by, face: null, tool: null })}
            />
            {op.by === "plane" && (
              <Box sx={pair}>
                <Segmented
                  fullWidth
                  label={t("studio.properties.plane")}
                  value={op.plane}
                  options={(["XY", "XZ", "YZ"] as const).map((plane) => ({ value: plane, label: plane }))}
                  onChange={(plane) => set({ plane })}
                />
                <NumberField
                  live
                  label={t("studio.properties.fields.offset")}
                  value={op.offset}
                  unit="mm"
                  onCommit={(offset) => set({ offset })}
                />
              </Box>
            )}
            {op.target &&
              op.by === "face" &&
              (op.face ? picked(t("studio.ops.split.facePicked")) : hint(t("studio.ops.split.pickFace")))}
            {op.target && op.by === "body" && (op.tool ? picked(label(op.tool)) : hint(t("studio.ops.split.pickTool")))}
          </>
        );
      case "scale":
        return (
          <>
            {op.target ? picked(label(op.target)) : hint(t("studio.ops.pickBody"))}
            <NumberField
              live
              label={t("studio.ops.scale.factor")}
              value={op.factor}
              unit="×"
              onCommit={(factor) => factor > 0 && factor <= 100 && set({ factor })}
            />
          </>
        );
      case "separate": {
        const open = parts?.filter((part) => !part.solid).length ?? 0;
        return (
          <>
            {op.target ? picked(label(op.target), () => set({ target: null })) : hint(t("studio.ops.pickBody"))}
            {op.target && parts && parts.length > 1 && hint(t("studio.ops.separate.count", { count: parts.length }))}
            {op.target && open > 0 && hint(t("studio.ops.separate.open", { count: open }))}
          </>
        );
      }
      case "sketch_face":
        return hint(t("studio.ops.sketch_face.pick"));
      case "text":
        return (
          <>
            <TextField
              size="small"
              label={t("studio.text.words")}
              value={op.text}
              placeholder={t("studio.text.placeholder")}
              multiline
              maxRows={3}
              onChange={(event) => set({ text: event.target.value })}
              helperText={t("studio.text.newLine")}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { maxLength: LIMITS.textLength },
                formHelperText: { sx: { mx: 0 } },
              }}
              fullWidth
            />
            <StudioFontField label={t("studio.text.font")} value={op.font} onChange={(font) => set({ font })} />
            <Box sx={pair}>
              <NumberField
                live
                label={t("studio.text.size")}
                value={op.size}
                unit="mm"
                onCommit={(size) => size > 0 && set({ size })}
              />
              <NumberField
                live
                label={op.combine === "cut" ? t("studio.ops.text.depth") : t("studio.ops.text.height")}
                value={op.height}
                unit="mm"
                onCommit={(height) => height > 0 && set({ height })}
              />
            </Box>
            <Segmented
              fullWidth
              label={t("studio.ops.text.on")}
              value={op.on}
              options={[
                { value: "plane", label: t("studio.ops.text.onPlane") },
                { value: "face", label: t("studio.ops.text.onFace") },
              ]}
              onChange={(on) => set({ on, face: null, target: null, combine: on === "face" ? "join" : "new" })}
            />
            {op.on === "plane" ? (
              <>
                <Segmented
                  fullWidth
                  label={t("studio.properties.plane")}
                  value={op.plane}
                  options={(["XY", "XZ", "YZ"] as const).map((plane) => ({ value: plane, label: plane }))}
                  onChange={(plane) => set({ plane })}
                />
                <Stack spacing={1}>
                  <Segmented
                    fullWidth
                    label={t("studio.ops.combine.label")}
                    value={op.combine}
                    options={(["new", "join", "cut"] as const).map((each) => ({
                      value: each,
                      label: t(`studio.ops.combine.${each}`),
                    }))}
                    onChange={(value) => set({ combine: value, target: value === "new" ? null : op.target })}
                  />
                  {op.combine !== "new" &&
                    (op.target
                      ? picked(label(op.target), () => set({ target: null }))
                      : hint(t("studio.ops.pickBody")))}
                </Stack>
              </>
            ) : (
              <>
                <Segmented
                  fullWidth
                  label={t("studio.ops.text.style")}
                  value={op.combine === "cut" ? "cut" : "join"}
                  options={[
                    { value: "join", label: t("studio.ops.text.raised") },
                    { value: "cut", label: t("studio.ops.text.engraved") },
                  ]}
                  onChange={(value) => set({ combine: value })}
                />
                {op.face && op.target
                  ? picked(label(op.target), () => set({ face: null, target: null }))
                  : hint(t("studio.ops.text.pick"))}
              </>
            )}
          </>
        );
    }
  })();

  return (
    <Paper
      elevation={6}
      component="section"
      aria-label={t(`studio.ops.${op.kind}.title`)}
      onKeyDown={(event) => {
        // Enter in a field is the field's, but for a text's words, where only Shift+Enter starts a new line.
        const field = event.target;
        if (event.key !== "Enter" || field instanceof HTMLInputElement) return;
        if (field instanceof HTMLTextAreaElement) {
          if (event.shiftKey) return;
          event.preventDefault();
        }
        if (canOk) onOk();
      }}
      sx={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 2,
        width: 300,
        maxWidth: "calc(100% - 24px)",
        maxHeight: "calc(100% - 24px)",
        overflow: "auto",
        p: 1.5,
        borderRadius: 2,
        border: 1,
        borderColor: "divider",
        animation: `${rise} 180ms ease-out`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1.25 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t(`studio.ops.${op.kind}.title`)}
          <HelpTip text={t(`studio.ops.${op.kind}.help`)} />
        </Typography>
        {busy && <CircularProgress size={14} aria-label={t("studio.working")} />}
      </Stack>
      <Stack spacing={1.25}>{fields}</Stack>
      {error && (
        <Stack direction="row" spacing={0.75} sx={{ mt: 1.25, color: "warning.main" }}>
          <WarningAmberRoundedIcon sx={{ fontSize: 16, mt: "2px" }} />
          <Typography variant="caption">{error}</Typography>
        </Stack>
      )}
      <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1.5 }}>
        <Button size="small" onClick={onCancel}>
          {t("studio.ops.cancel")}
        </Button>
        <Button size="small" variant="contained" disableElevation disabled={!canOk} onClick={onOk}>
          {t("studio.ops.ok")}
        </Button>
      </Stack>
    </Paper>
  );
}
