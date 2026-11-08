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
import { SocialOffError, socialApi } from "../../api/social";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import type { ResolvedTheme } from "../../constants/settingsOptions";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useRememberedList } from "../../hooks/useRememberedList";
import ModelCard from "../ModelsPage/ModelCard";

const PAGE_SIZE = 24;
// The most models the server answers with at once (pageQuery in backend routes/social.ts).
const MOST_AT_ONCE = 100;

type Props = {
  userId: string;
  sortMode: PrintSortMode;
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  viewer?: AuthUser | null;
  onUnauthorized?: () => void;
  /** Their models went private, or social features off, since the page was read: the page reads itself again. Until
   *  it shows otherwise, this offers to try again. */
  onGone: () => void;
  /** Goes up each time the page has read itself. Models that went missing are read again then, as the page still
   *  showing this means they're public again. */
  pageRead: number;
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
  pageRead,
}: Props) {
  const { t } = useTranslation(["models", "common"]);
  const { items, setItems, hasMore, setHasMore, loading, setLoading, returning } = useRememberedList<Print>({
    loadingAtFirst: true,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // A page asked for before the list was read again belongs to the old list, and is dropped.
  const run = useRef(0);

  // Stops paging until the user tries again; a gone list sends the page to read itself again too.
  const failedWith = (err: unknown) => {
    if (err instanceof UnauthorizedError) return onUnauthorized?.();
    setFailed(true);
    if (err instanceof SocialOffError) onGone();
  };
  // Models gone missing, to read again once the page has read itself; once only, so a page and a list that disagree
  // leave it to the retry button rather than asking each other again and again.
  const missing = useRef(false);
  const readAgainAfterPage = useRef(false);
  const retriedOnce = useRef(false);
  const gone = () => {
    setFailed(true);
    if (!retriedOnce.current) missing.current = true;
    onGone();
  };
  useEffect(() => {
    if (!missing.current) return;
    missing.current = false;
    retriedOnce.current = true;
    readAgainAfterPage.current = true;
    setFailed(false);
    setAttempt((n) => n + 1);
  }, [pageRead]);

  // Social features switched off, or the models no longer public: the models shown go at once, rather than staying
  // until the page has read itself again.
  const goneWithModels = () => {
    setItems([]);
    setHasMore(false);
    gone();
  };
  // Read fine, so nothing waits for the page's next read: the user's own retry may have got there first.
  const recovered = () => {
    retriedOnce.current = false;
    missing.current = false;
  };

  // A list put back on the way back, read again quietly, so a model copied to the library meanwhile says so. Failing,
  // the list stays as it was and says it couldn't be read, with a retry; gone, it goes as for a first load.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refresh = async (count: number, mine: number) => {
    const fresh: Print[] = [];
    let more = false;
    try {
      for (let offset = 0; offset < count; offset += MOST_AT_ONCE) {
        const limit = Math.min(MOST_AT_ONCE, count - offset);
        const page = await socialApi.userModels(userId, { order_by: sortMode, limit, offset });
        if (mine !== run.current) return;
        if (!page) return goneWithModels();
        fresh.push(...page.items);
        more = page.hasMore;
        if (!more) break;
      }
    } catch (err) {
      if (mine !== run.current) return;
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else if (err instanceof SocialOffError) goneWithModels();
      else setRefreshFailed(true);
      return;
    }
    if (mine !== run.current) return;
    recovered();
    setRefreshFailed(false);
    setItems(fresh);
    setHasMore(more);
  };

  useEffect(() => {
    const mine = ++run.current;
    const dropLate = () => {
      run.current += 1;
    };
    setRefreshFailed(false);
    // Read afresh after models went missing: what was kept of them is gone with them.
    const kept = failed || readAgainAfterPage.current ? null : returning();
    readAgainAfterPage.current = false;
    if (kept !== null) {
      void refresh(kept, mine);
      return dropLate;
    }
    // Another sort's or person's list isn't this one's: nothing of it stays to be paged on from. A page of it still on
    // its way won't clear loadingMore, so it's cleared here.
    setItems([]);
    setHasMore(false);
    setLoadingMore(false);
    setLoading(true);
    setFailed(false);
    socialApi.userModels(userId, { order_by: sortMode, limit: PAGE_SIZE, offset: 0 }).then(
      (page) => {
        if (mine !== run.current) return;
        setLoading(false);
        if (!page) return gone();
        recovered();
        setItems(page.items);
        setHasMore(page.hasMore);
      },
      (err) => {
        if (mine !== run.current) return;
        setLoading(false);
        failedWith(err);
      },
    );
    // Gone from the page, or read again: what's still on its way is dropped.
    return dropLate;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sortMode, attempt]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || failed) return;
    const mine = run.current;
    setLoadingMore(true);
    try {
      const page = await socialApi.userModels(userId, { order_by: sortMode, limit: PAGE_SIZE, offset: items.length });
      if (mine !== run.current) return;
      if (!page) return goneWithModels();
      setItems((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
    } catch (err) {
      if (mine === run.current) failedWith(err);
    } finally {
      if (mine === run.current) setLoadingMore(false);
    }
  };
  const sentinelRef = useInfiniteScroll(loadMore, hasMore && !failed, loading || loadingMore);
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
      {failed || refreshFailed ? (
        <Stack direction="row" alignItems="center" justifyContent="center" spacing={1} sx={{ color: "text.secondary" }}>
          <Typography variant="body2">{t("models:explore.modelsLoadFailed")}</Typography>
          <Button
            size="small"
            onClick={() => {
              if (failed) return setFailed(false);
              setRefreshFailed(false);
              void refresh(items.length, run.current);
            }}
          >
            {t("common:retry")}
          </Button>
        </Stack>
      ) : (
        hasMore && <Box ref={sentinelRef} sx={{ height: 1 }} />
      )}
    </Stack>
  );
}
