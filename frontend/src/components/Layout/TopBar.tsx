import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MenuIcon from "@mui/icons-material/Menu";
import type { AuthUser } from "../../api/auth";
import type { ThemeSelection } from "../../constants/settingsOptions";
import {
  notifyConfigurationClosed,
  onOpenConfiguration,
  takeConfigurationParam,
} from "../../utils/configurationEvents";
import AddMenu, { type AddMenuHandle } from "./AddMenu";
import ConfigurationDialog, { type ConfigurationTab } from "./ConfigurationDialog";
import NotificationBell from "./NotificationBell";
import { UserMenu } from "./UserMenu";
import GlobalSearch from "./GlobalSearch";

type Props = {
  onMenuClick?: () => void;
  menuOpen?: boolean;
  title: string;
  /** The entity kind, shown under the title so a long name gets the full line. */
  subtitle?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  categoryId: string | null;
  onUploaded: () => void;
  onUnauthorized?: () => void;
  user: AuthUser | null;
  theme: ThemeSelection;
  onThemeChange: (theme: ThemeSelection) => Promise<boolean>;
  onOpenProfile: () => void;
  onLogout: () => void;
};

/** Wraps route actions on narrow screens; the shell supplies a menu trigger only when navigation is modal. */
export default function TopBar({
  onMenuClick,
  menuOpen,
  title,
  subtitle,
  onBack,
  actions,
  categoryId,
  onUploaded,
  onUnauthorized,
  user,
  theme,
  onThemeChange,
  onOpenProfile,
  onLogout,
}: Props) {
  const { t } = useTranslation("app");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<AddMenuHandle | null>(null);
  const [configTab, setConfigTab] = useState<ConfigurationTab | null>(null);

  useEffect(() => onOpenConfiguration(setConfigTab), []);
  // Arriving with `?configuration=<tab>`, as from the homepage view's search.
  useEffect(() => {
    const tab = takeConfigurationParam();
    if (tab) setConfigTab(tab);
  }, []);

  // Publishes the bar's real height (it can wrap) as a CSS var for sticky elements below it.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => document.documentElement.style.setProperty("--topbar-height", `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Box
      ref={rootRef}
      sx={{
        display: "flex",
        // Narrow: every button stays on the first row and only the title drops to a second one of its
        // own, centred -- so a long name ellipsises in its own space instead of crowding the buttons.
        flexWrap: { xs: "wrap", md: "nowrap" },
        alignItems: "center",
        columnGap: 1,
        rowGap: 1,
        // Padding rather than margin so the spacing is part of the pinned, painted box.
        pt: 2,
        pb: 2,
        // Sticky needs an opaque background matching the shell, or content shows through.
        position: "sticky",
        top: 0,
        zIndex: (muiTheme) => muiTheme.zIndex.appBar,
        bgcolor: (muiTheme) => muiTheme.thingport.pageBackground,
      }}
    >
      {onMenuClick && (
        <IconButton
          aria-label={t("sidebar.openNavigation")}
          aria-expanded={Boolean(menuOpen)}
          onClick={onMenuClick}
          // The shell only passes a trigger when navigation is modal, which is the narrow layout.
          sx={{ display: { xs: "inline-flex", md: "none" }, width: 44, height: 44, flexShrink: 0 }}
        >
          <MenuIcon />
        </IconButton>
      )}
      {onBack && (
        <Tooltip title={t("shell.backToLibrary")}>
          <IconButton size="small" onClick={onBack} sx={{ flexShrink: 0 }}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {/* minWidth: 0 overrides the flex item default of `min-width: auto` -- without it, this box
          refuses to shrink below its content's natural width, which would push the tools off the
          edge well before the window actually runs out of room. Narrow, the full width is what
          breaks the title onto its own row, and `order` puts it after the buttons rather than
          between them. Wide, it takes only its own width, so the page's actions stay beside the
          title rather than drifting over to the app's tools. */}
      <Box
        sx={{
          minWidth: 0,
          order: { xs: 1, md: 0 },
          width: { xs: "100%", md: "auto" },
          flex: { md: "0 1 auto" },
          textAlign: { xs: "center", md: "left" },
        }}
      >
        <Typography variant="h6" fontWeight={700} noWrap>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" noWrap sx={{ display: "block", mt: "-4px", color: "text.secondary" }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions}
      <Stack direction="row" alignItems="center" spacing={0.75} minWidth={0} sx={{ ml: "auto", flexShrink: 0 }}>
        <GlobalSearch
          onUnauthorized={onUnauthorized}
          theme={theme}
          onThemeChange={onThemeChange}
          onLogout={onLogout}
          onImport={(link) => addMenuRef.current?.importFromCommand(link)}
          onOpenConfiguration={setConfigTab}
          isAdmin={user?.role === "ADMIN"}
        />
        <AddMenu ref={addMenuRef} categoryId={categoryId} onUploaded={onUploaded} onUnauthorized={onUnauthorized} />
        <NotificationBell />
        <UserMenu user={user} onOpenConfiguration={setConfigTab} onOpenProfile={onOpenProfile} onLogout={onLogout} />
      </Stack>
      <ConfigurationDialog
        open={configTab}
        onClose={() => {
          setConfigTab(null);
          notifyConfigurationClosed();
        }}
        theme={theme}
        onThemeChange={onThemeChange}
        isAdmin={user?.role === "ADMIN"}
        onUnauthorized={onUnauthorized}
      />
    </Box>
  );
}
