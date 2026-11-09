import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import ToggleOffOutlinedIcon from "@mui/icons-material/ToggleOffOutlined";
import ToggleOnOutlinedIcon from "@mui/icons-material/ToggleOnOutlined";
import { UnauthorizedError } from "../../api/client";
import { type ImportProvider, settingsApi } from "../../api/settings";
import { useConfirm } from "../../components/ConfirmProvider";
import SortTabs from "../../components/controls/SortTabs";
import { COMING_SOON_PROVIDERS } from "../../components/Layout/ConfigurationDialog/providerLogos";
import SectionHeader from "../../components/SectionHeader";
import SelectionToolbar, { SelectionAction } from "../../components/selection/SelectionToolbar";
import { useToast } from "../../components/ToastProvider";
import { publishProviders, refreshProviders, useProviders } from "../../hooks/useProviders";
import { useSelection } from "../../hooks/useSelection";
import { type AuthSlot, MANIFESTS, PROVIDER_IDS } from "../../providers/index.generated";
import ProviderCard, { ComingSoonCard } from "./ProviderCard";
import ProviderFiltersButton from "./ProviderFiltersButton";
import ProviderKeySection from "./ProviderKeySection";
import {
  activeFilterCount,
  matchesFilters,
  NO_FILTERS,
  type ProviderFilters,
  type ProviderSort,
  sortProviders,
} from "./providerFilters";

type Props = {
  onUnauthorized?: () => void;
};

/** The key for the whole instance a provider needs, which an admin sets here; none for most. */
const instanceAuth = (provider: ImportProvider) =>
  (MANIFESTS[provider].auth as readonly AuthSlot[]).find((auth) => auth.scope === "instance");

const idOf = (id: ImportProvider) => id;

/** The sites Thingport imports from and syncs with: each can be turned off for everyone, one at a time or several
 *  together, and the instance keys of the ones that need one set. */
export default function ProvidersPage({ onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["app", "common", "models"]);
  const confirm = useConfirm();
  const showToast = useToast();
  const providers = useProviders();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [keyOpen, setKeyOpen] = React.useState<ImportProvider | null>(null);
  const [sort, setSort] = React.useState<ProviderSort>("oldest");
  const [filters, setFilters] = React.useState<ProviderFilters>(NO_FILTERS);

  const fail = React.useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : String(err));
    },
    [onUnauthorized],
  );

  React.useEffect(() => {
    refreshProviders().catch(fail);
  }, [fail]);

  // Until they've loaded, every provider counts as on, as the server has them by default.
  const enabled = React.useMemo(() => new Map(providers?.map((p) => [p.id, p.enabled])), [providers]);
  const isOn = (id: ImportProvider) => enabled.get(id) ?? true;
  const shown = React.useMemo(
    () =>
      sortProviders(
        PROVIDER_IDS.filter((id) => matchesFilters(id, enabled.get(id) ?? true, filters)),
        sort,
        i18n.language,
      ),
    [enabled, filters, sort, i18n.language],
  );
  const selection = useSelection(shown, idOf);
  const onCount = PROVIDER_IDS.filter(isOn).length;
  const toTurnOn = selection.selected.filter((id) => !isOn(id));
  const toTurnOff = selection.selected.filter(isOn);

  const disableOne = (id: ImportProvider) => ({
    title: t("adminSettings.providers.disableTitle", { name: MANIFESTS[id].name }),
    message: t("adminSettings.providers.disableMessage", { name: MANIFESTS[id].name }),
    confirmLabel: t("adminSettings.providers.disableConfirm"),
    destructive: true,
  });

  const save = async (ids: ImportProvider[], on: boolean, single: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // Menus open elsewhere in the app hide or show them at once.
      publishProviders(
        single ? await settingsApi.setProviderEnabled(ids[0], on) : await settingsApi.setProvidersEnabled(ids, on),
      );
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: ImportProvider, on: boolean) => {
    if (!on && !(await confirm(disableOne(id)))) return;
    await save([id], on, true);
  };

  const switchSelected = async (on: boolean) => {
    const ids = on ? toTurnOn : toTurnOff;
    if (!ids.length) return;
    if (!on) {
      const names = new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(
        ids.map((id) => MANIFESTS[id].name),
      );
      const ok = await confirm(
        ids.length === 1
          ? disableOne(ids[0])
          : {
              title: t("adminSettings.providers.bulkDisableTitle", { count: ids.length }),
              message: t("adminSettings.providers.bulkDisableMessage", { names }),
              confirmLabel: t("adminSettings.providers.disableConfirm"),
              destructive: true,
            },
      );
      if (!ok) return;
    }
    if (!(await save(ids, on, false))) return;
    showToast({
      // One is named; the plural forms show the count, since in some languages their "one" form also covers 21.
      message:
        ids.length === 1
          ? t(on ? "adminSettings.providers.turnedOnNamed" : "adminSettings.providers.turnedOffNamed", {
              name: MANIFESTS[ids[0]].name,
            })
          : t(on ? "adminSettings.providers.turnedOn" : "adminSettings.providers.turnedOff", { count: ids.length }),
    });
  };

  const picked = selection.selected.length > 0;
  const sortOptions: { value: ProviderSort; label: string }[] = [
    { value: "newest", label: t("models:sort.newest") },
    { value: "oldest", label: t("adminSettings.providers.sortOldest") },
    { value: "name", label: t("models:tags.sortByName") },
  ];

  return (
    <Stack spacing={3}>
      <SectionHeader title={t("adminSettings.providers.heading")} subtitle={t("adminSettings.providers.subtitle")} />
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Stack spacing={1.5}>
        <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, rowGap: 1 }}>
          <SelectionToolbar
            selection={selection}
            total={shown.length}
            busy={busy}
            labels={{
              enter: t("adminSettings.providers.selection.enter"),
              exit: t("models:selection.exit"),
              toolbar: t("adminSettings.providers.selection.toolbar"),
              selectAllLoaded: t("common:selectAll"),
            }}
          >
            <SelectionAction
              label={t("adminSettings.providers.selection.turnOn")}
              hint={picked && !toTurnOn.length ? t("adminSettings.providers.selection.allOn") : undefined}
              icon={<ToggleOnOutlinedIcon fontSize="small" color={toTurnOn.length && !busy ? "primary" : undefined} />}
              disabled={!toTurnOn.length || busy || !providers}
              onClick={() => void switchSelected(true)}
            />
            <SelectionAction
              label={t("adminSettings.providers.selection.turnOff")}
              hint={picked && !toTurnOff.length ? t("adminSettings.providers.selection.allOff") : undefined}
              icon={<ToggleOffOutlinedIcon fontSize="small" color={toTurnOff.length && !busy ? "error" : undefined} />}
              disabled={!toTurnOff.length || busy || !providers}
              onClick={() => void switchSelected(false)}
            />
          </SelectionToolbar>
          <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1.5 }}>
            <SortTabs value={sort} options={sortOptions} onChange={setSort} />
            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
            <ProviderFiltersButton filters={filters} onChange={setFilters} onCount={onCount} shown={shown.length} />
          </Box>
        </Box>

        {shown.length ? (
          <Box
            sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))", gap: 1.5 }}
          >
            {shown.map((id) => {
              const key = instanceAuth(id);
              return (
                <ProviderCard
                  key={id}
                  id={id}
                  enabled={providers ? isOn(id) : null}
                  busy={busy}
                  hasKey={Boolean(key)}
                  keySet={
                    key && providers
                      ? providers.find((p) => p.id === id)?.slots[key.slot]?.status === "connected"
                      : undefined
                  }
                  onToggle={(on) => void toggle(id, on)}
                  onOpenKey={() => setKeyOpen(id)}
                  selectMode={selection.active}
                  selected={selection.isSelected(id)}
                  onToggleSelect={(range) => selection.toggle(id, range)}
                />
              );
            })}
            {activeFilterCount(filters) === 0 &&
              COMING_SOON_PROVIDERS.map(({ id, name }) => <ComingSoonCard key={id} id={id} name={name} />)}
          </Box>
        ) : (
          <Paper
            variant="outlined"
            sx={{
              borderRadius: "12px",
              borderStyle: "dashed",
              bgcolor: "transparent",
              py: 5,
              px: 2,
              textAlign: "center",
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {t("adminSettings.providers.noMatch")}
            </Typography>
            <Button size="small" sx={{ mt: 1 }} onClick={() => setFilters(NO_FILTERS)}>
              {t("models:filters.clear")}
            </Button>
          </Paper>
        )}
      </Stack>

      <Dialog open={Boolean(keyOpen)} onClose={() => setKeyOpen(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pr: 6 }}>
          {keyOpen && t(`providers:${keyOpen}.admin.key.heading`)}
          <IconButton
            aria-label={t("common:close")}
            onClick={() => setKeyOpen(null)}
            sx={{ position: "absolute", right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {keyOpen && instanceAuth(keyOpen) && (
            <ProviderKeySection
              key={keyOpen}
              provider={keyOpen}
              auth={instanceAuth(keyOpen)!}
              configured={
                providers?.find((p) => p.id === keyOpen)?.slots[instanceAuth(keyOpen)!.slot]?.status === "connected"
              }
              onUnauthorized={onUnauthorized}
            />
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
