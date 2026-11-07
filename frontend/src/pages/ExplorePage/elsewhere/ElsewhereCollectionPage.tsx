import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../../api/client";
import { socialApi, type RemoteCollectionPage } from "../../../api/social";
import InstanceChip from "../../../components/InstanceChip";
import { usePageHeader } from "../../../components/Layout/PageHeaderContext";
import MarkdownDescription from "../../../components/MarkdownDescription";
import { CardSkeletons } from "../../../components/media/CardSkeleton";
import { cardGridSx } from "../../../components/media/cardGrid";
import { useToast } from "../../../components/ToastProvider";
import UserAvatar from "../../../components/UserAvatar";
import { RemoteModelCardView } from "../RemoteCards";
import ElsewhereGone from "./ElsewhereGone";

const PAGE = 30;

/** A partner's person's public collection: whose it is, where, and the models in it, a page at a time. */
export default function ElsewhereCollectionPage({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const { collectionId } = useParams<{ collectionId: string }>();
  const { t } = useTranslation(["models", "common"]);
  const [page, setPage] = useState<RemoteCollectionPage | null>(null);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const showToast = useToast();
  const latest = useRef(0);

  const read = useCallback(
    (id: string) => {
      const asked = ++latest.current;
      setPage(null);
      setGone(false);
      setFailed(false);
      setLoadingMore(false);
      socialApi.elsewhere.collection(id, { limit: PAGE, offset: 0 }).then(
        (value) => {
          if (asked !== latest.current) return;
          if (value) setPage(value);
          else setGone(true);
        },
        (err) => {
          if (asked !== latest.current) return;
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else setFailed(true);
        },
      );
    },
    [onUnauthorized],
  );

  useEffect(() => {
    if (collectionId) read(collectionId);
    return () => {
      latest.current += 1;
    };
  }, [collectionId, read]);

  const loadMore = async () => {
    if (!collectionId || !page || loadingMore) return;
    const asked = latest.current;
    setLoadingMore(true);
    try {
      const next = await socialApi.elsewhere.collection(collectionId, { limit: PAGE, offset: page.models.length });
      if (asked !== latest.current) return;
      if (next) setPage({ ...page, models: [...page.models, ...next.models], total: next.total });
    } catch (err) {
      if (asked !== latest.current) return;
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: t("models:explore.modelsLoadFailed"), severity: "error" });
    } finally {
      if (asked === latest.current) setLoadingMore(false);
    }
  };

  const collection = page?.collection;
  usePageHeader({
    title: collection?.name,
    subtitle: collection ? t("models:explore.modelCount", { count: collection.item_count }) : undefined,
  });

  if (gone) return <ElsewhereGone />;
  if (failed) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:explore.loadFailed")}</Typography>
        <Button size="small" onClick={() => collectionId && read(collectionId)}>
          {t("common:retry")}
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2.5} sx={{ maxWidth: "1920px", mx: "auto" }}>
      {collection && (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Stack direction="row" spacing={1} alignItems="center">
              <UserAvatar user={collection.owner} size={28} />
              <Link
                component={RouterLink}
                to={`/explore/elsewhere/people/${collection.owner.id}`}
                underline="hover"
                fontWeight={600}
              >
                {collection.owner.display_name}
              </Link>
            </Stack>
            <InstanceChip
              instance={collection.instance}
              label={t("models:explore.elsewhere.on", { name: collection.instance.name })}
            />
          </Stack>
          {collection.description && (
            <Box sx={{ maxWidth: 900 }}>
              <MarkdownDescription markdown={collection.description} remote />
            </Box>
          )}
        </Stack>
      )}
      <Box sx={cardGridSx(6)}>
        {page ? (
          page.models.map((model) => <RemoteModelCardView key={model.id} model={model} />)
        ) : (
          <CardSkeletons count={6} />
        )}
      </Box>
      {page && page.models.length < page.total && (
        <Box>
          <Button variant="outlined" onClick={() => void loadMore()} disabled={loadingMore}>
            {t("models:explore.elsewhere.more")}
          </Button>
        </Box>
      )}
      {page && !page.models.length && (
        <Typography variant="body2" color="text.secondary">
          {t("models:explore.noModels")}
        </Typography>
      )}
    </Stack>
  );
}
