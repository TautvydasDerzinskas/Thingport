import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import { UnauthorizedError } from "../../api/client";
import type { AuthUser } from "../../api/auth";
import type { PrintSortMode } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
import { SocialOffError, socialApi, type ExploreUserPage as UserPage } from "../../api/social";
import { refreshSocialStatus, useSocialStatus } from "../../hooks/useSocialStatus";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import { useInfiniteScroll } from "../../hooks/useInfiniteScroll";
import { useScrollRestoreHold } from "../../hooks/useScrollRestoreHold";
import ProfileLayout, { ProfileLayoutSkeleton } from "../../components/profile/ProfileLayout";
import UserAvatar from "../../components/UserAvatar";
import CollectionCard from "../CollectionsPage/CollectionCard";
import SortTabs from "../ModelsPage/SortTabs";
import ExploreUserModels from "./ExploreUserModels";

type Section = "models" | "collections";

// Collections a page, after the first that comes with the page.
const COLLECTIONS_PAGE = 24;

// The tabs read as the page's section titles, as "Models" does on My models.
const tabsSx = {
  minHeight: 0,
  "& .MuiTabs-flexContainer": { gap: 3 },
  "& .MuiTab-root": {
    minHeight: 0,
    minWidth: 0,
    px: 0,
    py: 0.75,
    typography: "h6",
    fontWeight: 700,
    textTransform: "none",
    color: "text.secondary",
  },
  "& .MuiTab-root.Mui-selected": { color: (theme: Theme) => theme.thingport.headingText },
};

type Props = {
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUnauthorized?: () => void;
  viewer?: AuthUser | null;
};

/** One user, as the others see them: their profile beside their own models, when they made them public, and the
 *  collections they made public -- their My models page, as a visitor sees it. */
export default function ExploreUserPage({ theme, previewMode, onUnauthorized, viewer }: Props) {
  const { userId } = useParams<{ userId: string }>();
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState<UserPage | null>(null);
  const [notFound, setNotFound] = useState(false);
  // A read that failed: in place of the page when there's none yet, above it when it was only read again.
  const [failed, setFailed] = useState(false);
  // Social features were switched off: there's no Explore to show anyone's page in.
  const [off, setOff] = useState(false);
  const shownFor = useRef<string | null>(null);
  // Only the latest read's answer counts: one asked for earlier, or for a page left since, is dropped.
  const latest = useRef(0);
  // Their collections past the first page, read as the list is scrolled; a page read again starts from its first.
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [collectionsFailed, setCollectionsFailed] = useState(false);
  // How many have come from the server, apart from how many show (one shown already isn't twice), and whether it has
  // more; paging waits while the page is read again, which starts it over.
  const [collectionsFrom, setCollectionsFrom] = useState(0);
  const [collectionsMore, setCollectionsMore] = useState(false);
  const [rereading, setRereading] = useState(false);
  // Each time the page has been read: the models tab reads its models again after they went missing.
  const [reads, setReads] = useState(0);

  const read = useCallback(
    function readPage(asked: string, fresh: boolean) {
      const reading = ++latest.current;
      if (fresh) setPage(null);
      setLoadingCollections(false);
      setCollectionsFailed(false);
      setRereading(true);
      setNotFound(false);
      setFailed(false);
      setOff(false);
      socialApi.user(asked).then(
        (value) => {
          if (reading !== latest.current) return;
          setRereading(false);
          if (!value) {
            // Not under the header of whoever was shown before.
            setPage(null);
            setNotFound(true);
            return;
          }
          shownFor.current = asked;
          setPage(value);
          setReads((n) => n + 1);
          setCollectionsFrom(value.collections.length);
          setCollectionsMore(value.collections.length < value.collections_total);
        },
        (err) => {
          if (reading !== latest.current) return;
          setRereading(false);
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else if (err instanceof SocialOffError) {
            setPage(null);
            setOff(true);
            // So the status learns they're off too. Back on already (switched again meanwhile): read again, unless
            // another read has started since.
            void refreshSocialStatus().then((status) => {
              if (status.enabled && reading === latest.current) readPage(asked, true);
            });
          } else setFailed(true);
        },
      );
    },
    [onUnauthorized],
  );

  useEffect(() => {
    if (!userId) return;
    // Someone else's page starts from the skeleton; the same one's stays while it's read again.
    read(userId, shownFor.current !== userId);
    return () => {
      latest.current += 1;
    };
  }, [userId, read]);

  // Shown while social features were off: read again once they're switched back on -- on the change, not whenever
  // the status says on, which may be from before they went off.
  const socialOn = useSocialStatus()?.enabled === true;
  const wasOn = useRef(socialOn);
  useEffect(() => {
    if (socialOn && !wasOn.current && off && userId) read(userId, true);
    wasOn.current = socialOn;
  }, [socialOn, off, userId, read]);

  // Read again, in place, after the viewer changed one of their own collections here: the counts follow.
  const refresh = () => {
    if (userId) read(userId, false);
  };

  const moreCollections = page !== null && collectionsMore && !rereading;
  const loadMoreCollections = async () => {
    if (!page || loadingCollections || !moreCollections || collectionsFailed) return;
    const reading = latest.current;
    setLoadingCollections(true);
    try {
      const next = await socialApi.userCollections(page.user.id, {
        limit: COLLECTIONS_PAGE,
        offset: collectionsFrom,
      });
      if (reading !== latest.current) return;
      // None any more: the page is read again, to say what's there now.
      if (!next) return refresh();
      setCollectionsFrom(collectionsFrom + next.items.length);
      setCollectionsMore(next.hasMore && next.items.length > 0);
      setPage((prev) => {
        if (!prev) return prev;
        // One already shown, moved along by a change meanwhile, isn't shown twice.
        const shown = new Set(prev.collections.map((collection) => collection.id));
        const collections = [...prev.collections, ...next.items.filter((collection) => !shown.has(collection.id))];
        return { ...prev, collections };
      });
    } catch (err) {
      if (reading !== latest.current) return;
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else if (err instanceof SocialOffError) refresh();
      else setCollectionsFailed(true);
    } finally {
      if (reading === latest.current) setLoadingCollections(false);
    }
  };
  const collectionsSentinel = useInfiniteScroll(
    loadMoreCollections,
    moreCollections && !collectionsFailed,
    loadingCollections,
  );

  // Back to the page: its models and collections come once it's read, so a restore waits for that too.
  useScrollRestoreHold(!page && !off && !failed && !notFound);

  usePageHeader({
    title: page?.user.display_name,
    subtitle: page
      ? t("models:explore.personCounts", {
          collections: t("models:explore.collectionCount", { count: page.user.collection_count }),
          models: t("models:explore.modelCount", { count: page.user.model_count }),
        })
      : undefined,
  });

  if (off) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:explore.unavailable")}</Typography>
      </Stack>
    );
  }

  if (failed && !page) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:explore.loadFailed")}</Typography>
        <Button size="small" onClick={() => userId && read(userId, true)}>
          {t("common:retry")}
        </Button>
      </Stack>
    );
  }

  if (notFound) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:explore.userNotFound")}</Typography>
        <Button size="small" onClick={() => navigate("/explore")}>
          {t("models:explore.backToExplore")}
        </Button>
      </Stack>
    );
  }

  if (!page) {
    return <ProfileLayoutSkeleton />;
  }

  const joined = new Date(page.user.joined_at).toLocaleDateString(undefined, { year: "numeric", month: "long" });
  // Models first, when there are any to show: what they made before what they gathered.
  const tab: Section = page.user.models_public && searchParams.get("tab") !== "collections" ? "models" : "collections";
  const sortParam = searchParams.get("orderBy");
  const sortMode: PrintSortMode = sortParam === "popular" || sortParam === "downloads" ? sortParam : "newest";
  const setParam = (key: string, value: string | null, replace = false) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace },
    );

  return (
    <Stack spacing={3} sx={{ maxWidth: "1920px", mx: "auto" }}>
      {failed && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={refresh}>
              {t("common:retry")}
            </Button>
          }
        >
          {t("models:explore.refreshFailed")}
        </Alert>
      )}
      <ProfileLayout
        cover={page.user}
        avatar={<UserAvatar user={page.user} size={112} />}
        name={page.user.display_name}
        subtitle={t("models:explore.joined", { date: joined })}
        bio={page.user.bio}
        bioMarkdown
        links={page.user.links}
      >
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, mb: 2 }}>
          {page.user.models_public ? (
            <Tabs
              value={tab}
              onChange={(_event, next: Section) => setParam("tab", next === "models" ? null : next)}
              aria-label={t("models:explore.sections")}
              sx={tabsSx}
            >
              <Tab value="models" label={t("models:pageTitle")} />
              <Tab value="collections" label={t("models:collections.pageTitle")} />
            </Tabs>
          ) : (
            <Typography variant="h6" fontWeight={700} sx={{ color: (muiTheme) => muiTheme.thingport.headingText }}>
              {t("models:collections.pageTitle")}
            </Typography>
          )}
          {tab === "models" && (
            <Box sx={{ ml: "auto" }}>
              <SortTabs
                value={sortMode}
                onChange={(mode) => setParam("orderBy", mode === "newest" ? null : mode, true)}
              />
            </Box>
          )}
        </Box>

        {tab === "models" ? (
          <ExploreUserModels
            userId={page.user.id}
            sortMode={sortMode}
            theme={theme}
            previewMode={previewMode}
            viewer={viewer}
            onUnauthorized={onUnauthorized}
            onGone={refresh}
            pageRead={reads}
          />
        ) : page.collections.length ? (
          <Stack spacing={2}>
            <Box sx={cardGridSx(5)}>
              {page.collections.map((collection) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  theme={theme}
                  previewMode={previewMode}
                  // Only the viewer's own has a menu to change it from: a collection made private, or deleted, leaves
                  // the list of what they share.
                  onUpdated={(updated) => {
                    setPage(
                      (prev) =>
                        prev && {
                          ...prev,
                          collections: updated.is_public
                            ? prev.collections.map((c) => (c.id === updated.id ? updated : c))
                            : prev.collections.filter((c) => c.id !== updated.id),
                        },
                    );
                    refresh();
                  }}
                  onDeleted={(id) => {
                    setPage((prev) => prev && { ...prev, collections: prev.collections.filter((c) => c.id !== id) });
                    refresh();
                  }}
                  onUnauthorized={onUnauthorized}
                />
              ))}
              {loadingCollections && <CardSkeletons count={5} />}
            </Box>
            {collectionsFailed ? (
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="center"
                spacing={1}
                sx={{ color: "text.secondary" }}
              >
                <Typography variant="body2">{t("models:explore.collectionsLoadFailed")}</Typography>
                <Button size="small" onClick={() => setCollectionsFailed(false)}>
                  {t("common:retry")}
                </Button>
              </Stack>
            ) : (
              moreCollections && <Box ref={collectionsSentinel} sx={{ height: 1 }} />
            )}
          </Stack>
        ) : page.user.id === viewer?.id ? (
          <Stack alignItems="flex-start" spacing={1} sx={{ color: "text.secondary" }}>
            <Typography variant="body2">{t("models:explore.ownEmpty")}</Typography>
            <Button size="small" variant="outlined" onClick={() => navigate("/models/collections")}>
              {t("models:explore.emptyAction")}
            </Button>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("models:explore.noCollections", { name: page.user.display_name })}
          </Typography>
        )}
      </ProfileLayout>
    </Stack>
  );
}
