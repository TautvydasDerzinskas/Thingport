import { useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import FilterPopoverButton from "../../components/controls/FilterPopoverButton";
import { DEFAULT_MIN_COUNT, parseMinCount } from "./minCount";

const FIELD_ID = "tags-min-count";

type Props = {
  minCount: number;
  onChange: (minCount: number) => void;
};

/** Mounted with the popover, so it opens on the current number. */
function MinCountField({ minCount, onChange }: Props) {
  const { t } = useTranslation("models");
  // Text, so the field can be cleared on the way to a new number; leaving it empty puts the number back.
  const [draft, setDraft] = useState(String(minCount));

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: 300, maxWidth: "100%" }}>
      <Typography
        component="label"
        htmlFor={FIELD_ID}
        variant="body2"
        sx={{ flex: 1, minWidth: 0, color: (theme) => theme.thingport.headingText }}
      >
        {t("tags.minCount")}
      </Typography>
      <TextField
        id={FIELD_ID}
        type="number"
        size="small"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const next = parseMinCount(event.target.value);
          if (next !== null) onChange(next);
        }}
        onBlur={() => setDraft(String(minCount))}
        inputProps={{ min: 1, step: 1, inputMode: "numeric" }}
        sx={{ width: 76, flexShrink: 0 }}
      />
    </Box>
  );
}

/** How few models a tag can have and still be listed. */
export default function TagFiltersButton({ minCount, onChange }: Props) {
  const { t } = useTranslation("models");

  return (
    <FilterPopoverButton label={t("filters.title")} active={minCount === DEFAULT_MIN_COUNT ? 0 : 1}>
      <MinCountField minCount={minCount} onChange={onChange} />
    </FilterPopoverButton>
  );
}
