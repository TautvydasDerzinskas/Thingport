import React from "react";
import { useTranslation } from "react-i18next";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import Box from "@mui/material/Box";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import AppLayout from "./components/Layout/AppLayout";
import DashboardPage from "./pages/DashboardPage";
import ModelsPage from "./pages/ModelsPage";
import ModelDetailPage from "./pages/ModelDetailPage";
import CollectionsPage from "./pages/CollectionsPage";
import CollectionDetailPage from "./pages/CollectionDetailPage";
import TagsPage from "./pages/TagsPage";
import TagDetailPage from "./pages/TagDetailPage";
import SearchResultsPage from "./pages/SearchResultsPage";
import AuthorPage from "./pages/AuthorPage";
import AuthPage from "./pages/AuthPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import OidcCallbackPage from "./pages/OidcCallbackPage";
import ConnectGrabPage from "./pages/ConnectGrabPage";
import { rememberReturnPath } from "./utils/returnPath";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ProfilePage from "./pages/ProfilePage";
import ChangeEmailPage from "./pages/ProfilePage/ChangeEmailPage";
import ChangePasswordPage from "./pages/ProfilePage/ChangePasswordPage";
import DownloadPage from "./pages/DownloadPage";
import AdminPage from "./pages/AdminPage";
import ProvidersPage from "./pages/AdminSettingsPage/ProvidersPage";
import StorageSettingsPage from "./pages/AdminSettingsPage/StoragePage";
import AuthSettingsPage from "./pages/AdminSettingsPage/AuthPage";
import UsersPage from "./pages/UsersPage";
import LogsPage from "./pages/LogsPage";
import NotificationsPage from "./pages/NotificationsPage";
import TriggersPage from "./pages/TriggersPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import CaptchaPage from "./pages/CaptchaPage";
import ImportQueuePage from "./pages/ImportQueuePage";
import RenderingPage from "./pages/RenderingPage";
import AiPage from "./pages/AiPage";
import { healthApi, type HealthInfo } from "./api/health";
import { authApi, type AuthUser } from "./api/auth";
import { settingsApi, type PreviewMode } from "./api/settings";
import { clearToken, clearUser, readToken, readUser, storeToken, storeUser } from "./utils/auth";
import { type AppSettings, type MakerWorldSettings, loadSettings, saveSettings } from "./utils/settings";
import { useResolvedTheme } from "./hooks/useResolvedTheme";
import type { ResolvedTheme, ThemeSelection } from "./constants/settingsOptions";
import { buildTheme } from "./theme";

const DEFAULT_REFRESH_SECONDS = 6 * 60 * 60; // 6 hours

type AppShellProps = {
  isAdmin: boolean;
  user: AuthUser | null;
  apiUp: boolean | null;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  previewMode: PreviewMode;
  setPreviewMode: (mode: PreviewMode) => void;
  themeSelection: ThemeSelection;
  onThemeChange: (theme: ThemeSelection) => void;
  resolvedTheme: ResolvedTheme;
  muiTheme: ReturnType<typeof buildTheme>;
  onUnauthorized: () => void;
  onLogout: () => void;
  onUserUpdated: (user: AuthUser) => void;
};

/** Split out so App can stay outside <BrowserRouter>. */
function AppShell({
  isAdmin,
  user,
  apiUp,
  settings,
  setSettings,
  previewMode,
  setPreviewMode,
  themeSelection,
  onThemeChange,
  resolvedTheme,
  muiTheme,
  onUnauthorized,
  onLogout,
  onUserUpdated,
}: AppShellProps) {
  const navigate = useNavigate();
  // Seeded from the URL so a direct load of /models?category=<id> doesn't flash "All" first.
  const [categoryId, setCategoryId] = React.useState<string | null>(() => {
    if (typeof window === "undefined" || !window.location.pathname.startsWith("/models")) return null;
    return new URLSearchParams(window.location.search).get("category");
  });
  const [nonce, setNonce] = React.useState(0);
  const [categoryVersion, setCategoryVersion] = React.useState(0);
  const [bookmarksVersion, setBookmarksVersion] = React.useState(0);

  const handleCategoriesChanged = React.useCallback(() => {
    setCategoryVersion((v) => v + 1);
  }, []);

  const handleBookmarksChanged = React.useCallback(() => {
    setBookmarksVersion((v) => v + 1);
  }, []);

  const handlePrintsChanged = React.useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  const updateMakerWorld = React.useCallback(
    (patch: Partial<MakerWorldSettings>) =>
      setSettings((prev) => ({ ...prev, makerworld: { ...prev.makerworld, ...patch } })),
    [setSettings],
  );

  return (
    <AppLayout
      muiTheme={muiTheme}
      themeSelection={themeSelection}
      apiUp={apiUp}
      categoryId={categoryId}
      onSelectCategory={setCategoryId}
      onPrintsChanged={handlePrintsChanged}
      bookmarksVersion={bookmarksVersion}
      onUnauthorized={onUnauthorized}
      isAdmin={isAdmin}
      onOpenProfile={() => navigate("/profile")}
      onLogout={onLogout}
      makerworldCookie={settings.makerworld.cookie}
      onUpdateMakerWorld={updateMakerWorld}
      user={user}
      onThemeChange={onThemeChange}
    >
      <Routes>
        <Route path="/" element={<DashboardPage onUnauthorized={onUnauthorized} />} />
        <Route
          path="/models"
          element={
            <ModelsPage
              categoryId={categoryId}
              onSelectCategory={setCategoryId}
              categoriesVersion={categoryVersion}
              onCategoriesChanged={handleCategoriesChanged}
              printsVersion={nonce}
              onUnauthorized={onUnauthorized}
              theme={resolvedTheme}
              previewMode={previewMode}
              viewer={user}
            />
          }
        />
        <Route
          path="/models/collections"
          element={
            <CollectionsPage
              theme={resolvedTheme}
              previewMode={previewMode}
              onUnauthorized={onUnauthorized}
              onBookmarksChanged={handleBookmarksChanged}
            />
          }
        />
        <Route
          path="/models/collections/:collectionId"
          element={
            <CollectionDetailPage
              theme={resolvedTheme}
              previewMode={previewMode}
              onUnauthorized={onUnauthorized}
              onBookmarksChanged={handleBookmarksChanged}
              viewer={user}
            />
          }
        />
        <Route
          path="/models/tags"
          element={<TagsPage onUnauthorized={onUnauthorized} onBookmarksChanged={handleBookmarksChanged} />}
        />
        <Route
          path="/models/tags/:tagName"
          element={
            <TagDetailPage
              theme={resolvedTheme}
              previewMode={previewMode}
              onUnauthorized={onUnauthorized}
              onBookmarksChanged={handleBookmarksChanged}
              viewer={user}
            />
          }
        />
        <Route
          path="/search-results"
          element={
            <SearchResultsPage
              theme={resolvedTheme}
              previewMode={previewMode}
              onUnauthorized={onUnauthorized}
              viewer={user}
            />
          }
        />
        <Route
          path="/models/:printId"
          element={
            <ModelDetailPage
              theme={resolvedTheme}
              onSelectCategory={setCategoryId}
              onUnauthorized={onUnauthorized}
              viewer={user}
            />
          }
        />
        <Route
          path="/authors/:authorId"
          element={
            <AuthorPage
              theme={resolvedTheme}
              previewMode={previewMode}
              onUnauthorized={onUnauthorized}
              viewer={user}
              onUserUpdated={onUserUpdated}
            />
          }
        />
        <Route path="/profile" element={<ProfilePage user={user} onUnauthorized={onUnauthorized} />} />
        <Route
          path="/profile/email"
          element={<ChangeEmailPage user={user} onUserUpdated={onUserUpdated} onUnauthorized={onUnauthorized} />}
        />
        <Route path="/profile/password" element={<ChangePasswordPage onUnauthorized={onUnauthorized} />} />
        <Route path="/connect-grab" element={<ConnectGrabPage user={user} onUnauthorized={onUnauthorized} />} />
        <Route path="/downloads" element={<DownloadPage />} />
        <Route path="/notifications" element={<NotificationsPage onUnauthorized={onUnauthorized} />} />
        <Route
          path="/admin"
          element={isAdmin ? <AdminPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin-providers"
          element={isAdmin ? <ProvidersPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin-storage"
          element={isAdmin ? <StorageSettingsPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin-auth"
          element={isAdmin ? <AuthSettingsPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        {/* Settings was split into the three above; old links and bookmarks land on the first. */}
        <Route path="/admin-settings" element={<Navigate to="/admin-providers" replace />} />
        <Route
          path="/admin-rendering"
          element={
            isAdmin ? (
              <RenderingPage onUnauthorized={onUnauthorized} onPreviewModeChanged={setPreviewMode} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/admin-ai"
          element={isAdmin ? <AiPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin-users"
          element={isAdmin ? <UsersPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin-logs"
          element={isAdmin ? <LogsPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin-triggers"
          element={isAdmin ? <TriggersPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin-connections"
          element={isAdmin ? <ConnectionsPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin-queue"
          element={isAdmin ? <ImportQueuePage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin-captcha"
          element={isAdmin ? <CaptchaPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  const { t } = useTranslation("app");
  const [token, setToken] = React.useState<string | null>(() => readToken());
  const [user, setUser] = React.useState<AuthUser | null>(() => readUser());
  const [health, setHealth] = React.useState<HealthInfo | null>(null);
  const [tokenTtl, setTokenTtl] = React.useState<number | null>(null);
  const [showExpiredToast, setShowExpiredToast] = React.useState(false);
  // A ref so concurrent 401s see the guard synchronously and only one alert shows.
  const sessionExpiredRef = React.useRef(false);
  const [settings, setSettings] = React.useState<AppSettings>(() => loadSettings());
  const [previewMode, setPreviewMode] = React.useState<PreviewMode>("automatic");
  // Server-persisted so it follows the account across devices.
  const [themeSelection, setThemeSelection] = React.useState<ThemeSelection>("light");
  const resolvedTheme = useResolvedTheme(themeSelection);
  const muiTheme = React.useMemo(() => buildTheme(resolvedTheme), [resolvedTheme]);
  // index.html's theme-color tags follow the OS; this makes the title bar follow the theme
  // actually shown, which can be a manual light/dark choice.
  React.useEffect(() => {
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.content = muiTheme.palette.background.default;
    });
  }, [muiTheme]);
  const isAdmin = user?.role === "ADMIN";
  React.useEffect(() => {
    (async () => setHealth(await healthApi.get()))();
  }, []);
  React.useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        setPreviewMode((await settingsApi.getPreviews()).mode);
      } catch {}
    })();
  }, [token]);
  React.useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { theme } = await settingsApi.getTheme();
        // Null means never set; keep the current theme.
        if (theme) setThemeSelection(theme);
      } catch {}
    })();
  }, [token]);
  const handleThemeChange = React.useCallback((selected: ThemeSelection) => {
    setThemeSelection(selected);
    void settingsApi.updateTheme(selected).catch(() => {});
  }, []);
  React.useEffect(() => {
    saveSettings(settings);
  }, [settings]);
  const apiUp = health?.ok ?? null;
  const authRequired = health?.auth_required ?? true;

  const handleLogin = (tok: string, ttl: number, loggedInUser: AuthUser) => {
    storeToken(tok);
    storeUser(loggedInUser);
    setToken(tok);
    setUser(loggedInUser);
    setTokenTtl(ttl);
    sessionExpiredRef.current = false;
  };

  const handleUnauthorized = React.useCallback(() => {
    if (sessionExpiredRef.current) return;
    sessionExpiredRef.current = true;
    clearToken();
    setToken(null);
    setTokenTtl(null);
    setShowExpiredToast(true);
  }, []);

  const handleLogout = () => {
    // Fire-and-forget: local logout proceeds immediately.
    void authApi.logout();
    clearToken();
    clearUser();
    setToken(null);
    setUser(null);
    setTokenTtl(null);
  };

  // PATCH /profile doesn't reissue a token, so only the local user object changes.
  const handleUserUpdated = (updatedUser: AuthUser) => {
    storeUser(updatedUser);
    setUser(updatedUser);
  };

  React.useEffect(() => {
    if (!token) return;
    const ttl = tokenTtl ?? DEFAULT_REFRESH_SECONDS;
    const refreshMs = Math.max(5 * 60 * 1000, Math.min(ttl * 0.8 * 1000, ttl * 1000 - 5 * 60 * 1000));
    const timer = window.setTimeout(async () => {
      try {
        const res = await authApi.refresh();
        storeToken(res.token);
        setToken(res.token);
        setTokenTtl(res.expires_in);
      } catch {
        handleUnauthorized();
      }
    }, refreshMs);
    return () => window.clearTimeout(timer);
  }, [token, tokenTtl, handleUnauthorized]);

  // Shared by both branches so the toast survives the swap to AuthPage.
  const sessionExpiredToast = (
    <Snackbar
      open={showExpiredToast}
      autoHideDuration={5000}
      onClose={() => setShowExpiredToast(false)}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      <Alert onClose={() => setShowExpiredToast(false)} severity="error" variant="filled" sx={{ width: "100%" }}>
        {t("shell.sessionExpired")}
      </Alert>
    </Snackbar>
  );

  // Finishes a single sign-on even with a session already here, e.g. from another tab.
  const isOidcCallbackPath = typeof window !== "undefined" && window.location.pathname === "/oidc-callback";
  if ((authRequired && !token) || isOidcCallbackPath) {
    // Outside the router, so these pre-login links are matched against window.location.
    const isVerifyEmailPath = typeof window !== "undefined" && window.location.pathname === "/verify-email";
    // Thingport Grab's approval page, reached signed out: single sign-on comes back here once signed in.
    rememberReturnPath();
    const isResetPasswordPath = typeof window !== "undefined" && window.location.pathname === "/reset-password";
    const inviteParams =
      typeof window !== "undefined" && window.location.pathname === "/register"
        ? new URLSearchParams(window.location.search)
        : null;
    const invite = inviteParams?.get("invite")
      ? { token: inviteParams.get("invite")!, email: inviteParams.get("email") ?? "" }
      : null;
    return (
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <Box
          sx={{
            background: (theme) => theme.thingport.pageBackground,
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 2,
          }}
        >
          {isOidcCallbackPath ? (
            <OidcCallbackPage onSuccess={handleLogin} />
          ) : isVerifyEmailPath ? (
            <VerifyEmailPage onSuccess={handleLogin} />
          ) : isResetPasswordPath ? (
            <ResetPasswordPage onSuccess={handleLogin} />
          ) : (
            <AuthPage
              onSuccess={handleLogin}
              apiUp={apiUp}
              allowRegistrations={health?.allow_registrations ?? true}
              passwordResetEnabled={health?.password_reset_enabled ?? false}
              invite={invite}
              oidcProviders={health?.oidc_providers}
            />
          )}
        </Box>
        {sessionExpiredToast}
      </ThemeProvider>
    );
  }

  return (
    <>
      <BrowserRouter>
        <AppShell
          isAdmin={isAdmin}
          user={user}
          apiUp={apiUp}
          settings={settings}
          setSettings={setSettings}
          previewMode={previewMode}
          setPreviewMode={setPreviewMode}
          themeSelection={themeSelection}
          onThemeChange={handleThemeChange}
          resolvedTheme={resolvedTheme}
          muiTheme={muiTheme}
          onUnauthorized={handleUnauthorized}
          onLogout={handleLogout}
          onUserUpdated={handleUserUpdated}
        />
      </BrowserRouter>
      <ThemeProvider theme={muiTheme}>{sessionExpiredToast}</ThemeProvider>
    </>
  );
}
