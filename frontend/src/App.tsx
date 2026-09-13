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
import AuthorPage from "./pages/AuthorPage";
import AuthPage from "./pages/AuthPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import ProfilePage from "./pages/ProfilePage";
import ChangeEmailPage from "./pages/ProfilePage/ChangeEmailPage";
import ChangePasswordPage from "./pages/ProfilePage/ChangePasswordPage";
import DownloadPage from "./pages/DownloadPage";
import AdminPage from "./pages/AdminPage";
import AdminSettingsPage from "./pages/AdminSettingsPage";
import UsersPage from "./pages/UsersPage";
import LogsPage from "./pages/LogsPage";
import TriggersPage from "./pages/TriggersPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import { healthApi, type HealthInfo } from "./api/health";
import { authApi, type AuthUser } from "./api/auth";
import { settingsApi, type PreviewMode } from "./api/settings";
import { clearToken, clearUser, readToken, readUser, storeToken, storeUser } from "./utils/auth";
import { type AppSettings, loadSettings, saveSettings } from "./utils/settings";
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

/** Everything that needs router context (route-derived chrome, category selection that also
 *  navigates). Split out from App so App itself can stay outside <BrowserRouter>. */
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
  // Lazily seeded from the current URL (not just null) so a direct load/refresh of
  // /models?category=<id> already has the right categoryId on its very first render, instead of
  // starting unfiltered and correcting a moment later once ModelsPage's own URL-sync effect
  // catches up -- that gap was a real, visible flash of "All" before the filtered view. Only
  // matters at mount: normal in-app navigation keeps this in sync via onSelectCategory as usual.
  const [categoryId, setCategoryId] = React.useState<string | null>(() => {
    if (typeof window === "undefined" || !window.location.pathname.startsWith("/models")) return null;
    return new URLSearchParams(window.location.search).get("category");
  });
  const [nonce, setNonce] = React.useState(0);
  const [categoryVersion, setCategoryVersion] = React.useState(0);
  const [tagBookmarksVersion, setTagBookmarksVersion] = React.useState(0);

  const handleCategoriesChanged = React.useCallback(() => {
    setCategoryVersion(v => v + 1);
  }, []);

  const handleTagBookmarksChanged = React.useCallback(() => {
    setTagBookmarksVersion(v => v + 1);
  }, []);

  const handlePrintsChanged = React.useCallback(() => {
    setNonce(n => n + 1);
  }, []);

  return (
    <AppLayout
      muiTheme={muiTheme}
      themeSelection={themeSelection}
      apiUp={apiUp}
      categoryId={categoryId}
      onSelectCategory={setCategoryId}
      onPrintsChanged={handlePrintsChanged}
      tagBookmarksVersion={tagBookmarksVersion}
      onUnauthorized={onUnauthorized}
      isAdmin={isAdmin}
      onOpenProfile={() => navigate("/profile")}
      onLogout={onLogout}
      makerworldCookie={settings.makerworld.cookie}
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
          element={<CollectionsPage theme={resolvedTheme} previewMode={previewMode} onUnauthorized={onUnauthorized} />}
        />
        <Route
          path="/models/collections/:collectionId"
          element={<CollectionDetailPage theme={resolvedTheme} previewMode={previewMode} onUnauthorized={onUnauthorized} viewer={user} />}
        />
        <Route
          path="/models/tags"
          element={<TagsPage onUnauthorized={onUnauthorized} onBookmarksChanged={handleTagBookmarksChanged} />}
        />
        <Route
          path="/models/tags/:tagName"
          element={
            <TagDetailPage
              theme={resolvedTheme}
              previewMode={previewMode}
              onUnauthorized={onUnauthorized}
              onBookmarksChanged={handleTagBookmarksChanged}
              viewer={user}
            />
          }
        />
        <Route
          path="/models/:printId"
          element={<ModelDetailPage theme={resolvedTheme} onSelectCategory={setCategoryId} onUnauthorized={onUnauthorized} viewer={user} />}
        />
        <Route
          path="/authors/:authorId"
          element={<AuthorPage theme={resolvedTheme} previewMode={previewMode} onUnauthorized={onUnauthorized} viewer={user} onUserUpdated={onUserUpdated} />}
        />
        <Route
          path="/profile"
          element={
            <ProfilePage
              user={user}
              makerworldCookie={settings.makerworld.cookie}
              onUpdateMakerWorld={patch => setSettings(prev => ({ ...prev, makerworld: { ...prev.makerworld, ...patch } }))}
              onUnauthorized={onUnauthorized}
            />
          }
        />
        <Route
          path="/profile/email"
          element={<ChangeEmailPage user={user} onUserUpdated={onUserUpdated} onUnauthorized={onUnauthorized} />}
        />
        <Route
          path="/profile/password"
          element={<ChangePasswordPage onUnauthorized={onUnauthorized} />}
        />
        <Route path="/downloads" element={<DownloadPage />} />
        <Route
          path="/admin"
          element={isAdmin ? <AdminPage onUnauthorized={onUnauthorized} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin-settings"
          element={
            isAdmin
              ? <AdminSettingsPage onUnauthorized={onUnauthorized} onPreviewModeChanged={setPreviewMode} />
              : <Navigate to="/" replace />
          }
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
  // A ref (not state) so concurrent 401s from several in-flight requests all see the guard
  // synchronously -- state's setSessionExpired(true) wouldn't be visible to the others until
  // the next render, letting each of them past the check and onto its own alert().
  const sessionExpiredRef = React.useRef(false);
  const [settings, setSettings] = React.useState<AppSettings>(() => loadSettings());
  const [previewMode, setPreviewMode] = React.useState<PreviewMode>("automatic");
  // Server-persisted (see settings/theme, services/themePreferenceService.ts), not localStorage
  // -- unlike the old per-browser mirror, this follows the account across devices. "light" until
  // the fetch below resolves is the same fallback the old localStorage default used, so a
  // logged-in-elsewhere-first visit still starts on a sane theme rather than an empty one.
  const [themeSelection, setThemeSelection] = React.useState<ThemeSelection>("light");
  const resolvedTheme = useResolvedTheme(themeSelection);
  const muiTheme = React.useMemo(() => buildTheme(resolvedTheme), [resolvedTheme]);
  const isAdmin = user?.role === "ADMIN";
  React.useEffect(() => { (async ()=> setHealth(await healthApi.get()))(); }, []);
  React.useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        setPreviewMode((await settingsApi.getPreviews()).mode);
      } catch {
        // Keep the "automatic" default -- previews just aren't the reason to block the app.
      }
    })();
  }, [token]);
  React.useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const { theme } = await settingsApi.getTheme();
        // Null means this account has never set one (e.g. its very first login) -- keep
        // whatever's already showing rather than overwriting it with nothing.
        if (theme) setThemeSelection(theme);
      } catch {
        // Keep the current theme -- this just means it won't have synced from another device
        // yet, not a reason to block the app.
      }
    })();
  }, [token]);
  const handleThemeChange = React.useCallback((selected: ThemeSelection) => {
    setThemeSelection(selected);
    void settingsApi.updateTheme(selected).catch(() => {
      // Best-effort, like the extension's own cookie sync -- the UI already reflects the
      // change locally; a failed sync just means it won't follow to another device yet.
    });
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
    // Fire-and-forget: the audit-log entry is recorded server-side before the token that
    // identifies it is gone, but local logout must proceed immediately either way.
    void authApi.logout();
    clearToken();
    clearUser();
    setToken(null);
    setUser(null);
    setTokenTtl(null);
  };

  // PATCH /profile doesn't reissue a token (unlike login/verify-email), so this just refreshes
  // the locally-held user object -- e.g. after a display-name-unaffecting email/password change.
  const handleUserUpdated = (updatedUser: AuthUser) => {
    storeUser(updatedUser);
    setUser(updatedUser);
  };

  React.useEffect(() => {
    if (!token) return;
    const ttl = tokenTtl ?? DEFAULT_REFRESH_SECONDS;
    const refreshMs = Math.max(
      5 * 60 * 1000,
      Math.min(ttl * 0.8 * 1000, ttl * 1000 - 5 * 60 * 1000)
    );
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

  // Shared between both branches below so the toast survives the AppShell -> AuthPage swap that
  // handleUnauthorized triggers (clearing the token unmounts AppShell and mounts this instead).
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

  if (authRequired && !token) {
    // No BrowserRouter wraps this branch (see AppShell's comment), so /verify-email -- reached
    // pre-login from the link in the verification email -- is checked directly against
    // window.location rather than via a route.
    const isVerifyEmailPath = typeof window !== "undefined" && window.location.pathname === "/verify-email";
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
          {isVerifyEmailPath ? (
            <VerifyEmailPage onSuccess={handleLogin} />
          ) : (
            <AuthPage
              onSuccess={handleLogin}
              apiUp={apiUp}
              allowRegistrations={health?.allow_registrations ?? true}
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
