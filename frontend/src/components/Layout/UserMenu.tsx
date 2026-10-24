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
import { COMING_SOON_PROVIDERS, ProviderLogo, type ProviderId } from "./ConfigurationDialog/providerLogos";
import { SELF_AUTHOR_ID } from "../../constants/selfAuthor";
import { useGravatarUrl } from "../../hooks/useGravatarUrl";
import type { ProviderState } from "../../api/providers";
import { refreshProviders, useProviders } from "../../hooks/useProviders";
import { MANIFESTS } from "../../providers/_generated";
import { PROVIDER_UI, providerReady } from "../../providers/overrides";

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
  const providers = useProviders();

  const menuOpen = Boolean(anchorEl);
  // Asked again on every open: a sign-in can change in Configuration, or come from Thingport Grab, meanwhile.
  React.useEffect(() => {
    if (menuOpen) void refreshProviders().catch(() => undefined);
  }, [menuOpen]);

  const closeMenu = () => setAnchorEl(null);

  /** Why its imports don't work yet. */
  const notReadyReason = (state: ProviderState) => {
    const status = state.slots.default?.status;
    if (status === "expired") return t(`providers:${state.id}.status.expired`);
    if (status === "connected") {
      const missing = PROVIDER_UI[state.id]?.missing?.(state, t);
      if (missing) return missing.tooltip;
    }
    return t(`providers:${state.id}.status.disabledReason`);
  };

  // Turned off by an admin: no icon. Coming-soon sites follow the live ones.
  const services: { id: ProviderId; label: string; connected: boolean; tooltip: string }[] = [
    ...(providers ?? [])
      .filter((state) => state.enabled)
      .map((state) => {
        const label = MANIFESTS[state.id].name;
        const connected = providerReady(state);
        return {
          id: state.id,
          label,
          connected,
          tooltip: connected ? t("userMenu.serviceConnected", { service: label }) : notReadyReason(state),
        };
      }),
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
