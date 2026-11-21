import { useState } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { defaultSortDirection, type SortDirection } from "../../utils/sortDirection";

export type SortOption<T extends string> = {
  value: T;
  label: string;
  reverseLabel: string;
  defaultDirection?: SortDirection;
};

type Props<T extends string> = {
  value: T;
  options: SortOption<T>[];
  onChange: (value: T) => void;
  direction: SortDirection;
  onDirectionChange: (direction: SortDirection) => void;
};

/** A click on the chosen option reverses its order; any other option is chosen in its own default order. */
export function sortClick<T extends string>(
  value: T,
  direction: SortDirection,
  clicked: T,
): { direction: SortDirection } | { value: T } {
  if (clicked !== value) return { value: clicked };
  return { direction: direction === "asc" ? "desc" : "asc" };
}

// The label is all that shows the order, so a new one settles in rather than just swapping.
const relabel = keyframes`
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: none; }
`;

export default function SortTabs<T extends string>({
  value,
  options,
  onChange,
  direction,
  onDirectionChange,
}: Props<T>) {
  // Only a flip animates, so the labels don't all fade in whenever the page draws them.
  const [flipped, setFlipped] = useState<T | null>(null);
  return (
    <Stack direction="row" alignItems="center" flexWrap="wrap" columnGap={{ xs: 1.25, sm: 2 }} rowGap={0.5}>
      {options.map((option) => {
        const chosen = option.value === value;
        const reversed = chosen && direction !== (option.defaultDirection ?? defaultSortDirection(option.value));
        const click = () => {
          const next = sortClick(value, direction, option.value);
          if ("value" in next) return onChange(next.value);
          setFlipped(option.value);
          onDirectionChange(next.direction);
        };
        return (
          <Typography
            key={option.value}
            component="button"
            type="button"
            variant="body2"
            aria-pressed={chosen}
            onClick={click}
            sx={{
              p: 0,
              border: 0,
              bgcolor: "transparent",
              font: "inherit",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: chosen ? 700 : 500,
              color: chosen ? "primary.main" : "text.secondary",
              whiteSpace: "nowrap",
              transition: "color 150ms",
              "@media (pointer: coarse)": { minHeight: 44 },
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
            {/* Keyed by the order, so a flip replays the animation without replacing the focused button. */}
            <Box
              component="span"
              key={reversed ? "reversed" : "default"}
              sx={{
                display: "inline-block",
                ...(flipped === option.value && {
                  animation: `${relabel} 180ms ease-out`,
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }),
              }}
            >
              {reversed ? option.reverseLabel : option.label}
            </Box>
          </Typography>
        );
      })}
    </Stack>
  );
}
