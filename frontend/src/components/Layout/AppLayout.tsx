import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ThemeProvider, type Theme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Sidebar from "./Sidebar";
import AdminSubnav from "./AdminSubnav";
import TopBar from "./TopBar";
import ImportProgressBar from "./ImportProgressBar";
import AiRunProgressBar from "./AiRunProgressBar";
import StorageMoveProgressBar from "./StorageMoveProgressBar";
import { StorageMoveProvider } from "./StorageMoveContext";
import BackToTopButton from "./BackToTopButton";
import { ConfirmProvider } from "../ConfirmProvider";
import { ToastProvider } from "../ToastProvider";
import { PageHeaderContext, type PageHeader } from "./PageHeaderContext";
import { NavigationHistoryProvider, useSmartBack } from "./NavigationHistoryContext";
import { ImportJobProvider } from "./ImportJobContext";
import { AiRunProvider } from "./AiRunContext";
import { NotificationsProvider, useNotifications } from "./NotificationsContext";
import type { ThemeSelection } from "../../constants/settingsOptions";
import type { AuthUser } from "../../api/auth";
import type { MakerWorldSettings } from "../../utils/settings";

type AppLayoutProps = {
  muiTheme: Theme;
  /** The raw persisted choice, which may be "system". */
  themeSelection: ThemeSelection;
  apiUp: boolean | null;
  categoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  onPrintsChanged: () => void;
  bookmarksVersion: number;
  onUnauthorized: () => void;
  isAdmin: boolean;
  onOpenProfile: () => void;
  onLogout: () => void;
  makerworldCookie: string;
  onUpdateMakerWorld: (patch: Partial<MakerWorldSettings>) => void;
  user: AuthUser | null;
  onThemeChange: (theme: ThemeSelection) => void;
  children: React.ReactNode;
};

/** Title and default back destination per route. Most routes go back in history; Models and
 *  Collections go to a fixed page. Pages can override via usePageHeader's `onBack`. */
function useRouteChrome() {
  const { t } = useTranslation(["app", "models", "common"]);
  const location = useLocation();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const path = location.pathname;

  let title = t("sidebar.dashboard");
  let subtitle: string | undefined;
  let onBack: (() => void) | undefined;
  if (path === "/") {
    title = t("sidebar.dashboard");
  } else if (path === "/models/collections") {
    title = t("models:collections.pageTitle");
    onBack = () => navigate("/");
  } else if (path.startsWith("/models/collections/")) {
    title = t("models:collections.pageTitle");
    onBack = goBack;
  } else if (path === "/models/tags") {
    title = t("models:tags.pageTitle");
    onBack = () => navigate("/");
  } else if (path.startsWith("/models/tags/")) {
    // Set from the URL directly to avoid a "Models" title flash.
    const tagName = path.slice("/models/tags/".length);
    if (tagName) {
      title = t("models:tags.detail.title", { name: decodeURIComponent(tagName) });
      subtitle = t("models:tags.detail.subtitle");
    } else {
      title = t("models:pageTitle");
    }
    onBack = goBack;
  } else if (path.startsWith("/models/")) {
    title = t("models:pageTitle");
    onBack = goBack;
  } else if (path === "/models") {
    title = t("models:pageTitle");
    onBack = () => navigate("/");
  } else if (path.startsWith("/authors/")) {
    title = t("models:author.pageTitle");
    onBack = goBack;
  } else if (path === "/profile/email") {
    title = t("profile.changeEmailTitle");
    onBack = () => navigate("/profile");
  } else if (path === "/profile/password") {
    title = t("profile.changePasswordTitle");
    onBack = () => navigate("/profile");
  } else if (path === "/profile") {
    title = t("profile.title");
    onBack = goBack;
  } else if (path === "/notifications") {
    title = t("notifications.label");
    onBack = goBack;
  } else if (path === "/connect-grab") {
    title = "Thingport Grab";
  } else if (path === "/downloads") {
    title = t("sidebar.downloads");
    onBack = () => navigate("/");
  } else if (path === "/admin") {
    title = t("sidebar.administration");
    onBack = () => navigate("/");
  } else if (path.startsWith("/admin-providers")) {
    title = t("adminSettings.providers.heading");
    onBack = () => navigate("/admin");
  } else if (path.startsWith("/admin-storage")) {
    title = t("adminSettings.storageSettings.heading");
    onBack = () => navigate("/admin");
  } else if (path.startsWith("/admin-auth")) {
    title = t("adminSettings.auth.heading");
    onBack = () => navigate("/admin");
  } else if (path.startsWith("/admin-rendering")) {
    title = t("adminSettings.rendering.heading");
    onBack = () => navigate("/admin");
  } else if (path.startsWith("/admin-ai")) {
    title = t("adminSettings.ai.heading");
    onBack = () => navigate("/admin");
  } else if (path.startsWith("/admin-users")) {
    title = t("adminSettings.users.heading");
    onBack = () => navigate("/admin");
  } else if (path.startsWith("/admin-queue")) {
    title = t("adminSettings.importQueue.heading");
    onBack = () => navigate("/admin");
  } else if (path.startsWith("/admin-logs")) {
    title = t("adminSettings.logs.heading");
    onBack = () => navigate("/admin");
  } else if (path.startsWith("/admin-triggers")) {
    title = t("adminSettings.triggers.heading");
    onBack = () => navigate("/admin");
  } else if (path.startsWith("/admin-connections")) {
    title = t("adminSettings.connections.heading");
    onBack = () => navigate("/admin");
  } else if (path.startsWith("/admin-captcha")) {
    title = t("adminSettings.captcha.heading");
    onBack = () => navigate("/admin");
  }

  return { title, subtitle, onBack };
}

type ShellProps = Omit<AppLayoutProps, "muiTheme">;

/** Split out because it needs useNotifications(), which only works below AppLayout's provider. */
function AppLayoutShell({
  themeSelection,
  apiUp,
  categoryId,
  onSelectCategory,
  onPrintsChanged,
  bookmarksVersion,
  onUnauthorized,
  isAdmin,
  onOpenProfile,
  onLogout,
  makerworldCookie,
  onUpdateMakerWorld,
  user,
  onThemeChange,
  children,
}: ShellProps) {
  const { t } = useTranslation(["app", "common"]);
  const { title: routeTitle, subtitle: routeSubtitle, onBack: routeOnBack } = useRouteChrome();
  const { pathname } = useLocation();
  const [pageHeader, setPageHeader] = React.useState<PageHeader>(null);
  const { refresh: refreshNotifications } = useNotifications();

  const handleJobCompleted = React.useCallback(() => {
    onPrintsChanged();
    void refreshNotifications();
  }, [onPrintsChanged, refreshNotifications]);

  return (
    <ImportJobProvider onUnauthorized={onUnauthorized} onJobCompleted={handleJobCompleted}>
      <AiRunProvider onUnauthorized={onUnauthorized} onRunFinished={handleJobCompleted}>
        <StorageMoveProvider isAdmin={isAdmin} onUnauthorized={onUnauthorized}>
          <Box
            sx={{
              background: (theme) => theme.thingport.pageBackground,
              minHeight: "100vh",
              display: "flex",
            }}
          >
            <Sidebar isAdmin={isAdmin} onSelectCategory={onSelectCategory} bookmarksVersion={bookmarksVersion} />
            {isAdmin && pathname.startsWith("/admin") && <AdminSubnav />}
            <Box component="main" sx={{ flex: 1, minWidth: 0, p: 2, pt: 0 }}>
              {apiUp === false && (
                <Alert severity="error" sx={{ mb: 1.5 }}>
                  {t("shell.apiUnreachable")}
                </Alert>
              )}
              <TopBar
                title={pageHeader?.title || routeTitle}
                subtitle={pageHeader?.subtitle ?? routeSubtitle}
                onBack={pageHeader?.onBack ?? routeOnBack}
                actions={pageHeader?.actions}
                categoryId={categoryId}
                makerworldCookie={makerworldCookie}
                onUpdateMakerWorld={onUpdateMakerWorld}
                onUploaded={onPrintsChanged}
                onUnauthorized={onUnauthorized}
                user={user}
                theme={themeSelection}
                onThemeChange={onThemeChange}
                onOpenProfile={onOpenProfile}
                onLogout={onLogout}
              />
              <PageHeaderContext.Provider value={setPageHeader}>{children}</PageHeaderContext.Provider>
            </Box>
          </Box>
          {/* Several can run at once, so they stack here rather than each pinning itself to the bottom. Under
            dialogs and their backdrop, like the top bar. */}
          <Box sx={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: (theme) => theme.zIndex.appBar }}>
            <AiRunProgressBar kind="categorization" />
            <AiRunProgressBar kind="descriptions" />
            <ImportProgressBar />
            <StorageMoveProgressBar />
          </Box>
          <BackToTopButton />
        </StorageMoveProvider>
      </AiRunProvider>
    </ImportJobProvider>
  );
}

export default function AppLayout({ muiTheme, onUnauthorized, ...shellProps }: AppLayoutProps) {
  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <NavigationHistoryProvider>
        <ConfirmProvider>
          <ToastProvider>
            <NotificationsProvider onUnauthorized={onUnauthorized}>
              <AppLayoutShell onUnauthorized={onUnauthorized} {...shellProps} />
            </NotificationsProvider>
          </ToastProvider>
        </ConfirmProvider>
      </NavigationHistoryProvider>
    </ThemeProvider>
  );
}
