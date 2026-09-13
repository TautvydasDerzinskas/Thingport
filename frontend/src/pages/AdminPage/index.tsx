import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import SettingsIcon from "@mui/icons-material/Settings";
import PeopleIcon from "@mui/icons-material/People";
import HistoryIcon from "@mui/icons-material/History";
import BoltIcon from "@mui/icons-material/Bolt";
import CableIcon from "@mui/icons-material/Cable";
import UpdateCheckSection from "./UpdateCheckSection";

type Section = {
  path: string;
  icon: React.ReactNode;
  labelKey: string;
};

const SECTIONS: Section[] = [
  { path: "/admin-settings", icon: <SettingsIcon fontSize="small" />, labelKey: "common:settings" },
  { path: "/admin-users", icon: <PeopleIcon fontSize="small" />, labelKey: "adminSettings.users.heading" },
  { path: "/admin-logs", icon: <HistoryIcon fontSize="small" />, labelKey: "adminSettings.logs.heading" },
  { path: "/admin-triggers", icon: <BoltIcon fontSize="small" />, labelKey: "adminSettings.triggers.heading" },
  { path: "/admin-connections", icon: <CableIcon fontSize="small" />, labelKey: "adminSettings.connections.heading" },
];

type Props = {
  onUnauthorized?: () => void;
};

/** The Administration hub -- the sidebar now links here instead of listing every admin sub-page
 *  itself (see Sidebar's doc comment). Each row just navigates to that sub-page's own route;
 *  those pages' own back buttons return here (see AppLayout's useRouteChrome), and this page's
 *  own back button goes to the Dashboard, same as every other top-level page reachable directly
 *  from the sidebar (Models, Collections, Tags, Downloads). Update Checker lives here (not on
 *  AdminSettingsPage) since it's a hub-level status, not a per-instance setting. */
export default function AdminPage({ onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const navigate = useNavigate();

  return (
    <Stack spacing={3} sx={{ maxWidth: 480 }}>
      <UpdateCheckSection onUnauthorized={onUnauthorized} />
      <Paper
        variant="outlined"
        sx={{
          borderRadius: "12px",
          borderColor: (theme) => (theme.palette.mode === "dark" ? "transparent" : "divider"),
        }}
      >
        <List disablePadding>
          {SECTIONS.map((section, idx) => (
            <ListItemButton
              key={section.path}
              onClick={() => navigate(section.path)}
              divider={idx < SECTIONS.length - 1}
              sx={{ py: 1.5 }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{section.icon}</ListItemIcon>
              <ListItemText primary={t(section.labelKey)} primaryTypographyProps={{ variant: "body2", fontWeight: 600 }} />
              <ChevronRightIcon fontSize="small" sx={{ color: "text.disabled" }} />
            </ListItemButton>
          ))}
        </List>
      </Paper>
    </Stack>
  );
}
