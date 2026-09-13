import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type TagSortMode } from "../../api/tags";

const SORT_MODES: TagSortMode[] = ["popular", "name"];

type Props = {
  value: TagSortMode;
  onChange: (mode: TagSortMode) => void;
};

/** "Popular / Name" sort row for the Tags list page -- same look and alignment as
 *  ModelsPage/SortTabs, just a different (tag-specific) pair of modes. */
export default function TagSortTabs({ value, onChange }: Props) {
  const { t } = useTranslation("models");
  return (
    <Stack direction="row" spacing={3}>
      {SORT_MODES.map(mode => (
        <Typography
          key={mode}
          variant="body2"
          onClick={() => onChange(mode)}
          sx={{
            cursor: "pointer",
            fontSize: 14,
            fontWeight: value === mode ? 700 : 500,
            color: value === mode ? "primary.main" : "text.secondary",
            "&:hover": { color: "primary.main" },
          }}
        >
          {mode === "popular" ? t("sort.popular") : t("tags.sortByName")}
        </Typography>
      ))}
    </Stack>
  );
}
