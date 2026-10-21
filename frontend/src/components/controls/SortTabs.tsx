import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

type Props<T extends string> = {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
};

/** A row of sort choices as words, the chosen one bold in the accent colour, as the model grids have it. */
export default function SortTabs<T extends string>({ value, options, onChange }: Props<T>) {
  return (
    <Stack direction="row" spacing={3}>
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <Typography
            key={option.value}
            component="button"
            type="button"
            variant="body2"
            aria-pressed={chosen}
            onClick={() => onChange(option.value)}
            sx={{
              p: 0,
              border: 0,
              bgcolor: "transparent",
              font: "inherit",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: chosen ? 700 : 500,
              color: chosen ? "primary.main" : "text.secondary",
              transition: "color 150ms",
              "&:hover": { color: "primary.main" },
              "&:focus-visible": {
                outline: "2px solid",
                outlineColor: "primary.main",
                outlineOffset: 2,
                borderRadius: 0.5,
              },
              "@media (prefers-reduced-motion: reduce)": { transition: "none" },
            }}
          >
            {option.label}
          </Typography>
        );
      })}
    </Stack>
  );
}
