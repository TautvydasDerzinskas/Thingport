import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import BoltIcon from "@mui/icons-material/Bolt";
import CableIcon from "@mui/icons-material/Cable";
import HistoryIcon from "@mui/icons-material/History";
import PeopleIcon from "@mui/icons-material/People";
import QueueIcon from "@mui/icons-material/Queue";
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
  { path: "/admin-ai", icon: <AutoAwesomeIcon fontSize="small" />, labelKey: "adminSettings.ai.heading" },
  { path: "/admin-users", icon: <PeopleIcon fontSize="small" />, labelKey: "adminSettings.users.heading" },
  { path: "/admin-queue", icon: <QueueIcon fontSize="small" />, labelKey: "adminSettings.importQueue.heading" },
  { path: "/admin-logs", icon: <HistoryIcon fontSize="small" />, labelKey: "adminSettings.logs.heading" },
  { path: "/admin-triggers", icon: <BoltIcon fontSize="small" />, labelKey: "adminSettings.triggers.heading" },
  { path: "/admin-connections", icon: <CableIcon fontSize="small" />, labelKey: "adminSettings.connections.heading" },
  { path: "/admin-captcha", icon: <VerifiedUserIcon fontSize="small" />, labelKey: "adminSettings.captcha.heading" },
];
