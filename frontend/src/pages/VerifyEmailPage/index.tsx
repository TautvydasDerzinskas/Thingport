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
import { authApi, type AuthUser } from "../../api/auth";

type Props = {
  onSuccess: (token: string, expires_in: number, user: AuthUser) => void;
};

/** Rendered outside the router, so `token` is read from window.location. */
export default function VerifyEmailPage({ onSuccess }: Props) {
  const { t } = useTranslation("app");
  const [error, setError] = React.useState<string | null>(null);
  const [verified, setVerified] = React.useState(false);
  const verificationRequest = React.useRef<ReturnType<typeof authApi.verifyEmail> | null>(null);

  React.useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError(t("auth.verifyEmail.missingToken"));
      return;
    }
    // The token is single-use. Share its request across StrictMode's effect replay.
    const request = (verificationRequest.current ??= authApi.verifyEmail(token));
    let cancelled = false;
    (async () => {
      try {
        const res = await request;
        if (cancelled) return;
        window.history.replaceState(null, "", "/");
        if ("token" in res) onSuccess(res.token, res.expires_in, res.user);
        else setVerified(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("auth.verifyEmail.failed"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Uses the token from the URL on mount.
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
            <Alert severity="error" sx={{ width: "100%" }}>
              {error}
            </Alert>
            <Button
              variant="contained"
              onClick={() => {
                window.history.replaceState(null, "", "/");
                window.location.reload();
              }}
            >
              {t("auth.verifyEmail.backToSignIn")}
            </Button>
          </Stack>
        ) : verified ? (
          <Stack spacing={2} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {t("auth.verifyEmail.verified")}
            </Typography>
            <Button variant="contained" onClick={() => window.location.reload()}>
              {t("auth.verifyEmail.backToSignIn")}
            </Button>
          </Stack>
        ) : (
          <Stack spacing={2} alignItems="center">
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">
              {t("auth.verifyEmail.verifying")}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
