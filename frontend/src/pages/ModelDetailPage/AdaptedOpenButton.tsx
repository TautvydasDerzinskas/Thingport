import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { alpha } from "@mui/material/styles";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import AdaptedInfoIcon from "./AdaptedInfoIcon";
import type { AdaptedTarget } from "./useOpenInSlicer";
import type { AdaptState } from "./useAdaptedOpen";

type Props = {
  targets: AdaptedTarget[];
  slicerLabel: string;
  stateOf: (target: AdaptedTarget) => AdaptState;
  open: (target: AdaptedTarget) => Promise<boolean>;
  /** Several targets: opens the file picker, whose rows show each file's progress. */
  onPick: (anchor: HTMLElement) => void;
};

/** The side panel's "Open adapted in <slicer>" button, in the bulb's warning color. */
export default function AdaptedOpenButton({ targets, slicerLabel, stateOf, open, onPick }: Props) {
  const { t } = useTranslation(["models"]);
  const single = targets.length === 1 ? targets[0] : null;
  const state: AdaptState = single
    ? stateOf(single)
    : targets.some((target) => stateOf(target) === "preparing")
      ? "preparing"
      : "idle";
  const label =
    state === "preparing"
      ? t("models:detail.adaptPreparing")
      : state === "ready"
        ? t("models:detail.adaptReady", { slicer: slicerLabel })
        : t("models:detail.openAdaptedInSlicer", { slicer: slicerLabel });

  return (
    <Button
      onClick={(e) => (single ? void open(single) : onPick(e.currentTarget))}
      // Several files stay clickable while one prepares, so the picker can be reopened.
      disabled={Boolean(single) && state === "preparing"}
      startIcon={
        state === "preparing" ? (
          <CircularProgress size={16} color="inherit" />
        ) : targets[0] ? (
          <AdaptedInfoIcon slicerLabel={slicerLabel} plan={targets[0].plan} />
        ) : undefined
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
