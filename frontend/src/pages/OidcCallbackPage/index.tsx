import React from "react";
import { useTranslation } from "react-i18next";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Wordmark from "../../components/Wordmark";
import type { AuthUser } from "../../api/auth";
import { oidcApi } from "../../api/oidc";
import { takeReturnPath } from "../../utils/returnPath";

type Props = {
  onSuccess: (token: string, expires_in: number, user: AuthUser) => void;
};

/** Where a single sign-on provider's sign-in ends: the #fragment holds a one-time code, or why it failed. */
export default function OidcCallbackPage({ onSuccess }: Props) {
  const { t } = useTranslation("app");
  const [error, setError] = React.useState<string | null>(null);
  // The code works once, and the fragment is cleared on the first run: a second run (StrictMode) would find nothing.
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    // Off the address bar and out of history at once.
    window.history.replaceState(null, "", "/oidc-callback");
    const code = fragment.get("code");
    if (!code) {
      setError(fragment.get("error") || t("auth.sso.failed"));
      return;
    }
    (async () => {
      try {
        const res = await oidcApi.exchange(code);
        // Back to the profile page that asked to confirm it's them, or the page signing in interrupted; else home.
        const next = fragment.get("next");
        window.history.replaceState(null, "", next?.startsWith("/profile/") ? next : (takeReturnPath() ?? "/"));
        onSuccess(res.token, res.expires_in, res.user);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("auth.sso.failed"));
      }
    })();
    // Runs once against whatever was in the URL on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Paper
      elevation={8}
      sx={{
        width: "100%",
        maxWidth: 420,
        borderRadius: 3,
        p: 4,
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Stack spacing={3} sx={{ textAlign: "center" }}>
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <Wordmark size="lg" />
        </Box>
        {error ? (
          <Stack spacing={2} alignItems="center">
            <Alert severity="error" sx={{ width: "100%", textAlign: "left" }}>
              {error}
            </Alert>
            <Button
              variant="contained"
              onClick={() => {
                window.history.replaceState(null, "", "/");
                window.location.reload();
              }}
            >
              {t("auth.sso.backToSignIn")}
            </Button>
          </Stack>
        ) : (
          <Stack spacing={2} alignItems="center">
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">
              {t("auth.sso.signingIn")}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
