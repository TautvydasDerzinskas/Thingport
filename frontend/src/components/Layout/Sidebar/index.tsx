import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { useTheme, type Theme } from "@mui/material/styles";
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
import Paper from "@mui/material/Paper";
import SpaceDashboardIcon from "@mui/icons-material/SpaceDashboard";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import CollectionsIcon from "@mui/icons-material/Collections";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import DownloadIcon from "@mui/icons-material/Download";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Wordmark from "../../Wordmark";
import BrandMark from "../../BrandMark";
import { type BookmarkEntry, bookmarksApi } from "../../../api/bookmarks";

const SIDEBAR_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 72;
const SIDEBAR_COLLAPSED_STORAGE_KEY = "thingport_sidebar_collapsed";

export function navRowSx(selected: boolean) {
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
          // Dark mode: brighten the label instead of tinting the background on hover.
          "&:hover": (theme: Theme) =>
            theme.palette.mode === "dark"
              ? { backgroundColor: "transparent", color: "#fff", "& .MuiListItemIcon-root": { color: "#fff" } }
              : {},
        }),
  };
}

export function CollapsedNavIcon({
  icon,
  label,
  selected,
  onClick,
}: {
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
        <ListItemIcon sx={{ minWidth: 0 }}>{icon}</ListItemIcon>
      </ListItemButton>
    </Tooltip>
  );
}

type Props = {
  isAdmin: boolean;
  onSelectCategory: (id: string | null) => void;
  /** Bumped when a bookmark changes elsewhere, to refetch the list. */
  bookmarksVersion?: number;
};

function bookmarkTarget(entry: BookmarkEntry): { href: string; label: string } {
  return entry.type === "tag"
    ? { href: `/models/tags/${encodeURIComponent(entry.tag)}`, label: entry.tag }
    : { href: `/models/collections/${entry.collection_id}`, label: entry.name };
}

// A click that ends a drag (pointer or Space key) must not also navigate.
const POST_DRAG_CLICK_GUARD_MS = 250;

/** The whole row drags; a few pixels of travel tell a drag from a click. */
function SortableBookmarkRow({
  id,
  label,
  selected,
  onNavigate,
}: {
  id: string;
  label: string;
  selected: boolean;
  onNavigate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <ListItemButton
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      selected={selected}
      onClick={onNavigate}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      sx={{
        borderRadius: 1,
        mb: 0.5,
        cursor: "grab",
        touchAction: "none",
        // The DragOverlay shows the dragged row; this one stays as a faint placeholder.
        opacity: isDragging ? 0.4 : 1,
        ...navRowSx(selected),
      }}
    >
      <ListItemIcon sx={{ minWidth: 30 }}>
        <BookmarkIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText primary={label} primaryTypographyProps={{ variant: "body2", noWrap: true }} />
      <DragIndicatorIcon fontSize="small" sx={{ ml: "auto", flexShrink: 0, color: "text.disabled" }} />
    </ListItemButton>
  );
}

export default function Sidebar({ isAdmin, onSelectCategory, bookmarksVersion }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const location = useLocation();
  const navigate = useNavigate();
  const muiTheme = useTheme();
  const [collapsedByUser, setCollapsedByUser] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  });
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const suppressClickRef = useRef(false);
  const endDrag = () => {
    setDraggingId(null);
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, POST_DRAG_CLICK_GUARD_MS);
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Space only: Enter keeps opening the bookmark.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  useEffect(() => {
    let cancelled = false;
    bookmarksApi
      .list()
      .then((entries) => {
        if (!cancelled) setBookmarks(entries);
      })
      .catch(() => {
        /* non-critical nav aid -- swallow and leave the list as-is */
      });
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [bookmarksVersion]);

  // Optimistic reorder; a failed save refetches the server's order.
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    endDrag();
    if (!over || active.id === over.id) return;
    const from = bookmarks.findIndex((b) => b.id === active.id);
    const to = bookmarks.findIndex((b) => b.id === over.id);
    if (from === -1 || to === -1) return;
    const next = arrayMove(bookmarks, from, to);
    setBookmarks(next);
    bookmarksApi.reorder(next.map((b) => b.id)).catch(() => {
      bookmarksApi
        .list()
        .then(setBookmarks)
        .catch(() => {
          /* leave the optimistic order as-is */
        });
    });
  };

  const navigateUnlessDragged = (href: string) => {
    if (draggingId || suppressClickRef.current) return;
    navigate(href);
  };

  const draggingBookmark = draggingId ? bookmarks.find((b) => b.id === draggingId) : undefined;

  const onDashboard = location.pathname === "/";
  const onCollections = location.pathname.startsWith("/models/collections");
  const onTags = location.pathname.startsWith("/models/tags");
  const onModels =
    (location.pathname.startsWith("/models") && !onCollections && !onTags) || location.pathname.startsWith("/authors");
  const onDownload = location.pathname.startsWith("/downloads");
  const onAdmin = location.pathname.startsWith("/admin");
  // Administration opens its own menu beside this one, so this one folds to icons there, whatever the user chose.
  const collapsed = collapsedByUser || onAdmin;

  const toggleCollapsed = () => {
    setCollapsedByUser((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const currentWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  // Always lands on the unfiltered grid, unlike the in-page back button.
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
            <Wordmark size="lg" seasonal />
          </Link>
        )}
        {onAdmin ? (
          // Folded for administration, there's nothing to unfold: the mark leads home instead.
          <Tooltip title={t("sidebar.dashboard")} placement="right">
            <Link
              component={RouterLink}
              to="/"
              aria-label={t("sidebar.dashboard")}
              sx={{ display: "flex", alignItems: "center", lineHeight: 0, p: 0.5 }}
            >
              <BrandMark theme={muiTheme.palette.mode} size="md" />
            </Link>
          </Tooltip>
        ) : (
          <Tooltip title={collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}>
            <IconButton size="small" onClick={toggleCollapsed}>
              {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
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
            <ListItemButton
              selected={onDashboard}
              onClick={() => navigate("/")}
              sx={{ borderRadius: 1, mb: 0.5, ...navRowSx(onDashboard) }}
            >
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
              {collapsed ? (
                bookmarks.map((entry) => {
                  const { href, label } = bookmarkTarget(entry);
                  return (
                    <CollapsedNavIcon
                      key={entry.id}
                      icon={<BookmarkIcon fontSize="small" />}
                      label={label}
                      selected={location.pathname === href}
                      onClick={() => navigate(href)}
                    />
                  );
                })
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={({ active }) => setDraggingId(String(active.id))}
                  onDragEnd={handleDragEnd}
                  onDragCancel={endDrag}
                >
                  <SortableContext items={bookmarks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                    {bookmarks.map((entry) => {
                      const { href, label } = bookmarkTarget(entry);
                      return (
                        <SortableBookmarkRow
                          key={entry.id}
                          id={entry.id}
                          label={label}
                          selected={location.pathname === href}
                          onNavigate={() => navigateUnlessDragged(href)}
                        />
                      );
                    })}
                  </SortableContext>
                  <DragOverlay>
                    {draggingBookmark && (
                      <Paper
                        elevation={6}
                        sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, cursor: "grabbing" }}
                      >
                        <BookmarkIcon fontSize="small" />
                        <Typography variant="body2" noWrap>
                          {bookmarkTarget(draggingBookmark).label}
                        </Typography>
                      </Paper>
                    )}
                  </DragOverlay>
                </DndContext>
              )}
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
