import { useTranslation } from "react-i18next";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Typography from "@mui/material/Typography";
import FilterPopoverButton from "../../components/controls/FilterPopoverButton";
import { COLLECTION_TYPES, type CollectionType } from "./collectionTypes";

type Props = {
  /** The types turned off; every other one is on. */
  hidden: CollectionType[];
  onChange: (hidden: CollectionType[]) => void;
};

/** Which types of collection the page lists. */
export default function CollectionFiltersButton({ hidden, onChange }: Props) {
  const { t } = useTranslation("models");

  return (
    <FilterPopoverButton label={t("filters.title")} active={hidden.length}>
      <FormGroup>
        {COLLECTION_TYPES.map((type) => (
          <FormControlLabel
            key={type}
            sx={{ mr: 0 }}
            control={
              <Checkbox
                size="small"
                checked={!hidden.includes(type)}
                onChange={(event) =>
                  onChange(event.target.checked ? hidden.filter((other) => other !== type) : [...hidden, type])
                }
              />
            }
            label={
              <Typography variant="body2" sx={{ color: (theme) => theme.thingport.headingText }}>
                {t(`collections.types.${type}`)}
              </Typography>
            }
          />
        ))}
      </FormGroup>
    </FilterPopoverButton>
  );
}
