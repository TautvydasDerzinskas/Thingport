import Tooltip from "@mui/material/Tooltip";
import type { Print } from "../../api/prints";
import StarToggle from "../../components/StarToggle";
import { useFavoriteToggle } from "../../hooks/useFavoriteToggle";

type Props = {
  print: Print;
  onUpdated: (print: Print) => void;
  onUnauthorized?: () => void;
};

/** The model detail page's header favourite toggle -- adds/removes the print from the built-in
 *  "Favourites" pseudo-collection (see backend/src/services/collectionService.ts). Toggle
 *  behaviour and toasts are shared with the model grid cards via useFavoriteToggle. */
export default function FavoriteButton({ print, onUpdated, onUnauthorized }: Props) {
  const { isFavorite, toggle, label } = useFavoriteToggle(print, { onUpdated, onUnauthorized });

  return (
    <Tooltip title={label}>
      <span>
        <StarToggle active={isFavorite} onClick={toggle} ariaLabel={label} size={26} />
      </span>
    </Tooltip>
  );
}
