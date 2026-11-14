import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { UnauthorizedError } from "../../../api/client";
import { providersApi, type ProviderState } from "../../../api/providers";
import { useConfirm } from "../../ConfirmProvider";
import { AppGrid, AppTile, menuPosition, reopenContextMenuBelow, TileMenuHeader } from "./AppTiles";
import { PanelHeader } from "./parts";
import { COMING_SOON_PROVIDERS, ProviderLogo, type ProviderId } from "./providerLogos";
import { refreshProviders, useProviders } from "../../../hooks/useProviders";
import { type AuthSlot, MANIFESTS, PROVIDER_IDS, manifestOf } from "../../../providers/index.generated";
import { expiredSite, expiredTexts, missingOf as missingFor, signInStatus } from "../../../providers/overrides";
import { useProviderAbout } from "../../providerAbout/ProviderAboutProvider";
import Segmented from "../../controls/Segmented";

const PROVIDERS: { id: ProviderId; name: string }[] = [
  ...PROVIDER_IDS.map((id) => ({ id, name: MANIFESTS[id].name })),
  ...COMING_SOON_PROVIDERS,
];
const isComingSoon = (id: ProviderId) => COMING_SOON_PROVIDERS.some((provider) => provider.id === id);
const authOf = (id: ProviderId) => MANIFESTS[id].auth as readonly AuthSlot[];
/** The credential its tile connects; none for a provider that needs none (Printables). */
const defaultAuth = (id: ProviderId) => authOf(id).find((auth) => auth.slot === "default");
/** One credential for the whole instance, which only an admin sets. */
const isShared = (id: ProviderId) => defaultAuth(id)?.scope === "instance";
/** Its other sites with accounts of their own (VoxelShare's China one), each signed in to in the slot named after it. */
const regionsOf = (id: ProviderId) => manifestOf(id).regions ?? [];
const isRegionSlot = (id: ProviderId, slot: string) => regionsOf(id).some((region) => region.id === slot);
/** The sign-ins the tile connects, one per site, its connect form switching between them: its own and its regions'. */
const siteAuths = (id: ProviderId) =>
  authOf(id).filter((auth) => auth.slot === "default" || isRegionSlot(id, auth.slot));
/** The user's other credentials, besides those the tile connects (Cults3D's browser sign-in). */
const extraAuths = (id: ProviderId) =>
  authOf(id).filter((auth) => auth.slot !== "default" && auth.scope === "user" && !isRegionSlot(id, auth.slot));
const forget = (auth: AuthSlot) => Object.fromEntries(auth.fields.map((field) => [field.name, null]));

type Props = {
  isAdmin: boolean;
  onUnauthorized?: () => void;
};

/** The import sites as app icons: right-click one to connect or disconnect it, or double-click a
 *  disconnected one to connect it. Stored credentials are never shown, only whether one is set. */
export default function ProvidersPanel({ isAdmin, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const providers = useProviders();
  const [menu, setMenu] = React.useState<{ id: ProviderId; top: number; left: number } | null>(null);
  const [connecting, setConnecting] = React.useState<{ id: ProviderId; auth: AuthSlot } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Thingport Grab may have sent a sign-in since it was last asked.
  React.useEffect(() => {
    void refreshProviders().catch(() => undefined);
  }, []);

  const stateOf = (id: ProviderId): ProviderState | undefined => providers?.find((p) => p.id === id);
  // Any of its sites' sign-ins connects the tile.
  const statusOf = (id: ProviderId) => {
    const state = stateOf(id);
    return state ? signInStatus(state) : undefined;
  };
  /** Null until known, so a non-admin doesn't briefly see a shared one locked. */
  const isConnected = (id: ProviderId): boolean | null => {
    if (isComingSoon(id)) return false;
    if (!defaultAuth(id)) return true;
    const status = statusOf(id);
    return status ? status !== "disconnected" : null;
  };
  // No site's sign-in left that works, and one was turned down.
  const isExpired = (id: ProviderId) => statusOf(id) === "expired";
  /** What says which site's sign-in ran out, as a tooltip and as a menu's status. */
  const expiredOf = (id: ProviderId) => {
    const state = stateOf(id);
    return expiredTexts(id, (state && expiredSite(state)) ?? "default", t);
  };
  /** Connected, but not all its imports need, or another site's sign-in ran out: half connected. */
  const missingOf = (id: ProviderId) => {
    const state = stateOf(id);
    return state && isConnected(id) && !isExpired(id) ? missingFor(state, t) : undefined;
  };
  /** Its sites' names, as its connect form's toggle shows them: "International" for its main site. */
  const siteName = (id: ProviderId, slot: string) =>
    slot === "default"
      ? t("providers.regions.main")
      : t(`providers.regions.${slot}`, { defaultValue: regionsOf(id).find((region) => region.id === slot)?.name });
  /** "Connected", and for a provider with several sites, through which. */
  const connectedText = (id: ProviderId) => {
    const state = stateOf(id);
    if (!state || !regionsOf(id).length) return t("providers.connected");
    const sites = siteAuths(id).filter((auth) => state.slots[auth.slot]?.status === "connected");
    return t("providers.connectedSites", { sites: sites.map((auth) => siteName(id, auth.slot)).join(", ") });
  };
  /** The tile's sites not connected yet, which its menu offers to connect besides those that are. */
  const unconnectedSites = (id: ProviderId) =>
    regionsOf(id).length ? siteAuths(id).filter((auth) => stateOf(id)?.slots[auth.slot]?.status !== "connected") : [];
  /** The sign-in a connect starts on: the one that ran out, else the tile's own. */
  const firstAuth = (id: ProviderId) => {
    const state = stateOf(id);
    const expired = state && expiredSite(state);
    return siteAuths(id).find((auth) => auth.slot === expired) ?? defaultAuth(id);
  };
  const nameOf = (id: ProviderId) => PROVIDERS.find((provider) => provider.id === id)?.name ?? id;
  // Why this user can't connect or disconnect it, if they can't.
  const lockedReason = (id: ProviderId) => {
    if (isComingSoon(id)) return t("providers.comingSoon");
    if (!defaultAuth(id)) return t(`providers:${id}.status.alwaysConnected`);
    if (isShared(id) && !isAdmin) return t(`providers:${id}.status.adminOnly`);
    return null;
  };

  /** Saves a credential, or forgets it with null: the tile's credential takes the user's others with it, its other
   *  sites' too, so disconnecting leaves Thingport nothing of the account. */
  const save = async (id: ProviderId, auth: AuthSlot, values: Record<string, string> | null) => {
    if (values) {
      await providersApi.saveConnection(id, auth.slot, values);
    } else {
      if (auth.slot === "default") {
        const others = [...extraAuths(id), ...siteAuths(id).filter((site) => site.slot !== "default")];
        for (const other of others) await providersApi.saveConnection(id, other.slot, forget(other));
      }
      await providersApi.saveConnection(id, auth.slot, forget(auth));
    }
    await refreshProviders();
  };

  const startConnect = (id: ProviderId, auth = firstAuth(id)) => {
    if (!auth) return;
    setError(null);
    setNotice(null);
    setConnecting({ id, auth });
  };

  // Double-click or Enter: connects a disconnected site, or says why this one can't be.
  const activate = (id: ProviderId) => {
    if (isComingSoon(id)) return;
    const locked = lockedReason(id);
    if (locked) {
      setConnecting(null);
      setNotice(locked);
    } else if (isConnected(id) === false || isExpired(id)) {
      startConnect(id);
    }
  };

  const disconnect = async (id: ProviderId) => {
    const auth = defaultAuth(id);
    if (!auth) return;
    const name = nameOf(id);
    const ok = await confirm({
      title: t("providers.disconnectTitle", { name }),
      message: isShared(id)
        ? t("providers.disconnectMessageShared", { name })
        : t("providers.disconnectMessage", { name }),
      confirmLabel: t("providers.disconnect"),
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await save(id, auth, null);
      if (connecting?.id === id) setConnecting(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("providers.failed"));
    }
  };

  const openMenu = (id: ProviderId, event: React.MouseEvent<HTMLElement>) => {
    setNotice(null);
    setMenu({ id, ...menuPosition(event) });
  };

  const menuId = menu?.id;
  const menuConnected = menuId ? Boolean(isConnected(menuId)) : false;
  // Still connected, so it can be disconnected, but offered a fresh connect first.
  const menuExpired = menuId ? isExpired(menuId) : false;
  const menuLocked = menuId ? lockedReason(menuId) : null;
  const menuMissing = menuId ? missingOf(menuId) : undefined;
  // Another of its sites to connect, besides the one it's connected through.
  const menuMoreSites = menuId && menuConnected && !menuExpired ? unconnectedSites(menuId) : [];

  return (
    <>
      <PanelHeader title={t("providers.title")} subtitle={t("providers.subtitle")} />
      <AppGrid>
        {/* Turned off by an admin: not shown to connect. */}
        {PROVIDERS.filter(({ id }) => stateOf(id)?.enabled !== false).map(({ id, name }) => {
          const connected = isConnected(id);
          const locked = lockedReason(id);
          const tileExpired = isExpired(id);
          const missing = missingOf(id);
          const status = connected === null ? null : connected && !tileExpired && !missing;
          const tooltip = isComingSoon(id)
            ? t("providers.comingSoon")
            : missing
              ? missing.tooltip
              : tileExpired
                ? expiredOf(id).tooltip
                : isShared(id) && locked && !connected
                  ? locked
                  : connected
                    ? connectedText(id)
                    : t(`providers:${id}.status.notConnected`, { defaultValue: t("providers.notConnected") });
          return (
            <AppTile
              key={id}
              name={name}
              logo={<ProviderLogo id={id} size={26} />}
              on={Boolean(connected)}
              badge={status === null || isComingSoon(id) ? undefined : status}
              highlighted={connecting?.id === id || menuId === id}
              tooltip={status === null ? undefined : tooltip}
              ariaLabel={`${name}: ${tileExpired ? tooltip : connected ? connectedText(id) : t("providers.notConnected")}`}
              onContextMenu={(event) => openMenu(id, event)}
              onActivate={() => activate(id)}
            />
          );
        })}
      </AppGrid>

      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        onContextMenu={(event) => reopenContextMenuBelow(event, () => setMenu(null))}
        anchorReference="anchorPosition"
        anchorPosition={menu ? { top: menu.top, left: menu.left } : undefined}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        {menuId && (
          <TileMenuHeader
            logo={<ProviderLogo id={menuId} size={20} />}
            name={nameOf(menuId)}
            status={
              isComingSoon(menuId)
                ? t("providers.comingSoon")
                : menuExpired
                  ? expiredOf(menuId).status
                  : menuMissing
                    ? menuMissing.status
                    : menuConnected
                      ? connectedText(menuId)
                      : t("providers.notConnected")
            }
          />
        )}
        {menuId && <AboutMenuItem id={menuId} onClick={() => setMenu(null)} />}
        {menuId && !isComingSoon(menuId) && <Divider />}
        {menuId && menuExpired && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              startConnect(menuId);
            }}
          >
            <ListItemIcon>
              <LinkIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("providers.connect")}</ListItemText>
          </MenuItem>
        )}
        {menuId &&
          menuMoreSites.map((auth) => (
            <MenuItem
              key={auth.slot}
              onClick={() => {
                setMenu(null);
                startConnect(menuId, auth);
              }}
            >
              <ListItemIcon>
                <LinkIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("providers.connectSite", { site: siteName(menuId, auth.slot) })}</ListItemText>
            </MenuItem>
          ))}
        {menuId &&
          menuConnected &&
          !menuExpired &&
          extraAuths(menuId).map((auth) => (
            <MenuItem
              key={auth.slot}
              onClick={() => {
                setMenu(null);
                startConnect(menuId, auth);
              }}
            >
              <ListItemIcon>
                <ContentPasteIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t(`providers:${menuId}.connect.${auth.slot}.paste`)}</ListItemText>
            </MenuItem>
          ))}
        {menuId && (
          <MenuItem
            disabled={Boolean(menuLocked)}
            onClick={() => {
              setMenu(null);
              if (menuConnected) void disconnect(menuId);
              else startConnect(menuId);
            }}
          >
            <ListItemIcon>
              {menuConnected ? <LinkOffIcon fontSize="small" /> : <LinkIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{menuConnected ? t("providers.disconnect") : t("providers.connect")}</ListItemText>
          </MenuItem>
        )}
        {/* Coming soon is already said in the header. */}
        {menuLocked && menuId && !isComingSoon(menuId) && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", px: 2, pt: 0.5, pb: 1, maxWidth: 240 }}
          >
            {menuLocked}
          </Typography>
        )}
      </Menu>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="info" sx={{ mt: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {connecting && (
        <ConnectBox
          // Starts afresh for each site and credential.
          key={`${connecting.id}-${connecting.auth.slot}`}
          id={connecting.id}
          auth={connecting.auth}
          sites={
            isRegionSlot(connecting.id, connecting.auth.slot) || connecting.auth.slot === "default"
              ? siteAuths(connecting.id)
              : []
          }
          siteName={(slot) => siteName(connecting.id, slot)}
          name={nameOf(connecting.id)}
          onCancel={() => setConnecting(null)}
          onConnect={async (auth, values) => {
            await save(connecting.id, auth, values);
            setConnecting(null);
          }}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  );
}

function AboutMenuItem({ id, onClick }: { id: ProviderId; onClick: () => void }) {
  const { t } = useTranslation("app");
  const openAbout = useProviderAbout(id);
  if (!openAbout) return null;
  return (
    <MenuItem
      onClick={() => {
        onClick();
        openAbout();
      }}
    >
      <ListItemIcon>
        <InfoOutlinedIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText>{t("providerAbout.about")}</ListItemText>
    </MenuItem>
  );
}

type ConnectBoxProps = {
  id: ProviderId;
  /** The credential to connect first: the tile's, or another of the user's (Cults3D's browser sign-in). */
  auth: AuthSlot;
  /** For a provider with several sites, each one's sign-in, which a toggle at the top switches between; else none. */
  sites: readonly AuthSlot[];
  siteName: (slot: string) => string;
  name: string;
  onCancel: () => void;
  /** The credential and each field's value, by the name the API takes it under. */
  onConnect: (auth: AuthSlot, values: Record<string, string>) => Promise<void>;
  onUnauthorized?: () => void;
};

const camelCase = (name: string) => name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** A site's own host, as its toggle names it beside the site: voxelshare.cn. */
function siteHost(id: ProviderId, slot: string): string {
  const manifest = manifestOf(id);
  const site = slot === "default" ? manifest.site : manifest.regions?.find((region) => region.id === slot)?.site;
  return site ? new URL(site).hostname.replace(/^www\./, "") : "";
}

function ConnectBox({ id, auth: first, sites, siteName, name, onCancel, onConnect, onUnauthorized }: ConnectBoxProps) {
  const { t } = useTranslation(["app", "common"]);
  const [auth, setAuth] = React.useState(first);
  const [drafts, setDrafts] = React.useState<string[]>(() => first.fields.map(() => ""));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const site = sites.some((s) => s.slot === auth.slot);
  // Another credential of the user's, with words of its own; another site's sign-in is the tile's, worded as it is.
  const extra = auth.slot !== "default" && !site;
  const keyPrefix = auth.slot !== "default" ? `providers:${id}.connect.${auth.slot}` : `providers:${id}.connect`;

  /** Another site: what's typed stays where the fields are the same. */
  const switchSite = (slot: string) => {
    const next = sites.find((s) => s.slot === slot);
    if (!next || next.slot === auth.slot) return;
    setDrafts((current) => next.fields.map((field, i) => (auth.fields[i]?.name === field.name ? current[i] : "")));
    setError(null);
    setAuth(next);
  };
  const steps = t(`${keyPrefix}.steps`, { returnObjects: true }) as string[];
  // Where there are several, each says what it is.
  const labelled = auth.fields.length > 1;
  const ready = drafts.every((draft) => Boolean(draft.trim()));
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  // It opens below the icons, often past the bottom of the panel.
  React.useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const submit = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await onConnect(auth, Object.fromEntries(auth.fields.map((field, i) => [field.name, drafts[i].trim()])));
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("providers.failed"));
      setSaving(false);
    }
  };

  return (
    <Box ref={rootRef} sx={{ mt: 2.5, p: 2, border: 1, borderColor: "divider", borderRadius: "12px" }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 1.5 }}>
        <ProviderLogo id={id} size={20} />
        <Typography
          variant="body2"
          fontWeight={600}
          sx={{ flex: 1, color: (muiTheme) => muiTheme.thingport.headingText }}
        >
          {extra ? t(`${keyPrefix}.title`) : t("providers.connectTitle", { name })}
        </Typography>
        <IconButton size="small" onClick={onCancel} aria-label={t("common:close") ?? undefined}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      {sites.length > 1 && (
        <Box sx={{ mb: 1.5 }}>
          <Segmented
            value={auth.slot}
            options={sites.map((s) => ({ value: s.slot, label: `${siteName(s.slot)} · ${siteHost(id, s.slot)}` }))}
            onChange={switchSite}
            label={t("providers.site")}
            disabled={saving}
          />
        </Box>
      )}
      <Box
        component="ol"
        sx={{ m: 0, mb: 1.5, pl: 2.5, color: "text.secondary", fontSize: "0.75rem", "& li": { mb: 0.5 } }}
      >
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </Box>
      {auth.scope === "instance" && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {t(`providers:${id}.connect.shared`)}
        </Typography>
      )}
      {auth.fields.map((field, i) => (
        <TextField
          key={field.name}
          fullWidth
          multiline={field.multiline}
          minRows={field.multiline ? 3 : undefined}
          size="small"
          type={field.secret ? "password" : undefined}
          label={labelled ? t(`${keyPrefix}.${camelCase(field.name)}Label`) : undefined}
          value={drafts[i]}
          onChange={(e) => setDrafts((current) => current.map((draft, j) => (j === i ? e.target.value : draft)))}
          onKeyDown={(e) => {
            if (!field.multiline && e.key === "Enter") void submit();
          }}
          placeholder={i === 0 ? t(`${keyPrefix}.placeholder`) : undefined}
          disabled={saving}
          autoComplete="off"
          // oxlint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={i === 0}
          sx={i > 0 ? { mt: 1.5 } : undefined}
        />
      ))}
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button size="small" variant="contained" onClick={() => void submit()} disabled={saving || !ready}>
          {saving ? t("providers.connecting") : extra ? t(`${keyPrefix}.save`) : t("providers.connect")}
        </Button>
        <Button size="small" onClick={onCancel} disabled={saving}>
          {t("common:cancel")}
        </Button>
      </Stack>
    </Box>
  );
}
