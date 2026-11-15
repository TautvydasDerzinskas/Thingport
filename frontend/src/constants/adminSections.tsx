import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CableIcon from "@mui/icons-material/Cable";
import DashboardCustomizeOutlinedIcon from "@mui/icons-material/DashboardCustomizeOutlined";
import Diversity3OutlinedIcon from "@mui/icons-material/Diversity3Outlined";
import DriveFileMoveOutlinedIcon from "@mui/icons-material/DriveFileMoveOutlined";
import HandymanOutlinedIcon from "@mui/icons-material/HandymanOutlined";
import HistoryIcon from "@mui/icons-material/History";
import PeopleIcon from "@mui/icons-material/People";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PublicIcon from "@mui/icons-material/Public";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import ViewInArIcon from "@mui/icons-material/ViewInAr";

export type AdminSection = {
  path: string;
  icon: React.ReactNode;
  labelKey: string;
};

/** Administration's pages, under its entry in the sidebar; /admin itself is the overview. */
export const ADMIN_SECTIONS: AdminSection[] = [
  { path: "/admin-providers", icon: <PublicIcon fontSize="small" />, labelKey: "adminSettings.providers.heading" },
  {
    path: "/admin-storage",
    icon: <FolderOutlinedIcon fontSize="small" />,
    labelKey: "adminSettings.storageSettings.heading",
  },
  { path: "/admin-auth", icon: <LockOutlinedIcon fontSize="small" />, labelKey: "adminSettings.auth.heading" },
  { path: "/admin-rendering", icon: <ViewInArIcon fontSize="small" />, labelKey: "adminSettings.rendering.heading" },
  {
    path: "/admin-dashboard",
    icon: <DashboardCustomizeOutlinedIcon fontSize="small" />,
    labelKey: "adminSettings.dashboard.heading",
  },
  { path: "/admin-tools", icon: <HandymanOutlinedIcon fontSize="small" />, labelKey: "adminSettings.tools.heading" },
  { path: "/admin-ai", icon: <AutoAwesomeIcon fontSize="small" />, labelKey: "adminSettings.ai.heading" },
  { path: "/admin-users", icon: <PeopleIcon fontSize="small" />, labelKey: "adminSettings.users.heading" },
  // Not a Share icon: social-widget filter lists (Fanboy's, in uBlock Origin and Brave) hide every small MUI icon
  // named Share*.
  {
    path: "/admin-social",
    icon: <Diversity3OutlinedIcon fontSize="small" />,
    labelKey: "adminSettings.social.heading",
  },
  { path: "/admin-logs", icon: <HistoryIcon fontSize="small" />, labelKey: "adminSettings.logs.heading" },
  { path: "/admin-connections", icon: <CableIcon fontSize="small" />, labelKey: "adminSettings.connections.heading" },
  { path: "/admin-captcha", icon: <VerifiedUserIcon fontSize="small" />, labelKey: "adminSettings.captcha.heading" },
  {
    path: "/admin-migrate",
    icon: <DriveFileMoveOutlinedIcon fontSize="small" />,
    labelKey: "adminSettings.migrate.heading",
  },
];
