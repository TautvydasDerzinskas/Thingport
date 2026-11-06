import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { AuthUser } from "../../api/auth";
import { UnauthorizedError } from "../../api/client";
import type { Print, PrintSortMode } from "../../api/prints";
import type { PreviewMode } from "../../api/settings";
import { socialApi } from "../../api/social";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import type { ResolvedTheme } from "../../constants/settingsOptions";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import ModelCard from "../ModelsPage/ModelCard";

const PAGE_SIZE = 24;

type Props = {
  userId: string;
  sortMode: PrintSortMode;
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  viewer?: AuthUser | null;
  onUnauthorized?: () => void;
  /** Their models went private, or social features off, since the page was read: the page reads itself again. */
  onGone: () => void;
};

/** A user's own models on their Explore page, once they made them public: their My models, as the others see it. */
export default function ExploreUserModels({
  userId,
  sortMode,
  theme,
  previewMode,
  viewer,
  onUnauthorized,
  onGone,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const [items, setItems] = useState<Print[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // A page asked for before the list was read again belongs to the old list, and is dropped.
  const run = useRef(0);

  const failedWith = (err: unknown) => {
    if (err instanceof UnauthorizedError) onUnauthorized?.();
    else setFailed(true);
  };

  useEffect(() => {
    const mine = ++run.current;
    setLoading(true);
    setFailed(false);
    socialApi.userModels(userId, { order_by: sortMode, limit: PAGE_SIZE, offset: 0 }).then(
      (page) => {
        if (mine !== run.current) return;
        if (!page) return onGone();
        setItems(page.items);
        setHasMore(page.hasMore);
        setLoading(false);
      },
      (err) => {
        if (mine !== run.current) return;
        setLoading(false);
        failedWith(err);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sortMode, attempt]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    const mine = run.current;
    setLoadingMore(true);
    try {
      const page = await socialApi.userModels(userId, { order_by: sortMode, limit: PAGE_SIZE, offset: items.length });
      if (mine !== run.current) return;
      if (!page) return onGone();
      setItems((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
    } catch (err) {
      failedWith(err);
    } finally {
      setLoadingMore(false);
    }
  };
  const sentinelRef = useInfiniteScroll(loadMore, hasMore, loading || loadingMore);
  const replace = (updated: Print) => setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));

  if (loading) {
    return (
      <Box sx={cardGridSx(5)} aria-hidden>
        <CardSkeletons count={10} />
      </Box>
    );
  }
  if (failed && !items.length) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 6, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:explore.modelsLoadFailed")}</Typography>
        <Button size="small" onClick={() => setAttempt((n) => n + 1)}>
          {t("common:retry")}
        </Button>
      </Stack>
    );
  }
  if (!items.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("models:explore.noModels")}
      </Typography>
    );
  }
  return (
    <Stack spacing={2}>
      <Box sx={cardGridSx(5)}>
        {items.map((item) => (
          <ModelCard
            key={item.id}
            item={item}
            theme={theme}
            previewMode={previewMode}
            onUpdated={replace}
            onFavoriteChange={replace}
            onDeleted={(id) => setItems((prev) => prev.filter((other) => other.id !== id))}
            onUnauthorized={onUnauthorized}
            viewer={viewer}
          />
        ))}
        {loadingMore && <CardSkeletons count={5} />}
      </Box>
      {hasMore && <Box ref={sentinelRef} sx={{ height: 1 }} />}
    </Stack>
  );
}
