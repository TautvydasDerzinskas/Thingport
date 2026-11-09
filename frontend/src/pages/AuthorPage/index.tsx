import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { alpha } from "@mui/material/styles";
import ModelFiltersButton from "../../components/ModelFilters/ModelFiltersButton";
import FiltersEmptyNote from "../../components/ModelFilters/FiltersEmptyNote";
import { useLibrarySources, useModelFilters } from "../../hooks/useModelFilters";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PersonIcon from "@mui/icons-material/Person";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import { UnauthorizedError } from "../../api/client";
import { authorsApi, type Author } from "../../api/authors";
import { type Print, type PrintSortMode, printsApi } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
import type { AuthUser } from "../../api/auth";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useRememberedList } from "../../hooks/useRememberedList";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import { importProviderInfo, printProviderInfo, providerChipSx } from "../../constants/importProviders";
import { authorProfileUrl } from "../../utils/authorProfileUrl";
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import ModelCard from "../ModelsPage/ModelCard";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import ModelSelectionToolbar from "../../components/modelSelection/ModelSelectionToolbar";
import { replacePrints, useModelSelection } from "../../hooks/useModelSelection";
import { useFinishedVersion } from "../../components/importQueue/ImportQueueContext";
import { keepLoaded, useBackgroundReload } from "../../hooks/useBackgroundReload";
import { profileApi } from "../../api/profile";
import ProfileLayout, { ProfileLayoutSkeleton } from "../../components/profile/ProfileLayout";
import { useSocialStatus } from "../../hooks/useSocialStatus";
import SortTabs from "../ModelsPage/SortTabs";
import EditProfileDialog from "./EditProfileDialog";
import HandleChip from "../../components/profile/HandleChip";
import ModelsVisibilityToggle from "./ModelsVisibilityToggle";
import AvatarDialog from "../../components/profile/AvatarDialog";
import EditableAvatar from "../../components/profile/EditableAvatar";

const PAGE_SIZE = 24;
// What the page shows beside the grid, put back with it on the way back.
type AuthorAlongside = { author: Author | null; myLinks: Author[] };

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
  const { generative, hiddenProviders, licenseAllows, licensed } = filters;
  const sources = useLibrarySources(null);
  const finishedVersion = useFinishedVersion();
  const isBackgroundReload = useBackgroundReload(finishedVersion);
  // A page on its way when the list reloads belongs to the old list, and is dropped.
  const listRun = useRef(0);
  const { items, setItems, hasMore, setHasMore, loading, setLoading, returning, restored } = useRememberedList<
    Print,
    AuthorAlongside
  >({ loadingAtFirst: true, alongside: (): AuthorAlongside => ({ author, myLinks }) });
  const [author, setAuthor] = useState<Author | null>(restored?.author ?? null);
  const [notFound, setNotFound] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(items.length);
  const selection = useModelSelection(items);
  // Authors the viewer has claimed: self-mode provider chips, and whether "It's me!" shows.
  const [myLinks, setMyLinks] = useState<Author[]>(restored?.myLinks ?? []);
  const [linking, setLinking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changingAvatar, setChangingAvatar] = useState(false);
  const [changingVisibility, setChangingVisibility] = useState(false);
  // Whether their models can be public at all: there's no Explore to show them on while social features are off.
  const social = useSocialStatus();
  const socialOn = social?.enabled === true;
  // Handles mean something once this instance connects with others.
  const handleHost = social?.federation ? social.instance_host : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const sortModeParam = searchParams.get("orderBy");
  const sortMode: PrintSortMode =
    sortModeParam === "popular" || sortModeParam === "downloads" ? sortModeParam : "newest";
  const setSortMode = (mode: PrintSortMode) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (mode === "newest") next.delete("orderBy");
        else next.set("orderBy", mode);
        return next;
      },
      { replace: true },
    );

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
    if (message) showToast({ message, severity: "error" });
    return false;
  };

  useEffect(() => {
    if (!authorId) return;
    let cancelled = false;
    listRun.current += 1;
    // Back to this list puts it back as it was left, then checks it quietly, like a reload nobody asked for.
    const kept = returning();
    if (kept !== null) setOffset(kept);
    const background = isBackgroundReload() || kept !== null;
    const limit = background ? keepLoaded(PAGE_SIZE, kept ?? offset) : PAGE_SIZE;
    if (!background) {
      setLoading(true);
      setNotFound(false);
    }
    (async () => {
      try {
        if (isSelf) {
          const [printsResult, linkedAuthors] = await Promise.all([
            printsApi.list({
              author_id: SELF_AUTHOR_ID,
              generative: generative || undefined,
              hide_providers: hiddenProviders,
              license_allows: licenseAllows,
              licensed: licensed || undefined,
              order_by: sortMode,
              limit,
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
            license_allows: licenseAllows,
            licensed: licensed || undefined,
            order_by: sortMode,
            limit,
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
        if (handleError(err) || background) return;
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorId, isSelf, generative, hiddenProviders, licenseAllows, licensed, sortMode, finishedVersion]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !authorId) return;
    const run = listRun.current;
    setLoadingMore(true);
    try {
      const result = await printsApi.list({
        author_id: isSelf ? SELF_AUTHOR_ID : authorId,
        generative: generative || undefined,
        hide_providers: hiddenProviders,
        license_allows: licenseAllows,
        licensed: licensed || undefined,
        order_by: sortMode,
        limit: PAGE_SIZE,
        offset,
      });
      if (run !== listRun.current) return;
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
      showToast({ message: err instanceof Error ? err.message : t("models:author.linkFailed"), severity: "error" });
    } finally {
      setLinking(false);
    }
  };

  // Going public asks first: everyone on the instance can then download and copy them. Going private doesn't need to.
  const toggleModelsPublic = async () => {
    if (!viewer) return;
    const next = !viewer.models_public;
    if (next) {
      const confirmed = await confirmDialog({
        title: t("models:author.visibility.confirmTitle"),
        message: t("models:author.visibility.confirmMessage"),
        confirmLabel: t("models:author.visibility.confirmLabel"),
      });
      if (!confirmed) return;
    }
    setChangingVisibility(true);
    try {
      onUserUpdated?.(await profileApi.update({ models_public: next }));
      showToast({ message: t(next ? "models:author.visibility.nowPublic" : "models:author.visibility.nowPrivate") });
    } catch (err) {
      handleError(err, err instanceof Error ? err.message : t("models:author.editProfile.saveFailed"));
    } finally {
      setChangingVisibility(false);
    }
  };

  if (loading) {
    // Whose page it is is known already for the user's own, and so is their cover.
    return <ProfileLayoutSkeleton cover={isSelf ? viewer : undefined} />;
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
  const avatarUrl = isSelf ? viewer?.avatar_url : (author?.avatar_url ?? undefined);

  const chips = isSelf
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
      );

  return (
    <>
      <ProfileLayout
        cover={isSelf ? viewer : { background_url: author?.background_url }}
        coverAction={
          isSelf &&
          viewer && (
            <Tooltip title={t("models:author.editProfile.changeCover")}>
              <IconButton
                aria-label={t("models:author.editProfile.changeCover")}
                onClick={() => setEditing(true)}
                sx={(muiTheme) => ({
                  position: "absolute",
                  top: 12,
                  right: 12,
                  bgcolor: alpha(muiTheme.palette.common.black, 0.45),
                  color: muiTheme.palette.common.white,
                  "&:hover": { bgcolor: alpha(muiTheme.palette.common.black, 0.65) },
                })}
              >
                <PhotoCameraOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )
        }
        avatar={
          isSelf && viewer ? (
            <EditableAvatar
              src={avatarUrl}
              name={displayName}
              size={112}
              label={t("models:avatar.change")}
              onClick={() => setChangingAvatar(true)}
            />
          ) : (
            <Avatar src={avatarUrl} sx={{ width: 112, height: 112, fontSize: 40 }}>
              <PersonIcon fontSize="large" />
            </Avatar>
          )
        }
        name={displayName}
        subtitle={
          isSelf && viewer && handleHost ? (
            <HandleChip
              user={viewer}
              host={handleHost}
              onSaved={(user) => onUserUpdated?.(user)}
              onUnauthorized={onUnauthorized}
            />
          ) : !isSelf && author?.handle ? (
            `@${author.handle}`
          ) : undefined
        }
        actions={
          <>
            {chips}
            {isSelf && viewer && (
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2 }}>
                {socialOn && (
                  <ModelsVisibilityToggle
                    isPublic={Boolean(viewer.models_public)}
                    busy={changingVisibility}
                    onToggle={toggleModelsPublic}
                  />
                )}
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<EditOutlinedIcon />}
                  onClick={() => setEditing(true)}
                >
                  {t("models:author.editProfile.button")}
                </Button>
              </Stack>
            )}
          </>
        }
        bio={bioText}
        // A user's bio is shown as the other users see it on Explore.
        bioMarkdown={isSelf}
        links={isSelf ? viewer?.links : undefined}
      >
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, mb: 2 }}>
          <Typography variant="h6" fontWeight={700} sx={{ color: (muiTheme) => muiTheme.thingport.headingText }}>
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
          <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1.5 }}>
            <SortTabs value={sortMode} onChange={setSortMode} />
            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
            <ModelFiltersButton filters={filters} sources={sources} />
          </Box>
        </Box>
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
      </ProfileLayout>
      {changingAvatar && viewer && (
        <AvatarDialog
          user={viewer}
          onClose={() => setChangingAvatar(false)}
          onSaved={(saved) => {
            onUserUpdated?.(saved);
            setChangingAvatar(false);
            showToast({ message: t("models:avatar.saved") });
          }}
          onUnauthorized={onUnauthorized}
        />
      )}
      {editing && viewer && (
        <EditProfileDialog
          user={viewer}
          linkedAuthors={myLinks}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            onUserUpdated?.(saved);
            setEditing(false);
            showToast({ message: t("models:author.editProfile.saved") });
          }}
          onUpdated={onUserUpdated}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  );
}
