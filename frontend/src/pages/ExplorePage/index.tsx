import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { socialApi, type ExploreOverview, type ExploreScope, type InstanceRef } from "../../api/social";
import Segmented from "../../components/controls/Segmented";
import { type ResolvedTheme } from "../../constants/settingsOptions";
import { CardSkeletons } from "../../components/media/CardSkeleton";
import { cardGridSx } from "../../components/media/cardGrid";
import { useSocialStatus } from "../../hooks/useSocialStatus";
import ModelCard from "../ModelsPage/ModelCard";
import CollectionCard from "../CollectionsPage/CollectionCard";
import ExploreSection from "./ExploreSection";
import PersonCard from "./PersonCard";
import { RemoteCollectionCardView, RemoteModelCardView } from "./RemoteCards";
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

const PEOPLE = 48;
const RECENT_MODELS = 12;
const RECENT_COLLECTIONS = 8;

type Entry = { key: string; at: string | null | undefined; node: ReactNode };

/** This instance's and partners' together, the latest shared first. */
function newestFirst(entries: Entry[], limit: number): ReactNode[] {
  const time = (at: string | null | undefined) => (at ? Date.parse(at) || 0 : 0);
  return entries
    .toSorted((a, b) => time(b.at) - time(a.at) || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((entry) => entry.node);
}

/** What the instance's other users share: who they are, what they added lately, and what everyone copies most. */
export default function ExplorePage({ theme, previewMode, onUnauthorized, viewer }: Props) {
  const { t } = useTranslation(["models", "app"]);
  const navigate = useNavigate();
  const [overview, setOverview] = useState<ExploreOverview | null>(null);
  const [failed, setFailed] = useState(false);
  // Everything, this instance's own, or one partner's; the partners stay listed while one is picked.
  const [scope, setScope] = useState<ExploreScope>("all");
  const [instances, setInstances] = useState<InstanceRef[]>([]);
  const latest = useRef(0);
  const [elsewhereOpen, setElsewhereOpen] = useState(false);
  // With connected instances on, someone on another instance can be asked for, here.
  const federation = useSocialStatus()?.federation === true;

  useEffect(() => {
    const asked = ++latest.current;
    socialApi.explore(scope).then(
      (value) => {
        if (asked !== latest.current) return;
        setOverview(value);
        setInstances(value.instances ?? []);
        // A partner no longer there: back to everything.
        if (scope !== "all" && scope !== "here" && !(value.instances ?? []).some((item) => item.id === scope)) {
          setScope("all");
        }
      },
      (err) => {
        if (asked !== latest.current) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setFailed(true);
      },
    );
    return () => {
      latest.current += 1;
    };
  }, [onUnauthorized, scope]);

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

  const filter = instances.length > 0 && (
    // Many partners: it scrolls sideways rather than squeezing.
    <Box sx={{ display: "flex", justifyContent: "flex-end", overflowX: "auto", pb: 0.5 }}>
      <Segmented
        label={t("models:explore.scope.label")}
        value={scope}
        onChange={setScope}
        options={[
          { value: "all", label: t("models:explore.scope.all") },
          { value: "here", label: t("models:explore.scope.here") },
          ...instances.map((instance) => ({ value: instance.id, label: instance.name })),
        ]}
      />
    </Box>
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

  const sharedAt = overview.shared_at;
  const elsewhere = overview.elsewhere;
  const people = newestFirst(
    [
      ...overview.people.map((person) => ({
        key: person.id,
        at: sharedAt?.people[person.id],
        node: <PersonCard key={person.id} person={person} />,
      })),
      ...(elsewhere?.people ?? []).map((person) => ({
        key: person.id,
        at: person.shared_at,
        node: <PersonCard key={person.id} person={person} />,
      })),
    ],
    PEOPLE,
  );
  const recentModels = newestFirst(
    [
      ...overview.recent_models.map((model) => ({
        key: model.id,
        at: sharedAt?.models[model.id],
        node: modelCard(model),
      })),
      ...(elsewhere?.recent_models ?? []).map((model) => ({
        key: model.id,
        at: model.shared_at,
        node: <RemoteModelCardView key={model.id} model={model} />,
      })),
    ],
    RECENT_MODELS,
  );
  const recentCollections = newestFirst(
    [
      ...overview.recent_collections.map((collection) => ({
        key: collection.id,
        at: sharedAt?.collections[collection.id],
        node: (
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
        ),
      })),
      ...(elsewhere?.recent_collections ?? []).map((collection) => ({
        key: collection.id,
        at: collection.updated_at,
        node: <RemoteCollectionCardView key={collection.id} collection={collection} />,
      })),
    ],
    RECENT_COLLECTIONS,
  );

  if (!people.length) {
    return (
      <Stack spacing={2} sx={{ maxWidth: "1920px", mx: "auto" }}>
        {filter}
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
      </Stack>
    );
  }

  let order = 0;
  return (
    <Stack spacing={4} sx={{ maxWidth: "1920px", mx: "auto" }}>
      {filter}
      <ExploreSection
        title={t("models:explore.people")}
        help={t("models:explore.peopleHelp")}
        icon={<GroupOutlinedIcon fontSize="small" />}
        order={order++}
        action={elsewhereButton}
      >
        <Box sx={peopleGridSx}>{people}</Box>
      </ExploreSection>

      {recentModels.length > 0 && (
        <ExploreSection
          title={t("models:explore.recentModels")}
          help={t("models:explore.recentModelsHelp")}
          icon={<NewReleasesOutlinedIcon fontSize="small" />}
          order={order++}
        >
          <Box sx={cardGridSx(6)}>{recentModels}</Box>
        </ExploreSection>
      )}

      {recentCollections.length > 0 && (
        <ExploreSection
          title={t("models:explore.recentCollections")}
          help={t("models:explore.recentCollectionsHelp")}
          icon={<CollectionsIcon fontSize="small" />}
          order={order++}
        >
          <Box sx={cardGridSx(6)}>{recentCollections}</Box>
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
