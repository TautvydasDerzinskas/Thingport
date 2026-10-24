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
import { settingsApi, type Cults3dSettings } from "../../../api/settings";
import { cults3dReady, cults3dStatus } from "./cults3dStatus";
import type { MakerWorldSettings } from "../../../utils/settings";
import { useConfirm } from "../../ConfirmProvider";
import { AppGrid, AppTile, menuPosition, reopenContextMenuBelow, TileMenuHeader } from "./AppTiles";
import { PanelHeader } from "./parts";
import { COMING_SOON_PROVIDERS, ProviderLogo, type ProviderId } from "./providerLogos";
import { useDisabledProviders } from "../../../hooks/useDisabledProviders";
import { MANIFESTS, PROVIDER_IDS } from "../../../providers/_generated";
import { useProviderAbout } from "../../providerAbout/ProviderAboutProvider";
import type { ImportProvider } from "../../../api/settings";

const PROVIDERS: { id: ProviderId; name: string }[] = [
  ...PROVIDER_IDS.map((id) => ({ id, name: MANIFESTS[id].name })),
  ...COMING_SOON_PROVIDERS,
];
const isComingSoon = (id: ProviderId) => COMING_SOON_PROVIDERS.some((provider) => provider.id === id);
// Connected with one key for the whole instance, which only an admin sets.
const SHARED = new Set<ProviderId>(["thingiverse"]);
// Connected with the user's own sign-in, which the site can turn down once it expires. MyMiniFactory's also has
// the instance's API key, set in Administration; the user's sign-in adds paid and login-only models. Snapmaker's
// lasts a day; Thingport Grab keeps renewing it. MakerOnline's reads the user's likes and private collections; its
// files only ever come through Thingport Grab. Creality Cloud's lasts a week from signing in there; NexPrint's is
// renewed by the site as the user visits it. Thangs' renews itself on the server, for about a year. Cults3D's is the
// user's API key; its files also need the browser's sign-in, which Grab sends (see cults3dStatus.ts).
type SessionProvider =
  "makerworld" | "myminifactory" | "snapmaker" | "makeronline" | "crealitycloud" | "nexprint" | "thangs" | "cults3d";
const SESSION_PROVIDERS = new Set<ProviderId>([
  "makerworld",
  "myminifactory",
  "snapmaker",
  "makeronline",
  "crealitycloud",
  "nexprint",
  "thangs",
  "cults3d",
]);
const isSessionProvider = (id: ProviderId): id is SessionProvider => SESSION_PROVIDERS.has(id);

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
  // The shared ones are unknown until loaded, so a non-admin doesn't briefly see them locked.
  const [connected, setConnected] = React.useState<Record<ProviderId, boolean | null>>({
    makerworld: Boolean(cookie.trim()),
    thingiverse: null,
    printables: true,
    myminifactory: null,
    thangs: null,
    cults3d: null,
    makeronline: null,
    crealitycloud: null,
    nexprint: null,
    snapmaker: null,
  });
  const [menu, setMenu] = React.useState<{ id: ProviderId; top: number; left: number } | null>(null);
  const [expired, setExpired] = React.useState<Record<SessionProvider, boolean>>({
    makerworld: false,
    myminifactory: false,
    snapmaker: false,
    makeronline: false,
    crealitycloud: false,
    nexprint: false,
    thangs: false,
    cults3d: false,
  });
  // Its browser sign-in, besides the API key the tile's connection is.
  const [cults3d, setCults3d] = React.useState<Cults3dSettings | null>(null);
  const isExpired = (id: ProviderId) => isSessionProvider(id) && Boolean(connected[id]) && expired[id];
  const [connecting, setConnecting] = React.useState<ProviderId | null>(null);
  const [pastingCults3dSignIn, setPastingCults3dSignIn] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    settingsApi
      .getMakerworld()
      .then((res) => {
        if (!active) return;
        setConnected((current) => ({ ...current, makerworld: res.configured }));
        setExpired((current) => ({ ...current, makerworld: res.expired }));
      })
      .catch(() => undefined);
    settingsApi
      .getThingiverse()
      .then((res) => active && setConnected((current) => ({ ...current, thingiverse: res.configured })))
      .catch(() => undefined);
    settingsApi
      .getMyminifactorySession()
      .then((res) => {
        if (!active) return;
        setConnected((current) => ({ ...current, myminifactory: res.configured }));
        setExpired((current) => ({ ...current, myminifactory: res.expired }));
      })
      .catch(() => undefined);
    settingsApi
      .getSnapmakerSession()
      .then((res) => {
        if (!active) return;
        setConnected((current) => ({ ...current, snapmaker: res.configured }));
        setExpired((current) => ({ ...current, snapmaker: res.expired }));
      })
      .catch(() => undefined);
    settingsApi
      .getMakeronlineSession()
      .then((res) => {
        if (!active) return;
        setConnected((current) => ({ ...current, makeronline: res.configured }));
        setExpired((current) => ({ ...current, makeronline: res.expired }));
      })
      .catch(() => undefined);
    settingsApi
      .getCrealitycloudSession()
      .then((res) => {
        if (!active) return;
        setConnected((current) => ({ ...current, crealitycloud: res.configured }));
        setExpired((current) => ({ ...current, crealitycloud: res.expired }));
      })
      .catch(() => undefined);
    settingsApi
      .getNexprintSession()
      .then((res) => {
        if (!active) return;
        setConnected((current) => ({ ...current, nexprint: res.configured }));
        setExpired((current) => ({ ...current, nexprint: res.expired }));
      })
      .catch(() => undefined);
    settingsApi
      .getThangsSession()
      .then((res) => {
        if (!active) return;
        setConnected((current) => ({ ...current, thangs: res.configured }));
        setExpired((current) => ({ ...current, thangs: res.expired }));
      })
      .catch(() => undefined);
    settingsApi
      .getCults3d()
      .then((res) => {
        if (!active) return;
        setCults3d(res);
        setConnected((current) => ({ ...current, cults3d: res.configured }));
        setExpired((current) => ({ ...current, cults3d: res.expired }));
      })
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
    if (SHARED.has(id) && !isAdmin) return t(`providers.${id}.adminOnly`);
    return null;
  };

  /** Saves a credential, or removes it with null. Cults3D's takes its API key as `secondary`, its nickname as `value`. */
  const save = async (id: ProviderId, value: string | null, secondary?: string) => {
    if (id === "makerworld") {
      const result = await settingsApi.updateMakerworld(value);
      onUpdateMakerWorld({ cookie: value ?? "" });
      setConnected((current) => ({ ...current, makerworld: result.configured }));
      setExpired((current) => ({ ...current, makerworld: false }));
    } else if (id === "thingiverse") {
      const result = await settingsApi.updateThingiverse(value);
      setConnected((current) => ({ ...current, thingiverse: result.configured }));
    } else if (id === "myminifactory") {
      const result = await settingsApi.updateMyminifactorySession(value);
      setConnected((current) => ({ ...current, myminifactory: result.configured }));
      setExpired((current) => ({ ...current, myminifactory: false }));
    } else if (id === "snapmaker") {
      const result = await settingsApi.updateSnapmakerSession(value);
      setConnected((current) => ({ ...current, snapmaker: result.configured }));
      setExpired((current) => ({ ...current, snapmaker: false }));
    } else if (id === "makeronline") {
      const result = await settingsApi.updateMakeronlineSession(value);
      setConnected((current) => ({ ...current, makeronline: result.configured }));
      setExpired((current) => ({ ...current, makeronline: false }));
    } else if (id === "crealitycloud") {
      const result = await settingsApi.updateCrealitycloudSession(value);
      setConnected((current) => ({ ...current, crealitycloud: result.configured }));
      setExpired((current) => ({ ...current, crealitycloud: false }));
    } else if (id === "nexprint") {
      const result = await settingsApi.updateNexprintSession(value);
      setConnected((current) => ({ ...current, nexprint: result.configured }));
      setExpired((current) => ({ ...current, nexprint: false }));
    } else if (id === "thangs") {
      const result = await settingsApi.updateThangsSession(value);
      setConnected((current) => ({ ...current, thangs: result.configured }));
      setExpired((current) => ({ ...current, thangs: false }));
    } else if (id === "cults3d") {
      if (value === null) {
        // Forgets the browser's sign-in too: disconnecting means Thingport has nothing of the account left.
        await settingsApi.updateCults3dSession(null);
        await settingsApi.updateCults3d(null);
      } else {
        await settingsApi.updateCults3d({ nick: value, apiKey: secondary ?? "" });
      }
      const res = await settingsApi.getCults3d();
      setCults3d(res);
      setConnected((current) => ({ ...current, cults3d: res.configured }));
      setExpired((current) => ({ ...current, cults3d: res.expired }));
    }
  };

  const saveCults3dSignIn = async (value: string) => {
    await settingsApi.updateCults3dSession(value);
    setCults3d(await settingsApi.getCults3d());
  };

  const startConnect = (id: ProviderId) => {
    setError(null);
    setNotice(null);
    setPastingCults3dSignIn(false);
    setConnecting(id);
  };

  // Double-click or Enter: connects a disconnected site, or says why this one can't be.
  const activate = (id: ProviderId) => {
    if (isComingSoon(id)) return;
    const locked = lockedReason(id);
    if (locked) {
      setConnecting(null);
      setNotice(locked);
    } else if (connected[id] === false || isExpired(id)) {
      startConnect(id);
    }
  };

  const disconnect = async (id: ProviderId) => {
    const name = nameOf(id);
    const ok = await confirm({
      title: t("providers.disconnectTitle", { name }),
      message: SHARED.has(id)
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
  const menuExpired = menuId ? isExpired(menuId) : false;
  const menuLocked = menuId ? lockedReason(menuId) : null;

  return (
    <>
      <PanelHeader title={t("providers.title")} subtitle={t("providers.subtitle")} />
      <AppGrid>
        {PROVIDERS.filter(({ id }) => !disabledProviders.has(id as ImportProvider)).map(({ id, name }) => {
          const isConnected = Boolean(connected[id]);
          const locked = lockedReason(id);
          const tileExpired = isExpired(id);
          // Cults3D's files also need the browser's sign-in: connected without it is half connected.
          const cults3dMissing =
            id === "cults3d" && isConnected && !tileExpired ? cults3dStatus(cults3d, t) : undefined;
          const status = connected[id] === null ? null : isConnected && !tileExpired && !cults3dMissing;
          const tooltip = isComingSoon(id)
            ? t("providers.comingSoon")
            : cults3dMissing
              ? cults3dMissing
              : tileExpired
                ? t(`providers.${id}.expired`)
                : SHARED.has(id) && locked && !isConnected
                  ? locked
                  : isConnected
                    ? t("providers.connected")
                    : isSessionProvider(id) && id !== "makerworld"
                      ? t(`providers.${id}.notConnected`)
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
              ariaLabel={`${name}: ${tileExpired ? t(`providers.${id}.expired`) : isConnected ? t("providers.connected") : t("providers.notConnected")}`}
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
                  ? t(`providers.${menuId}.expiredStatus`)
                  : menuId === "cults3d" && menuConnected && !cults3dReady(cults3d)
                    ? t("providers.cults3d.siteMissingStatus")
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
        {menuId === "cults3d" && menuConnected && !menuExpired && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              setError(null);
              setNotice(null);
              setConnecting(null);
              setPastingCults3dSignIn(true);
            }}
          >
            <ListItemIcon>
              <ContentPasteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("providers.cults3d.session.paste")}</ListItemText>
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
          onConnect={async (value, secondary) => {
            await save(connecting, value, secondary);
            setConnecting(null);
          }}
          onUnauthorized={onUnauthorized}
        />
      )}
      {pastingCults3dSignIn && !connecting && (
        <ConnectBox
          key="cults3d-session"
          id="cults3d"
          mode="session"
          name={nameOf("cults3d")}
          onCancel={() => setPastingCults3dSignIn(false)}
          onConnect={async (value) => {
            await saveCults3dSignIn(value);
            setPastingCults3dSignIn(false);
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
  /** "session": Cults3D's browser sign-in, pasted, rather than its API key. */
  mode?: "account" | "session";
  name: string;
  onCancel: () => void;
  /** `secondary` is the second field's, where there is one: Cults3D's API key. */
  onConnect: (value: string, secondary?: string) => Promise<void>;
  onUnauthorized?: () => void;
};

function ConnectBox({ id, mode = "account", name, onCancel, onConnect, onUnauthorized }: ConnectBoxProps) {
  const { t } = useTranslation(["app", "common"]);
  const [draft, setDraft] = React.useState("");
  const [secondary, setSecondary] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const session = mode === "session";
  // Cults3D's API wants two things: the user's nickname and an API key.
  const twoFields = id === "cults3d" && !session;
  const keyPrefix = session ? `providers.${id}.session` : `providers.${id}`;
  const steps = t(`${keyPrefix}.steps`, { returnObjects: true }) as string[];
  // MakerWorld's cookie is long; Creality Cloud's sign-in may be pasted as two copied request headers, Thangs' as a
  // whole Cookie header, Cults3D's browser sign-in as a request's copied headers.
  const multiline = id === "makerworld" || id === "crealitycloud" || id === "thangs" || session;
  const ready = Boolean(draft.trim()) && (!twoFields || Boolean(secondary.trim()));
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  // It opens below the icons, often past the bottom of the panel.
  React.useEffect(() => {
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const submit = async () => {
    const value = draft.trim();
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await onConnect(value, twoFields ? secondary.trim() : undefined);
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
          {session ? t("providers.cults3d.session.title") : t("providers.connectTitle", { name })}
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
      {SHARED.has(id) && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
          {t(`providers.${id}.shared`)}
        </Typography>
      )}
      <TextField
        fullWidth
        multiline={multiline}
        minRows={multiline ? 3 : undefined}
        size="small"
        label={twoFields ? t("providers.cults3d.nickLabel") : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (!multiline && e.key === "Enter") void submit();
        }}
        placeholder={t(`${keyPrefix}.placeholder`)}
        disabled={saving}
        autoComplete="off"
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      {twoFields && (
        <TextField
          fullWidth
          size="small"
          type="password"
          label={t("providers.cults3d.keyLabel")}
          value={secondary}
          onChange={(e) => setSecondary(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          disabled={saving}
          autoComplete="off"
          sx={{ mt: 1.5 }}
        />
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button size="small" variant="contained" onClick={() => void submit()} disabled={saving || !ready}>
          {saving ? t("providers.connecting") : session ? t("providers.cults3d.session.save") : t("providers.connect")}
        </Button>
        <Button size="small" onClick={onCancel} disabled={saving}>
          {t("common:cancel")}
        </Button>
      </Stack>
    </Box>
  );
}
