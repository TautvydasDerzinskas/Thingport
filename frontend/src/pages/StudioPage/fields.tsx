import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Segmented from "../../components/controls/Segmented";
import type { EdgeTreatment } from "../../studio/document";

// The number fields Studio's panels share: one kept on Enter or leaving it (each change is a command), one that takes
// every valid number as it's typed (a tool's preview follows it).

const show = (value: number) => String(Number(value.toFixed(3)));
const parse = (text: string) => Number(text.replace(",", "."));

/** Kept on Enter or on leaving the field; Escape, or something that isn't a number, puts it back. */
export function NumberField({
  label,
  value,
  unit,
  onCommit,
  live,
}: {
  label: string;
  value: number;
  unit?: string;
  onCommit: (value: number) => void;
  /** Every valid number as it's typed, for a preview. */
  live?: boolean;
}) {
  const [text, setText] = useState(show(value));
  useEffect(() => {
    // While typing a live field, "1." is still 1: only an outside change rewrites it.
    if (parse(text) !== value) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = () => {
    const next = parse(text);
    if (text.trim() === "" || !Number.isFinite(next)) return setText(show(value));
    if (next !== value) onCommit(next);
  };
  return (
    <TextField
      size="small"
      label={label}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const next = parse(event.target.value);
        if (live && event.target.value.trim() !== "" && Number.isFinite(next) && next !== value) onCommit(next);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") {
          setText(show(value));
          event.stopPropagation();
        }
      }}
      slotProps={{
        htmlInput: { inputMode: "decimal", "aria-label": unit ? `${label} (${unit})` : label },
        input: unit
          ? { endAdornment: <InputAdornment position="end">{unit}</InputAdornment>, sx: { pr: 1 } }
          : undefined,
        inputLabel: { shrink: true },
      }}
      sx={{ "& input": { py: 0.75, fontSize: "0.85rem" } }}
    />
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
