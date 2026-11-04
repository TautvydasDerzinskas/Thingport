import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import Segmented from "../../components/controls/Segmented";
import FontField from "../../components/customizer/FontField";
import type { EdgeTreatment, Vec3 } from "../../studio/document";
import { fontName, STUDIO_FONTS, type StudioFontId } from "../../studio/text";

// The fields Studio's panels share: a number kept on Enter or leaving it (each change is a command), one that takes
// every valid number as it's typed (a tool's preview follows it), a text's font and a sweep's path.

const show = (value: number) => String(Number(value.toFixed(3)));
const parse = (text: string) => Number(text.replace(",", "."));

/**
 * Kept on Enter or on leaving the field; Escape, or something that isn't a number, puts it back. Where `onExpression`
 * is given, "=" and a formula over the design's parameters makes the number follow it: the field's name then has ƒx
 * after it, and the field shows the formula while it's being edited.
 */
export function NumberField({
  label,
  value,
  unit,
  onCommit,
  live,
  expression,
  onExpression,
}: {
  label: string;
  value: number;
  unit?: string;
  onCommit: (value: number) => void;
  /** Every valid number as it's typed, for a preview. */
  live?: boolean;
  /** The formula the number follows, if it does. */
  expression?: string;
  onExpression?: (expression: string) => void;
}) {
  const { t } = useTranslation("app");
  const [text, setText] = useState(show(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    // While typing a live field, "1." is still 1: only an outside change rewrites it.
    if (!editing && parse(text) !== value) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const formula = onExpression !== undefined && text.trim().startsWith("=");
  const commit = () => {
    setEditing(false);
    if (formula) {
      const typed = text.trim().slice(1).trim();
      if (typed && typed !== expression) onExpression!(typed);
      return setText(show(value));
    }
    const next = parse(text);
    if (text.trim() === "" || !Number.isFinite(next)) return setText(show(value));
    if (next !== value) onCommit(next);
  };
  const follows = expression !== undefined && !editing;
  // A narrow field has no room for a mark beside its number: ƒx goes by its name, the formula in a tooltip.
  return (
    <Tooltip title={follows ? t("studio.parameters.follows", { expression }) : ""} placement="top">
      <TextField
        size="small"
        label={
          follows ? (
            <>
              {label}{" "}
              <Box component="span" sx={{ fontStyle: "italic", fontWeight: 700, color: "primary.main" }}>
                ƒx
              </Box>
            </>
          ) : (
            label
          )
        }
        value={text}
        onFocus={() => {
          setEditing(true);
          if (expression !== undefined) setText(`=${expression}`);
        }}
        onChange={(event) => {
          setText(event.target.value);
          const next = parse(event.target.value);
          if (
            live &&
            !event.target.value.trim().startsWith("=") &&
            event.target.value.trim() !== "" &&
            Number.isFinite(next) &&
            next !== value
          )
            onCommit(next);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") {
            setText(expression !== undefined ? `=${expression}` : show(value));
            event.stopPropagation();
          }
        }}
        slotProps={{
          htmlInput: {
            inputMode: onExpression ? "text" : "decimal",
            "aria-label": `${unit ? `${label} (${unit})` : label}${expression !== undefined ? `, = ${expression}` : ""}`,
          },
          input: {
            endAdornment: unit ? <InputAdornment position="end">{unit}</InputAdornment> : undefined,
            sx: unit ? { pr: 1 } : undefined,
          },
          inputLabel: { shrink: true },
        }}
        sx={{ "& input": { py: 0.75, fontSize: "0.85rem" } }}
      />
    </Tooltip>
  );
}

/** An edge left sharp, rounded or bevelled, and how much. */
export function EdgeTreatmentField({
  label,
  value,
  onChange,
  live,
}: {
  label: string;
  value: EdgeTreatment | null | undefined;
  onChange: (value: EdgeTreatment | null) => void;
  live?: boolean;
}) {
  const { t } = useTranslation("app");
  const kind = value?.type ?? "none";
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 96px", gap: 1, alignItems: "end" }}>
      <Box>
        <Box component="span" sx={{ display: "block", fontSize: "0.75rem", color: "text.secondary", mb: 0.5 }}>
          {label}
        </Box>
        <Segmented
          fullWidth
          label={label}
          value={kind}
          options={(["none", "fillet", "chamfer"] as const).map((each) => ({
            value: each,
            label: t(`studio.edges.${each}`),
          }))}
          onChange={(each) => onChange(each === "none" ? null : { type: each, size: value?.size ?? 1 })}
        />
      </Box>
      {value && (
        <NumberField
          live={live}
          label={value.type === "fillet" ? t("studio.edges.radius") : t("studio.edges.distance")}
          value={value.size}
          unit="mm"
          onCommit={(size) => size > 0 && onChange({ ...value, size })}
        />
      )}
    </Box>
  );
}

/** Most points a sweep's path takes, as the sweep command does. */
const PATH_POINTS = 500;

/** A sweep's path, its points in the world in mm: each edited where it is, one added 10 mm above the last. */
export function PathPointsField({
  path,
  onChange,
  live,
}: {
  path: Vec3[];
  onChange: (path: Vec3[]) => void;
  live?: boolean;
}) {
  const { t } = useTranslation("app");
  return (
    <Stack spacing={0.75}>
      <Typography variant="caption" color="text.secondary">
        {t("studio.ops.sweep.path")}
      </Typography>
      {path.map((point, index) => (
        // A path's points have no ids: they're edited where they are.
        // oxlint-disable-next-line react/no-array-index-key
        <Stack key={index} direction="row" spacing={0.5} alignItems="center">
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <NumberField
              key={axis}
              live={live}
              label={axis}
              value={point[i]}
              onCommit={(value) =>
                onChange(
                  path.map((each, j) =>
                    j === index ? (each.map((coordinate, k) => (k === i ? value : coordinate)) as Vec3) : each,
                  ),
                )
              }
            />
          ))}
          <IconButton
            size="small"
            aria-label={t("studio.ops.sweep.removePoint", { number: index + 1 })}
            disabled={path.length <= 2}
            onClick={() => onChange(path.filter((_, j) => j !== index))}
          >
            <CloseRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Stack>
      ))}
      <Button
        size="small"
        startIcon={<AddIcon />}
        disabled={path.length >= PATH_POINTS}
        onClick={() => {
          const last = path[path.length - 1];
          onChange([...path, [last[0], last[1], last[2] + 10]]);
        }}
        sx={{ alignSelf: "flex-start" }}
      >
        {t("studio.ops.sweep.addPoint")}
      </Button>
    </Stack>
  );
}

/** A text shape's font, from the ones Thingport carries, each name drawn in its own face. */
export function StudioFontField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: StudioFontId;
  onChange: (font: StudioFontId) => void;
}) {
  return (
    <FontField
      name={label}
      label={label}
      value={fontName(value)}
      onChange={(name) => {
        const font = STUDIO_FONTS.find((each) => each.name === name);
        if (font) onChange(font.id);
      }}
    />
  );
}
