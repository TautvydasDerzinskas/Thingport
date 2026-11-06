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
import { cardGridSx } from "../../components/media/cardGrid";
import ProfileLayout, { ProfileLayoutSkeleton } from "../../components/profile/ProfileLayout";
import UserAvatar from "../../components/UserAvatar";
import CollectionCard from "../CollectionsPage/CollectionCard";
import SortTabs from "../ModelsPage/SortTabs";
import ExploreUserModels from "./ExploreUserModels";

type Section = "models" | "collections";

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

  const read = useCallback(
    function readPage(asked: string, fresh: boolean) {
      const reading = ++latest.current;
      if (fresh) setPage(null);
      setNotFound(false);
      setFailed(false);
      setOff(false);
      socialApi.user(asked).then(
        (value) => {
          if (reading !== latest.current) return;
          if (!value) {
            // Not under the header of whoever was shown before.
            setPage(null);
            setNotFound(true);
            return;
          }
          shownFor.current = asked;
          setPage(value);
        },
        (err) => {
          if (reading !== latest.current) return;
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
          />
        ) : page.collections.length ? (
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
          </Box>
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
