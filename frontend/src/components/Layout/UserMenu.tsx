import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import PersonIcon from "@mui/icons-material/Person";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import type { AuthUser } from "../../api/auth";
import type { ConfigurationTab } from "./ConfigurationDialog";
import { IMPORT_PROVIDER_INFO } from "../../constants/importProviders";
import { COMING_SOON_PROVIDERS, ProviderLogo, type ProviderId } from "./ConfigurationDialog/providerLogos";
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import { useGravatarUrl } from "../../hooks/useGravatarUrl";
import { settingsApi, type Cults3dSettings } from "../../api/settings";
import { cults3dReady, cults3dStatus } from "./ConfigurationDialog/cults3dStatus";
import { useDisabledProviders } from "../../hooks/useDisabledProviders";

type ServiceChipDef = {
  key:
    | "makerworld"
    | "thingiverse"
    | "printables"
    | "myminifactory"
    | "snapmaker"
    | "makeronline"
    | "crealitycloud"
    | "nexprint"
    | "thangs"
    | "cults3d";
  label: string;
  connected: boolean;
  /** Explains what's missing when not connected. */
  disabledReason?: string;
};

type Props = {
  user: AuthUser | null;
  onOpenConfiguration: (tab: ConfigurationTab) => void;
  onOpenProfile: () => void;
  onLogout: () => void;
};

/** Identity, quick settings and import-provider connection icons. Connection status comes from the
 *  backend, not localStorage, which may disagree with the DB. */
export function UserMenu({ user, onOpenConfiguration, onOpenProfile, onLogout }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const navigate = useNavigate();
  const avatarUrl = useGravatarUrl(user?.email, 128);
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [makerworldConfigured, setMakerworldConfigured] = React.useState(false);
  const [makerworldExpired, setMakerworldExpired] = React.useState(false);
  const [thingiverseConfigured, setThingiverseConfigured] = React.useState(false);
  const [myminifactoryConfigured, setMyminifactoryConfigured] = React.useState(false);
  const [snapmakerConfigured, setSnapmakerConfigured] = React.useState(false);
  const [snapmakerExpired, setSnapmakerExpired] = React.useState(false);
  const [makeronlineConfigured, setMakeronlineConfigured] = React.useState(false);
  const [makeronlineExpired, setMakeronlineExpired] = React.useState(false);
  const [crealitycloudConfigured, setCrealitycloudConfigured] = React.useState(false);
  const [crealitycloudExpired, setCrealitycloudExpired] = React.useState(false);
  const [nexprintConfigured, setNexprintConfigured] = React.useState(false);
  const [nexprintExpired, setNexprintExpired] = React.useState(false);
  const [thangsConfigured, setThangsConfigured] = React.useState(false);
  const [thangsExpired, setThangsExpired] = React.useState(false);
  const [cults3d, setCults3d] = React.useState<Cults3dSettings | null>(null);

  const menuOpen = Boolean(anchorEl);
  // Checked on every open: the cookie can change in Configuration while the menu stays mounted.
  React.useEffect(() => {
    if (!menuOpen) return;
    let active = true;
    settingsApi
      .getMakerworld()
      .then((res) => {
        if (!active) return;
        setMakerworldConfigured(res.configured);
        setMakerworldExpired(res.expired);
      })
      .catch(() => undefined);
    settingsApi
      .getThingiverse()
      .then((res) => {
        if (active) setThingiverseConfigured(res.configured);
      })
      .catch(() => undefined);
    settingsApi
      .getMyminifactory()
      .then((res) => {
        if (active) setMyminifactoryConfigured(res.configured);
      })
      .catch(() => undefined);
    settingsApi
      .getSnapmakerSession()
      .then((res) => {
        if (!active) return;
        setSnapmakerConfigured(res.configured);
        setSnapmakerExpired(res.expired);
      })
      .catch(() => undefined);
    settingsApi
      .getMakeronlineSession()
      .then((res) => {
        if (!active) return;
        setMakeronlineConfigured(res.configured);
        setMakeronlineExpired(res.expired);
      })
      .catch(() => undefined);
    settingsApi
      .getCrealitycloudSession()
      .then((res) => {
        if (!active) return;
        setCrealitycloudConfigured(res.configured);
        setCrealitycloudExpired(res.expired);
      })
      .catch(() => undefined);
    settingsApi
      .getNexprintSession()
      .then((res) => {
        if (!active) return;
        setNexprintConfigured(res.configured);
        setNexprintExpired(res.expired);
      })
      .catch(() => undefined);
    settingsApi
      .getThangsSession()
      .then((res) => {
        if (!active) return;
        setThangsConfigured(res.configured);
        setThangsExpired(res.expired);
      })
      .catch(() => undefined);
    settingsApi
      .getCults3d()
      .then((res) => active && setCults3d(res))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [menuOpen]);

  const closeMenu = () => setAnchorEl(null);
  const disabledProviders = useDisabledProviders();

  const allServices: ServiceChipDef[] = [
    {
      key: "makerworld",
      ...IMPORT_PROVIDER_INFO.makerworld,
      connected: makerworldConfigured && !makerworldExpired,
      disabledReason: makerworldExpired ? t("providers.makerworld.expired") : t("userMenu.makerworldDisabledReason"),
    },
    {
      key: "thingiverse",
      ...IMPORT_PROVIDER_INFO.thingiverse,
      connected: thingiverseConfigured,
      disabledReason: t("userMenu.thingiverseDisabledReason"),
    },
    // Printables' public API needs no configuration.
    { key: "printables", ...IMPORT_PROVIDER_INFO.printables, connected: true },
    {
      key: "myminifactory",
      ...IMPORT_PROVIDER_INFO.myminifactory,
      connected: myminifactoryConfigured,
      disabledReason: t("userMenu.myminifactoryDisabledReason"),
    },
    {
      key: "snapmaker",
      ...IMPORT_PROVIDER_INFO.snapmaker,
      connected: snapmakerConfigured && !snapmakerExpired,
      disabledReason: snapmakerExpired ? t("providers.snapmaker.expired") : t("userMenu.snapmakerDisabledReason"),
    },
    {
      key: "makeronline",
      ...IMPORT_PROVIDER_INFO.makeronline,
      connected: makeronlineConfigured && !makeronlineExpired,
      disabledReason: makeronlineExpired ? t("providers.makeronline.expired") : t("userMenu.makeronlineDisabledReason"),
    },
    {
      key: "crealitycloud",
      ...IMPORT_PROVIDER_INFO.crealitycloud,
      connected: crealitycloudConfigured && !crealitycloudExpired,
      disabledReason: crealitycloudExpired
        ? t("providers.crealitycloud.expired")
        : t("userMenu.crealitycloudDisabledReason"),
    },
    {
      key: "nexprint",
      ...IMPORT_PROVIDER_INFO.nexprint,
      connected: nexprintConfigured && !nexprintExpired,
      disabledReason: nexprintExpired ? t("providers.nexprint.expired") : t("userMenu.nexprintDisabledReason"),
    },
    {
      key: "thangs",
      ...IMPORT_PROVIDER_INFO.thangs,
      connected: thangsConfigured && !thangsExpired,
      disabledReason: thangsExpired ? t("providers.thangs.expired") : t("userMenu.thangsDisabledReason"),
    },
    {
      key: "cults3d",
      ...IMPORT_PROVIDER_INFO.cults3d,
      // Downloads need both: the API key, and the browser's sign-in Grab sends.
      connected: cults3dReady(cults3d),
      disabledReason: cults3dStatus(cults3d, t),
    },
  ];
  // Turned off by an admin: no icon. Coming-soon sites follow the live ones.
  const services: { id: ProviderId; label: string; connected: boolean; tooltip: string }[] = [
    ...allServices
      .filter((service) => !disabledProviders.has(service.key))
      .map((svc) => ({
        id: svc.key,
        label: svc.label,
        connected: svc.connected,
        tooltip: svc.connected
          ? t("userMenu.serviceConnected", { service: svc.label })
          : (svc.disabledReason ?? t("userMenu.serviceNotConnected", { service: svc.label })),
      })),
    ...COMING_SOON_PROVIDERS.map(({ id, name }) => ({
      id,
      label: name,
      connected: false,
      tooltip: `${name}: ${t("providers.comingSoon")}`,
    })),
  ];

  return (
    <>
      <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
        <Avatar
          alt={user?.display_name}
          src={avatarUrl}
          sx={{ width: 32, height: 32, bgcolor: "primary.main", fontSize: 13 }}
        >
          {user?.display_name?.[0]?.toUpperCase()}
        </Avatar>
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ pl: 2, pr: 1, py: 1.25, minWidth: 220, display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography
              variant="body2"
              fontWeight={600}
              noWrap
              sx={{ color: (muiTheme) => muiTheme.thingport.headingText }}
            >
              {user?.display_name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {user?.email}
            </Typography>
          </Box>
          <Tooltip title={t("common:logOut")}>
            <IconButton
              size="small"
              onClick={() => {
                closeMenu();
                onLogout();
              }}
            >
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            closeMenu();
            onOpenProfile();
          }}
        >
          <ListItemIcon>
            <PersonIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("profile.title")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            navigate(`/authors/${SELF_AUTHOR_ID}`);
          }}
        >
          <ListItemIcon>
            <ViewInArIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("userMenu.myModels")}</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu();
            onOpenConfiguration("appearance");
          }}
        >
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("configuration.title")}</ListItemText>
        </MenuItem>
        <Divider />
        <Box sx={{ px: 1.5, py: 1, display: "flex", flexWrap: "wrap", gap: 0.5, maxWidth: 260 }}>
          {services.map((svc) => (
            <Tooltip key={svc.id} title={svc.tooltip}>
              <IconButton
                size="small"
                aria-label={svc.tooltip}
                onClick={() => {
                  closeMenu();
                  onOpenConfiguration("providers");
                }}
                sx={{
                  p: 0.625,
                  // Greyed out so connected logos stand out at a glance.
                  "& svg": {
                    filter: svc.connected ? "none" : "grayscale(1)",
                    opacity: svc.connected ? 1 : 0.4,
                    transition: "filter 150ms, opacity 150ms",
                  },
                  "&:hover svg, &:focus-visible svg": { opacity: svc.connected ? 1 : 0.7 },
                }}
              >
                <ProviderLogo id={svc.id} size={18} />
              </IconButton>
            </Tooltip>
          ))}
        </Box>
      </Menu>
    </>
  );
}
