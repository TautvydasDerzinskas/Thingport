import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../api/client";
import {
  BROWSABLE_PROVIDERS,
  type BrowsableProvider,
  type ProviderAccounts,
  type ProviderCollection,
  providerCollectionsApi,
} from "../../api/providerCollections";
import { importProviderInfo } from "../../constants/importProviders";
import HelpTip from "../../components/HelpTip";
import Segmented from "../../components/controls/Segmented";
import { SectionLabel } from "../../components/Layout/ConfigurationDialog/parts";
import { useSlicerPreference } from "../../hooks/useSlicerPreference";
import { useConfirm } from "../../components/ConfirmProvider";
import { onConfigurationClosed, openConfiguration } from "../../utils/configurationEvents";
import ProviderCollectionTile, { ProviderCollectionTileSkeleton } from "./ProviderCollectionTile";
import { useDisabledProviders } from "../../hooks/useDisabledProviders";

export type BrowsePick = { provider: BrowsableProvider; collection: ProviderCollection };

type Props = {
  provider: BrowsableProvider | null;
  onProviderChange: (provider: BrowsableProvider) => void;
  picked: BrowsePick | null;
  onPick: (pick: BrowsePick | null) => void;
  onUnauthorized?: () => void;
};

const PASTE_DEBOUNCE_MS = 400;
// Two rows' worth at the dialog's width.
const LOADING_TILES = 6;

const PASTE_EXAMPLES: Record<BrowsableProvider, string> = {
  makerworld: "https://makerworld.com/en/collections/…",
  printables: "https://www.printables.com/@…/collections/…",
  thingiverse: "https://www.thingiverse.com/…/collections/…",
};

/** The one the user's slicer goes with, unless it isn't connected; then the first that is. Only from `available`,
 *  the ones an admin hasn't turned off. */
function defaultProvider(
  accounts: ProviderAccounts,
  slicer: string | null,
  available: readonly BrowsableProvider[],
): BrowsableProvider {
  const slicers = slicer === "bambustudio" ? "makerworld" : slicer === "prusaslicer" ? "printables" : "thingiverse";
  const preferred = available.includes(slicers) ? slicers : (available[0] ?? slicers);
  if (accounts[preferred].connected) return preferred;
  return available.find((provider) => accounts[provider].connected) ?? preferred;
}

function providerOfUrl(url: string): BrowsableProvider | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BROWSABLE_PROVIDERS.find((provider) => host.endsWith(`${provider}.com`)) ?? null;
  } catch {
    return null;
  }
}

/** Picking the provider collection an unsynced Thingport collection should follow: the user's own
 *  collections on the chosen provider, or any collection by its link. */
export default function SyncBrowse({ provider, onProviderChange, picked, onPick, onUnauthorized }: Props) {
  // Turned off by an admin: not offered.
  const disabled = useDisabledProviders();
  const available = useMemo(() => BROWSABLE_PROVIDERS.filter((p) => !disabled.has(p)), [disabled]);
  const { t } = useTranslation(["models", "common"]);
  const slicer = useSlicerPreference();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<ProviderAccounts | null>(null);
  const [collections, setCollections] = useState<Partial<Record<BrowsableProvider, ProviderCollection[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);
  const [editingAccount, setEditingAccount] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pastedResult, setPastedResult] = useState<{ pick: BrowsePick } | { error: string } | "loading" | null>(null);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : fallback);
    },
    [onUnauthorized],
  );

  const loadAccounts = useCallback(() => {
    providerCollectionsApi
      .accounts()
      .then((next) => {
        setAccounts(next);
        // A provider connected in Configuration lists afresh.
        setCollections({});
      })
      .catch((err) => fail(err, t("models:collections.sync.browse.loadFailed")));
  }, [fail, t]);

  useEffect(() => {
    loadAccounts();
    return onConfigurationClosed(loadAccounts);
  }, [loadAccounts]);

  // Waits for the slicer too, so the default doesn't flip once it arrives.
  useEffect(() => {
    // Also when the one shown has just been turned off by an admin.
    if (accounts && (!provider || (!available.includes(provider) && available.length))) {
      onProviderChange(defaultProvider(accounts, slicer, available));
    }
  }, [accounts, provider, slicer, onProviderChange, available]);

  const account = provider && accounts ? accounts[provider] : null;
  const needsAccount = provider !== null && provider !== "makerworld" && account?.connected && !account.account;
  const canList = Boolean(account?.connected && (provider === "makerworld" || account.account));

  useEffect(() => {
    if (!provider || !canList || collections[provider]) return;
    let active = true;
    setLoading(true);
    setError(null);
    providerCollectionsApi
      .list(provider)
      .then((list) => active && setCollections((current) => ({ ...current, [provider]: list })))
      .catch((err) => active && fail(err, t("models:collections.sync.browse.loadFailed")))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [provider, canList, collections, fail, t]);

  // A pasted link shows as its card once it's recognised.
  useEffect(() => {
    const url = pasted.trim();
    if (!url) {
      setPastedResult(null);
      return;
    }
    const linkProvider = providerOfUrl(url);
    if (!linkProvider) {
      setPastedResult({ error: t("models:collections.sync.browse.notALink") });
      return;
    }
    let active = true;
    setPastedResult("loading");
    const timer = setTimeout(() => {
      providerCollectionsApi
        .lookup(url)
        .then((collection) => {
          if (!active) return;
          const pick = { provider: linkProvider, collection };
          setPastedResult({ pick });
          if (!collection.synced) onPick(pick);
        })
        .catch((err) => {
          if (!active) return;
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else
            setPastedResult({
              error: err instanceof Error ? err.message : t("models:collections.sync.browse.lookupFailed"),
            });
        });
    }, PASTE_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pasted, onPick, onUnauthorized, t]);

  const saveUsername = async () => {
    if (!provider || !username.trim()) return;
    setSavingUsername(true);
    setError(null);
    try {
      setAccounts(await providerCollectionsApi.setAccount(provider, username.trim()));
      setCollections((current) => ({ ...current, [provider]: undefined }));
      setEditingAccount(false);
      setUsername("");
    } catch (err) {
      fail(err, t("models:collections.sync.browse.usernameFailed"));
    } finally {
      setSavingUsername(false);
    }
  };

  /** For Printables, also stops Thingport Grab sending what only the user sees there. */
  const forgetAccount = async () => {
    if (!provider) return;
    const ok = await confirm({
      title: t("models:collections.sync.browse.forgetTitle", { provider: importProviderInfo(provider)?.label }),
      message: t(`models:collections.sync.browse.forgetMessage.${provider}`),
      confirmLabel: t("models:collections.sync.browse.forget"),
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      setAccounts(await providerCollectionsApi.setAccount(provider, null));
      setCollections((current) => ({ ...current, [provider]: undefined }));
    } catch (err) {
      fail(err, t("models:collections.sync.browse.usernameFailed"));
    }
  };

  const isPicked = (p: BrowsableProvider, collection: ProviderCollection) =>
    picked?.provider === p && picked.collection.id === collection.id;

  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 2 };
  const skeletons = (p: BrowsableProvider, count: number) => (
    <Box sx={grid}>
      {Array.from({ length: count }, (_, i) => (
        <ProviderCollectionTileSkeleton key={i} provider={p} />
      ))}
    </Box>
  );
  const tiles = (p: BrowsableProvider, list: ProviderCollection[]) => (
    <Box sx={grid}>
      {list.map((collection) => (
        <ProviderCollectionTile
          key={collection.id}
          provider={p}
          collection={collection}
          selected={isPicked(p, collection)}
          onSelect={() => onPick(isPicked(p, collection) ? null : { provider: p, collection })}
        />
      ))}
    </Box>
  );

  if (!accounts || !provider) {
    if (error) return <Alert severity="error">{error}</Alert>;
    // The picker, the paste field and a row of tiles, until it's known which provider to show.
    return (
      <Stack spacing={2.5} aria-hidden>
        <Skeleton variant="rounded" width={290} height={38} sx={{ borderRadius: "10px" }} />
        <Skeleton variant="rounded" height={40} />
        <Box sx={grid}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} variant="rounded" sx={{ height: "auto", aspectRatio: "1 / 1", borderRadius: "12px" }} />
          ))}
        </Box>
      </Stack>
    );
  }
  const name = importProviderInfo(provider)?.label ?? provider;
  const list = collections[provider];

  return (
    <Stack spacing={2.5}>
      {/* Wrapped, so the stack doesn't stretch the picker across the dialog. */}
      <div>
        <Segmented
          label={t("models:collections.sync.browse.providerLabel")}
          value={provider}
          onChange={(next) => {
            setError(null);
            setEditingAccount(false);
            onProviderChange(next);
          }}
          options={available.map((value) => ({ value, label: importProviderInfo(value)?.label ?? value }))}
        />
      </div>

      {/* First, so it's in view however long the list of the user's own is. */}
      <Box>
        <SectionLabel>{t("models:collections.sync.browse.pasteLabel")}</SectionLabel>
        <TextField
          size="small"
          fullWidth
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={PASTE_EXAMPLES[provider]}
        />
        {pastedResult === "loading" && (
          <Box sx={{ mt: 1.5, maxWidth: 220 }}>{skeletons(providerOfUrl(pasted.trim()) ?? provider, 1)}</Box>
        )}
        {pastedResult && pastedResult !== "loading" && "error" in pastedResult && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {pastedResult.error}
          </Alert>
        )}
        {pastedResult && pastedResult !== "loading" && "pick" in pastedResult && (
          <Box sx={{ mt: 1.5 }}>
            {pastedResult.pick.collection.synced && (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                {t("models:collections.sync.browse.pastedTaken", {
                  name: pastedResult.pick.collection.synced.collection_name,
                })}
              </Alert>
            )}
            <Box sx={{ maxWidth: 220 }}>{tiles(pastedResult.pick.provider, [pastedResult.pick.collection])}</Box>
          </Box>
        )}
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      {!account?.connected && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={() => openConfiguration("providers")}>
              {t("models:collections.sync.browse.openProviders")}
            </Button>
          }
        >
          {t(`models:collections.sync.browse.notConnected.${provider}`)}
        </Alert>
      )}

      {account?.connected && (needsAccount || editingAccount) && (
        <Box>
          <SectionLabel>{t("models:collections.sync.browse.usernameLabel", { provider: name })}</SectionLabel>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t(`models:collections.sync.browse.usernameHint.${provider}`)}
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveUsername();
              }}
              placeholder={t(`models:collections.sync.browse.usernamePlaceholder.${provider}`)}
              disabled={savingUsername}
            />
            <Button
              variant="contained"
              onClick={() => void saveUsername()}
              disabled={savingUsername || !username.trim()}
            >
              {t("common:save")}
            </Button>
          </Stack>
        </Box>
      )}

      {canList && !editingAccount && (
        <Box>
          <SectionLabel>{t("models:collections.sync.browse.yoursLabel", { provider: name })}</SectionLabel>
          {provider !== "makerworld" && account?.account && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t(`models:collections.sync.browse.showing.${provider}`, { user: account.account })}
              {provider === "printables" && (
                <HelpTip text={t("models:collections.sync.browse.printablesPrivateHelp")} />
              )}{" "}
              <Link component="button" variant="body2" onClick={() => setEditingAccount(true)}>
                {t("models:collections.sync.browse.change")}
              </Link>
              {" · "}
              <Link component="button" variant="body2" onClick={() => void forgetAccount()}>
                {t("models:collections.sync.browse.forget")}
              </Link>
            </Typography>
          )}
          {loading && !list
            ? skeletons(provider, LOADING_TILES)
            : list && list.length
              ? tiles(provider, list)
              : list && (
                  <Typography variant="body2" color="text.secondary">
                    {t("models:collections.sync.browse.empty", { provider: name })}
                  </Typography>
                )}
        </Box>
      )}
    </Stack>
  );
}
