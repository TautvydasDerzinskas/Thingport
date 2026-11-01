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
import { type AuthSlot, MANIFESTS, PROVIDER_IDS } from "../../../providers/index.generated";
import { PROVIDER_UI } from "../../../providers/overrides";
import { useProviderAbout } from "../../providerAbout/ProviderAboutProvider";

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
/** The user's other credentials, besides the one the tile connects (Cults3D's browser sign-in). */
const extraAuths = (id: ProviderId) => authOf(id).filter((auth) => auth.slot !== "default" && auth.scope === "user");
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
  /** Null until known, so a non-admin doesn't briefly see a shared one locked. */
  const isConnected = (id: ProviderId): boolean | null => {
    if (isComingSoon(id)) return false;
    if (!defaultAuth(id)) return true;
    const status = stateOf(id)?.slots.default?.status;
    return status ? status !== "disconnected" : null;
  };
  const isExpired = (id: ProviderId) => stateOf(id)?.slots.default?.status === "expired";
  /** Connected, but not all its imports need: half connected. */
  const missingOf = (id: ProviderId) => {
    const state = stateOf(id);
    return state && isConnected(id) && !isExpired(id) ? PROVIDER_UI[id]?.missing?.(state, t) : undefined;
  };
  const nameOf = (id: ProviderId) => PROVIDERS.find((provider) => provider.id === id)?.name ?? id;
  // Why this user can't connect or disconnect it, if they can't.
  const lockedReason = (id: ProviderId) => {
    if (isComingSoon(id)) return t("providers.comingSoon");
    if (!defaultAuth(id)) return t(`providers:${id}.status.alwaysConnected`);
    if (isShared(id) && !isAdmin) return t(`providers:${id}.status.adminOnly`);
    return null;
  };

  /** Saves a credential, or forgets it with null: the tile's credential takes the user's others with it, so
   *  disconnecting leaves Thingport nothing of the account. */
  const save = async (id: ProviderId, auth: AuthSlot, values: Record<string, string> | null) => {
    if (values) {
      await providersApi.saveConnection(id, auth.slot, values);
    } else {
      if (auth.slot === "default") {
        for (const extra of extraAuths(id)) await providersApi.saveConnection(id, extra.slot, forget(extra));
      }
      await providersApi.saveConnection(id, auth.slot, forget(auth));
    }
    await refreshProviders();
  };

  const startConnect = (id: ProviderId, auth = defaultAuth(id)) => {
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
                ? t(`providers:${id}.status.expired`)
                : isShared(id) && locked && !connected
                  ? locked
                  : connected
                    ? t("providers.connected")
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
              ariaLabel={`${name}: ${tileExpired ? t(`providers:${id}.status.expired`) : connected ? t("providers.connected") : t("providers.notConnected")}`}
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
                  ? t(`providers:${menuId}.status.expiredStatus`)
                  : menuMissing
                    ? menuMissing.status
                    : menuConnected
                      ? t("providers.connected")
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
          name={nameOf(connecting.id)}
          onCancel={() => setConnecting(null)}
          onConnect={async (values) => {
            await save(connecting.id, connecting.auth, values);
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
  /** The credential to connect: the tile's, or another of the user's (Cults3D's browser sign-in). */
  auth: AuthSlot;
  name: string;
  onCancel: () => void;
  /** Each field's value, by the name the API takes it under. */
  onConnect: (values: Record<string, string>) => Promise<void>;
  onUnauthorized?: () => void;
};

const camelCase = (name: string) => name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

function ConnectBox({ id, auth, name, onCancel, onConnect, onUnauthorized }: ConnectBoxProps) {
  const { t } = useTranslation(["app", "common"]);
  const [drafts, setDrafts] = React.useState<string[]>(() => auth.fields.map(() => ""));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const extra = auth.slot !== "default";
  const keyPrefix = extra ? `providers:${id}.connect.${auth.slot}` : `providers:${id}.connect`;
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
      await onConnect(Object.fromEntries(auth.fields.map((field, i) => [field.name, drafts[i].trim()])));
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
