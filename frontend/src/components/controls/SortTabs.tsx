import { useTranslation } from "react-i18next";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
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

export default function SortTabs<T extends string>({
  value,
  options,
  onChange,
  direction,
  onDirectionChange,
}: Props<T>) {
  const { t } = useTranslation("models");
  const ascending = direction === "asc";
  const directionLabel = t(ascending ? "sort.reverseAscending" : "sort.reverseDescending");
  return (
    <Stack direction="row" alignItems="center" flexWrap="wrap" columnGap={{ xs: 1.25, sm: 2 }} rowGap={0.5}>
      {options.map((option) => {
        const chosen = option.value === value;
        const reversed = chosen && direction !== (option.defaultDirection ?? defaultSortDirection(option.value));
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
            {reversed ? option.reverseLabel : option.label}
          </Typography>
        );
      })}
      <Tooltip title={directionLabel}>
        <IconButton
          size="small"
          aria-label={directionLabel}
          onClick={() => onDirectionChange(ascending ? "desc" : "asc")}
          sx={{
            flexShrink: 0,
            gap: 0.125,
            "@media (pointer: coarse)": { minWidth: 44, minHeight: 44 },
            "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" },
          }}
        >
          <ArrowUpwardIcon sx={{ fontSize: 16, color: ascending ? "success.main" : "text.secondary" }} />
          <ArrowDownwardIcon sx={{ fontSize: 16, color: ascending ? "text.secondary" : "success.main" }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
