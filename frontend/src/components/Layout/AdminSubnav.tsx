import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import { ADMIN_SECTIONS } from "../../constants/adminSections";
import { dividerBorderColor } from "../../theme";
import { CollapsedNavIcon, navRowSx, SIDEBAR_COLLAPSED_WIDTH } from "./Sidebar";

const WIDTH = 220;
const COLLAPSED_STORAGE_KEY = "thingport_admin_nav_collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Administration's own pages, in a second column beside the sidebar while one of them is open. The sidebar folds to
 * icons meanwhile, so this one has the collapse button; folded, it's an icon rail too.
 */
export default function AdminSubnav() {
  const { t } = useTranslation(["app", "common"]);
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const pages = [
    { path: "/admin", icon: <DashboardOutlinedIcon fontSize="small" />, label: t("sidebar.adminOverview") },
    ...ADMIN_SECTIONS.map((section) => ({ path: section.path, icon: section.icon, label: t(section.labelKey) })),
  ];

  const toggle = () =>
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // Storage blocked: it just won't be remembered.
      }
      return next;
    });

  return (
    <Box
      component="nav"
      aria-label={t("sidebar.administration")}
      sx={{
        width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : WIDTH,
        flexShrink: 0,
        height: "100vh",
        position: "sticky",
        top: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid",
        borderColor: dividerBorderColor,
        bgcolor: (theme) => theme.thingport.subnavBackground,
        overflowX: "hidden",
        overflowY: "auto",
        transition: (theme) => theme.transitions.create("width", { duration: theme.transitions.duration.shortest }),
      }}
    >
      {/* As tall as the folded sidebar's logo row beside it, so both columns' lists start level. */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent={collapsed ? "center" : "space-between"}
        sx={{ px: collapsed ? 1 : 2, pt: "20px", pb: "20px", minHeight: 72 }}
      >
        {!collapsed && (
          <Typography variant="subtitle2" fontWeight={700} noWrap>
            {t("sidebar.administration")}
          </Typography>
        )}
        <Tooltip title={collapsed ? t("sidebar.expandAdminMenu") : t("sidebar.collapseAdminMenu")}>
          <IconButton size="small" onClick={toggle} aria-expanded={!collapsed}>
            {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>
      <List disablePadding sx={{ px: collapsed ? 0.5 : 1 }}>
        {pages.map((page) => {
          // The overview only on itself; each page also on anything under it.
          const selected =
            page.path === "/admin" ? location.pathname === "/admin" : location.pathname.startsWith(page.path);
          return collapsed ? (
            <CollapsedNavIcon
              key={page.path}
              icon={page.icon}
              label={page.label}
              selected={selected}
              onClick={() => navigate(page.path)}
            />
          ) : (
            <ListItemButton
              key={page.path}
              selected={selected}
              onClick={() => navigate(page.path)}
              aria-current={selected ? "page" : undefined}
              sx={{ borderRadius: 1, mb: 0.5, ...navRowSx(selected) }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>{page.icon}</ListItemIcon>
              <ListItemText primary={page.label} primaryTypographyProps={{ variant: "body2" }} />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
