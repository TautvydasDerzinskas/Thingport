import { useTranslation } from "react-i18next";
import Chip from "@mui/material/Chip";

/** Marks the file the source site flags as its default. */
export default function DefaultFileChip() {
  const { t } = useTranslation(["models"]);
  return <Chip size="small" variant="outlined" color="primary" label={t("models:detail.defaultFile")} />;
}

/** Default files first, the rest in their given order. Without a default (or with all of them) the order is
 *  unchanged; with several, they keep their relative order. Returns a new array. */
export function defaultFirst<T>(items: T[], isDefault: (item: T) => boolean): T[] {
  return [...items.filter(isDefault), ...items.filter((item) => !isDefault(item))];
}
