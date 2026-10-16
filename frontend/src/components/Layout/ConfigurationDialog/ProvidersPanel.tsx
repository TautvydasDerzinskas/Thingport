import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
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
import { UnauthorizedError } from "../../../api/client";
import { settingsApi } from "../../../api/settings";
import type { MakerWorldSettings } from "../../../utils/settings";
import { useConfirm } from "../../ConfirmProvider";
import { AppGrid, AppTile, menuPosition, TileMenuHeader } from "./AppTiles";
import { PanelHeader } from "./parts";
import { ProviderLogo, type ProviderId } from "./providerLogos";
import { useDisabledProviders } from "../../../hooks/useDisabledProviders";
import type { ImportProvider } from "../../../api/settings";

const PROVIDERS: { id: ProviderId; name: string; comingSoon?: boolean }[] = [
  { id: "makerworld", name: "MakerWorld" },
  { id: "thingiverse", name: "Thingiverse" },
  { id: "printables", name: "Printables" },
  { id: "thangs", name: "Thangs", comingSoon: true },
];
const isComingSoon = (id: ProviderId) => PROVIDERS.some((provider) => provider.id === id && provider.comingSoon);

type Props = {
  isAdmin: boolean;
  cookie: string;
  onUpdateMakerWorld: (patch: Partial<MakerWorldSettings>) => void;
  onUnauthorized?: () => void;
};

/** The import sites as app icons: right-click one to connect or disconnect it, or double-click a
 *  disconnected one to connect it. Stored credentials are never shown, only whether one is set. */
export default function ProvidersPanel({ isAdmin, cookie, onUpdateMakerWorld, onUnauthorized }: Props) {
  // Turned off by an admin: not shown to connect.
  const disabledProviders = useDisabledProviders();
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  // Thingiverse is unknown until loaded, so a non-admin doesn't briefly see it locked.
  const [connected, setConnected] = React.useState<Record<ProviderId, boolean | null>>({
    makerworld: Boolean(cookie.trim()),
    thingiverse: null,
    printables: true,
    thangs: false,
  });
  const [menu, setMenu] = React.useState<{ id: ProviderId; top: number; left: number } | null>(null);
  const [makerworldExpired, setMakerworldExpired] = React.useState(false);
  const [connecting, setConnecting] = React.useState<ProviderId | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    settingsApi
      .getMakerworld()
      .then((res) => {
        if (!active) return;
        setConnected((current) => ({ ...current, makerworld: res.configured }));
        setMakerworldExpired(res.expired);
      })
      .catch(() => undefined);
    settingsApi
      .getThingiverse()
      .then((res) => active && setConnected((current) => ({ ...current, thingiverse: res.configured })))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const nameOf = (id: ProviderId) => PROVIDERS.find((provider) => provider.id === id)?.name ?? id;
  // Why this user can't connect or disconnect it, if they can't.
  const lockedReason = (id: ProviderId) => {
    if (isComingSoon(id)) return t("providers.comingSoon");
    if (id === "printables") return t("providers.printables.alwaysConnected");
    if (id === "thingiverse" && !isAdmin) return t("providers.thingiverse.adminOnly");
    return null;
  };

  /** Saves a credential, or removes it with null. */
  const save = async (id: ProviderId, value: string | null) => {
    if (id === "makerworld") {
      const result = await settingsApi.updateMakerworld(value);
      onUpdateMakerWorld({ cookie: value ?? "" });
      setConnected((current) => ({ ...current, makerworld: result.configured }));
      setMakerworldExpired(false);
    } else if (id === "thingiverse") {
      const result = await settingsApi.updateThingiverse(value);
      setConnected((current) => ({ ...current, thingiverse: result.configured }));
    }
  };

  const startConnect = (id: ProviderId) => {
    setError(null);
    setNotice(null);
    setConnecting(id);
  };

  // Double-click or Enter: connects a disconnected site, or says why this one can't be.
  const activate = (id: ProviderId) => {
    if (isComingSoon(id)) return;
    const locked = lockedReason(id);
    if (locked) {
      setConnecting(null);
      setNotice(locked);
    } else if (connected[id] === false || (id === "makerworld" && makerworldExpired)) {
      startConnect(id);
    }
  };

  const disconnect = async (id: ProviderId) => {
    const name = nameOf(id);
    const ok = await confirm({
      title: t("providers.disconnectTitle", { name }),
      message:
        id === "thingiverse"
          ? t("providers.disconnectMessageShared", { name })
          : t("providers.disconnectMessage", { name }),
      confirmLabel: t("providers.disconnect"),
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await save(id, null);
      if (connecting === id) setConnecting(null);
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
  const menuConnected = menuId ? Boolean(connected[menuId]) : false;
  // Still connected, so it can be disconnected, but offered a fresh connect first.
  const menuExpired = menuId === "makerworld" && menuConnected && makerworldExpired;
  const menuLocked = menuId ? lockedReason(menuId) : null;

  return (
    <>
      <PanelHeader title={t("providers.title")} subtitle={t("providers.subtitle")} />
      <AppGrid>
        {PROVIDERS.filter(({ id }) => !disabledProviders.has(id as ImportProvider)).map(({ id, name }) => {
          const isConnected = Boolean(connected[id]);
          const locked = lockedReason(id);
          const expired = id === "makerworld" && isConnected && makerworldExpired;
          const status = connected[id] === null ? null : isConnected && !expired;
          const tooltip = isComingSoon(id)
            ? t("providers.comingSoon")
            : expired
              ? t("providers.makerworld.expired")
              : id === "thingiverse" && locked && !isConnected
                ? locked
                : isConnected
                  ? t("providers.connected")
                  : t("providers.notConnected");
          return (
            <AppTile
              key={id}
              name={name}
              logo={<ProviderLogo id={id} size={26} />}
              on={isConnected}
              badge={status === null || isComingSoon(id) ? undefined : status}
              highlighted={connecting === id || menuId === id}
              tooltip={status === null ? undefined : tooltip}
              ariaLabel={`${name}: ${expired ? t("providers.makerworld.expired") : isConnected ? t("providers.connected") : t("providers.notConnected")}`}
              onContextMenu={(event) => openMenu(id, event)}
              onActivate={() => activate(id)}
            />
          );
        })}
      </AppGrid>

      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
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
                  ? t("providers.makerworld.expiredStatus")
                  : menuConnected
                    ? t("providers.connected")
                    : t("providers.notConnected")
            }
          />
        )}
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
          // Starts afresh for each site.
          key={connecting}
          id={connecting}
          name={nameOf(connecting)}
          onCancel={() => setConnecting(null)}
          onConnect={async (value) => {
            await save(connecting, value);
            setConnecting(null);
          }}
          onUnauthorized={onUnauthorized}
        />
      )}
    </>
  );
}

type ConnectBoxProps = {
  id: ProviderId;
  name: string;
  onCancel: () => void;
  onConnect: (value: string) => Promise<void>;
  onUnauthorized?: () => void;
};

function ConnectBox({ id, name, onCancel, onConnect, onUnauthorized }: ConnectBoxProps) {
  const { t } = useTranslation(["app", "common"]);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const steps = t(`providers.${id}.steps`, { returnObjects: true }) as string[];
  const multiline = id === "makerworld";
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  // It opens below the icons, often past the bottom of the panel.
  React.useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const submit = async () => {
    const value = draft.trim();
    if (!value) return;
    setSaving(true);
    setError(null);
    try {
      await onConnect(value);
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
          {t("providers.connectTitle", { name })}
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
      {id === "thingiverse" && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {t("providers.thingiverse.shared")}
        </Typography>
      )}
      <TextField
        fullWidth
        multiline={multiline}
        minRows={multiline ? 3 : undefined}
        size="small"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (!multiline && e.key === "Enter") void submit();
        }}
        placeholder={t(`providers.${id}.placeholder`)}
        disabled={saving}
        autoComplete="off"
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button size="small" variant="contained" onClick={() => void submit()} disabled={saving || !draft.trim()}>
          {saving ? t("providers.connecting") : t("providers.connect")}
        </Button>
        <Button size="small" onClick={onCancel} disabled={saving}>
          {t("common:cancel")}
        </Button>
      </Stack>
    </Box>
  );
}
