import React, { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import type { AuthUser } from "../../api/auth";
import type { ThemeSelection } from "../../constants/settingsOptions";
import AddMenu from "./AddMenu";
import NotificationBell from "./NotificationBell";
import { UserMenu } from "./UserMenu";
import GlobalSearch from "./GlobalSearch";

type Props = {
  title: string;
  /** Shown smaller, under the title -- the entity kind ("Collection", "Tag", "Model") for a
   *  detail page, kept off the title's own line so a long name gets the full line's width
   *  instead of sharing it with a "Collection: " prefix (see PageHeaderContext). */
  subtitle?: string;
  onBack?: () => void;
  /** Slot for page-specific actions next to the title (an overflow "more" menu, etc.) --
   *  nothing currently populates it, but the header supports it the same way it will once a
   *  page needs one. */
  actions?: React.ReactNode;
  categoryId: string | null;
  makerworldCookie: string;
  onUploaded: () => void;
  onUnauthorized?: () => void;
  user: AuthUser | null;
  theme: ThemeSelection;
  onThemeChange: (theme: ThemeSelection) => void;
  onOpenProfile: () => void;
  onLogout: () => void;
};

/** The persistent header row above the active view's content: an optional back button + title
 *  (+ page actions) on the left, the global search box truly centered in the middle (a CSS grid
 *  with two equal `1fr` side columns, not just "whatever's left between the other two" -- the
 *  left/right clusters are very different widths depending on the page, and only a grid keeps the
 *  middle column centered on the bar as a whole regardless), and the global Add/Notifications/User
 *  cluster on the right. */
export default function TopBar({
  title,
  subtitle,
  onBack,
  actions,
  categoryId,
  makerworldCookie,
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

  // Publishes this bar's real rendered height (it can wrap to two lines on narrow widths, so a
  // guessed constant would drift) as a CSS var on the document root -- any sticky element further
  // down the page (currently just ModelSidePanel) reads it to stick just below the bar instead of
  // guessing a fixed offset and ending up stuck underneath it once both are pinned at once.
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
        // Capped at 360px (3/4 of the original 480px) -- on narrower laptop screens the title
        // column doesn't have enough room left to share with a still-wide search box before a
        // long collection/tag/model name has to ellipsize hard.
        gridTemplateColumns: "1fr minmax(0, 360px) 1fr",
        alignItems: "center",
        gap: 1.5,
        // Both of these used to live on `main` (pt) / as this bar's own margin (mb) -- moved to
        // padding on this box itself so they're part of what's actually pinned. As margin/an
        // ancestor's padding, that space isn't covered by this bar's own background, so it either
        // visibly disappeared once scrolling clipped it out from under `main`'s padding (the top
        // one) or left a seam between this bar and the content below it that isn't really "this
        // bar" (the bottom one) -- padding keeps both included in its own painted, sticky box.
        pt: 2,
        pb: 2,
        // Pinned to the top of the window (the app scrolls at that level, not inside `main` --
        // see AppLayout's own comment on why overflow was removed from main) so the title, back
        // button, and the Add/Notifications/User cluster stay reachable no matter how far a long
        // page (e.g. the model detail page's sticky side panel) gets scrolled. Needs its own
        // opaque background, exactly matching the shell's, or scrolled content would show through
        // behind it instead of being covered.
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
          <Typography variant="h6" fontWeight={700} noWrap>{title}</Typography>
          {subtitle && (
            <Typography variant="caption" noWrap sx={{ display: "block", mt: "-4px", color: "text.secondary" }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions}
      </Stack>
      <Box sx={{ minWidth: 0, justifySelf: "center", width: "100%" }}>
        <GlobalSearch onUnauthorized={onUnauthorized} />
      </Box>
      <Stack direction="row" alignItems="center" spacing={1} minWidth={0} justifySelf="end">
        <AddMenu
          categoryId={categoryId}
          makerworldCookie={makerworldCookie}
          onUploaded={onUploaded}
          onUnauthorized={onUnauthorized}
        />
        <NotificationBell />
        <UserMenu
          user={user}
          theme={theme}
          onThemeChange={onThemeChange}
          onOpenProfile={onOpenProfile}
          onLogout={onLogout}
        />
      </Stack>
    </Box>
  );
}
