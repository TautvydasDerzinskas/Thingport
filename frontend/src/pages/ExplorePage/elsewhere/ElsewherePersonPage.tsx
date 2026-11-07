import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { chatsApi } from "../../../api/chats";
import { UnauthorizedError } from "../../../api/client";
import { socialApi, type RemoteModelCard, type RemotePersonPage } from "../../../api/social";
import { COVER_PRESETS, type CoverPreset } from "../../../constants/profileCovers";
import InstanceChip from "../../../components/InstanceChip";
import { usePageHeader } from "../../../components/Layout/PageHeaderContext";
import { CardSkeletons } from "../../../components/media/CardSkeleton";
import { cardGridSx } from "../../../components/media/cardGrid";
import ProfileLayout, { ProfileLayoutSkeleton } from "../../../components/profile/ProfileLayout";
import { useToast } from "../../../components/ToastProvider";
import UserAvatar from "../../../components/UserAvatar";
import { useSocialStatus } from "../../../hooks/useSocialStatus";
import { copyText } from "../../../utils/clipboard";
import { RemoteCollectionCardView, RemoteModelCardView } from "../RemoteCards";
import ElsewhereGone from "./ElsewhereGone";

type Section = "models" | "collections";
const PAGE = 30;

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

const isPreset = (value: string | null | undefined): value is CoverPreset =>
  COVER_PRESETS.includes(value as CoverPreset);

/** Someone on a partner instance, as its directory said: their profile, with where they are and their handle, beside
 *  the models and collections they share there. Read-only. */
export default function ElsewherePersonPage({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const { personId } = useParams<{ personId: string }>();
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState<RemotePersonPage | null>(null);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [models, setModels] = useState<RemoteModelCard[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);
  const navigate = useNavigate();
  const chatsOn = useSocialStatus()?.chats === true;
  const [opening, setOpening] = useState(false);

  const read = useCallback(
    (id: string) => {
      const asked = ++latest.current;
      setPage(null);
      setModels(null);
      setGone(false);
      setFailed(false);
      setHasMore(false);
      setLoadingMore(false);
      setOpening(false);
      Promise.all([socialApi.elsewhere.person(id), socialApi.elsewhere.personModels(id, { limit: PAGE, offset: 0 })])
        .then(([person, first]) => {
          if (asked !== latest.current) return;
          if (!person) {
            setGone(true);
            return;
          }
          setPage(person);
          setModels(first?.items ?? []);
          setHasMore(first?.hasMore ?? false);
        })
        .catch((err) => {
          if (asked !== latest.current) return;
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else setFailed(true);
        });
    },
    [onUnauthorized],
  );

  useEffect(() => {
    if (personId) read(personId);
    return () => {
      latest.current += 1;
    };
  }, [personId, read]);

  const loadMore = async () => {
    if (!personId || !models || loadingMore) return;
    // Someone else opened meanwhile: this page of the one before is dropped.
    const asked = latest.current;
    setLoadingMore(true);
    try {
      const next = await socialApi.elsewhere.personModels(personId, { limit: PAGE, offset: models.length });
      if (asked !== latest.current) return;
      setModels([...models, ...(next?.items ?? [])]);
      setHasMore(next?.hasMore ?? false);
    } catch (err) {
      if (asked !== latest.current) return;
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: t("models:explore.modelsLoadFailed"), severity: "error" });
    } finally {
      if (asked === latest.current) setLoadingMore(false);
    }
  };

  const person = page?.person;
  usePageHeader({
    title: person?.display_name,
    subtitle: person
      ? t("models:explore.personCounts", {
          collections: t("models:explore.collectionCount", { count: person.collection_count }),
          models: t("models:explore.modelCount", { count: person.model_count }),
        })
      : undefined,
  });

  if (gone) return <ElsewhereGone />;
  if (failed) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <Typography variant="body2">{t("models:explore.loadFailed")}</Typography>
        <Button size="small" onClick={() => personId && read(personId)}>
          {t("common:retry")}
        </Button>
      </Stack>
    );
  }
  if (!page || !person) return <ProfileLayoutSkeleton />;

  const tab: Section = person.model_count > 0 && searchParams.get("tab") !== "collections" ? "models" : "collections";
  const message = async () => {
    if (!person) return;
    // Someone else opened meanwhile: what this asked for no longer applies.
    const asked = latest.current;
    setOpening(true);
    try {
      const chat = await chatsApi.openDirect({ remoteId: person.id });
      if (asked === latest.current) navigate(`/chats/${chat.id}`);
    } catch (err) {
      if (asked !== latest.current) return;
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: t("models:explore.elsewhere.messageFailed"), severity: "error" });
      setOpening(false);
    }
  };

  const copyHandle = async () => {
    if (!person.handle) return;
    try {
      await copyText(person.handle);
      showToast({ message: t("models:author.username.copied") });
    } catch {
      showToast({ message: t("models:author.username.copyFailed"), severity: "error" });
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: "1920px", mx: "auto" }}>
      <ProfileLayout
        cover={{
          background_url: person.background_url ?? null,
          cover_preset: isPreset(person.cover_preset) ? person.cover_preset : person.background_url ? null : "retro",
          cover_position_y: person.cover_position_y,
        }}
        avatar={<UserAvatar user={person} size={112} />}
        name={person.display_name}
        subtitle={
          <Stack spacing={1} alignItems="flex-start" sx={{ mt: 1 }}>
            <InstanceChip
              instance={person.instance}
              label={t("models:explore.elsewhere.on", { name: person.instance.name })}
            />
            {person.handle && (
              <Box
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.25,
                  height: 32,
                  pl: 1.25,
                  pr: 0.25,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 2,
                  maxWidth: "100%",
                }}
              >
                <Box
                  component="span"
                  title={person.handle}
                  sx={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {person.handle}
                </Box>
                <Tooltip title={t("models:explore.elsewhere.copyHandle")}>
                  <IconButton
                    size="small"
                    onClick={() => void copyHandle()}
                    aria-label={t("models:explore.elsewhere.copyHandle")}
                  >
                    <ContentCopyIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            )}
            {chatsOn && (
              <Button
                variant="contained"
                size="small"
                disableElevation
                startIcon={<ChatBubbleOutlineIcon fontSize="small" />}
                onClick={() => void message()}
                disabled={opening}
              >
                {t("models:explore.elsewhere.message")}
              </Button>
            )}
          </Stack>
        }
        bio={person.bio}
        bioMarkdown
        remote
        links={person.links}
      >
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, mb: 2 }}>
          <Tabs
            value={tab}
            onChange={(_event, next: Section) =>
              setSearchParams(next === "models" ? {} : { tab: next }, { replace: true })
            }
            aria-label={t("models:explore.sections")}
            sx={tabsSx}
          >
            {person.model_count > 0 && <Tab value="models" label={t("models:pageTitle")} />}
            <Tab value="collections" label={t("models:collections.pageTitle")} />
          </Tabs>
        </Box>
        {tab === "models" ? (
          models === null ? (
            <Box sx={cardGridSx(5)}>
              <CardSkeletons count={10} />
            </Box>
          ) : (
            <Stack spacing={2}>
              <Box sx={cardGridSx(5)}>
                {models.map((model) => (
                  <RemoteModelCardView key={model.id} model={model} />
                ))}
              </Box>
              {hasMore && (
                <Box>
                  <Button variant="outlined" onClick={() => void loadMore()} disabled={loadingMore}>
                    {t("models:explore.elsewhere.more")}
                  </Button>
                </Box>
              )}
            </Stack>
          )
        ) : page.collections.length ? (
          <Box sx={cardGridSx(5)}>
            {page.collections.map((collection) => (
              <RemoteCollectionCardView key={collection.id} collection={collection} />
            ))}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("models:explore.noCollections", { name: person.display_name })}
          </Typography>
        )}
      </ProfileLayout>
    </Stack>
  );
}
