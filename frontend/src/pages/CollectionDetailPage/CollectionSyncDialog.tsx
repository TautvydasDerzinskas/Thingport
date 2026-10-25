import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import SyncIcon from "@mui/icons-material/Sync";
import SyncDisabledIcon from "@mui/icons-material/SyncDisabled";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import TravelExploreIcon from "@mui/icons-material/TravelExplore";
import TuneIcon from "@mui/icons-material/Tune";
import { UnauthorizedError } from "../../api/client";
import {
  type Collection,
  type SyncIntervalHours,
  type SyncProfileScope,
  SYNC_INTERVAL_HOURS,
  collectionsApi,
} from "../../api/collections";
import type { BrowsableProvider } from "../../api/providerCollections";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToast } from "../../components/ToastProvider";
import { importProviderInfo } from "../../constants/importProviders";
import { relativeTime } from "../../utils/relativeTime";
import SectionedDialog, { type DialogSection } from "../../components/SectionedDialog";
import SyncChain from "./SyncChain";
import SyncBrowse, { type BrowsePick } from "./SyncBrowse";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import { SectionLabel } from "../../components/Layout/ConfigurationDialog/parts";
import { isProviderId, manifestOf } from "../../providers/index.generated";

const SCOPES: SyncProfileScope[] = ["url", "designer", "all"];

type SyncSection = "overview" | "browse" | "settings";

// What a sync turned on here starts with; Settings can change them first.
const NEW_SYNC_INTERVAL: SyncIntervalHours = 24;
const NEW_SYNC_SCOPE: SyncProfileScope = "designer";

type Props = {
  /** Unsynced, it opens on Browse, to pick the provider collection to sync with. */
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

/** A collection's sync, in sections like the app's Configuration. Synced: Overview (the link, its
 *  status, Sync now and Stop syncing). Not yet: Browse (the provider collection to sync with). Both
 *  have Settings: how often it's checked and, for MakerWorld, which print profiles each new model
 *  brings. */
export default function CollectionSyncDialog({ collection, onClose, onUpdated, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["models", "common"]);
  const confirm = useConfirm();
  const showToast = useToast();
  const { sync } = collection;
  const [browseProvider, setBrowseProvider] = useState<BrowsableProvider | null>(null);
  const [picked, setPicked] = useState<BrowsePick | null>(null);
  // A pick from another provider would leave its explanation under this one's list.
  const changeBrowseProvider = useCallback((next: BrowsableProvider) => {
    setBrowseProvider(next);
    setPicked(null);
  }, []);
  const providerId = sync?.provider ?? picked?.provider ?? browseProvider;
  const provider = importProviderInfo(providerId)?.label ?? providerId ?? "";
  const capabilities = providerId && isProviderId(providerId) ? manifestOf(providerId).capabilities : null;
  const hasProfiles = !!capabilities?.profiles;
  const newOnly = !!capabilities?.syncsNewOnly;
  const [scope, setScope] = useState<SyncProfileScope>(sync?.profile_scope ?? NEW_SYNC_SCOPE);
  const [intervalHours, setIntervalHours] = useState<SyncIntervalHours>(sync?.interval_hours ?? NEW_SYNC_INTERVAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<SyncSection>(sync ? "overview" : "browse");

  const readyAt = sync?.sync_now_at ? new Date(sync.sync_now_at).getTime() : null;
  const now = useNowUntil(readyAt);
  const coolingMs = readyAt ? readyAt - now : 0;
  const cooling = coolingMs > 0;
  // How far through the cool-down, from the last check to when Sync now is back.
  const startedAt = sync?.last_checked_at ? new Date(sync.last_checked_at).getTime() : null;
  const coolProgress =
    cooling && readyAt && startedAt && readyAt > startedAt ? ((now - startedAt) / (readyAt - startedAt)) * 100 : 0;

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

  const syncNow = async () => {
    const ok = await confirm({
      title: t("models:collections.sync.syncNowTitle"),
      message: t("models:collections.sync.syncNowMessage", { name: collection.name, provider }),
      confirmLabel: t("models:collections.sync.syncNow"),
    });
    if (!ok) return;
    await run(async () => {
      const updated = await collectionsApi.runSync(collection.id);
      onUpdated({ ...collection, sync: updated });
      showToast({ message: t("models:collections.sync.syncNowStarted", { name: collection.name }) });
    });
  };

  const stop = async () => {
    const ok = await confirm({
      title: t("models:collections.sync.stopTitle"),
      message: t("models:collections.sync.stopMessage", { name: collection.name }),
      confirmLabel: t("models:collections.sync.stop"),
      destructive: true,
    });
    if (!ok) return;
    await run(async () => {
      await collectionsApi.stopSync(collection.id);
      showToast({ message: t("models:collections.sync.stopped", { name: collection.name }) });
      onUpdated({ ...collection, sync: null });
      onClose();
    });
  };

  /** Settings are saved as they're picked; a failed save puts the choice back. */
  const saveSetting = async (change: Parameters<typeof collectionsApi.updateSync>[1], revert: () => void) => {
    let saved = false;
    await run(async () => {
      const updated = await collectionsApi.updateSync(collection.id, change);
      saved = true;
      onUpdated({ ...collection, sync: updated });
      showToast({ message: t("models:collections.sync.saved") });
    });
    if (!saved) revert();
  };

  // Before sync is on, the choices wait for it.
  const changeScope = (next: SyncProfileScope) => {
    const previous = scope;
    setScope(next);
    if (sync) void saveSetting({ profile_scope: next }, () => setScope(previous));
  };

  const changeInterval = (next: SyncIntervalHours) => {
    const previous = intervalHours;
    setIntervalHours(next);
    if (sync) void saveSetting({ interval_hours: next }, () => setIntervalHours(previous));
  };

  const startSync = async () => {
    if (!picked) return;
    await run(async () => {
      const result = await collectionsApi.enableSync(collection.id, {
        url: picked.collection.url,
        interval_hours: intervalHours,
        ...(hasProfiles ? { profile_scope: scope } : {}),
      });
      onUpdated({ ...collection, sync: result.sync });
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
            // The instance names a likes card in English; the tile shows it translated.
            source: picked.collection.likes ? t("models:collections.sync.browse.likes") : picked.collection.name,
          },
        ),
      });
      setSection("overview");
    });
  };

  const footerText = !picked
    ? t("models:collections.sync.browse.pickPrompt")
    : newOnly
      ? t("models:collections.sync.browse.confirmMakerworld")
      : t("models:collections.sync.browse.confirmImport", { count: picked.collection.model_count });

  const checked = sync?.last_checked_at
    ? t("models:collections.sync.lastChecked", { when: relativeTime(sync.last_checked_at, i18n.language) })
    : t("models:collections.sync.notCheckedYet");
  const next = sync?.next_sync_at
    ? t("models:collections.sync.nextSync", { time: clockTime(sync.next_sync_at, i18n.language) })
    : null;

  const sections: DialogSection<SyncSection>[] = [
    sync
      ? {
          id: "overview",
          label: t("models:collections.sync.sections.overview"),
          icon: <HubOutlinedIcon fontSize="small" />,
        }
      : {
          id: "browse",
          label: t("models:collections.sync.sections.browse"),
          icon: <TravelExploreIcon fontSize="small" />,
        },
    { id: "settings", label: t("models:collections.sync.sections.settings"), icon: <TuneIcon fontSize="small" /> },
  ];

  return (
    <SectionedDialog
      open
      onClose={busy ? () => undefined : onClose}
      title={t("models:collections.sync.title")}
      sections={sections}
      section={section}
      onSectionChange={setSection}
      size={sync ? "default" : "large"}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {section === "browse" && !sync && (
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

      {section === "overview" && sync && (
        <Stack spacing={2}>
          <Box>
            <Typography variant="body2">
              {sync.likes_of
                ? t("models:collections.sync.introLikes", { user: sync.likes_of, provider, count: sync.interval_hours })
                : t("models:collections.sync.intro", { provider, count: sync.interval_hours })}
            </Typography>
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
          <SyncChain
            collection={{ ...collection, sync }}
            syncNow={{
              label: t("models:collections.sync.syncNow"),
              icon: <SyncIcon fontSize="small" />,
              onClick: () => void syncNow(),
              disabled: busy || cooling,
              disabledLabel: cooling
                ? t("models:collections.sync.syncNowIn", { time: minutesSeconds(coolingMs) })
                : undefined,
              progress: cooling ? coolProgress : null,
            }}
            stop={{
              label: t("models:collections.sync.stop"),
              icon: <SyncDisabledIcon fontSize="small" />,
              onClick: () => void stop(),
              disabled: busy,
              color: "error",
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {next ? `${checked} · ${next}` : checked}
          </Typography>
          {sync.last_error && <Alert severity="warning">{sync.last_error}</Alert>}
        </Stack>
      )}

      {section === "settings" && (
        <Stack spacing={3}>
          <div>
            <SectionLabel>{t("models:collections.sync.intervalLabel")}</SectionLabel>
            <Segmented
              label={t("models:collections.sync.intervalLabel")}
              value={String(intervalHours)}
              onChange={(value) => changeInterval(Number(value) as SyncIntervalHours)}
              disabled={busy}
              options={SYNC_INTERVAL_HOURS.map((hours) => ({
                value: String(hours),
                label: t("models:collections.sync.intervalOption", { count: hours }),
              }))}
            />
          </div>
          {/* Only MakerWorld models have print profiles to choose between. */}
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
                disabled={busy}
                options={SCOPES.map((value) => ({ value, label: t(`models:collections.sync.profiles.${value}`) }))}
              />
            </div>
          )}
        </Stack>
      )}
    </SectionedDialog>
  );
}
