import { useTranslation } from "react-i18next";
import type { PrintSortMode } from "../../api/prints";
import SortTabs from "../../components/controls/SortTabs";
import { PRINT_SORT_MODES, SEARCH_SORT_MODES } from "../../hooks/usePrintSort";
import type { SortDirection } from "../../utils/sortDirection";

type Props = {
  value: PrintSortMode;
  onChange: (mode: PrintSortMode) => void;
  direction: SortDirection;
  onDirectionChange: (direction: SortDirection) => void;
  search?: boolean;
};

const REVERSE_LABELS = {
  newest: "oldest",
  popular: "leastPopular",
  downloads: "fewestDownloads",
  relevance: "leastRelevant",
} as const;

/** "Popular" sorts by views, "Downloads" by print count. */
export default function PrintSortTabs({ search = false, ...sort }: Props) {
  const { t } = useTranslation("models");
  const modes = search ? SEARCH_SORT_MODES : PRINT_SORT_MODES;
  const options = modes.map((value) => {
    const label = value === "name" ? t("tags.sortByName") : t(`sort.${value}`);
    const reverseLabel =
      value === "name" ? t("sort.reverseAlphabetical", { label }) : t(`sort.${REVERSE_LABELS[value]}`);
    return { value, label, reverseLabel };
  });
  return <SortTabs {...sort} options={options} />;
}
