import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import { type PreviewMode } from "../../api/settings";
import { socialApi, type ExploreUserPage as UserPage } from "../../api/social";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import MarkdownDescription from "../../components/MarkdownDescription";
import UserAvatar from "../../components/UserAvatar";
import { dividerBorderColor } from "../../theme";
import CollectionCard from "../CollectionsPage/CollectionCard";

type Props = {
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUnauthorized?: () => void;
};

/** One user, as the others see them: who they are and the collections they made public. */
export default function ExploreUserPage({ theme, previewMode, onUnauthorized }: Props) {
  const { userId } = useParams<{ userId: string }>();
  const { t } = useTranslation(["models", "common"]);
  const navigate = useNavigate();
  const [page, setPage] = useState<UserPage | null>(null);
  const [notFound, setNotFound] = useState(false);
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    // Someone else's page starts from the skeleton; the same one's stays while it's read again.
    if (shownFor.current !== userId) {
      setPage(null);
      setNotFound(false);
    }
    socialApi.user(userId).then(
      (value) => {
        if (!active) return;
        shownFor.current = userId;
        setPage(value);
      },
      (err) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setNotFound(true);
      },
    );
    return () => {
      active = false;
    };
  }, [userId, onUnauthorized]);

  // Read again, in place, after the viewer changed one of their own collections here: the counts follow. Dropped if
  // another user's page has been shown since.
  const refresh = () => {
    if (!userId) return;
    const asked = userId;
    socialApi.user(asked).then(
      (value) => {
        if (shownFor.current === asked) setPage(value);
      },
      () => undefined,
    );
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

  const joined = page
    ? new Date(page.user.joined_at).toLocaleDateString(undefined, { year: "numeric", month: "long" })
    : null;

  return (
    <Stack spacing={3} sx={{ maxWidth: "1920px", mx: "auto" }}>
      <Paper
        variant="outlined"
        sx={{ p: 2.5, borderRadius: "12px", borderColor: dividerBorderColor, display: "flex", gap: 2.5 }}
      >
        {page ? (
          <UserAvatar user={page.user} size={64} />
        ) : (
          <Skeleton variant="circular" width={64} height={64} sx={{ flexShrink: 0 }} />
        )}
        <Stack spacing={0.5} sx={{ minWidth: 0, flex: 1, justifyContent: "center" }}>
          <Typography variant="h6" fontWeight={700} sx={{ color: (muiTheme) => muiTheme.thingport.headingText }}>
            {page ? page.user.display_name : <Skeleton width={180} />}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {joined ? t("models:explore.joined", { date: joined }) : <Skeleton width={120} />}
          </Typography>
          {page?.user.bio && (
            <Box sx={{ mt: 1, color: "text.secondary", "& p": { my: 0.5 } }}>
              <MarkdownDescription markdown={page.user.bio} />
            </Box>
          )}
        </Stack>
      </Paper>

      {!page ? (
        <Box sx={cardGridSx(6)}>
          <CardSkeletons count={6} variant="collection" />
        </Box>
      ) : page.collections.length ? (
        <Box sx={cardGridSx(6)}>
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
      ) : (
        // Only ever the viewer's own page: anyone else's with nothing public isn't found.
        <Stack alignItems="center" spacing={1} sx={{ py: 6, color: "text.secondary" }}>
          <Typography variant="body2">{t("models:explore.ownEmpty")}</Typography>
          <Button size="small" variant="outlined" onClick={() => navigate("/models/collections")}>
            {t("models:explore.emptyAction")}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
