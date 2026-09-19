import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import type { Theme } from "@mui/material/styles";
import { dividerBorderColor } from "../../../theme";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import CollectionsIcon from "@mui/icons-material/Collections";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import DownloadIcon from "@mui/icons-material/Download";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Wordmark from "../../Wordmark";
import { type BookmarkEntry, bookmarksApi } from "../../../api/bookmarks";

const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED_WIDTH = 72;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "thingport_sidebar_collapsed";

/** Shared color/background logic for every nav row (both the expanded ListItemButton and the
 *  collapsed icon-only variant below) -- selected rows get the theme's nav-selected background
 *  (a flat tint in light mode, a left-to-right gradient in dark) and text/icon color, unselected
 *  ones get the theme's dedicated (narrower-than-text.secondary) inactive nav color. */
function navRowSx(selected: boolean) {
  const color = (theme: Theme) => (selected ? theme.thingport.selectedNavText : theme.thingport.navInactiveText);
  return {
    color,
    "& .MuiListItemIcon-root": { color },
    ...(selected
      ? {
          background: (theme: Theme) => theme.thingport.selectedNavBackground,
          "&.Mui-selected, &.Mui-selected:hover": {
            background: (theme: Theme) => theme.thingport.selectedNavBackground,
          },
        }
      : {
          // Dark mode only: hovering an inactive row shouldn't tint its background (unlike
          // MUI's own default hover overlay, which light mode still gets, unchanged) -- just
          // brighten the label/icon to white. Returning {} for light leaves that default alone.
          "&:hover": (theme: Theme) =>
            theme.palette.mode === "dark"
              ? { backgroundColor: "transparent", color: "#fff", "& .MuiListItemIcon-root": { color: "#fff" } }
              : {},
        }),
  };
}

/** Icon-only rail row used for every nav item once the sidebar is collapsed -- a tooltip stands
 *  in for the label. */
function CollapsedNavIcon({ icon, label, selected, onClick }: {
  icon: React.ReactNode;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={label} placement="right">
      <ListItemButton
        selected={selected}
        onClick={onClick}
        sx={{ borderRadius: 1, mb: 0.5, justifyContent: "center", px: 0, ...navRowSx(selected) }}
      >
        <ListItemIcon sx={{ minWidth: 0 }}>
          {icon}
        </ListItemIcon>
      </ListItemButton>
    </Tooltip>
  );
}

type Props = {
  isAdmin: boolean;
  onSelectCategory: (id: string | null) => void;
  /** Bumped whenever a tag or collection is bookmarked/unbookmarked elsewhere (the Tags/
   *  Collections list pages, or a tag/collection detail page's title-row toggle) so the
   *  quick-access list below refetches without needing a full remount -- same shape as
   *  ModelsPage's categoriesVersion/onCategoriesChanged. */
  bookmarksVersion?: number;
};

/** Where a bookmark entry navigates to, and its display label -- tags and collections share one
 *  ordered list (see BookmarkEntry) but differ in both. */
function bookmarkTarget(entry: BookmarkEntry): { href: string; label: string } {
  return entry.type === "tag"
    ? { href: `/models/tags/${encodeURIComponent(entry.tag)}`, label: entry.tag }
    : { href: `/models/collections/${entry.collection_id}`, label: entry.name };
}

/** The persistent app-wide navigation rail: Dashboard, Models, Collections, Tags, Downloads, then
 *  (once any tag or collection is bookmarked) a divider, a "Bookmarks" heading, and one row per
 *  bookmark -- tags and collections interleaved, in the user's own manual order (drag a row up or
 *  down to reorder; see handleDrop) -- and finally (for admins) a single "Administration" row --
 *  it's just a link to the /admin hub page now, not an expandable list of every admin sub-page
 *  (see AdminPage). Category browsing lives inside the Models page itself, not here. */
export default function Sidebar({ isAdmin, onSelectCategory, bookmarksVersion }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  });
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  // The bookmark id currently being dragged, if any -- set on that row's dragstart, read by every
  // other row's drop handler, cleared once the gesture ends (drop, or a drag that's cancelled).
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    bookmarksApi.list()
      .then(entries => { if (!cancelled) setBookmarks(entries); })
      .catch(() => { /* non-critical nav aid -- swallow and leave the list as-is */ });
    return () => { cancelled = true; };
    // bookmarksVersion is a deliberate refetch trigger, not read inside the effect itself.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [bookmarksVersion]);

  // Drops `draggedId` immediately before/after `targetId` (wherever it lands in the array once
  // moved next to it) -- applied optimistically so the row jumps right away, then persisted via
  // POST /bookmarks/reorder; a failed save just refetches the server's own order rather than
  // trying to roll back the local splice by hand.
  const handleDrop = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setBookmarks(prev => {
      const from = prev.findIndex(b => b.id === draggedId);
      const to = prev.findIndex(b => b.id === targetId);
      if (from === -1 || to === -1) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      bookmarksApi.reorder(next.map(b => b.id)).catch(() => {
        bookmarksApi.list().then(setBookmarks).catch(() => { /* leave the optimistic order as-is */ });
      });
      return next;
    });
  };

  const onDashboard = location.pathname === "/";
  const onCollections = location.pathname.startsWith("/models/collections");
  const onTags = location.pathname.startsWith("/models/tags");
  const onModels = (location.pathname.startsWith("/models") && !onCollections && !onTags) || location.pathname.startsWith("/authors");
  const onDownload = location.pathname.startsWith("/downloads");
  // Covers both the hub itself (/admin) and every sub-page (/admin-settings, /admin-users, ...)
  // as a plain string-prefix match -- they're only ever reached from that hub now, not listed
  // individually here any more, so one flag is all this row needs.
  const onAdmin = location.pathname.startsWith("/admin");

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const currentWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  // Always lands on the unfiltered grid, even if a category was selected the last time Models
  // was open -- unlike the in-page back button, which keeps the filter (see useRouteChrome).
  const goToModelsRoot = () => {
    onSelectCategory(null);
    navigate("/models");
  };

  return (
    <Box
      component="aside"
      sx={{
        width: currentWidth,
        flexShrink: 0,
        height: "100vh",
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid",
        borderColor: dividerBorderColor,
        bgcolor: "background.paper",
        overflow: "hidden",
        transition: (theme) => theme.transitions.create("width", { duration: theme.transitions.duration.shortest }),
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent={collapsed ? "center" : "space-between"}
        sx={{ px: collapsed ? 1 : 2, pt: "20px", pb: "20px" }}
      >
        {!collapsed && (
          <Link
            component={RouterLink}
            to="/"
            aria-label={t("sidebar.dashboard")}
            sx={{ display: "flex", alignItems: "center", lineHeight: 0 }}
          >
            <Wordmark size="lg" />
          </Link>
        )}
        <Tooltip title={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}>
          <IconButton size="small" onClick={toggleCollapsed}>
            {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>

      <Box component="nav" sx={{ flex: 1, overflow: "auto", px: collapsed ? 0.5 : 1 }}>
        <List disablePadding>
          {collapsed ? (
            <CollapsedNavIcon
              icon={<SpaceDashboardIcon fontSize="small" />}
              label={t("sidebar.dashboard")}
              selected={onDashboard}
              onClick={() => navigate("/")}
            />
          ) : (
            <ListItemButton selected={onDashboard} onClick={() => navigate("/")} sx={{ borderRadius: 1, mb: 0.5, ...navRowSx(onDashboard) }}>
              <ListItemIcon sx={{ minWidth: 30 }}>
                <SpaceDashboardIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t("sidebar.dashboard")} primaryTypographyProps={{ variant: "body2" }} />
            </ListItemButton>
          )}

          {collapsed ? (
            <CollapsedNavIcon
              icon={<ViewInArIcon fontSize="small" />}
              label={t("sidebar.models")}
              selected={onModels}
              onClick={goToModelsRoot}
            />
          ) : (
            <ListItemButton
              selected={onModels}
              onClick={goToModelsRoot}
              sx={{ borderRadius: 1, mb: 0.5, ...navRowSx(onModels) }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <ViewInArIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t("sidebar.models")} primaryTypographyProps={{ variant: "body2" }} />
            </ListItemButton>
          )}

          {collapsed ? (
            <CollapsedNavIcon
              icon={<CollectionsIcon fontSize="small" />}
              label={t("sidebar.collections")}
              selected={onCollections}
              onClick={() => navigate("/models/collections")}
            />
          ) : (
            <ListItemButton
              selected={onCollections}
              onClick={() => navigate("/models/collections")}
              sx={{ borderRadius: 1, mb: 0.5, ...navRowSx(onCollections) }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <CollectionsIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t("sidebar.collections")} primaryTypographyProps={{ variant: "body2" }} />
            </ListItemButton>
          )}

          {collapsed ? (
            <CollapsedNavIcon
              icon={<LocalOfferIcon fontSize="small" />}
              label={t("sidebar.tags")}
              selected={onTags && location.pathname === "/models/tags"}
              onClick={() => navigate("/models/tags")}
            />
          ) : (
            <ListItemButton
              selected={onTags && location.pathname === "/models/tags"}
              onClick={() => navigate("/models/tags")}
              sx={{ borderRadius: 1, mb: 0.5, ...navRowSx(onTags && location.pathname === "/models/tags") }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <LocalOfferIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t("sidebar.tags")} primaryTypographyProps={{ variant: "body2" }} />
            </ListItemButton>
          )}

          {collapsed ? (
            <CollapsedNavIcon
              icon={<DownloadIcon fontSize="small" />}
              label={t("sidebar.downloads")}
              selected={onDownload}
              onClick={() => navigate("/downloads")}
            />
          ) : (
            <ListItemButton
              selected={onDownload}
              onClick={() => navigate("/downloads")}
              sx={{ borderRadius: 1, mb: 0.5, ...navRowSx(onDownload) }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <DownloadIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t("sidebar.downloads")} primaryTypographyProps={{ variant: "body2" }} />
            </ListItemButton>
          )}

          {/* Bookmarked tags + collections, interleaved in the user's own manual order -- only
              once any exist, so an empty section never shows just a bare divider with nothing
              under it. The "Bookmarks" label is a plain heading (nothing to click), so it's
              skipped entirely while collapsed rather than rendered as dead space -- unlike every
              row above, the collapsed rail has no way to show it at all. Dragging is only wired
              up while expanded too: the collapsed rail is icon-only, with no room for a
              meaningful drag target. */}
          {bookmarks.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              {!collapsed && (
                <Typography
                  variant="caption"
                  fontWeight={700}
                  sx={{ display: "block", px: 1.5, mb: 0.5, color: (theme) => theme.thingport.navInactiveText }}
                >
                  {t("sidebar.bookmarks")}
                </Typography>
              )}
              {bookmarks.map(entry => {
                const { href, label } = bookmarkTarget(entry);
                const selected = location.pathname === href;
                return collapsed ? (
                  <CollapsedNavIcon
                    key={entry.id}
                    icon={<BookmarkIcon fontSize="small" />}
                    label={label}
                    selected={selected}
                    onClick={() => navigate(href)}
                  />
                ) : (
                  <ListItemButton
                    key={entry.id}
                    draggable
                    onDragStart={() => setDraggingId(entry.id)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      if (draggingId) handleDrop(draggingId, entry.id);
                      setDraggingId(null);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    selected={selected}
                    onClick={() => navigate(href)}
                    sx={{ borderRadius: 1, mb: 0.5, cursor: "grab", ...navRowSx(selected) }}
                  >
                    <ListItemIcon sx={{ minWidth: 30 }}>
                      <BookmarkIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={label} primaryTypographyProps={{ variant: "body2", noWrap: true }} />
                  </ListItemButton>
                );
              })}
            </>
          )}

          {isAdmin && (
            <>
              <Divider sx={{ my: 1 }} />
              {collapsed ? (
                <CollapsedNavIcon
                  icon={<AdminPanelSettingsIcon fontSize="small" />}
                  label={t("sidebar.administration")}
                  selected={onAdmin}
                  onClick={() => navigate("/admin")}
                />
              ) : (
                <ListItemButton
                  selected={onAdmin}
                  onClick={() => navigate("/admin")}
                  sx={{ borderRadius: 1, mb: 0.5, ...navRowSx(onAdmin) }}
                >
                  <ListItemIcon sx={{ minWidth: 30 }}>
                    <AdminPanelSettingsIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={t("sidebar.administration")} primaryTypographyProps={{ variant: "body2" }} />
                </ListItemButton>
              )}
            </>
          )}
        </List>
      </Box>
    </Box>
  );
}
