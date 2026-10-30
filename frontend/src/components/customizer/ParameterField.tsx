import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import HelpTip from "../HelpTip";
import ColorField from "../controls/ColorField";
import Segmented from "../controls/Segmented";
import type { ScadParameter } from "../../sdk/openscad";
import FileField from "./FileField";
import FontField from "./FontField";
import { controlFor } from "./parameters";

type Props = {
  parameter: ScadParameter;
  value: unknown;
  onChange: (value: unknown) => void;
  /** A file chosen for a parameter that reads one. */
  onFile: (fileName: string, bytes: Uint8Array) => void;
  disabled?: boolean;
};

/** The choices a segmented control or dropdown offers, keyed by position: a value may be any JSON. */
const optionKey = (index: number) => String(index);

/** What a vector's components are called, for the fields' accessible names. */
const AXES = ["X", "Y", "Z", "W"];

/** One parameter, as the control its declaration asks for. */
export default function ParameterField({ parameter, value, onChange, onFile, disabled }: Props) {
  const { t } = useTranslation("models");
  const control = controlFor(parameter);

  const label = (
    <Stack direction="row" alignItems="baseline" spacing={0.5} sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600, wordBreak: "break-word" }}>
        {parameter.name}
      </Typography>
      {/* The author's own sentence about the parameter, behind a `?`: a column of them buries the controls. */}
      {parameter.caption && <HelpTip text={parameter.caption} />}
      <Box sx={{ flex: 1 }} />
      {(control.kind === "slider" || control.kind === "number") && (
        <Typography variant="caption" sx={{ color: "text.primary", fontVariantNumeric: "tabular-nums" }}>
          {String(value ?? "")}
        </Typography>
      )}
    </Stack>
  );

  if (control.kind === "switch") {
    const { on, off } = control;
    // Compared as text so a boolean value still matches a "true"/"false" choice; anything matching neither
    // reads as off rather than guessing.
    const checked = String(value) === String(on.value);
    return (
      <FormControlLabel
        sx={{ ml: 0, gap: 1 }}
        control={
          <Switch
            size="small"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked ? on.value : off.value)}
          />
        }
        label={
          <Stack direction="row" alignItems="center" spacing={0.25}>
            <Typography variant="body2">{parameter.name}</Typography>
            {parameter.caption && <HelpTip text={parameter.caption} />}
          </Stack>
        }
      />
    );
  }

  if (control.kind === "segmented") {
    const selected = control.options.findIndex((option) => JSON.stringify(option.value) === JSON.stringify(value));
    return (
      <Stack spacing={0.5}>
        {label}
        <Segmented
          label={parameter.name}
          disabled={disabled}
          value={optionKey(selected < 0 ? 0 : selected)}
          options={control.options.map((option, index) => ({
            value: optionKey(index),
            label: String(option.name),
          }))}
          onChange={(key) => onChange(control.options[Number(key)].value)}
        />
      </Stack>
    );
  }

  if (control.kind === "select") {
    const selected = control.options.findIndex((option) => JSON.stringify(option.value) === JSON.stringify(value));
    return (
      <Stack spacing={0.5}>
        {label}
        <TextField
          select
          size="small"
          fullWidth
          disabled={disabled}
          value={optionKey(selected < 0 ? 0 : selected)}
          onChange={(event) => onChange(control.options[Number(event.target.value)].value)}
          slotProps={{ htmlInput: { "aria-label": parameter.name } }}
        >
          {control.options.map((option, index) => (
            <MenuItem key={optionKey(index)} value={optionKey(index)}>
              {String(option.name)}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    );
  }

  if (control.kind === "slider") {
    return (
      <Stack spacing={0.5}>
        {label}
        <Slider
          size="small"
          disabled={disabled}
          min={control.min}
          max={control.max}
          step={control.step}
          value={typeof value === "number" ? value : control.min}
          // While dragging, so the number above keeps up; the model is only rendered when asked for.
          onChange={(_event, next) => onChange(next as number)}
          aria-label={parameter.name}
          sx={{ mx: 0.5, width: "calc(100% - 8px)" }}
        />
      </Stack>
    );
  }

  if (control.kind === "vector") {
    return (
      <Stack spacing={0.5}>
        {label}
        <VectorField parameter={parameter} value={value} onChange={onChange} disabled={disabled} />
      </Stack>
    );
  }

  if (control.kind === "color") {
    return (
      <Stack spacing={0.5}>
        {label}
        <ColorField
          value={String(value ?? "")}
          onChange={onChange}
          label={parameter.name}
          pickLabel={t("customizer.form.pickColor")}
          disabled={disabled}
        />
      </Stack>
    );
  }

  if (control.kind === "font") {
    return (
      <Stack spacing={0.5}>
        {label}
        <FontField name={parameter.name} value={String(value ?? "")} onChange={onChange} disabled={disabled} />
      </Stack>
    );
  }

  if (control.kind === "file") {
    return (
      <Stack spacing={0.5}>
        {label}
        <FileField
          name={parameter.name}
          value={String(value ?? "")}
          initial={String(parameter.initial)}
          accept={control.accept}
          onFile={onFile}
          onClear={() => onChange(parameter.initial)}
          disabled={disabled}
        />
      </Stack>
    );
  }

  return (
    <Stack spacing={0.5}>
      {label}
      <TextField
        size="small"
        fullWidth
        disabled={disabled}
        type={control.kind === "number" ? "number" : "text"}
        value={control.kind === "number" ? (value as number) : String(value ?? "")}
        onChange={(event) => onChange(control.kind === "number" ? numberOr(event.target.value, 0) : event.target.value)}
        slotProps={{
          htmlInput: { "aria-label": parameter.name, ...(control.kind === "number" ? { step: control.step } : {}) },
        }}
      />
    </Stack>
  );
}

function numberOr(text: string, fallback: number): number {
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * A vector as one field per component.
 *
 * Almost every vector a script declares is a size or a position, so three numbers side by side say what they
 * are. Its length is taken from the value it came with, since that is what the script expects back.
 */
function VectorField({ parameter, value, onChange, disabled }: Omit<Props, "onFile">) {
  const current = Array.isArray(value) ? value : [];
  const incoming = JSON.stringify(current);
  // Held as text while a component is being edited: a half-typed "-" or "1." is not yet a number, and
  // rounding it to one as it is typed takes the keyboard away from the reader.
  const [draft, setDraft] = useState(() => ({ parts: current.map(String), of: incoming }));
  // A vector that changed from outside -- an undo, or Reset -- replaces what was being typed. Adjusted during
  // the render that brings it rather than in an effect, so no pass ever draws the stale text.
  if (draft.of !== incoming) setDraft({ parts: current.map(String), of: incoming });

  return (
    <Stack direction="row" spacing={0.75}>
      {draft.parts.map((part, index) => (
        <TextField
          // A fixed row of components, never reordered or added to: the position is the identity.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          size="small"
          disabled={disabled}
          value={part}
          onChange={(event) => {
            const parts = draft.parts.with(index, event.target.value);
            const next = parts.map((entry) => numberOr(entry, 0));
            setDraft({ parts, of: JSON.stringify(next) });
            onChange(next);
          }}
          slotProps={{
            htmlInput: {
              "aria-label": `${parameter.name} ${AXES[index] ?? index + 1}`,
              inputMode: "decimal",
              style: { textAlign: "center" },
            },
          }}
          sx={{ flex: 1, minWidth: 0 }}
        />
      ))}
    </Stack>
  );
}
