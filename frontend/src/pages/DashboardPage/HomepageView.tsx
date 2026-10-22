import { useSearchParams } from "react-router-dom";
import { ThemeProvider, type Theme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import { ConfirmProvider } from "../../components/ConfirmProvider";
import { ToastProvider } from "../../components/ToastProvider";
import { ProviderAboutProvider } from "../../components/providerAbout/ProviderAboutProvider";
import DashboardPage from "./index";

type Props = {
  muiTheme: Theme;
  isAdmin: boolean;
  onUnauthorized: () => void;
};

/**
 * The dashboard on its own, without the side menu and top bar, for a browser's homepage. `?template=<id>` keeps it to
 * the template it was opened from. Clicking through to a model opens the full app, as anywhere else.
 */
export default function HomepageView({ muiTheme, isAdmin, onUnauthorized }: Props) {
  const [params] = useSearchParams();
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
            </Box>
          </ProviderAboutProvider>
        </ToastProvider>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
