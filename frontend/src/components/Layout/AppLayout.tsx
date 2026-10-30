import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ThemeProvider, type Theme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import useMediaQuery from "@mui/material/useMediaQuery";
import Alert from "@mui/material/Alert";
import Sidebar from "./Sidebar";
import AdminSubnav from "./AdminSubnav";
import TopBar from "./TopBar";
import ImportProgressBar from "./ImportProgressBar";
import AiRunProgressBar from "./AiRunProgressBar";
import StorageMoveProgressBar from "./StorageMoveProgressBar";
import { StorageMoveProvider } from "./StorageMoveContext";
import ModelRepairProgressBar from "./ModelRepairProgressBar";
import { ModelRepairProvider } from "./ModelRepairContext";
import MissingFilesDialog from "../missingFiles/MissingFilesDialog";
import BackToTopButton from "./BackToTopButton";
import { ConfirmProvider } from "../ConfirmProvider";
import { ToastProvider, useToast } from "../ToastProvider";
import { ProviderAboutProvider } from "../providerAbout/ProviderAboutProvider";
import { WhatsNewProvider } from "../whatsNew/WhatsNewProvider";
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
  onLogout: () => Promise<void>;
  makerworldCookie: string;
  onUpdateMakerWorld: (patch: Partial<MakerWorldSettings>) => void;
  user: AuthUser | null;
  onThemeChange: (theme: ThemeSelection) => Promise<boolean>;
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
  const { pathname, key: locationKey } = useLocation();
  const mobile = useMediaQuery((theme: Theme) => theme.breakpoints.down("md"));
  // Opened for the current route only: navigating, including back/forward and query-only changes, must not leave an
  // overlay covering the page. Widening closes it too, so narrowing again doesn't bring it back: in an effect, since
  // an update during render left useMediaQuery stuck on desktop when the drawer had been open.
  const [navigation, setNavigation] = React.useState<string | null>(null);
  const navigationOpen = mobile && navigation === locationKey;
  const closeNavigation = () => setNavigation(null);
  React.useEffect(() => {
    if (!mobile) setNavigation(null);
  }, [mobile]);
  const [pageHeader, setPageHeader] = React.useState<PageHeader>(null);
  const { refresh: refreshNotifications } = useNotifications();
  const showToast = useToast();

  const handleLogout = () =>
    void onLogout().catch(() => showToast({ message: t("userMenu.logOutFailed"), severity: "error" }));

  const handleJobCompleted = React.useCallback(() => {
    onPrintsChanged();
    void refreshNotifications();
  }, [onPrintsChanged, refreshNotifications]);

  return (
    <ImportJobProvider onUnauthorized={onUnauthorized} onJobCompleted={handleJobCompleted}>
      <AiRunProvider onUnauthorized={onUnauthorized} onRunFinished={handleJobCompleted}>
        <StorageMoveProvider isAdmin={isAdmin} onUnauthorized={onUnauthorized}>
          <ModelRepairProvider onUnauthorized={onUnauthorized} onRepairFinished={handleJobCompleted}>
            <Box
              sx={{
                background: (theme) => theme.thingport.pageBackground,
                minHeight: "100vh",
                display: "flex",
              }}
            >
              {mobile ? (
                <Drawer
                  id="mobile-navigation"
                  open={Boolean(navigationOpen)}
                  onClose={closeNavigation}
                  PaperProps={{
                    role: "dialog",
                    "aria-modal": true,
                    "aria-label": t("sidebar.navigationMenu"),
                    sx: {
                      width: "min(320px, calc(100vw - 40px))",
                      // MUI pins the paper to height:100%, which on a phone is the viewport with the URL bar
                      // hidden -- taller than what's on screen. dvh follows the bar, so the menu ends where the
                      // screen does, and the panel keeps its own scrolling instead of dragging the page with it.
                      height: "100dvh",
                      overscrollBehavior: "contain",
                      pt: "env(safe-area-inset-top)",
                      pb: "env(safe-area-inset-bottom)",
                    },
                  }}
                >
                  <Box sx={{ display: "flex", justifyContent: "flex-end", px: 1, pt: 1 }}>
                    <IconButton
                      aria-label={t("sidebar.closeNavigation")}
                      onClick={closeNavigation}
                      sx={{ width: 44, height: 44 }}
                    >
                      <CloseIcon />
                    </IconButton>
                  </Box>
                  <Sidebar
                    mobile
                    isAdmin={isAdmin}
                    onSelectCategory={(id) => {
                      onSelectCategory(id);
                      closeNavigation();
                    }}
                    bookmarksVersion={bookmarksVersion}
                  />
                  {isAdmin && pathname.startsWith("/admin") && <AdminSubnav mobile />}
                </Drawer>
              ) : (
                <>
                  <Sidebar isAdmin={isAdmin} onSelectCategory={onSelectCategory} bookmarksVersion={bookmarksVersion} />
                  {isAdmin && pathname.startsWith("/admin") && <AdminSubnav />}
                </>
              )}
              <Box component="main" sx={{ flex: 1, minWidth: 0, px: { xs: 1.5, md: 2 }, pb: 2 }}>
                {apiUp === false && (
                  <Alert severity="error" sx={{ mb: 1.5 }}>
                    {t("shell.apiUnreachable")}
                  </Alert>
                )}
                <TopBar
                  onMenuClick={mobile ? () => setNavigation(locationKey) : undefined}
                  menuOpen={Boolean(navigationOpen)}
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
                  onLogout={handleLogout}
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
              <ModelRepairProgressBar />
            </Box>
            <BackToTopButton />
            {/* Comes up on its own when a look at the library finds models with no files left. */}
            <MissingFilesDialog />
          </ModelRepairProvider>
        </StorageMoveProvider>
      </AiRunProvider>
    </ImportJobProvider>
  );
}

/** Keeps responsive navigation inside the same theme, session and notification providers as the page. */
export default function AppLayout({ muiTheme, onUnauthorized, ...shellProps }: AppLayoutProps) {
  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <NavigationHistoryProvider>
        <ConfirmProvider>
          <ToastProvider>
            <NotificationsProvider onUnauthorized={onUnauthorized}>
              <ProviderAboutProvider>
                <WhatsNewProvider>
                  <AppLayoutShell onUnauthorized={onUnauthorized} {...shellProps} />
                </WhatsNewProvider>
              </ProviderAboutProvider>
            </NotificationsProvider>
          </ToastProvider>
        </ConfirmProvider>
      </NavigationHistoryProvider>
    </ThemeProvider>
  );
}
