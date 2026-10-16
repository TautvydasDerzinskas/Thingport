import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
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
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import { useGravatarUrl } from "../../hooks/useGravatarUrl";
import { settingsApi } from "../../api/settings";
import { useDisabledProviders } from "../../hooks/useDisabledProviders";

type ServiceChipDef = {
  key: "makerworld" | "thingiverse" | "printables";
  label: string;
  color: string;
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

/** Identity, quick settings and import-provider connection chips. Connection status comes from the
 *  backend, not localStorage, which may disagree with the DB. */
export function UserMenu({ user, onOpenConfiguration, onOpenProfile, onLogout }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const navigate = useNavigate();
  const avatarUrl = useGravatarUrl(user?.email, 128);
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [makerworldConfigured, setMakerworldConfigured] = React.useState(false);
  const [makerworldExpired, setMakerworldExpired] = React.useState(false);
  const [thingiverseConfigured, setThingiverseConfigured] = React.useState(false);

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
  ];
  // Turned off by an admin: no chip, and with none left, no row.
  const services = allServices.filter((service) => !disabledProviders.has(service.key));

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
        {services.length > 0 && [
          <Divider key="divider" />,
          <Box key="services" sx={{ px: 2, py: 1.25, display: "flex", gap: 0.75 }}>
            {services.map((svc) => (
              <ButtonBase
                key={svc.key}
                onClick={() => {
                  closeMenu();
                  onOpenConfiguration("providers");
                }}
                title={
                  svc.connected
                    ? t("userMenu.serviceConnected", { service: svc.label })
                    : (svc.disabledReason ?? t("userMenu.serviceNotConnected", { service: svc.label }))
                }
                sx={{
                  px: 1,
                  py: 0.375,
                  borderRadius: 1,
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 1.4,
                  whiteSpace: "nowrap",
                  color: "#fff",
                  // Grey rather than dimmed so the two states are unmistakable.
                  bgcolor: svc.connected ? svc.color : "grey.500",
                  opacity: svc.connected ? 1 : 0.5,
                  transition: "filter 150ms",
                  "&:hover": { filter: "brightness(1.1)" },
                }}
              >
                {svc.label}
              </ButtonBase>
            ))}
          </Box>,
        ]}
      </Menu>
    </>
  );
}
