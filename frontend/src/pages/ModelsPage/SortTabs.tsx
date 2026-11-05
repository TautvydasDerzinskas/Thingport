import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type PrintSortMode } from "../../api/prints";

const SORT_MODES: PrintSortMode[] = ["newest", "popular", "downloads"];

type Props = {
  value: PrintSortMode;
  /** Defaults to newest, popular, downloads. */
  modes?: PrintSortMode[];
  onChange: (mode: PrintSortMode) => void;
};

/** "Popular" sorts by views, "Downloads" by print count. */
export default function SortTabs({ value, modes = SORT_MODES, onChange }: Props) {
  const { t } = useTranslation("models");
  return (
    <Stack direction="row" spacing={3}>
      {modes.map((mode) => (
        <Typography
          key={mode}
          variant="body2"
          onClick={() => onChange(mode)}
          sx={{
            cursor: "pointer",
            fontSize: 14,
            fontWeight: value === mode ? 700 : 500,
            color: value === mode ? (theme) => theme.thingport.accentText : "text.secondary",
            "&:hover": { color: (theme) => theme.thingport.accentText },
          }}
        >
          {t(`sort.${mode}`)}
        </Typography>
      ))}
    </Stack>
  );
}
