import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CollectionsIcon from "@mui/icons-material/Collections";
import ExploreOutlinedIcon from "@mui/icons-material/ExploreOutlined";
import FolderSharedOutlinedIcon from "@mui/icons-material/FolderSharedOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import LibraryAddCheckOutlinedIcon from "@mui/icons-material/LibraryAddCheckOutlined";
import NewReleasesOutlinedIcon from "@mui/icons-material/NewReleasesOutlined";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import type { AuthUser } from "../../api/auth";
import type { Collection } from "../../api/collections";
import { UnauthorizedError } from "../../api/client";
import type { Print } from "../../api/prints";
import { type PreviewMode } from "../../api/settings";
import {
  socialApi,
  type ExploreOverview,
  type ExploreScope,
  type InstanceRef,
  type RemoteSharedCard,
} from "../../api/social";
import Segmented from "../../components/controls/Segmented";
import { useToast } from "../../components/ToastProvider";
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
// Collections shared with the user, a click of Show more at a time past the first page Explore came with.
const SHARED_MORE = 24;

type Entry = { at: string | null | undefined; node: ReactNode };

/** This instance's and partners' together, the latest shared first. Ties, and entries without a time, keep the order
 *  they came in, each list's as the server ranked it. */
function newestFirst(entries: Entry[], limit: number): ReactNode[] {
  const time = (at: string | null | undefined) => (at ? Date.parse(at) || 0 : 0);
  return entries
    .toSorted((a, b) => time(b.at) - time(a.at))
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
  // Shared with the user past the first page, as Show more loaded them, and how many there are as it last said. A page
  // asked for before Explore was loaded again (another scope) is dropped when it comes.
  const [moreShared, setMoreShared] = useState<{
    items: (Collection & { shared_at?: string | null })[];
    total: number | null;
  }>({ items: [], total: null });
  // The same of what partners' people shared with the user.
  const [moreElsewhere, setMoreElsewhere] = useState<{ items: RemoteSharedCard[]; total: number | null }>({
    items: [],
    total: null,
  });
  const [loadingShared, setLoadingShared] = useState(false);
  const sharedAsk = useRef(0);
  // Explore being loaded (a scope picked, or pages started again): what comes of it is what's shown next.
  const loadingOverview = useRef(false);
  const showToast = useToast();
  // With connected instances on, someone on another instance can be asked for, here.
  const federation = useSocialStatus()?.federation === true;

  /** Explore as it came: what's shown from now on, Show more's pages starting again from it. */
  const accept = useCallback(
    (value: ExploreOverview) => {
      setFailed(false);
      setOverview(value);
      // A page asked for before this came belongs to the Explore it replaced.
      sharedAsk.current += 1;
      setLoadingShared(false);
      setMoreShared({ items: [], total: null });
      setMoreElsewhere({ items: [], total: null });
      setInstances(value.instances ?? []);
      // A partner no longer there: back to everything.
      if (scope !== "all" && scope !== "here" && !(value.instances ?? []).some((item) => item.id === scope)) {
        setScope("all");
      }
    },
    [scope],
  );

  useEffect(() => {
    const asked = ++latest.current;
    loadingOverview.current = true;
    sharedAsk.current += 1;
    setLoadingShared(false);
    socialApi.explore(scope).then(
      (value) => {
        if (asked !== latest.current) return;
        loadingOverview.current = false;
        accept(value);
      },
      (err) => {
        if (asked !== latest.current) return;
        loadingOverview.current = false;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setFailed(true);
      },
    );
    return () => {
      latest.current += 1;
    };
  }, [onUnauthorized, scope, accept]);

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
    // The filter stays, to pick another instance or this one again.
    return (
      <Stack spacing={2} sx={{ maxWidth: "1920px", mx: "auto" }}>
        {filter}
        <Stack alignItems="center" spacing={1} sx={{ py: 8, color: "text.secondary" }}>
          <ExploreOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
          <Typography variant="body2">{t("models:explore.unavailable")}</Typography>
        </Stack>
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

  const collectionCard = (collection: Collection) => (
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
  );
  const sharedAt = overview.shared_at;
  const elsewhere = overview.elsewhere;
  const people = newestFirst(
    [
      ...overview.people.map((person) => ({
        at: sharedAt?.people[person.id],
        node: <PersonCard key={person.id} person={person} />,
      })),
      ...(elsewhere?.people ?? []).map((person) => ({
        at: person.shared_at,
        node: <PersonCard key={person.id} person={person} />,
      })),
    ],
    PEOPLE,
  );
  const recentModels = newestFirst(
    [
      ...overview.recent_models.map((model) => ({
        at: sharedAt?.models[model.id],
        node: modelCard(model),
      })),
      ...(elsewhere?.recent_models ?? []).map((model) => ({
        at: model.shared_at,
        node: <RemoteModelCardView key={model.id} model={model} />,
      })),
    ],
    RECENT_MODELS,
  );
  const recentCollections = newestFirst(
    [
      ...overview.recent_collections.map((collection) => ({
        at: sharedAt?.collections[collection.id],
        node: collectionCard(collection),
      })),
      ...(elsewhere?.recent_collections ?? []).map((collection) => ({
        at: collection.updated_at,
        node: <RemoteCollectionCardView key={collection.id} collection={collection} />,
      })),
    ],
    RECENT_COLLECTIONS,
  );

  const sharedWithYou: (Collection & { shared_at?: string | null })[] = [
    ...(overview.shared_with_you ?? []),
    ...moreShared.items,
  ];
  const sharedTotal = moreShared.total ?? overview.shared_with_you_total ?? sharedWithYou.length;
  const sharedElsewhere = [...(elsewhere?.shared_with_you ?? []), ...moreElsewhere.items];
  const elsewhereTotal = moreElsewhere.total ?? elsewhere?.shared_with_you_total ?? sharedElsewhere.length;
  const sharedLeft =
    Math.max(0, sharedTotal - sharedWithYou.length) + Math.max(0, elsewhereTotal - sharedElsewhere.length);
  // This instance's and partners' people's together, the latest shared with the user first: a page past the first
  // carries its own times.
  const sharedEntries = newestFirst(
    [
      ...sharedWithYou.map((collection) => ({
        at: sharedAt?.collections[collection.id] ?? collection.shared_at,
        node: collectionCard(collection),
      })),
      ...sharedElsewhere.map((collection) => ({
        at: collection.shared_at,
        node: <RemoteCollectionCardView key={collection.id} collection={collection} />,
      })),
    ],
    Number.POSITIVE_INFINITY,
  );
  // The next page of each that has more, this instance's and partners' people's.
  const showMoreShared = async () => {
    const asked = ++sharedAsk.current;
    setLoadingShared(true);
    try {
      const none = { items: [], total: null };
      const [page, remote] = await Promise.all([
        sharedWithYou.length < sharedTotal
          ? socialApi.sharedWithYou({ limit: SHARED_MORE, offset: sharedWithYou.length })
          : Promise.resolve(none),
        sharedElsewhere.length < elsewhereTotal
          ? socialApi.elsewhere.shared({ scope, limit: SHARED_MORE, offset: sharedElsewhere.length })
          : Promise.resolve(none),
      ]);
      if (asked !== sharedAsk.current) return;
      const known = new Set(sharedWithYou.map((collection) => collection.id));
      const knownElsewhere = new Set(sharedElsewhere.map((collection) => collection.id));
      // Something shared since Explore loaded moved the ranking under its pages, or something unshared did (a page
      // from an offset past it would skip one): start again from the top, unless Explore is being loaded already
      // (another scope picked), which starts them again itself.
      const fewer = (total: number | null, before: number) => total !== null && total < before;
      if (
        page.items.some((collection) => known.has(collection.id)) ||
        remote.items.some((collection) => knownElsewhere.has(collection.id)) ||
        fewer(page.total, sharedTotal) ||
        fewer(remote.total, elsewhereTotal)
      ) {
        if (loadingOverview.current) return;
        const again = ++latest.current;
        loadingOverview.current = true;
        try {
          const value = await socialApi.explore(scope);
          if (again === latest.current) accept(value);
        } finally {
          if (again === latest.current) loadingOverview.current = false;
        }
        return;
      }
      // The totals as they are now.
      if (page.total !== null) setMoreShared((prev) => ({ items: [...prev.items, ...page.items], total: page.total }));
      if (remote.total !== null) {
        setMoreElsewhere((prev) => ({ items: [...prev.items, ...remote.items], total: remote.total }));
      }
    } catch (err) {
      if (asked !== sharedAsk.current) return;
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: t("models:explore.sharedFailed"), severity: "error" });
    } finally {
      if (asked === sharedAsk.current) setLoadingShared(false);
    }
  };

  if (!people.length && !sharedEntries.length) {
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
      {sharedEntries.length > 0 && (
        <ExploreSection
          title={t("models:explore.sharedWithYou")}
          help={t("models:explore.sharedWithYouHelp")}
          icon={<FolderSharedOutlinedIcon fontSize="small" />}
          order={order++}
          // With nobody sharing on Explore, asking for someone elsewhere starts here.
          action={!people.length ? elsewhereButton : undefined}
        >
          <Box sx={cardGridSx(6)}>{sharedEntries}</Box>
          {sharedLeft > 0 && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Button size="small" variant="outlined" onClick={showMoreShared} disabled={loadingShared}>
                {t("models:explore.showMore", { count: sharedLeft })}
              </Button>
            </Box>
          )}
        </ExploreSection>
      )}

      {people.length > 0 && (
        <ExploreSection
          title={t("models:explore.people")}
          help={t("models:explore.peopleHelp")}
          icon={<GroupOutlinedIcon fontSize="small" />}
          order={order++}
          action={elsewhereButton}
        >
          <Box sx={peopleGridSx}>{people}</Box>
        </ExploreSection>
      )}

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
