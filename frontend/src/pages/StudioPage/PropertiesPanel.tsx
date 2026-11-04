import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CircleOutlinedIcon from "@mui/icons-material/CircleOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PentagonOutlinedIcon from "@mui/icons-material/PentagonOutlined";
import RectangleOutlinedIcon from "@mui/icons-material/RectangleOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import GestureOutlinedIcon from "@mui/icons-material/GestureOutlined";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import {
  consumerOf,
  featureById,
  isBody,
  LIMITS,
  type BodyFeature,
  type PathShape,
  type SketchFeature,
  type SketchShape,
  type StudioDocument,
  type Vec3,
} from "../../studio/document";
import type { RunCommand } from "./useStudioDesign";
import { DEFAULT_FONT, type TextShape } from "../../studio/text";
import type { TraceShape } from "../../studio/trace";
import { PATH_CHARACTERS } from "../../studio/svgPath";
import PictureThumb from "./PictureThumb";
import { EdgeTreatmentField, NumberField, PathPointsField, StudioFontField } from "./fields";
import { featureLabel } from "./labels";
import { FeatureIcon, SeparateIcon } from "./studioIcons";

type Props = {
  designId: string;
  document: StudioDocument;
  selected: readonly string[];
  errors: Record<string, string>;
  run: RunCommand;
  onSelect: (id: string) => void;
  /** Opens the Separate tool on a body. */
  onSeparate: (id: string) => void;
  onEditSketch: (id: string) => void;
};

const show = (value: number) => String(Number(value.toFixed(3)));

function TextCommitField({
  label,
  value,
  placeholder,
  onCommit,
  multiline = false,
  maxLength = 80,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  /** Shift+Enter starts a new line; Enter still commits. */
  multiline?: boolean;
  maxLength?: number;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <TextField
      size="small"
      label={label}
      value={text}
      placeholder={placeholder}
      multiline={multiline}
      maxRows={multiline ? 4 : undefined}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => text.trim() !== value && onCommit(text.trim())}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !(multiline && event.shiftKey)) {
          event.preventDefault();
          (event.target as HTMLInputElement).blur();
        }
        if (event.key === "Escape") {
          setText(value);
          event.stopPropagation();
        }
      }}
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { maxLength } }}
      sx={{ "& input, & textarea": { py: 0.75, fontSize: "0.85rem" } }}
      fullWidth
    />
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography
        variant="caption"
        sx={{ display: "block", mb: 1, fontWeight: 700, color: "text.secondary", textTransform: "uppercase" }}
      >
        {title}
        {help && <HelpTip text={help} />}
      </Typography>
      {children}
    </Box>
  );
}

const triple = { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 } as const;
const pair = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 } as const;

/** The selected feature's dimensions, place and parts, each field one command. */
export default function PropertiesPanel({
  designId,
  document,
  selected,
  errors,
  run,
  onSelect,
  onSeparate,
  onEditSketch,
}: Props) {
  const { t } = useTranslation("app");
  const feature = selected.length === 1 ? featureById(document, selected[0]) : undefined;

  if (!feature) {
    return (
      <Box sx={{ px: 1.5, pb: 1.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {selected.length > 1
            ? t("studio.properties.selectedCount", { count: selected.length })
            : t("studio.properties.none")}
        </Typography>
      </Box>
    );
  }

  const id = feature.id;
  const update = (changes: Record<string, number | string | boolean | Vec3[]>) =>
    void run("update_feature", { feature_id: id, ...changes });
  // A field can follow a formula over the design's parameters: "=" and the formula.
  const follow = (field: string) => ({
    expression: feature.expressions?.[field],
    onExpression: (expression: string) => void run("set_expression", { feature_id: id, field, expression }),
  });
  const dimension = (key: string, value: number, unit = "mm") => (
    <NumberField
      key={key}
      label={t(`studio.properties.fields.${key}`)}
      value={value}
      unit={unit}
      onCommit={(v) => update({ [key]: v })}
      {...follow(key)}
    />
  );
  const partOf = consumerOf(document, id);

  return (
    <Box sx={{ px: 1.5, pb: 1.5, pt: 0.5, overflow: "auto", height: "100%" }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <FeatureIcon type={feature.type} sx={{ fontSize: 20, color: "primary.main" }} />
        <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          {featureLabel(feature, t)}
        </Typography>
        <Chip
          size="small"
          label={id}
          variant="outlined"
          sx={{ fontFamily: "monospace", fontSize: "0.7rem", height: 20 }}
        />
      </Stack>
      {errors[id] && (
        <Stack direction="row" spacing={0.75} sx={{ mt: 1, color: "warning.main" }}>
          <WarningAmberRoundedIcon sx={{ fontSize: 16, mt: "2px" }} />
          <Typography variant="caption">{errors[id]}</Typography>
        </Stack>
      )}
      {partOf && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
          {t("studio.properties.partOf")}{" "}
          <Box
            component="button"
            type="button"
            onClick={() => onSelect(partOf.id)}
            sx={{ font: "inherit", color: "primary.main", bgcolor: "transparent", border: 0, p: 0, cursor: "pointer" }}
          >
            {featureLabel(partOf, t)}
          </Box>
        </Typography>
      )}
      <Box sx={{ mt: 1.5 }}>
        <TextCommitField
          label={t("studio.properties.name")}
          value={feature.name}
          placeholder={featureLabel({ ...feature, name: "" }, t)}
          onCommit={(name) => void run("rename_feature", { feature_id: id, name })}
        />
      </Box>

      {feature.type === "mesh" && (
        <Section title={t("studio.properties.mesh.source")}>
          <Stack spacing={0.5}>
            <Link component={RouterLink} to={`/models/${feature.source.model_id}`} variant="body2" noWrap>
              {feature.source.model_title}
            </Link>
            <Typography variant="caption" color="text.secondary" noWrap title={feature.source.file_name}>
              {feature.source.file_name} · {t("studio.properties.mesh.triangles", { count: feature.triangles })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("studio.properties.mesh.importedSize", { size: feature.size.map(show).join(" × ") })}
            </Typography>
            {feature.solid ? (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label={t("studio.properties.mesh.solid")}
                sx={{ alignSelf: "flex-start", mt: 0.5 }}
              />
            ) : (
              <OpenWarning />
            )}
            {feature.parts !== undefined && feature.parts > 1 && (
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {t("studio.properties.mesh.parts", { count: feature.parts })}
                </Typography>
                {!partOf && (
                  <Button size="small" startIcon={<SeparateIcon />} onClick={() => onSeparate(id)}>
                    {t("studio.imported.separate")}
                  </Button>
                )}
              </Stack>
            )}
          </Stack>
        </Section>
      )}
      {feature.type === "part" && !feature.solid && <OpenWarning />}
      {feature.type === "box" && (
        <Section title={t("studio.properties.size")}>
          <Box sx={triple}>
            {dimension("width", feature.width)}
            {dimension("depth", feature.depth)}
            {dimension("height", feature.height)}
          </Box>
        </Section>
      )}
      {feature.type === "cylinder" && (
        <Section title={t("studio.properties.size")}>
          <Box sx={triple}>
            {dimension("radius", feature.radius)}
            {dimension("height", feature.height)}
            {dimension("segments", feature.segments, "")}
          </Box>
          <Stack spacing={1} sx={{ mt: 1.25 }}>
            <EdgeTreatmentField
              label={t("studio.ops.extrude.topRim")}
              value={feature.top_edge}
              onChange={(top_edge) => void run("update_feature", { feature_id: id, top_edge })}
            />
            <EdgeTreatmentField
              label={t("studio.ops.extrude.bottomRim")}
              value={feature.bottom_edge}
              onChange={(bottom_edge) => void run("update_feature", { feature_id: id, bottom_edge })}
            />
          </Stack>
        </Section>
      )}
      {feature.type === "cone" && (
        <Section title={t("studio.properties.size")}>
          <Box sx={pair}>
            {dimension("radius_bottom", feature.radius_bottom)}
            {dimension("radius_top", feature.radius_top)}
            {dimension("height", feature.height)}
            {dimension("segments", feature.segments, "")}
          </Box>
          <Stack spacing={1} sx={{ mt: 1.25 }}>
            <EdgeTreatmentField
              label={t("studio.ops.extrude.topRim")}
              value={feature.top_edge}
              onChange={(top_edge) => void run("update_feature", { feature_id: id, top_edge })}
            />
            <EdgeTreatmentField
              label={t("studio.ops.extrude.bottomRim")}
              value={feature.bottom_edge}
              onChange={(bottom_edge) => void run("update_feature", { feature_id: id, bottom_edge })}
            />
          </Stack>
        </Section>
      )}
      {feature.type === "sphere" && (
        <Section title={t("studio.properties.size")}>
          <Box sx={pair}>
            {dimension("radius", feature.radius)}
            {dimension("segments", feature.segments, "")}
          </Box>
        </Section>
      )}
      {feature.type === "torus" && (
        <Section title={t("studio.properties.size")}>
          <Box sx={triple}>
            {dimension("major_radius", feature.major_radius)}
            {dimension("minor_radius", feature.minor_radius)}
            {dimension("segments", feature.segments, "")}
          </Box>
        </Section>
      )}
      {feature.type === "extrude" && (
        <Section title={t("studio.properties.extrude")} help={t("studio.properties.extrudeHelp")}>
          <Stack spacing={1}>
            <Box sx={pair}>
              {dimension("distance", feature.distance)}
              <NumberField
                label={t("studio.ops.extrude.taper")}
                value={feature.taper ?? 0}
                unit="°"
                onCommit={(taper) => Math.abs(taper) <= 60 && update({ taper })}
              />
              <NumberField
                label={t("studio.ops.extrude.startOffset")}
                value={feature.start_offset ?? 0}
                unit="mm"
                onCommit={(start_offset) => update({ start_offset })}
              />
            </Box>
            <FormControlLabel
              sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
              control={
                <Switch
                  size="small"
                  checked={Boolean(feature.symmetric)}
                  onChange={(event) => void run("update_feature", { feature_id: id, symmetric: event.target.checked })}
                />
              }
              label={t("studio.ops.extrude.symmetric")}
            />
            <EdgeTreatmentField
              label={t("studio.ops.extrude.topEdge")}
              value={feature.top_edge}
              onChange={(top_edge) => void run("update_feature", { feature_id: id, top_edge })}
            />
            <EdgeTreatmentField
              label={t("studio.ops.extrude.bottomEdge")}
              value={feature.bottom_edge}
              onChange={(bottom_edge) => void run("update_feature", { feature_id: id, bottom_edge })}
            />
            <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => onEditSketch(feature.sketch_id)}>
              {t("studio.actions.editSketch")}
            </Button>
          </Stack>
        </Section>
      )}
      {feature.type === "pattern" && (
        <Section title={t(`studio.types.${feature.kind === "mirror" ? "mirror" : "pattern"}`)}>
          {feature.kind === "mirror" ? (
            <FormControlLabel
              sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
              control={
                <Switch
                  size="small"
                  checked={feature.keep_original}
                  onChange={(event) =>
                    void run("update_feature", { feature_id: id, keep_original: event.target.checked })
                  }
                />
              }
              label={t("studio.ops.mirror.keep")}
            />
          ) : (
            <Box sx={pair}>
              {dimension("count", feature.count, "")}
              {feature.kind === "linear"
                ? dimension("spacing", feature.spacing)
                : dimension("angle", feature.angle, "°")}
              {feature.kind === "linear" && feature.grid_direction && dimension("grid_count", feature.grid_count, "")}
              {feature.kind === "linear" && feature.grid_direction && dimension("grid_spacing", feature.grid_spacing)}
            </Box>
          )}
        </Section>
      )}
      {feature.type === "hull" && (
        <Section title={t("studio.types.hull")}>
          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            {feature.body_ids.map((part) => {
              const input = featureById(document, part);
              return (
                input && (
                  <Chip
                    key={part}
                    size="small"
                    variant="outlined"
                    icon={<FeatureIcon type={input.type} sx={{ fontSize: 16 }} />}
                    label={featureLabel(input, t)}
                    onClick={() => onSelect(part)}
                  />
                )
              );
            })}
          </Stack>
        </Section>
      )}
      {feature.type === "loft" && (
        <Section title={t("studio.types.loft")}>
          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            {feature.sketch_ids.map((part) => {
              const input = featureById(document, part);
              return (
                input && (
                  <Chip
                    key={part}
                    size="small"
                    variant="outlined"
                    icon={<FeatureIcon type={input.type} sx={{ fontSize: 16 }} />}
                    label={featureLabel(input, t)}
                    onClick={() => onSelect(part)}
                  />
                )
              );
            })}
          </Stack>
        </Section>
      )}
      {feature.type === "sweep" && (
        <Section title={t("studio.types.sweep")}>
          <Stack spacing={1}>
            <PathPointsField path={feature.path} onChange={(path) => update({ path })} />
            <Stack direction="row" spacing={1}>
              {(["smooth", "closed"] as const).map((flag) => (
                <FormControlLabel
                  key={flag}
                  sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
                  control={
                    <Switch
                      size="small"
                      checked={feature[flag]}
                      onChange={(event) => update({ [flag]: event.target.checked })}
                    />
                  }
                  label={t(`studio.ops.sweep.${flag}`)}
                />
              ))}
            </Stack>
            <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => onEditSketch(feature.sketch_id)}>
              {t("studio.actions.editSketch")}
            </Button>
          </Stack>
        </Section>
      )}
      {feature.type === "revolve" && (
        <Section title={t("studio.ops.revolve.title")}>
          <Stack spacing={1}>
            <Box sx={pair}>
              <Segmented
                fullWidth
                label={t("studio.ops.revolve.axis")}
                value={feature.axis}
                options={[
                  { value: "v", label: t("studio.ops.revolve.axisV") },
                  { value: "u", label: t("studio.ops.revolve.axisU") },
                ]}
                onChange={(axis) => void run("update_feature", { feature_id: id, axis })}
              />
              {dimension("angle", feature.angle, "°")}
            </Box>
            {dimension("segments", feature.segments, "")}
            <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => onEditSketch(feature.sketch_id)}>
              {t("studio.actions.editSketch")}
            </Button>
          </Stack>
        </Section>
      )}
      {feature.type === "press_pull" && (
        <Section title={t("studio.ops.press_pull.title")}>{dimension("distance", feature.distance)}</Section>
      )}
      {(feature.type === "fillet" || feature.type === "chamfer") && (
        <Section title={t(`studio.ops.${feature.type}.title`)}>
          <Stack spacing={1}>
            {feature.type === "fillet" ? dimension("radius", feature.radius) : dimension("distance", feature.distance)}
            <Typography variant="caption" color="text.secondary">
              {t("studio.ops.edges", { count: feature.edges.length })}
            </Typography>
          </Stack>
        </Section>
      )}
      {feature.type === "thread" && (
        <Section title={t("studio.types.thread")}>
          <Stack spacing={1}>
            <Segmented
              fullWidth
              label={t("studio.thread.kind")}
              value={feature.internal ? "internal" : "external"}
              options={(["external", "internal"] as const).map((kind) => ({
                value: kind,
                label: t(`studio.thread.${kind}`),
              }))}
              onChange={(kind) => void run("update_feature", { feature_id: id, internal: kind === "internal" })}
            />
            <Box sx={pair}>
              {dimension("diameter", feature.diameter)}
              {dimension("pitch", feature.pitch)}
              {dimension("length", feature.length)}
              {dimension("clearance", feature.clearance)}
            </Box>
            <Segmented
              fullWidth
              label={t("studio.thread.hand")}
              value={feature.hand}
              options={(["right", "left"] as const).map((hand) => ({
                value: hand,
                label: t(`studio.thread.hands.${hand}`),
              }))}
              onChange={(hand) => void run("update_feature", { feature_id: id, hand })}
            />
            <FormControlLabel
              sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
              control={
                <Switch
                  size="small"
                  checked={feature.chamfer}
                  onChange={(event) => void run("update_feature", { feature_id: id, chamfer: event.target.checked })}
                />
              }
              label={t("studio.thread.chamfer")}
            />
          </Stack>
        </Section>
      )}
      {feature.type === "hole" && (
        <Section title={t("studio.ops.hole.title")}>
          <Stack spacing={1}>
            <Box sx={pair}>
              {dimension("diameter", feature.diameter)}
              {feature.depth !== null && dimension("depth", feature.depth)}
            </Box>
            {!feature.counterbore && !feature.countersink && (
              <FormControlLabel
                sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
                control={
                  <Switch
                    size="small"
                    checked={Boolean(feature.thread)}
                    onChange={(event) =>
                      void run("update_feature", { feature_id: id, thread: event.target.checked ? {} : null })
                    }
                  />
                }
                label={
                  feature.thread
                    ? t("studio.ops.hole.threadedAs", {
                        size: `M${feature.diameter}×${feature.thread.pitch}`,
                      })
                    : t("studio.ops.hole.threaded")
                }
              />
            )}
            <FormControlLabel
              sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
              control={
                <Switch
                  size="small"
                  checked={feature.depth === null}
                  onChange={(event) =>
                    void run("update_feature", { feature_id: id, depth: event.target.checked ? null : 10 })
                  }
                />
              }
              label={t("studio.ops.hole.through")}
            />
            {feature.counterbore && (
              <Box sx={pair}>
                <NumberField
                  label={t("studio.ops.hole.boreDiameter")}
                  value={feature.counterbore.diameter}
                  unit="mm"
                  onCommit={(diameter) =>
                    diameter > 0 &&
                    void run("update_feature", { feature_id: id, counterbore: { ...feature.counterbore!, diameter } })
                  }
                />
                <NumberField
                  label={t("studio.ops.hole.boreDepth")}
                  value={feature.counterbore.depth}
                  unit="mm"
                  onCommit={(depth) =>
                    depth > 0 &&
                    void run("update_feature", { feature_id: id, counterbore: { ...feature.counterbore!, depth } })
                  }
                />
              </Box>
            )}
            {feature.countersink && (
              <Box sx={pair}>
                <NumberField
                  label={t("studio.ops.hole.sinkDiameter")}
                  value={feature.countersink.diameter}
                  unit="mm"
                  onCommit={(diameter) =>
                    diameter > 0 &&
                    void run("update_feature", { feature_id: id, countersink: { ...feature.countersink!, diameter } })
                  }
                />
                <NumberField
                  label={t("studio.ops.hole.angle")}
                  value={feature.countersink.angle}
                  unit="°"
                  onCommit={(angle) =>
                    angle >= 30 &&
                    angle <= 150 &&
                    void run("update_feature", { feature_id: id, countersink: { ...feature.countersink!, angle } })
                  }
                />
              </Box>
            )}
          </Stack>
        </Section>
      )}
      {feature.type === "shell" && (
        <Section title={t("studio.ops.shell.title")}>
          <Stack spacing={1}>
            {dimension("thickness", feature.thickness)}
            {feature.open_faces.length > 0 && (
              <Typography variant="caption" color="text.secondary">
                {t("studio.ops.shell.open", { count: feature.open_faces.length })}
              </Typography>
            )}
          </Stack>
        </Section>
      )}
      {feature.type === "split" && (
        <Section title={t("studio.ops.split.title")}>
          <Segmented
            fullWidth
            label={t("studio.ops.split.keep")}
            value={feature.keep}
            options={(feature.tool_id ? (["inside", "outside"] as const) : (["front", "back"] as const)).map(
              (keep) => ({
                value: keep,
                label: t(`studio.ops.split.${keep}`),
              }),
            )}
            onChange={(keep) => void run("update_feature", { feature_id: id, keep })}
          />
        </Section>
      )}
      {feature.type === "boolean" && (
        <Section title={t("studio.properties.operation")}>
          <Segmented
            fullWidth
            label={t("studio.properties.operation")}
            value={feature.operation}
            options={(["union", "subtract", "intersect"] as const).map((operation) => ({
              value: operation,
              label: t(`studio.actions.${operation}`),
            }))}
            onChange={(operation) => update({ operation })}
          />
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: 1.25 }}>
            {[feature.target_id, ...feature.tool_ids].map((part, index) => {
              const input = featureById(document, part);
              return (
                input && (
                  <Chip
                    key={part}
                    size="small"
                    variant={index === 0 ? "filled" : "outlined"}
                    icon={<FeatureIcon type={input.type} sx={{ fontSize: 16 }} />}
                    label={featureLabel(input, t)}
                    onClick={() => onSelect(part)}
                  />
                )
              );
            })}
          </Stack>
        </Section>
      )}
      {feature.type === "sketch" && (
        <SketchProperties designId={designId} sketch={feature} run={run} onEditSketch={onEditSketch} />
      )}
      {isBody(feature) && <TransformFields feature={feature} run={run} />}
    </Box>
  );
}

/** A mesh, or a part of one, with gaps: what it can and can't do. */
function OpenWarning() {
  const { t } = useTranslation("app");
  return (
    <Stack direction="row" alignItems="center" sx={{ color: "warning.main", mt: 0.5 }}>
      <WarningAmberRoundedIcon sx={{ fontSize: 16, mr: 0.5 }} />
      <Typography variant="caption">{t("studio.properties.mesh.open")}</Typography>
      <HelpTip text={t("studio.properties.mesh.openHelp")} />
    </Stack>
  );
}

function TransformFields({ feature, run }: { feature: BodyFeature; run: RunCommand }) {
  const { t } = useTranslation("app");
  const { position, rotation, scale } = feature.transform;
  const set = (key: "position" | "rotation" | "scale", vector: Vec3, axis: number, value: number) => {
    const next = [...vector] as Vec3;
    next[axis] = value;
    void run("set_transform", { feature_id: feature.id, [key]: next });
  };
  const row = (key: "position" | "rotation" | "scale", vector: Vec3, unit: string) => (
    <Section title={t(`studio.properties.${key}`)}>
      <Box sx={triple}>
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <NumberField
            key={axis}
            label={axis}
            value={vector[index]}
            unit={unit}
            onCommit={(v) => set(key, vector, index, v)}
            expression={feature.expressions?.[`${key}.${axis.toLowerCase()}`]}
            onExpression={(expression) =>
              void run("set_expression", {
                feature_id: feature.id,
                field: `${key}.${axis.toLowerCase()}`,
                expression,
              })
            }
          />
        ))}
      </Box>
    </Section>
  );
  return (
    <>
      {row("position", position, "mm")}
      {row("rotation", rotation, "°")}
      {row("scale", scale, "×")}
    </>
  );
}

const SHAPE_ICONS = {
  rectangle: RectangleOutlinedIcon,
  circle: CircleOutlinedIcon,
  polygon: PentagonOutlinedIcon,
  text: TextFieldsIcon,
  trace: ImageOutlinedIcon,
  path: GestureOutlinedIcon,
};

/** A path's SVG data, and whether loops inside others are holes whatever way they're drawn. */
function PathShapeFields({ shape, onChange }: { shape: PathShape; onChange: (shape: PathShape) => void }) {
  const { t } = useTranslation("app");
  return (
    <Stack spacing={1}>
      <TextCommitField
        label={t("studio.path.data")}
        value={shape.d}
        multiline
        maxLength={PATH_CHARACTERS}
        onCommit={(d) => d && onChange({ ...shape, d })}
      />
      <Segmented
        fullWidth
        label={t("studio.path.fill")}
        value={shape.fill ?? "evenodd"}
        options={(["evenodd", "nonzero"] as const).map((fill) => ({
          value: fill,
          label: t(`studio.path.fills.${fill}`),
        }))}
        onChange={(fill) => onChange({ ...shape, fill })}
      />
    </Stack>
  );
}

/** A traced picture's size, place and how it was traced: each change traces it again. */
function TraceShapeFields({
  designId,
  shape,
  onChange,
}: {
  designId: string;
  shape: TraceShape;
  onChange: (shape: TraceShape) => void;
}) {
  const { t } = useTranslation("app");
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center">
        <PictureThumb source={{ designId, pictureId: shape.picture_id }} size={40} alt={t("studio.trace.picture")} />
        <Typography variant="caption" color="text.secondary">
          {show(shape.width)} × {show(shape.height)} mm
        </Typography>
      </Stack>
      <Box sx={pair}>
        <NumberField
          label="U"
          value={shape.center[0]}
          unit="mm"
          onCommit={(u) => onChange({ ...shape, center: [u, shape.center[1]] })}
        />
        <NumberField
          label="V"
          value={shape.center[1]}
          unit="mm"
          onCommit={(v) => onChange({ ...shape, center: [shape.center[0], v] })}
        />
        <NumberField
          label={t("studio.properties.fields.width")}
          value={shape.width}
          unit="mm"
          onCommit={(width) => width > 0 && onChange({ ...shape, width })}
        />
        <NumberField
          label={t("studio.trace.threshold")}
          value={shape.threshold ?? 0}
          onCommit={(threshold) =>
            threshold >= 0 &&
            threshold <= 255 &&
            onChange({ ...shape, threshold: threshold ? Math.round(threshold) : null })
          }
        />
      </Box>
      <Segmented
        fullWidth
        label={t("studio.trace.detail")}
        value={shape.detail}
        options={(["low", "medium", "high"] as const).map((detail) => ({
          value: detail,
          label: t(`studio.trace.details.${detail}`),
        }))}
        onChange={(detail) => onChange({ ...shape, detail })}
      />
      <Stack direction="row" spacing={1}>
        <FormControlLabel
          sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
          control={
            <Switch
              size="small"
              checked={shape.invert}
              onChange={(event) => onChange({ ...shape, invert: event.target.checked })}
            />
          }
          label={t("studio.trace.invert")}
        />
        <FormControlLabel
          sx={{ ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
          control={
            <Switch
              size="small"
              checked={Boolean(shape.hole)}
              onChange={(event) => onChange({ ...shape, hole: event.target.checked })}
            />
          }
          label={t("studio.properties.hole")}
        />
      </Stack>
    </Stack>
  );
}

/** A text shape's words, font, size and lining up. */
function TextShapeFields({ shape, onChange }: { shape: TextShape; onChange: (shape: TextShape) => void }) {
  const { t } = useTranslation("app");
  return (
    <Stack spacing={1} sx={{ mb: 1 }}>
      <TextCommitField
        label={t("studio.text.words")}
        value={shape.text}
        multiline
        maxLength={LIMITS.textLength}
        onCommit={(text) => text && onChange({ ...shape, text })}
      />
      <StudioFontField
        label={t("studio.text.font")}
        value={shape.font ?? DEFAULT_FONT}
        onChange={(font) => onChange({ ...shape, font })}
      />
      <Box sx={pair}>
        <NumberField
          label={t("studio.text.size")}
          value={shape.size}
          unit="mm"
          onCommit={(size) => size > 0 && onChange({ ...shape, size })}
        />
        <NumberField
          label={t("studio.text.spacing")}
          value={shape.spacing ?? 0}
          unit="mm"
          onCommit={(spacing) => onChange({ ...shape, spacing })}
        />
      </Box>
      {shape.text.includes("\n") && (
        <Segmented
          fullWidth
          label={t("studio.text.align")}
          value={shape.align ?? "center"}
          options={(["left", "center", "right"] as const).map((align) => ({
            value: align,
            label: t(`studio.text.aligns.${align}`),
          }))}
          onChange={(align) => onChange({ ...shape, align })}
        />
      )}
    </Stack>
  );
}

function SketchProperties({
  designId,
  sketch,
  run,
  onEditSketch,
}: {
  designId: string;
  sketch: SketchFeature;
  run: RunCommand;
  onEditSketch: (id: string) => void;
}) {
  const { t } = useTranslation("app");
  const change = (index: number, shape: Exclude<SketchShape, TraceShape>) =>
    void run("update_sketch_shape", { sketch_id: sketch.id, index, shape });
  // A traced shape changes by being traced again, on the server, from its picture.
  const retrace = (index: number, shape: TraceShape) =>
    void run("trace_picture", {
      picture_id: shape.picture_id,
      sketch_id: sketch.id,
      index,
      width: shape.width,
      center: shape.center,
      threshold: shape.threshold,
      invert: shape.invert,
      detail: shape.detail,
      hole: Boolean(shape.hole),
    });
  return (
    <>
      <Section title={t("studio.properties.plane")} help={t("studio.properties.planeHelp")}>
        <Stack spacing={1}>
          {sketch.plane === "FACE" ? (
            <Typography variant="body2">{t("studio.planes.FACE")}</Typography>
          ) : (
            <Segmented
              fullWidth
              label={t("studio.properties.plane")}
              value={sketch.plane}
              options={(["XY", "XZ", "YZ"] as const).map((plane) => ({ value: plane, label: plane }))}
              onChange={(plane) => void run("update_feature", { feature_id: sketch.id, plane })}
            />
          )}
          <NumberField
            label={t("studio.properties.fields.offset")}
            value={sketch.offset}
            unit="mm"
            onCommit={(offset) => void run("update_feature", { feature_id: sketch.id, offset })}
          />
          <Button size="small" startIcon={<EditOutlinedIcon />} onClick={() => onEditSketch(sketch.id)}>
            {t("studio.actions.drawOnSketch")}
          </Button>
        </Stack>
      </Section>
      <Section title={t("studio.properties.shapes")}>
        {sketch.shapes.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("studio.properties.noShapes")}
          </Typography>
        )}
        <Stack spacing={1.25}>
          {sketch.shapes.map((shape, index) => {
            const ShapeIcon = SHAPE_ICONS[shape.type];
            return (
              // A shape has no id: the commands address it by its index too.
              // oxlint-disable-next-line react/no-array-index-key
              <Box key={index} sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1 }}>
                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
                  <ShapeIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {t(`studio.shapes.${shape.type}`)}
                    {shape.type === "polygon" && (
                      <Typography component="span" variant="caption" color="text.secondary">
                        {" "}
                        · {t("studio.properties.points", { count: shape.points.length })}
                      </Typography>
                    )}
                  </Typography>
                  <Tooltip title={t("studio.properties.removeShape")}>
                    <IconButton
                      size="small"
                      aria-label={t("studio.properties.removeShape")}
                      onClick={() => void run("remove_sketch_shape", { sketch_id: sketch.id, index })}
                      sx={{ p: 0.25 }}
                    >
                      <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </Stack>
                {shape.type === "text" && <TextShapeFields shape={shape} onChange={(next) => change(index, next)} />}
                {shape.type === "trace" ? (
                  <TraceShapeFields designId={designId} shape={shape} onChange={(next) => retrace(index, next)} />
                ) : (
                  <>
                    {shape.type === "path" && (
                      <PathShapeFields shape={shape} onChange={(next) => change(index, next)} />
                    )}
                    {shape.type !== "polygon" && shape.type !== "path" && (
                      <Box sx={pair}>
                        <NumberField
                          label="U"
                          value={shape.center[0]}
                          unit="mm"
                          onCommit={(u) => change(index, { ...shape, center: [u, shape.center[1]] })}
                        />
                        <NumberField
                          label="V"
                          value={shape.center[1]}
                          unit="mm"
                          onCommit={(v) => change(index, { ...shape, center: [shape.center[0], v] })}
                        />
                        {shape.type === "rectangle" ? (
                          <>
                            <NumberField
                              label={t("studio.properties.fields.width")}
                              value={shape.width}
                              unit="mm"
                              onCommit={(width) => change(index, { ...shape, width })}
                            />
                            <NumberField
                              label={t("studio.properties.fields.height")}
                              value={shape.height}
                              unit="mm"
                              onCommit={(height) => change(index, { ...shape, height })}
                            />
                          </>
                        ) : shape.type === "circle" ? (
                          <NumberField
                            label={t("studio.properties.fields.radius")}
                            value={shape.radius}
                            unit="mm"
                            onCommit={(radius) => change(index, { ...shape, radius })}
                          />
                        ) : null}
                      </Box>
                    )}
                    {(shape.type === "rectangle" || shape.type === "polygon") && (
                      <Box sx={{ mt: 1 }}>
                        <NumberField
                          label={t("studio.properties.cornerRadius")}
                          value={shape.corner_radius ?? 0}
                          unit="mm"
                          onCommit={(corner_radius) => corner_radius >= 0 && change(index, { ...shape, corner_radius })}
                        />
                      </Box>
                    )}
                    <FormControlLabel
                      sx={{ mt: 0.5, ml: 0, "& .MuiFormControlLabel-label": { fontSize: "0.8rem" } }}
                      control={
                        <Switch
                          size="small"
                          checked={Boolean(shape.hole)}
                          onChange={(event) => change(index, { ...shape, hole: event.target.checked })}
                        />
                      }
                      label={t("studio.properties.hole")}
                    />
                  </>
                )}
              </Box>
            );
          })}
        </Stack>
      </Section>
    </>
  );
}
