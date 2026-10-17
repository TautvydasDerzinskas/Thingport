import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import type { AuthUser } from "../../api/auth";
import type { ThemeSelection } from "../../constants/settingsOptions";
import type { MakerWorldSettings } from "../../utils/settings";
import { notifyConfigurationClosed, onOpenConfiguration } from "../../utils/configurationEvents";
import AddMenu, { type AddMenuHandle } from "./AddMenu";
import ConfigurationDialog, { type ConfigurationTab } from "./ConfigurationDialog";
import NotificationBell from "./NotificationBell";
import { UserMenu } from "./UserMenu";
import GlobalSearch from "./GlobalSearch";

type Props = {
  title: string;
  /** The entity kind, shown under the title so a long name gets the full line. */
  subtitle?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  categoryId: string | null;
  makerworldCookie: string;
  onUpdateMakerWorld: (patch: Partial<MakerWorldSettings>) => void;
  onUploaded: () => void;
  onUnauthorized?: () => void;
  user: AuthUser | null;
  theme: ThemeSelection;
  onThemeChange: (theme: ThemeSelection) => void;
  onOpenProfile: () => void;
  onLogout: () => void;
};

/** A grid with equal `1fr` side columns keeps the search box centered however wide the sides are. */
export default function TopBar({
  title,
  subtitle,
  onBack,
  actions,
  categoryId,
  makerworldCookie,
  onUpdateMakerWorld,
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
        display: "grid",
        gridTemplateColumns: "1fr minmax(0, 360px) 1fr",
        alignItems: "center",
        gap: 1.5,
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
      {/* minWidth: 0 overrides the grid item default of `min-width: auto` -- without it, this
          column refuses to shrink below its content's natural width (the title, mainly), which
          would push the center/right columns off `justify-content` center/right well before the
          window actually runs out of room. */}
      <Stack direction="row" alignItems="center" spacing={1} minWidth={0}>
        {onBack && (
          <Tooltip title={t("shell.backToLibrary")}>
            <IconButton size="small" onClick={onBack}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Box sx={{ minWidth: 0 }}>
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
      </Stack>
      <Box sx={{ minWidth: 0, justifySelf: "center", width: "100%" }}>
        <GlobalSearch
          onUnauthorized={onUnauthorized}
          theme={theme}
          onThemeChange={onThemeChange}
          onLogout={onLogout}
          onImport={(link) => addMenuRef.current?.importFromCommand(link)}
          onOpenConfiguration={setConfigTab}
          isAdmin={user?.role === "ADMIN"}
        />
      </Box>
      <Stack direction="row" alignItems="center" spacing={1} minWidth={0} justifySelf="end">
        <AddMenu
          ref={addMenuRef}
          categoryId={categoryId}
          makerworldCookie={makerworldCookie}
          onUploaded={onUploaded}
          onUnauthorized={onUnauthorized}
        />
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
        makerworldCookie={makerworldCookie}
        onUpdateMakerWorld={onUpdateMakerWorld}
        onUnauthorized={onUnauthorized}
      />
    </Box>
  );
}
