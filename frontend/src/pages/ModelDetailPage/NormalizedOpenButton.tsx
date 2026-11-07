import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { alpha } from "@mui/material/styles";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import NormalizeInfoIcon from "./NormalizeInfoIcon";
import type { SlicerTarget } from "./useOpenInSlicer";
import type { NormalizeState } from "./useNormalizedOpen";

type Props = {
  targets: SlicerTarget[];
  slicerLabel: string;
  stateOf: (target: SlicerTarget) => NormalizeState;
  open: (target: SlicerTarget) => Promise<boolean>;
  /** Several targets: opens the file picker, whose rows show each file's progress. */
  onPick: (anchor: HTMLElement) => void;
};

/** The side panel's "Open normalized in <slicer>" button, in the bulb's warning color. */
export default function NormalizedOpenButton({ targets, slicerLabel, stateOf, open, onPick }: Props) {
  const { t } = useTranslation(["models"]);
  const single = targets.length === 1 ? targets[0] : null;
  const state: NormalizeState = single
    ? stateOf(single)
    : targets.some((target) => stateOf(target) === "preparing")
      ? "preparing"
      : "idle";
  const label =
    state === "preparing"
      ? t("models:detail.normalizePreparing")
      : state === "ready"
        ? t("models:detail.normalizeReady", { slicer: slicerLabel })
        : t("models:detail.openNormalizedInSlicer", { slicer: slicerLabel });

  return (
    <Button
      onClick={(e) => (single ? void open(single) : onPick(e.currentTarget))}
      // Several files stay clickable while one prepares, so the picker can be reopened.
      disabled={Boolean(single) && state === "preparing"}
      startIcon={
        state === "preparing" ? (
          <CircularProgress size={16} color="inherit" />
        ) : (
          <NormalizeInfoIcon slicerLabel={slicerLabel} orca={targets[0]?.normalizeTarget === "orca"} />
        )
      }
      endIcon={single ? undefined : <ArrowDropDownIcon />}
      fullWidth
      sx={{
        bgcolor: "background.paper",
        color: "warning.main",
        border: "1.5px solid",
        borderColor: "warning.main",
        "&:hover": {
          bgcolor: (theme) => alpha(theme.palette.warning.main, 0.08),
          borderColor: "warning.dark",
        },
        "&.Mui-disabled": { color: "warning.main", borderColor: "warning.main", opacity: 0.7 },
      }}
    >
      {label}
    </Button>
  );
}
