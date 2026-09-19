import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
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
import { importProviderInfo, printProviderInfo } from "../../constants/importProviders";
import { authorProfileUrl } from "../../utils/authorProfileUrl";
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import ModelCard from "../ModelsPage/ModelCard";

const PAGE_SIZE = 24;
const COVER_HEIGHT = 184;

type Props = {
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUnauthorized?: () => void;
  /** Only read for the `/authors/self` "My models" route (see UserMenu's menu item and
   *  ModelCard/ModelSidePanel's showViewerAsAuthor click-through) -- every other author id backs
   *  a real, shared Author row instead, fetched below. */
  viewer?: AuthUser | null;
  /** Called after a successful "It's me!" link with the (possibly bio/cover-enriched) viewer --
   *  same shape as ChangeEmailPage's own onUserUpdated, so App.tsx's handleUserUpdated can persist
   *  and propagate it app-wide. */
  onUserUpdated?: (user: AuthUser) => void;
};

/** An author's own page: a cover strip, then a narrow profile column (avatar, name, @handle, a
 *  provider chip linking back to their profile on the site they were imported from, and their
 *  bio) beside a wide "Models" grid of every print by them this user has imported -- the models
 *  route's own grid pattern, reused as-is via ModelCard. The whole thing reads as a page of its
 *  own, sidebar-colored, sitting inside the app shell rather than blending into it -- a light-theme
 *  divider on the profile column's right edge separates it from the models grid (matching the rest
 *  of the app's light-mode borders, dropped in dark mode where the two columns already contrast).
 *  Author rows are shared across users (not scoped to this account -- see
 *  authorService.ts's doc comment on the backend), so there's nothing here to edit.
 *
 *  Doubles as the viewer's own "My models" page when `authorId === SELF_AUTHOR_ID`: a plain
 *  upload has no Author row at all (see ModelCard/ModelSidePanel's showViewerAsAuthor fallback),
 *  so there's nothing to authorsApi.get() -- the profile column instead shows the viewer's own
 *  identity, and the grid is fetched via the backend's matching SELF_AUTHOR_ID sentinel rather
 *  than a real author_id. */
export default function AuthorPage({ theme, previewMode, onUnauthorized, viewer, onUserUpdated }: Props) {
  const { authorId } = useParams<{ authorId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation(["models", "common"]);
  const confirmDialog = useConfirm();
  const showToast = useToast();
  const isSelf = authorId === SELF_AUTHOR_ID;
  const viewerAvatarUrl = useGravatarUrl(viewer?.email, 112);
  const [author, setAuthor] = useState<Author | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [items, setItems] = useState<Print[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  // The Author rows the viewer has already claimed as themselves -- backs self mode's provider
  // chips and, on a real author page, whether "It's me!" should show at all (hidden once the
  // viewer already has a different author linked for that same provider, or this one is already
  // linked to someone). Fetched alongside everything else below regardless of mode.
  const [myLinks, setMyLinks] = useState<Author[]>([]);
  const [linking, setLinking] = useState(false);

  const displayName = isSelf
    ? viewer?.display_name || t("models:card.unknownAuthor")
    : author?.name || author?.handle || t("models:card.unknownAuthor");

  // Only overrides the title -- the route's own default onBack (see AppLayout's useRouteChrome,
  // "/authors/" -> useSmartBack) already does exactly "back button goes to the previous page".
  // A real (non-self) author gets a small "Author" subtitle under their name instead of an
  // "Author - " prefix sharing the title line with it -- same treatment as the collection/tag/
  // model/category detail headers. "My models" has no such prefix to move in the first place,
  // so the self view stays plain.
  usePageHeader({
    title: isSelf ? t("models:author.myModelsPageTitle") : author ? t("models:author.pageTitleWithName", { name: displayName }) : undefined,
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
            printsApi.list({ author_id: SELF_AUTHOR_ID, limit: PAGE_SIZE, offset: 0 }),
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
          printsApi.list({ author_id: authorId, limit: PAGE_SIZE, offset: 0 }),
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
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorId, isSelf]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !authorId) return;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({ author_id: isSelf ? SELF_AUTHOR_ID : authorId, limit: PAGE_SIZE, offset });
      setItems(prev => [...prev, ...result.items]);
      setOffset(offset + result.items.length);
      setHasMore(result.hasMore);
    } catch (err) {
      handleError(err, t("models:errors.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  };

  const loadMoreSentinelRef = useInfiniteScroll(loadMore, hasMore, loading || loadingMore);

  const linkedToMe = Boolean(author && myLinks.some(a => a.id === author.id));
  const viewerHasProviderLinked = Boolean(author && myLinks.some(a => a.provider === author.provider));
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
      setMyLinks(prev => [...prev, result.author]);
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
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress size={22} />
      </Stack>
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
  // Self mode's bio/cover come from the viewer's own profile fields -- populated by linking an
  // author elsewhere (see authorService.ts's linkAuthorToUser) rather than fetched here.
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
            // Quoted, not a bare url(...) -- an unquoted CSS url() treats the first unescaped ")"
            // as its terminator, which a data: URI (or any URL containing one) would break.
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
            // "stretch" (the grid default, but spelled out since the divider below depends on it)
            // -- so the shorter profile column's box is exactly as tall as the models grid next to
            // it, and its border-right runs the full height instead of stopping wherever the
            // profile column's own (usually much shorter) content ends.
            alignItems: "stretch",
            pt: 3,
            pb: 3
          }}
        >
          <Box
            sx={{
              borderRight: { xs: "none", md: "1px solid" },
              // Unlike every other light-mode-only border in the app (see dividerBorderColor),
              // this one stays visible in dark mode too -- the same plain `divider` token the
              // sidebar's own Download/Administration separator renders unconditionally, rather
              // than the sidebar's own outer edge (which dividerBorderColor hides in dark mode).
              borderColor: "divider",
              pr: { xs: 0, md: 4 },
            }}
          >
            <Avatar src={avatarUrl} sx={{ width: 112, height: 112, fontSize: 40 }}>
              <PersonIcon fontSize="large" />
            </Avatar>
            <Typography variant="h5" fontWeight={700} sx={{ mt: 2 }}>{displayName}</Typography>
            {!isSelf && author?.handle && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>@{author.handle}</Typography>
            )}
            {isSelf ? (
              myLinks.length > 0 && (
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} sx={{ mt: 1.5 }}>
                  {myLinks.map(linked => {
                    const info = printProviderInfo(linked.provider);
                    return (
                      <Chip
                        key={linked.id}
                        label={info.label}
                        size="small"
                        clickable
                        onClick={() => navigate(`/authors/${linked.id}`)}
                        sx={{ bgcolor: info.color, color: info.textColor ?? "#fff", fontWeight: 600 }}
                      />
                    );
                  })}
                </Stack>
              )
            ) : (
              (providerInfo || linkedToMe || canClaim) && (
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
                        color: "#fff",
                        textDecoration: "none",
                        bgcolor: providerInfo.color,
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
              )
            )}

            <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 3, mb: 1 }}>{t("models:author.bio")}</Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", color: bioText ? "text.primary" : "text.disabled" }}>
              {bioText || t("models:author.noBio")}
            </Typography>
          </Box>

          <Box sx={{ minWidth: 0, pt: 3, pb: 3 }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>{t("models:pageTitle")}</Typography>
            {items.length ? (
              <Stack spacing={2}>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, 1fr)",
                    columnGap: "20px",
                    rowGap: "20px",
                    "@media (max-width: 1684px)": { gridTemplateColumns: "repeat(4, 1fr)" },
                    "@media (max-width: 1404px)": { gridTemplateColumns: "repeat(3, 1fr)" },
                    "@media (max-width: 1124px)": { gridTemplateColumns: "repeat(2, 1fr)" },
                    "@media (max-width: 860px)": { gridTemplateColumns: "repeat(1, 1fr)" },
                  }}
                >
                  {items.map(item => (
                    <ModelCard
                      key={item.id}
                      item={item}
                      theme={theme}
                      previewMode={previewMode}
                      onDeleted={deletedId => setItems(prev => prev.filter(i => i.id !== deletedId))}
                      onFavoriteChange={updated => setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)))}
                      onUpdated={updated => setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)))}
                      onUnauthorized={onUnauthorized}
                      viewer={viewer}
                    />
                  ))}
                </Box>
                {hasMore && (
                  <Stack ref={loadMoreSentinelRef} direction="row" justifyContent="center" sx={{ py: 1 }}>
                    {loadingMore && (
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "text.secondary" }}>
                        <CircularProgress size={14} />
                        <Typography variant="caption">{t("models:grid.loadingMore")}</Typography>
                      </Stack>
                    )}
                  </Stack>
                )}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">{t("models:author.noModels")}</Typography>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
