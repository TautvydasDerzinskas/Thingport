import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CollectionsIcon from "@mui/icons-material/Collections";
import ExploreOutlinedIcon from "@mui/icons-material/ExploreOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import LibraryAddCheckOutlinedIcon from "@mui/icons-material/LibraryAddCheckOutlined";
import NewReleasesOutlinedIcon from "@mui/icons-material/NewReleasesOutlined";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import type { AuthUser } from "../../api/auth";
import { UnauthorizedError } from "../../api/client";
import type { Print } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
import { socialApi, type ExploreOverview } from "../../api/social";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import { useSocialStatus } from "../../hooks/useSocialStatus";
import ModelCard from "../ModelsPage/ModelCard";
import CollectionCard from "../CollectionsPage/CollectionCard";
import ExploreSection from "./ExploreSection";
import PersonCard from "./PersonCard";
import SomeoneElsewhereDialog from "./SomeoneElsewhereDialog";

type Props = {
  theme: ResolvedTheme;
  previewMode: PreviewMode;
  onUnauthorized?: () => void;
  viewer?: AuthUser | null;
};

const peopleGridSx = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: "12px",
} as const;

/** What the instance's other users share: who they are, what they added lately, and what everyone copies most. */
export default function ExplorePage({ theme, previewMode, onUnauthorized, viewer }: Props) {
  const { t } = useTranslation(["models", "app"]);
  const navigate = useNavigate();
  const [overview, setOverview] = useState<ExploreOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [elsewhereOpen, setElsewhereOpen] = useState(false);
  // With connected instances on, someone on another instance can be asked for, here.
  const federation = useSocialStatus()?.federation === true;

  useEffect(() => {
    let active = true;
    socialApi.explore().then(
      (value) => {
        if (active) setOverview(value);
      },
      (err) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  // A copy made from a card's menu: the card says so from then on, wherever the model shows on the page.
  const replaceModel = (updated: Print) =>
    setOverview(
      (prev) =>
        prev && {
          ...prev,
          recent_models: prev.recent_models.map((m) => (m.id === updated.id ? updated : m)),
          most_collected: prev.most_collected.map((e) => (e.model.id === updated.id ? { ...e, model: updated } : e)),
        },
    );

  const elsewhereButton = federation && (
    <Button size="small" startIcon={<HubOutlinedIcon />} onClick={() => setElsewhereOpen(true)}>
      {t("models:explore.elsewhere.open")}
    </Button>
  );
  const elsewhereDialog = elsewhereOpen && (
    <SomeoneElsewhereDialog onClose={() => setElsewhereOpen(false)} onUnauthorized={onUnauthorized} />
  );

  const modelCard = (model: Print) => (
    <ModelCard
      key={model.id}
      item={model}
      theme={theme}
      previewMode={previewMode}
      onUpdated={replaceModel}
      onUnauthorized={onUnauthorized}
      viewer={viewer}
    />
  );

  if (failed) {
    return (
      <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
        <ExploreOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
        <Typography variant="body2">{t("models:explore.unavailable")}</Typography>
      </Stack>
    );
  }

  if (!overview) {
    return (
      <Stack spacing={4} sx={{ maxWidth: "1920px", mx: "auto" }} aria-busy>
        <Box sx={peopleGridSx}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} variant="rounded" height={70} sx={{ borderRadius: "12px" }} />
          ))}
        </Box>
        <Box sx={cardGridSx(6)}>
          <CardSkeletons count={6} />
        </Box>
        <Box sx={cardGridSx(6)}>
          <CardSkeletons count={6} variant="collection" />
        </Box>
      </Stack>
    );
  }

  if (!overview.people.length) {
    return (
      <Stack alignItems="center" spacing={1.5} sx={{ py: 8, color: "text.secondary", textAlign: "center" }}>
        <ExploreOutlinedIcon sx={{ fontSize: 44, color: "text.disabled" }} />
        <Typography variant="subtitle1" fontWeight={700} sx={{ color: (muiTheme) => muiTheme.thingport.headingText }}>
          {t("models:explore.emptyTitle")}
        </Typography>
        <Typography variant="body2">{t("models:explore.emptyHint")}</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" useFlexGap>
          <Button variant="outlined" size="small" onClick={() => navigate("/models/collections")}>
            {t("models:explore.emptyAction")}
          </Button>
          {elsewhereButton}
        </Stack>
        {elsewhereDialog}
      </Stack>
    );
  }

  let order = 0;
  return (
    <Stack spacing={4} sx={{ maxWidth: "1920px", mx: "auto" }}>
      <ExploreSection
        title={t("models:explore.people")}
        help={t("models:explore.peopleHelp")}
        icon={<GroupOutlinedIcon fontSize="small" />}
        order={order++}
        action={elsewhereButton}
      >
        <Box sx={peopleGridSx}>
          {overview.people.map((person) => (
            <PersonCard key={person.id} person={person} />
          ))}
        </Box>
      </ExploreSection>

      {overview.recent_models.length > 0 && (
        <ExploreSection
          title={t("models:explore.recentModels")}
          help={t("models:explore.recentModelsHelp")}
          icon={<NewReleasesOutlinedIcon fontSize="small" />}
          order={order++}
        >
          <Box sx={cardGridSx(6)}>{overview.recent_models.map(modelCard)}</Box>
        </ExploreSection>
      )}

      {overview.recent_collections.length > 0 && (
        <ExploreSection
          title={t("models:explore.recentCollections")}
          help={t("models:explore.recentCollectionsHelp")}
          icon={<CollectionsIcon fontSize="small" />}
          order={order++}
        >
          <Box sx={cardGridSx(6)}>
            {overview.recent_collections.map((collection) => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                theme={theme}
                previewMode={previewMode}
                // Another user's: nothing on the card changes it.
                onUpdated={() => undefined}
                onDeleted={() => undefined}
                onUnauthorized={onUnauthorized}
              />
            ))}
          </Box>
        </ExploreSection>
      )}

      {overview.most_collected.length > 0 && (
        <ExploreSection
          title={t("models:explore.mostCollected")}
          help={t("models:explore.mostCollectedHelp")}
          icon={<TrendingUpIcon fontSize="small" />}
          order={order++}
        >
          <Box sx={cardGridSx(6)}>
            {overview.most_collected.map(({ model, copies }) => (
              <Stack key={model.id} spacing={0.75}>
                {modelCard(model)}
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 0.5, color: "text.secondary" }}>
                  <LibraryAddCheckOutlinedIcon sx={{ fontSize: 14 }} />
                  <Typography variant="caption">{t("models:explore.copies", { count: copies })}</Typography>
                </Stack>
              </Stack>
            ))}
          </Box>
        </ExploreSection>
      )}
      {elsewhereDialog}
    </Stack>
  );
}
