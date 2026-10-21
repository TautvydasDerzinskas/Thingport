import type React from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ToggleButton from "@mui/material/ToggleButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import HighlightAltIcon from "@mui/icons-material/HighlightAlt";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import DeselectIcon from "@mui/icons-material/Deselect";
import type { Selection } from "../../hooks/useSelection";

const slideIn = keyframes`
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: none; }
`;

type Props = {
  selection: Selection<unknown>;
  /** Items "select all" can take: the loaded, selectable ones. */
  total: number;
  /** More are still to load, so "select all" says it only takes the loaded ones. */
  hasMore?: boolean;
  /** An action is running: the toolbar holds still until it's done. */
  busy?: boolean;
  labels: { enter: string; exit: string; toolbar: string; selectAllLoaded: string };
  /** The actions, as `SelectionAction`s. */
  children: React.ReactNode;
  /** Menus and dialogs the actions open, mounted outside the toolbar. */
  dialogs?: React.ReactNode;
};

/** A grid's select-mode toggle and, while it's on, its actions, the count and select all. */
export default function SelectionToolbar({
  selection,
  total,
  hasMore = false,
  busy = false,
  labels,
  children,
  dialogs,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const { active } = selection;
  const count = selection.selected.length;
  const allSelected = count > 0 && count === total;
  const selectAllLabel = allSelected
    ? t("common:clearSelection")
    : hasMore
      ? labels.selectAllLoaded
      : t("common:selectAll");
  const toggleLabel = active ? labels.exit : labels.enter;

  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
      <Tooltip title={toggleLabel}>
        <ToggleButton
          value="select"
          size="small"
          selected={active}
          onChange={() => selection.setActive(!active)}
          aria-label={toggleLabel}
          sx={{ px: 1 }}
        >
          <HighlightAltIcon fontSize="small" />
        </ToggleButton>
      </Tooltip>
      {active && (
        <Stack
          direction="row"
          alignItems="center"
          spacing={0.25}
          role="toolbar"
          aria-label={labels.toolbar}
          sx={{
            animation: `${slideIn} 200ms ease-out`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          {children}
          <Divider orientation="vertical" flexItem sx={{ mx: 0.75 }} />
          <Typography
            variant="caption"
            aria-live="polite"
            sx={{ color: "text.secondary", whiteSpace: "nowrap", minWidth: 64 }}
          >
            {t("models:selection.count", { count })}
          </Typography>
          <Tooltip title={selectAllLabel}>
            <span>
              <IconButton
                size="small"
                aria-label={selectAllLabel}
                disabled={total === 0 || busy}
                onClick={allSelected ? selection.clear : selection.selectAll}
              >
                {allSelected ? <DeselectIcon fontSize="small" /> : <SelectAllIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      )}
      {dialogs}
    </Stack>
  );
}

type ActionProps = {
  label: string;
  /** Says why it's disabled, in place of the label, when that isn't obvious. */
  hint?: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
};

/** An icon button in the selection toolbar, its label as tooltip and accessible name. */
export function SelectionAction({ label, hint, icon, disabled = false, onClick }: ActionProps) {
  return (
    <Tooltip title={disabled && hint ? hint : label}>
      {/* A disabled button fires no events, so the span keeps the tooltip working. */}
      <span>
        <IconButton size="small" aria-label={label} disabled={disabled} onClick={onClick}>
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}
