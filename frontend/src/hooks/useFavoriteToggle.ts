import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { UnauthorizedError } from "../api/client";
import { type Print, printsApi } from "../api/prints";
import { useToast } from "../components/ToastProvider";

type Options = {
  onUpdated?: (print: Print) => void;
  onUnauthorized?: () => void;
};

/** Shared favourite toggle for every StarToggle that adds/removes a print from the built-in
 *  "Favourites" pseudo-collection (model grid cards, the model detail page header), so they all
 *  confirm with the same toast. Flips immediately on click (optimistic, rolled back on failure)
 *  instead of waiting on the request behind a spinner -- StarToggle's burst animation only plays
 *  on an actual false->true prop transition while mounted, so swapping it for a spinner
 *  mid-request (then remounting it already-flipped once the response lands) skipped it. */
export function useFavoriteToggle(print: Print, { onUpdated, onUnauthorized }: Options = {}) {
  const { t } = useTranslation(["models"]);
  const showToast = useToast();
  const [isFavorite, setIsFavorite] = useState(print.is_favorite);
  const pendingRef = useRef(false);

  useEffect(() => { setIsFavorite(print.is_favorite); }, [print.is_favorite]);

  const toggle = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      const updated = next ? await printsApi.favorite(print.id) : await printsApi.unfavorite(print.id);
      onUpdated?.(updated);
      showToast({
        message: t(updated.is_favorite ? "models:card.addedToFavorites" : "models:card.removedFromFavorites", {
          name: updated.title || updated.name,
        }),
      });
    } catch (err) {
      setIsFavorite(!next);
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      console.error(err);
      showToast({ message: t("models:detail.favoriteFailed"), severity: "error" });
    } finally {
      pendingRef.current = false;
    }
  };

  const label = isFavorite ? t("models:detail.removeFromFavorites") : t("models:detail.addToFavorites");

  return { isFavorite, toggle, label };
}
