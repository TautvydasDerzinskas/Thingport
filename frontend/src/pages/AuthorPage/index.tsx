import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import ModelFiltersButton from "../../components/ModelFilters/ModelFiltersButton";
import FiltersEmptyNote from "../../components/ModelFilters/FiltersEmptyNote";
import { useLibrarySources, useModelFilters } from "../../hooks/useModelFilters";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PersonIcon from "@mui/icons-material/Person";
import { UnauthorizedError } from "../../api/client";
import { authorsApi, type Author } from "../../api/authors";
import { type Print, printsApi } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useGravatarUrl } from "../../hooks/useGravatarUrl";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import { importProviderInfo, printProviderInfo, providerChipSx } from "../../constants/importProviders";
import { authorProfileUrl } from "../../utils/authorProfileUrl";
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import ModelCard from "../ModelsPage/ModelCard";
import Skeleton from "@mui/material/Skeleton";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import ModelSelectionToolbar from "../../components/modelSelection/ModelSelectionToolbar";
import { replacePrints, useModelSelection } from "../../hooks/useModelSelection";

const PAGE_SIZE = 24;
const COVER_HEIGHT = 184;

type Props = {
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUnauthorized?: () => void;
  /** Only used by the `/authors/self` "My models" route. */
  viewer?: AuthUser | null;
  onUserUpdated?: (user: AuthUser) => void;
};

/** An author's page: profile column beside a grid of their imported models. Doubles as the
 *  viewer's own "My models" page when `authorId === SELF_AUTHOR_ID`. */
export default function AuthorPage({ theme, previewMode, onUnauthorized, viewer, onUserUpdated }: Props) {
  const { authorId } = useParams<{ authorId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["models", "common"]);
  const confirmDialog = useConfirm();
  const showToast = useToast();
  const isSelf = authorId === SELF_AUTHOR_ID;
  const filters = useModelFilters();
  const { generative, hiddenProviders } = filters;
  const sources = useLibrarySources(null);
  const viewerAvatarUrl = useGravatarUrl(viewer?.email, 112);
  const [author, setAuthor] = useState<Author | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [items, setItems] = useState<Print[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const selection = useModelSelection(items);
  // Authors the viewer has claimed: self-mode provider chips, and whether "It's me!" shows.
  const [myLinks, setMyLinks] = useState<Author[]>([]);
  const [linking, setLinking] = useState(false);

  const displayName = isSelf
    ? viewer?.display_name || t("models:card.unknownAuthor")
    : author?.name || author?.handle || t("models:card.unknownAuthor");

  usePageHeader({
    title: isSelf
      ? t("models:author.myModelsPageTitle")
      : author
        ? t("models:author.pageTitleWithName", { name: displayName })
        : undefined,
    subtitle: !isSelf && author ? t("models:author.subtitle") : undefined,
  });

  const handleError = (err: unknown, message?: string) => {
    if (err instanceof UnauthorizedError) {
      onUnauthorized?.();
      return true;
    }
    console.error(err);
    if (message) alert(message);
    return false;
  };

  useEffect(() => {
    if (!authorId) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        if (isSelf) {
          const [printsResult, linkedAuthors] = await Promise.all([
            printsApi.list({
              author_id: SELF_AUTHOR_ID,
              generative: generative || undefined,
              hide_providers: hiddenProviders,
              limit: PAGE_SIZE,
              offset: 0,
            }),
            authorsApi.myLinks(),
          ]);
          if (cancelled) return;
          setAuthor(null);
          setMyLinks(linkedAuthors);
          setItems(printsResult.items);
          setOffset(printsResult.items.length);
          setHasMore(printsResult.hasMore);
          return;
        }
        const [authorResult, printsResult, linkedAuthors] = await Promise.all([
          authorsApi.get(authorId),
          printsApi.list({
            author_id: authorId,
            generative: generative || undefined,
            hide_providers: hiddenProviders,
            limit: PAGE_SIZE,
            offset: 0,
          }),
          authorsApi.myLinks(),
        ]);
        if (cancelled) return;
        setMyLinks(linkedAuthors);
        setAuthor(authorResult);
        setItems(printsResult.items);
        setOffset(printsResult.items.length);
        setHasMore(printsResult.hasMore);
      } catch (err) {
        if (cancelled) return;
        if (handleError(err)) return;
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorId, isSelf, generative, hiddenProviders]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !authorId) return;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({
        author_id: isSelf ? SELF_AUTHOR_ID : authorId,
        generative: generative || undefined,
        hide_providers: hiddenProviders,
        limit: PAGE_SIZE,
        offset,
      });
      setItems((prev) => [...prev, ...result.items]);
      setOffset(offset + result.items.length);
      setHasMore(result.hasMore);
    } catch (err) {
      handleError(err, t("models:errors.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  };

  const loadMoreSentinelRef = useInfiniteScroll(loadMore, hasMore, loading || loadingMore);

  const linkedToMe = Boolean(author && myLinks.some((a) => a.id === author.id));
  const viewerHasProviderLinked = Boolean(author && myLinks.some((a) => a.provider === author.provider));
  const canClaim = !isSelf && Boolean(author) && !author!.is_linked && !viewerHasProviderLinked;

  const handleClaim = async () => {
    if (!author) return;
    const confirmed = await confirmDialog({
      title: t("models:author.linkConfirmTitle"),
      message: t("models:author.linkConfirmMessage", { name: displayName }),
      confirmLabel: t("models:author.linkConfirmLabel"),
    });
    if (!confirmed) return;
    setLinking(true);
    try {
      const result = await authorsApi.link(author.id);
      setAuthor(result.author);
      setMyLinks((prev) => [...prev, result.author]);
      onUserUpdated?.(result.user);
      showToast({ message: t("models:author.linkSuccess", { name: displayName }) });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      alert(err instanceof Error ? err.message : t("models:author.linkFailed"));
    } finally {
      setLinking(false);
    }
  };

  if (loading) {
    return (
      <Box
        sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "320px 1fr" }, gap: "32px", pt: 3, pb: 3 }}
        aria-hidden
      >
        <Stack spacing={1.5} alignItems={{ xs: "center", md: "flex-start" }}>
          <Skeleton variant="circular" width={112} height={112} />
          <Skeleton variant="text" sx={{ fontSize: "1.5rem", width: "60%" }} />
          <Skeleton variant="text" sx={{ width: "40%" }} />
          <Skeleton variant="text" sx={{ width: "90%" }} />
          <Skeleton variant="text" sx={{ width: "80%" }} />
        </Stack>
        <Box sx={cardGridSx(5)}>
          <CardSkeletons count={10} />
        </Box>
      </Box>
    );
  }

  if (notFound || (!isSelf && !author)) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:author.notFound")}</Typography>
      </Stack>
    );
  }

  const providerInfo = isSelf ? null : importProviderInfo(author?.provider);
  const profileUrl = isSelf || !author ? null : authorProfileUrl(author);
  const bioText = isSelf ? viewer?.bio || null : author?.bio || author?.bio_translated;
  const avatarUrl = isSelf ? viewerAvatarUrl : (author?.avatar_url ?? undefined);
  const backgroundUrl = isSelf ? viewer?.background_url || null : author?.background_url;

  return (
    <Box sx={{ maxWidth: "1920px", mx: "auto", bgcolor: "background.paper", borderRadius: "12px", overflow: "hidden" }}>
      <Box
        sx={{
          height: `${COVER_HEIGHT}px`,
          bgcolor: "action.hover",
          ...(backgroundUrl && {
            // Quoted: an unquoted url() ends at the first ")", which a data: URI can contain.
            backgroundImage: `url("${backgroundUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }),
        }}
      />

      <Box sx={{ pl: 3, pr: 3 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "320px 1fr" },
            gap: "32px",
            // Stretch so the profile column's border runs the grid's full height.
            alignItems: "stretch",
            pt: 3,
            pb: 3,
          }}
        >
          <Box
            sx={{
              borderRight: { xs: "none", md: "1px solid" },
              // Unlike dividerBorderColor, this stays visible in dark mode.
              borderColor: "divider",
              pr: { xs: 0, md: 4 },
            }}
          >
            <Avatar src={avatarUrl} sx={{ width: 112, height: 112, fontSize: 40 }}>
              <PersonIcon fontSize="large" />
            </Avatar>
            <Typography variant="h5" fontWeight={700} sx={{ mt: 2 }}>
              {displayName}
            </Typography>
            {!isSelf && author?.handle && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                @{author.handle}
              </Typography>
            )}
            {isSelf
              ? myLinks.length > 0 && (
                  <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} sx={{ mt: 1.5 }}>
                    {myLinks.map((linked) => {
                      const info = printProviderInfo(linked.provider);
                      return (
                        <Chip
                          key={linked.id}
                          label={info.label}
                          size="small"
                          clickable
                          onClick={() => navigate(`/authors/${linked.id}`)}
                          sx={{ ...providerChipSx(info), fontWeight: 600 }}
                        />
                      );
                    })}
                  </Stack>
                )
              : (providerInfo || linkedToMe || canClaim) && (
                  <Stack direction="row" flexWrap="wrap" alignItems="center" spacing={1} sx={{ mt: 1.5 }}>
                    {providerInfo && profileUrl && (
                      <Box
                        component="a"
                        href={profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t("models:author.viewOnProvider", { provider: providerInfo.label })}
                        sx={{
                          display: "inline-block",
                          px: 1.25,
                          py: 0.5,
                          borderRadius: 1,
                          fontSize: 12,
                          fontWeight: 600,
                          lineHeight: 1.6,
                          textDecoration: "none",
                          ...providerChipSx(providerInfo),
                        }}
                      >
                        {providerInfo.label}
                      </Box>
                    )}
                    {linkedToMe && (
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ color: "success.main" }}>
                        <CheckCircleIcon sx={{ fontSize: 16 }} />
                        <Typography variant="caption" fontWeight={600} color="inherit">
                          {t("models:author.linkedBadge")}
                        </Typography>
                      </Stack>
                    )}
                    {canClaim && (
                      <Button size="small" variant="outlined" disabled={linking} onClick={handleClaim}>
                        {t("models:author.itsMe")}
                      </Button>
                    )}
                  </Stack>
                )}

            <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 3, mb: 1 }}>
              {t("models:author.bio")}
            </Typography>
            <Typography
              variant="body2"
              sx={{ whiteSpace: "pre-wrap", color: bioText ? "text.primary" : "text.disabled" }}
            >
              {bioText || t("models:author.noBio")}
            </Typography>
          </Box>

          <Box sx={{ minWidth: 0, pt: 3, pb: 3 }}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
              <Typography variant="h6" fontWeight={700}>
                {t("models:pageTitle")}
              </Typography>
              <ModelSelectionToolbar
                selection={selection}
                total={items.length}
                hasMore={hasMore}
                onDeleted={(ids) => setItems((prev) => prev.filter((i) => !ids.includes(i.id)))}
                onUpdated={(updated) => setItems((prev) => replacePrints(prev, updated))}
                onUnauthorized={onUnauthorized}
              />
              <Box sx={{ ml: "auto" }}>
                <ModelFiltersButton filters={filters} sources={sources} />
              </Box>
            </Stack>
            {items.length ? (
              <Stack spacing={2}>
                <Box sx={cardGridSx(5)}>
                  {items.map((item) => (
                    <ModelCard
                      key={item.id}
                      item={item}
                      theme={theme}
                      previewMode={previewMode}
                      onDeleted={(deletedId) => setItems((prev) => prev.filter((i) => i.id !== deletedId))}
                      onFavoriteChange={(updated) =>
                        setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
                      }
                      onUpdated={(updated) => setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))}
                      onUnauthorized={onUnauthorized}
                      viewer={viewer}
                      selectMode={selection.active}
                      selected={selection.isSelected(item.id)}
                      onToggleSelect={(range) => selection.toggle(item.id, range)}
                    />
                  ))}
                  {loadingMore && <CardSkeletons count={5} />}
                </Box>
                {hasMore && <Box ref={loadMoreSentinelRef} sx={{ height: 1 }} />}
              </Stack>
            ) : (
              <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "text.secondary" }}>
                {filters.active ? (
                  <FiltersEmptyNote filters={filters} />
                ) : (
                  <Typography variant="body2">{t("models:author.noModels")}</Typography>
                )}
              </Stack>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
