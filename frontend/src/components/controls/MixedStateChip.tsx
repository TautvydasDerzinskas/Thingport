import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import { keyframes } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";
import RemoveIcon from "@mui/icons-material/Remove";

/** Whether something ends up on all of the selected items, none of them, or stays on just the ones that have it. */
export type MixedState = "all" | "some" | "none";

export const startMixedState = (has: number, total: number): MixedState =>
  has >= total ? "all" : has > 0 ? "some" : "none";

/** Only what some of the items have can go back to "some"; anything else flips between all and none. */
export function nextMixedState(state: MixedState, has: number, total: number): MixedState {
  if (state === "all") return "none";
  if (state === "none") return startMixedState(has, total) === "some" ? "some" : "all";
  return "all";
}

const appear = keyframes`
  from { opacity: 0; transform: scale(0.85); }
  to { opacity: 1; transform: scale(1); }
`;

/** For a chip just added to its list, so it pops in. */
export const freshChipSx = {
  animation: `${appear} 180ms ease-out`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
};

type Props = {
  label: string;
  /** How many of the `total` selected items have it now. */
  has: number;
  total: number;
  state: MixedState;
  onClick: () => void;
  /** Read instead of the label while it's on only some, which the label alone shows as just a count. */
  someLabel: string;
  disabled?: boolean;
  /** Just added to the list, so it pops in. */
  fresh?: boolean;
};

/** A three-state chip for a multi-select (Gmail's labels): on all, on some, on none. Clicking cycles it, a change
 *  is shown in bold and a removal struck through. */
export default function MixedStateChip({ label, has, total, state, onClick, someLabel, disabled, fresh }: Props) {
  const removing = state === "none" && has > 0;
  return (
    <Chip
      size="small"
      clickable
      disabled={disabled}
      onClick={onClick}
      aria-pressed={state === "all" ? "true" : state === "some" ? "mixed" : "false"}
      aria-label={state === "some" ? someLabel : undefined}
      color={state === "all" ? "primary" : "default"}
      variant={state === "all" ? "filled" : "outlined"}
      icon={
        state === "all" ? (
          <CheckIcon fontSize="small" />
        ) : state === "some" ? (
          <RemoveIcon fontSize="small" />
        ) : undefined
      }
      label={
        state === "some" ? (
          <>
            {label}
            <Box component="span" sx={{ ml: 0.75, color: "text.secondary", fontSize: "0.7rem" }}>
              {has}/{total}
            </Box>
          </>
        ) : (
          label
        )
      }
      sx={{
        fontWeight: state !== startMixedState(has, total) ? 600 : undefined,
        ...(removing && { textDecoration: "line-through", color: "text.disabled" }),
        ...(fresh && freshChipSx),
      }}
    />
  );
}
