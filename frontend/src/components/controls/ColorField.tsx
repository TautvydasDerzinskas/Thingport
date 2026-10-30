import { useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";

const HEX = /^#[0-9a-f]{6}$/i;

/** What was typed, as a colour: the # is easily left off, and pasted hex often comes without one. */
const asColor = (text: string) => (text.startsWith("#") ? text : `#${text}`);

type Props = {
  /** A `#rrggbb`. */
  value: string;
  onChange: (value: string) => void;
  /** What the colour is for, which names both halves. */
  label: string;
  /** The swatch's tooltip. */
  pickLabel: string;
  disabled?: boolean;
};

/** A colour as a swatch opening the browser's own picker, beside the same colour as text to type or paste. */
export default function ColorField({ value, onChange, label, pickLabel, disabled }: Props) {
  // Held as text while it is being typed: a half-typed colour isn't one yet, and only a whole one is sent on.
  const [draft, setDraft] = useState({ text: value, of: value });
  // A colour that changed from outside -- an undo, or Reset -- replaces what was being typed. Adjusted during the
  // render that brings it rather than in an effect, so no pass ever draws the stale text.
  if (draft.of !== value) setDraft({ text: value, of: value });

  const type = (text: string) => {
    const color = asColor(text);
    const whole = HEX.test(color);
    setDraft({ text, of: whole ? color : value });
    if (whole) onChange(color);
  };

  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Tooltip title={pickLabel}>
        {/* A span so the tooltip still has something to hold while the swatch is disabled. */}
        <Box component="span" sx={{ display: "inline-flex", flexShrink: 0 }}>
          <Box
            component="input"
            type="color"
            // The picker only takes the lower-case long form, and an invalid value would otherwise read as black
            // without saying so.
            value={HEX.test(value) ? value.toLowerCase() : "#000000"}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            aria-label={`${label}: ${pickLabel}`}
            sx={{
              display: "block",
              width: 40,
              height: 40,
              p: 0,
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              bgcolor: "transparent",
              overflow: "hidden",
              cursor: disabled ? "default" : "pointer",
              appearance: "none",
              transition: "transform 150ms",
              "&:hover:not(:disabled)": { transform: "scale(1.05)" },
              "&:focus-visible": { outline: "2px solid", outlineColor: "text.primary", outlineOffset: 2 },
              "&:disabled": { opacity: 0.5 },
              "&::-webkit-color-swatch-wrapper": { p: 0 },
              "&::-webkit-color-swatch": { border: 0 },
              "&::-moz-color-swatch": { border: 0 },
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            }}
          />
        </Box>
      </Tooltip>
      <TextField
        size="small"
        fullWidth
        disabled={disabled}
        value={draft.text}
        error={!HEX.test(asColor(draft.text))}
        onChange={(event) => type(event.target.value)}
        onBlur={() => setDraft({ text: value, of: value })}
        slotProps={{ htmlInput: { "aria-label": label, spellCheck: false, maxLength: 7 } }}
      />
    </Stack>
  );
}
