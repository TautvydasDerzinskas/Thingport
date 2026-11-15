import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddLinkIcon from "@mui/icons-material/AddLink";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import SyncIcon from "@mui/icons-material/Sync";
import SyncDisabledIcon from "@mui/icons-material/SyncDisabled";
import { UnauthorizedError } from "../../api/client";
import {
  type Collection,
  type CollectionSync,
  type SyncIntervalHours,
  type SyncProfileScope,
  SYNC_INTERVAL_HOURS,
  collectionsApi,
  withSync,
  withoutSync,
} from "../../api/collections";
import type { BrowsableProvider } from "../../api/providerCollections";
import type { ImportProvider } from "../../api/settings";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import { relativeTime } from "../../utils/relativeTime";
import SectionedDialog, { SectionNavButton, type DialogSection } from "../../components/SectionedDialog";
import SyncChain from "./SyncChain";
import SyncBrowse, { type BrowsePick } from "./SyncBrowse";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import { SectionLabel } from "../../components/Layout/ConfigurationDialog/parts";
import { hasProviderLogo, ProviderLogo } from "../../components/Layout/ConfigurationDialog/providerLogos";
import { SyncBubble } from "../../components/CollectionSyncBadge";
import { isSourceOff, providerLabel, sourceName } from "../../components/syncSources";
import { allProvidersOff, useDisabledProviders } from "../../hooks/useProviders";
import { isProviderId, manifestOf } from "../../providers/index.generated";

const SCOPES: SyncProfileScope[] = ["url", "designer", "all"];

type SectionId = "overview" | "browse" | `source:${string}`;
const sourceSection = (sync: CollectionSync): SectionId => `source:${sync.id}`;

/** Where the dialog opens, and where it goes when the open source is stopped: nothing to show but Browse while it
 *  follows nothing, the one source it follows, or the overview of several. */
function homeSection(syncs: CollectionSync[]): SectionId {
  if (!syncs.length) return "browse";
  return syncs.length === 1 ? sourceSection(syncs[0]) : "overview";
}

type Props = {
  collection: Collection;
  onClose: () => void;
  onUpdated: (collection: Collection) => void;
  onUnauthorized?: () => void;
};

/** Ticks every second while `until` is in the future, so a countdown can redraw. */
function useNowUntil(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null || until <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return now;
}

/** "21:30", or "Fri 09:00" when it isn't today. */
function clockTime(iso: string, locale: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(locale, {
    ...(sameDay ? {} : { weekday: "short" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

function minutesSeconds(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const coolingUntil = (sync: CollectionSync) => (sync.sync_now_at ? new Date(sync.sync_now_at).getTime() : null);

/** A source's logo in the rail and the overview, faded while an admin has its provider turned off. */
function SourceLogo({ sync, off, size }: { sync: CollectionSync; off: boolean; size: number }) {
  return (
    <Box
      sx={{
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        width: 20,
        lineHeight: 0,
        opacity: off ? 0.45 : 1,
        filter: off ? "grayscale(1)" : "none",
      }}
    >
      {hasProviderLogo(sync.provider) ? (
        <ProviderLogo id={sync.provider} size={size} />
      ) : (
        <SyncIcon sx={{ fontSize: size }} />
      )}
    </Box>
  );
}

type SourceActions = {
  busy: boolean;
  syncNow: (sync: CollectionSync) => void;
  stop: (sync: CollectionSync) => void;
  save: (
    sync: CollectionSync,
    change: { profile_scope?: SyncProfileScope; interval_hours?: SyncIntervalHours },
    revert: () => void,
  ) => void;
};

/** One source: what it brings in and how often, the chain with Sync now and Stop syncing, its status, and its settings:
 *  how often it's checked and, where the provider has them, which print profiles each new model brings. */
function SourcePanel({
  collection,
  sync,
  off,
  actions,
}: {
  collection: Collection;
  sync: CollectionSync;
  off: boolean;
  actions: SourceActions;
}) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const provider = providerLabel(sync.provider);
  const hasProfiles = isProviderId(sync.provider) && !!manifestOf(sync.provider).capabilities.profiles;
  const [scope, setScope] = useState<SyncProfileScope>(sync.profile_scope);
  const [intervalHours, setIntervalHours] = useState<SyncIntervalHours>(sync.interval_hours);

  const readyAt = coolingUntil(sync);
  const now = useNowUntil(readyAt);
  const coolingMs = readyAt ? readyAt - now : 0;
  const cooling = coolingMs > 0;
  // How far through the cool-down, from the last check to when Sync now is back.
  const startedAt = sync.last_checked_at ? new Date(sync.last_checked_at).getTime() : null;
  const coolProgress =
    cooling && readyAt && startedAt && readyAt > startedAt ? ((now - startedAt) / (readyAt - startedAt)) * 100 : 0;

  const checked = sync.last_checked_at
    ? t("models:collections.sync.lastChecked", { when: relativeTime(sync.last_checked_at, i18n.language) })
    : t("models:collections.sync.notCheckedYet");
  const next = sync.next_sync_at
    ? t("models:collections.sync.nextSync", { time: clockTime(sync.next_sync_at, i18n.language) })
    : null;

  const intro = sync.likes_of
    ? t("models:collections.sync.introLikes", { user: sync.likes_of, provider, count: sync.interval_hours })
    : sync.title
      ? t("models:collections.sync.introSource", { source: sync.title, provider, count: sync.interval_hours })
      : t("models:collections.sync.intro", { provider, count: sync.interval_hours });

  const changeInterval = (value: SyncIntervalHours) => {
    const previous = intervalHours;
    setIntervalHours(value);
    actions.save(sync, { interval_hours: value }, () => setIntervalHours(previous));
  };
  const changeScope = (value: SyncProfileScope) => {
    const previous = scope;
    setScope(value);
    actions.save(sync, { profile_scope: value }, () => setScope(previous));
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="body2">{intro}</Typography>
        <Link
          variant="body2"
          href={sync.source_url}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ display: "block", width: "fit-content" }}
        >
          {t("models:collections.sync.openSource", { provider })}
        </Link>
      </Box>
      {off && <Alert severity="warning">{t("models:collections.sync.badgeOff", { provider })}</Alert>}
      <SyncChain
        collection={collection}
        sync={sync}
        off={off}
        syncNow={{
          label: t("models:collections.sync.syncNow"),
          icon: <SyncIcon fontSize="small" />,
          onClick: () => actions.syncNow(sync),
          disabled: actions.busy || cooling || off,
          disabledLabel: cooling
            ? t("models:collections.sync.syncNowIn", { time: minutesSeconds(coolingMs) })
            : off
              ? t("models:collections.sync.menuProviderOff", { provider })
              : undefined,
          progress: cooling ? coolProgress : null,
        }}
        stop={{
          label: t("models:collections.sync.stop"),
          icon: <SyncDisabledIcon fontSize="small" />,
          onClick: () => actions.stop(sync),
          disabled: actions.busy,
          color: "error",
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {next ? `${checked} · ${next}` : checked}
      </Typography>
      {sync.last_error && <Alert severity="warning">{sync.last_error}</Alert>}
      <div>
        <SectionLabel>{t("models:collections.sync.intervalLabel")}</SectionLabel>
        <Segmented
          label={t("models:collections.sync.intervalLabel")}
          value={String(intervalHours)}
          onChange={(value) => changeInterval(Number(value) as SyncIntervalHours)}
          disabled={actions.busy || off}
          options={SYNC_INTERVAL_HOURS.map((hours) => ({
            value: String(hours),
            label: t("models:collections.sync.intervalOption", { count: hours }),
          }))}
        />
      </div>
      {hasProfiles && (
        <div>
          <SectionLabel>
            {t("models:collections.sync.profilesLabel")}
            <HelpTip text={t("models:collections.sync.profilesHelp")} />
          </SectionLabel>
          <Segmented
            label={t("models:collections.sync.profilesLabel")}
            value={scope}
            onChange={changeScope}
            disabled={actions.busy || off}
            options={SCOPES.map((value) => ({ value, label: t(`models:collections.sync.profiles.${value}`) }))}
          />
        </div>
      )}
    </Stack>
  );
}

/** Every source at a glance, each opening its own section, and Sync all now. */
function OverviewPanel({
  collection,
  disabled,
  busy,
  onOpen,
  onSyncAll,
}: {
  collection: Collection;
  disabled: ReadonlySet<ImportProvider>;
  busy: boolean;
  onOpen: (sync: CollectionSync) => void;
  onSyncAll: (ready: CollectionSync[]) => void;
}) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const { syncs } = collection;
  // Ticks until the last source's Sync now is back, so Sync all now comes back with it.
  const now = useNowUntil(Math.max(0, ...syncs.map((sync) => coolingUntil(sync) ?? 0)) || null);
  const cooling = (sync: CollectionSync) => (coolingUntil(sync) ?? 0) > now;
  const ready = syncs.filter((sync) => !isSourceOff(sync, disabled) && !cooling(sync));
  const nextAt = syncs
    .map((sync) => sync.next_sync_at)
    .filter((at): at is string => !!at)
    .toSorted()[0];

  const status = (sync: CollectionSync) => {
    const provider = providerLabel(sync.provider);
    if (isSourceOff(sync, disabled)) {
      return { text: t("models:collections.sync.menuProviderOff", { provider }), color: "error.main" };
    }
    if (sync.last_error) {
      return { text: `${provider} · ${t("models:collections.sync.lastFailed")}`, color: "warning.main" };
    }
    const checked = sync.last_checked_at
      ? t("models:collections.sync.checkedShort", { when: relativeTime(sync.last_checked_at, i18n.language) })
      : t("models:collections.sync.notCheckedShort");
    const every = t("models:collections.sync.intervalEvery", { count: sync.interval_hours });
    return { text: `${provider} · ${every} · ${checked}`, color: "text.secondary" };
  };

  const syncAll = (
    <Button
      variant="outlined"
      size="small"
      startIcon={<SyncIcon />}
      disabled={busy || !ready.length}
      onClick={() => onSyncAll(ready)}
    >
      {t("models:collections.sync.syncAll")}
    </Button>
  );

  return (
    <Stack spacing={2}>
      <Typography variant="body2">
        {t("models:collections.sync.overviewIntro", { name: collection.name, count: syncs.length })}
      </Typography>
      <Box
        component="ul"
        sx={{ m: 0, p: 0, listStyle: "none", border: 1, borderColor: "divider", borderRadius: "10px" }}
      >
        {syncs.map((sync, index) => {
          const off = isSourceOff(sync, disabled);
          const { text, color } = status(sync);
          return (
            <Box component="li" key={sync.id} sx={{ borderTop: index ? 1 : 0, borderColor: "divider" }}>
              <ButtonBase
                onClick={() => onOpen(sync)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  width: "100%",
                  px: 1.25,
                  py: 1,
                  textAlign: "left",
                  borderRadius: index === 0 ? "10px 10px 0 0" : index === syncs.length - 1 ? "0 0 10px 10px" : 0,
                  transition: "background-color 150ms",
                  "&:hover": { bgcolor: "action.hover" },
                  "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
                }}
              >
                <Box
                  sx={{
                    position: "relative",
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                    width: 30,
                    height: 30,
                    borderRadius: "8px",
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.paper",
                  }}
                >
                  <SourceLogo sync={sync} off={off} size={16} />
                  <SyncBubble health={off ? "off" : sync.last_error ? "partial" : "ok"} size={14} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    noWrap
                    sx={{ color: (theme) => theme.thingport.headingText }}
                  >
                    {sourceName(sync, t)}
                  </Typography>
                  <Typography variant="caption" component="div" noWrap sx={{ color }}>
                    {text}
                  </Typography>
                </Box>
                <ChevronRightIcon fontSize="small" sx={{ color: "text.secondary" }} />
              </ButtonBase>
            </Box>
          );
        })}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {ready.length ? (
          syncAll
        ) : (
          <Tooltip title={t("models:collections.sync.syncAllUnavailable")}>
            <span>{syncAll}</span>
          </Tooltip>
        )}
        {nextAt && (
          <Typography variant="caption" color="text.secondary">
            {t("models:collections.sync.nextSync", { time: clockTime(nextAt, i18n.language) })}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

/** A collection's sync, in sections like the app's Configuration. Following several provider collections: an Overview
 *  of them. Each source: its own section, with its chain, status and settings. Add source: Browse, to pick another
 *  provider collection to follow, which is all an unsynced collection shows. */
export default function CollectionSyncDialog({ collection, onClose, onUpdated, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const confirm = useConfirm();
  const showToast = useToast();
  const disabled = useDisabledProviders();
  const { syncs } = collection;
  const [section, setSection] = useState<SectionId>(() => homeSection(syncs));
  const [browseProvider, setBrowseProvider] = useState<BrowsableProvider | null>(null);
  const [picked, setPicked] = useState<BrowsePick | null>(null);
  // A pick from another provider would leave its explanation under this one's list.
  const changeBrowseProvider = useCallback((next: BrowsableProvider) => {
    setBrowseProvider(next);
    setPicked(null);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The collection as the page has it now. An action's answer is applied to this, not to the collection as it was when
  // the action started: the page may have reloaded it meanwhile, as it does when an import finishes.
  const latest = useRef(collection);
  useEffect(() => {
    latest.current = collection;
  }, [collection]);

  const open = syncs.find((sync) => sourceSection(sync) === section) ?? null;
  // A source stopped, or gone since: back to where the dialog would open.
  useEffect(() => {
    if (section.startsWith("source:") && !open) setSection(homeSection(syncs));
    if (section === "overview" && syncs.length < 2) setSection(homeSection(syncs));
  }, [section, open, syncs]);

  /** Runs an action, keeping the dialog open on failure with the error shown. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      setError(err instanceof Error ? err.message : t("models:collections.sync.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const actions: SourceActions = {
    busy,
    syncNow: async (sync) => {
      const ok = await confirm({
        title: t("models:collections.sync.syncNowTitle"),
        message: t("models:collections.sync.syncNowMessage", {
          name: collection.name,
          provider: providerLabel(sync.provider),
        }),
        confirmLabel: t("models:collections.sync.syncNow"),
      });
      if (!ok) return;
      await run(async () => {
        const started = await collectionsApi.runSync(collection.id, sync.id);
        onUpdated(withSync(latest.current, started));
        showToast({ message: t("models:collections.sync.syncNowStarted", { name: collection.name }) });
      });
    },
    stop: async (sync) => {
      const others = syncs.length > 1;
      const source = sourceName(sync, t);
      const ok = await confirm({
        title: t("models:collections.sync.stopTitle"),
        message: others
          ? t("models:collections.sync.stopSourceMessage", { name: collection.name, source })
          : t("models:collections.sync.stopMessage", { name: collection.name }),
        confirmLabel: t("models:collections.sync.stop"),
        destructive: true,
      });
      if (!ok) return;
      await run(async () => {
        await collectionsApi.stopSync(collection.id, sync.id);
        showToast({
          message: others
            ? t("models:collections.sync.stoppedSource", { name: collection.name, source })
            : t("models:collections.sync.stopped", { name: collection.name }),
        });
        const next = withoutSync(latest.current, sync.id);
        onUpdated(next);
        if (!next.syncs.length) onClose();
        else setSection(homeSection(next.syncs));
      });
    },
    // Saved as they're picked; a failed save puts the choice back.
    save: async (sync, change, revert) => {
      let saved = false;
      await run(async () => {
        const updated = await collectionsApi.updateSync(collection.id, sync.id, change);
        onUpdated(withSync(latest.current, updated));
        saved = true;
        showToast({ message: t("models:collections.sync.saved") });
      });
      if (!saved) revert();
    },
  };

  const syncAll = async (ready: CollectionSync[]) => {
    const ok = await confirm({
      title: t("models:collections.sync.syncAllTitle"),
      message: t("models:collections.sync.syncAllMessage", { name: collection.name, count: ready.length }),
      confirmLabel: t("models:collections.sync.syncAll"),
    });
    if (!ok) return;
    await run(async () => {
      const started: CollectionSync[] = [];
      let failure: unknown = null;
      // One at a time: each joins the sync lane, which runs them in turn anyway.
      for (const sync of ready) {
        try {
          started.push(await collectionsApi.runSync(collection.id, sync.id));
        } catch (err) {
          if (err instanceof UnauthorizedError) throw err;
          failure ??= err;
        }
      }
      onUpdated(started.reduce(withSync, latest.current));
      if (failure) throw failure;
      showToast({ message: t("models:collections.sync.syncAllStarted", { name: collection.name }) });
    });
  };

  const startSync = async () => {
    if (!picked) return;
    await run(async () => {
      const result = await collectionsApi.enableSync(collection.id, {
        url: picked.collection.url,
        // The instance names a likes card in English; Likes are named after their user anyway.
        title: picked.collection.likes ? null : picked.collection.name,
      });
      onUpdated(withSync(latest.current, result.sync));
      const provider = providerLabel(picked.provider);
      showToast({
        message: t(
          result.waiting
            ? "models:collections.sync.browse.startedWaiting"
            : result.importing
              ? "models:collections.sync.browse.startedImporting"
              : "models:collections.sync.browse.started",
          {
            name: collection.name,
            provider,
            source: picked.collection.likes ? t("models:collections.sync.browse.likes") : picked.collection.name,
          },
        ),
      });
      setPicked(null);
      // Straight to it, where its settings can be changed from the defaults it started with.
      setSection(sourceSection(result.sync));
    });
  };

  const newOnly = !!picked && isProviderId(picked.provider) && !!manifestOf(picked.provider).capabilities.syncsNewOnly;
  const footerText = !picked
    ? t("models:collections.sync.browse.pickPrompt")
    : newOnly
      ? t("models:collections.sync.browse.confirmMakerworld")
      : t("models:collections.sync.browse.confirmImport", { count: picked.collection.model_count });

  const sections: DialogSection<SectionId>[] = [
    ...(syncs.length > 1
      ? [
          {
            id: "overview" as const,
            label: t("models:collections.sync.sections.overview"),
            icon: <HubOutlinedIcon fontSize="small" />,
            count: syncs.length,
          },
        ]
      : []),
    ...syncs.map((sync) => ({
      id: sourceSection(sync),
      label: sourceName(sync, t),
      title: `${providerLabel(sync.provider)}: ${sourceName(sync, t)}`,
      icon: <SourceLogo sync={sync} off={isSourceOff(sync, disabled)} size={16} />,
    })),
  ];
  // Every provider turned off, a new source can't be added, though the ones there are can be looked at and stopped.
  const canAdd = !allProvidersOff(disabled);
  const addSource = (layout: "side" | "grid") => (
    <Box sx={sections.length ? { mt: 0.75, pt: 0.75, borderTop: 1, borderColor: "divider", width: "100%" } : undefined}>
      <SectionNavButton
        label={t("models:collections.sync.addSource")}
        icon={<AddLinkIcon fontSize="small" />}
        chosen={section === "browse"}
        disabled={!canAdd}
        onClick={() => setSection("browse")}
        layout={layout}
      />
    </Box>
  );

  return (
    <SectionedDialog
      open
      onClose={busy ? () => undefined : onClose}
      title={t("models:collections.sync.title")}
      sections={sections}
      section={section}
      onSectionChange={setSection}
      size={syncs.length ? "default" : "large"}
      phoneNav="grid"
      railFooter={addSource("side")}
      phoneRailFooter={addSource("grid")}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {section === "browse" && (
        // Reaches through the content area's 20px bottom padding, so the footer sits on the
        // dialog's bottom edge however short the list is, just where it sticks on a long one.
        <Box sx={{ display: "flex", flexDirection: "column", minHeight: "calc(100% + 20px)", mb: "-20px" }}>
          <Box sx={{ mb: 2.5 }}>
            <SyncBrowse
              provider={browseProvider}
              onProviderChange={changeBrowseProvider}
              picked={picked}
              onPick={setPicked}
              onUnauthorized={onUnauthorized}
              collectionId={collection.id}
            />
          </Box>
          {/* Always in view, however far down the list the pick was made. Its bottom offset
              cancels the content area's bottom padding. */}
          <Box
            sx={{
              position: "sticky",
              bottom: -20,
              mt: "auto",
              mx: { xs: -2, md: -2.5 },
              px: { xs: 2, md: 2.5 },
              py: 1,
              borderTop: 1,
              borderColor: "divider",
              bgcolor: "background.paper",
              zIndex: 1,
            }}
          >
            {/* One short line beside the button, to leave the list as much room as possible. */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Button
                variant="contained"
                onClick={() => void startSync()}
                disabled={busy || !picked}
                sx={{ flexShrink: 0 }}
              >
                {t("models:collections.sync.browse.startNothing")}
              </Button>
              <Typography variant="body2" color={picked ? "text.primary" : "text.secondary"} sx={{ minWidth: 0 }}>
                {footerText}
                {picked && newOnly && (
                  <HelpTip text={t("models:collections.sync.browse.makerworldHelp", { name: collection.name })} />
                )}
              </Typography>
            </Box>
          </Box>
        </Box>
      )}

      {section === "overview" && syncs.length > 1 && (
        <OverviewPanel
          collection={collection}
          disabled={disabled}
          busy={busy}
          onOpen={(sync) => setSection(sourceSection(sync))}
          onSyncAll={(ready) => void syncAll(ready)}
        />
      )}

      {open && (
        <SourcePanel
          key={open.id}
          collection={collection}
          sync={open}
          off={isSourceOff(open, disabled)}
          actions={actions}
        />
      )}
    </SectionedDialog>
  );
}
