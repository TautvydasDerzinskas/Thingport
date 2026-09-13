import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ThemeProvider, type Theme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import ImportProgressBar from "./ImportProgressBar";
import BackToTopButton from "./BackToTopButton";
import { ConfirmProvider } from "../ConfirmProvider";
import { ToastProvider } from "../ToastProvider";
import { PageHeaderContext, type PageHeader } from "./PageHeaderContext";
import { NavigationHistoryProvider, useSmartBack } from "./NavigationHistoryContext";
import { ImportJobProvider } from "./ImportJobContext";
import { NotificationsProvider, useNotifications } from "./NotificationsContext";
import type { ThemeSelection } from "../../constants/settingsOptions";
import type { AuthUser } from "../../api/auth";

type AppLayoutProps = {
  muiTheme: Theme;
  /** The user's raw persisted choice (light/dark/system), for UserMenu's theme submenu to show
   *  which one is checked -- NOT the resolved light/dark palette, which lives in muiTheme
   *  instead and has already collapsed "system" into a concrete value by this point. */
  themeSelection: ThemeSelection;
  apiUp: boolean | null;
  categoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  onPrintsChanged: () => void;
  tagBookmarksVersion: number;
  onUnauthorized: () => void;
  isAdmin: boolean;
  onOpenProfile: () => void;
  onLogout: () => void;
  makerworldCookie: string;
  user: AuthUser | null;
  onThemeChange: (theme: ThemeSelection) => void;
  children: React.ReactNode;
};

/** Derives the header title + default back-button destination from the current route -- there's
 *  no per-route config table beyond this since the set of routes is small and each is distinct
 *  chrome-wise. Most routes just retrace browser history (wherever the user drilled in from);
 *  the two top-level list routes (Models, Collections) instead go to a fixed destination since
 *  they're reachable directly from the sidebar with no meaningful "came from" page. A page can
 *  still override this default via usePageHeader's `onBack` -- see ModelsPage, whose back
 *  button clears an active category filter instead of leaving the page while one's selected. */
function useRouteChrome() {
  const { t } = useTranslation(["app", "models", "common"]);
  const location = useLocation();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const path = location.pathname;

  let title = t("sidebar.dashboard");
  let onBack: (() => void) | undefined;
  if (path === "/") {
    title = t("sidebar.dashboard");
  } else if (path === "/models/collections") {
    title = t("models:collections.pageTitle");
    onBack = () => navigate("/");
  } else if (path.startsWith("/models/collections/")) {
    // Overridden by CollectionDetailPage's usePageHeader once the collection loads.
    title = t("models:collections.pageTitle");
    onBack = goBack;
  } else if (path === "/models/tags") {
    title = t("models:tags.pageTitle");
    onBack = () => navigate("/");
  } else if (path.startsWith("/models/tags/")) {
    // The tag name is already known from the URL (unlike a collection, a tag isn't a fetched
    // entity), so this is set directly rather than waiting on TagDetailPage's usePageHeader --
    // avoids a "Models" title flash before that effect runs.
    const tagName = path.slice("/models/tags/".length);
    title = tagName ? t("models:tags.detail.title", { name: decodeURIComponent(tagName) }) : t("models:pageTitle");
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
  } else if (path === "/downloads") {
    // Overridden by DownloadPage's usePageHeader once translations resolve.
    title = t("sidebar.downloads");
    onBack = () => navigate("/");
  } else if (path.startsWith("/admin-settings")) {
    title = t("adminSettings.pageTitle");
    onBack = () => navigate("/");
  } else if (path.startsWith("/admin-users")) {
    title = t("adminSettings.users.heading");
    onBack = () => navigate("/");
  } else if (path.startsWith("/admin-logs")) {
    title = t("adminSettings.logs.heading");
    onBack = () => navigate("/");
  } else if (path.startsWith("/admin-triggers")) {
    title = t("adminSettings.triggers.heading");
    onBack = () => navigate("/");
  } else if (path.startsWith("/admin-connections")) {
    title = t("adminSettings.connections.heading");
    onBack = () => navigate("/");
  }

  return { title, onBack };
}

type ShellProps = Omit<AppLayoutProps, "muiTheme">;

/** Sits inside both NotificationsProvider and ImportJobProvider so it can wire a finished
 *  import job to a grid refresh + notification refresh, then renders the actual shell chrome.
 *  Split out from AppLayout because that wiring needs useNotifications(), which only works
 *  below the provider AppLayout itself renders. */
function AppLayoutShell({
  themeSelection,
  apiUp,
  categoryId,
  onSelectCategory,
  onPrintsChanged,
  tagBookmarksVersion,
  onUnauthorized,
  isAdmin,
  onOpenProfile,
  onLogout,
  makerworldCookie,
  user,
  onThemeChange,
  children,
}: ShellProps) {
  const { t } = useTranslation(["app", "common"]);
  const { title: routeTitle, onBack: routeOnBack } = useRouteChrome();
  const [pageHeader, setPageHeader] = React.useState<PageHeader>(null);
  const { refresh: refreshNotifications } = useNotifications();

  const handleJobCompleted = React.useCallback(() => {
    onPrintsChanged();
    void refreshNotifications();
  }, [onPrintsChanged, refreshNotifications]);

  return (
    <ImportJobProvider onUnauthorized={onUnauthorized} onJobCompleted={handleJobCompleted}>
      <Box
        sx={{
          background: (theme) => theme.thingport.pageBackground,
          minHeight: "100vh",
          display: "flex",
        }}
      >
        <Sidebar isAdmin={isAdmin} onSelectCategory={onSelectCategory} tagBookmarksVersion={tagBookmarksVersion} />
        <Box component="main" sx={{ flex: 1, p: 2, pt: 0 }}>
          {apiUp === false && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {t("shell.apiUnreachable")}
            </Alert>
          )}
          <TopBar
            title={pageHeader?.title || routeTitle}
            onBack={pageHeader?.onBack ?? routeOnBack}
            actions={pageHeader?.actions}
            categoryId={categoryId}
            makerworldCookie={makerworldCookie}
            onUploaded={onPrintsChanged}
            onUnauthorized={onUnauthorized}
            user={user}
            theme={themeSelection}
            onThemeChange={onThemeChange}
            onOpenProfile={onOpenProfile}
            onLogout={onLogout}
          />
          <PageHeaderContext.Provider value={setPageHeader}>
            {children}
          </PageHeaderContext.Provider>
        </Box>
      </Box>
      <ImportProgressBar />
      <BackToTopButton />
    </ImportJobProvider>
  );
}

/** The persistent app shell: theming, the nav sidebar, and the header row (back button + title,
 *  then the global Add/Notifications/User cluster). `children` is the routed page content. */
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
