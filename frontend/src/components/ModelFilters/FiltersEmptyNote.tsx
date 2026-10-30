import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import type { ModelFilters } from "../../hooks/useModelFilters";

/** A list's empty state when it's the filters that emptied it: says so, with the way back. */
export default function FiltersEmptyNote({ filters }: { filters: ModelFilters }) {
  const { t } = useTranslation("models");
  return (
    <>
      <Typography variant="body2">{t("filters.noMatch")}</Typography>
      <Button size="small" onClick={filters.clear}>
        {t("filters.clear")}
      </Button>
    </>
  );
}
