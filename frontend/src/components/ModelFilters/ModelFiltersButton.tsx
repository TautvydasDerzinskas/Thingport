import { useState } from "react";
import { useTranslation } from "react-i18next";
import Badge from "@mui/material/Badge";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import TuneIcon from "@mui/icons-material/Tune";
import type { PrintSource } from "../../api/prints";
import type { ModelFilters } from "../../hooks/useModelFilters";
import ModelFiltersPopover from "./ModelFiltersPopover";

type Props = {
  filters: ModelFilters;
  /** The sites the library holds models from (useLibrarySources). */
  sources: PrintSource[];
};

/** A model list's filter button, badged with how many filters are on, and the popover it opens. */
export default function ModelFiltersButton({ filters, sources }: Props) {
  const { t } = useTranslation("models");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <Tooltip title={t("filters.title")}>
        <Badge color="primary" badgeContent={filters.active} overlap="circular">
          <IconButton
            size="small"
            aria-label={t("filters.title")}
            aria-haspopup="dialog"
            aria-expanded={Boolean(anchor)}
            onClick={(event) => setAnchor(event.currentTarget)}
            color={filters.active ? "primary" : "default"}
          >
            <TuneIcon fontSize="small" />
          </IconButton>
        </Badge>
      </Tooltip>
      <ModelFiltersPopover
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        sources={sources}
        hidden={filters.hiddenProviders}
        onHiddenChange={filters.setHiddenProviders}
        generative={filters.generative}
        onGenerativeChange={filters.setGenerative}
      />
    </>
  );
}
