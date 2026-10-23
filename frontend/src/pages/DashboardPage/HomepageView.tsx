import { useNavigate, useSearchParams } from "react-router-dom";
import { ThemeProvider, type Theme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import { ConfirmProvider } from "../../components/ConfirmProvider";
import { ToastProvider } from "../../components/ToastProvider";
import { ProviderAboutProvider } from "../../components/providerAbout/ProviderAboutProvider";
import GlobalSearch from "../../components/Layout/GlobalSearch";
import type { ThemeSelection } from "../../constants/settingsOptions";
import { IMPORT_PATH } from "../../utils/bookmarklet";
import { configurationLink } from "../../utils/configurationEvents";
import DashboardPage from "./index";

type Props = {
  muiTheme: Theme;
  isAdmin: boolean;
  onUnauthorized: () => void;
  themeSelection: ThemeSelection;
  onThemeChange: (theme: ThemeSelection) => void;
  onLogout: () => void;
};

/**
 * The dashboard on its own, without the side menu and top bar, for a browser's homepage. `?template=<id>` keeps it to
 * the template it was opened from. Clicking through to a model opens the full app, as anywhere else.
 */
export default function HomepageView({
  muiTheme,
  isAdmin,
  onUnauthorized,
  themeSelection,
  onThemeChange,
  onLogout,
}: Props) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <ConfirmProvider>
        <ToastProvider>
          <ProviderAboutProvider>
            <Box
              component="main"
              sx={{ minHeight: "100vh", bgcolor: (theme) => theme.thingport.pageBackground, p: { xs: 1.5, md: 3 } }}
            >
              <DashboardPage
                standalone
                templateId={params.get("template")}
                isAdmin={isAdmin}
                onUnauthorized={onUnauthorized}
              />
              {/* The top bar's search, opened with ⌘S or its corner button. What it opens that lives in the app's layout,
                  importing and Configuration, takes the user into the app for it. */}
              <GlobalSearch
                trigger="corner"
                onUnauthorized={onUnauthorized}
                theme={themeSelection}
                onThemeChange={onThemeChange}
                onLogout={onLogout}
                onImport={(link) => navigate(`${IMPORT_PATH}?url=${encodeURIComponent(link ?? "")}`)}
                onOpenConfiguration={(tab) => navigate(configurationLink(tab))}
                isAdmin={isAdmin}
              />
            </Box>
          </ProviderAboutProvider>
        </ToastProvider>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
