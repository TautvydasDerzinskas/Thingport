import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import type { AuthUser } from "../../api/auth";
import { UnauthorizedError } from "../../api/client";
import { grabApi } from "../../api/grab";

type Props = {
  user: AuthUser | null;
  onUnauthorized?: () => void;
};

// Mirrors the backend's check: the hash of the extension's secret.
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Opened by Thingport Grab to connect without a password: the signed-in user approves it here. Grab watches its
 *  tab and picks the code up from the #fragment, then closes the tab. */
export default function ConnectGrabPage({ user, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [request] = React.useState(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      challenge: params.get("challenge") ?? "",
      name: (params.get("name") ?? "").slice(0, 80) || t("grab.connect.unknownBrowser"),
      error: params.get("error"),
    };
  });
  const [state, setState] = React.useState<"asking" | "busy" | "approved" | "cancelled">("asking");
  const [error, setError] = React.useState<string | null>(request.error);
  const valid = CHALLENGE_PATTERN.test(request.challenge);

  const approve = async () => {
    setState("busy");
    setError(null);
    try {
      const { code } = await grabApi.approve(request.challenge, request.name);
      setState("approved");
      // A navigation within the page, which the extension sees on its tab.
      window.location.hash = `grab_code=${encodeURIComponent(code)}`;
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      setError(err instanceof Error ? err.message : String(err));
      setState("asking");
    }
  };

  const cancel = () => {
    setState("cancelled");
    window.location.hash = "grab_cancelled=1";
  };

  return (
    <Box sx={{ display: "flex", justifyContent: "center", pt: { xs: 2, sm: 6 } }}>
      <Paper variant="outlined" sx={{ width: "100%", maxWidth: 460, p: { xs: 2.5, sm: 4 }, borderRadius: "16px" }}>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            {state === "approved" ? (
              <CheckCircleOutlineIcon color="success" sx={{ fontSize: 36 }} />
            ) : (
              <ExtensionOutlinedIcon color="primary" sx={{ fontSize: 36 }} />
            )}
            <Typography variant="h6">
              {state === "approved" ? t("grab.connect.approvedTitle") : t("grab.connect.title")}
            </Typography>
          </Stack>

          {!valid && !request.error ? (
            <Alert severity="error">{t("grab.connect.invalid")}</Alert>
          ) : state === "approved" ? (
            <Typography variant="body2" color="text.secondary">
              {t("grab.connect.approvedBody")}
            </Typography>
          ) : state === "cancelled" ? (
            <Typography variant="body2" color="text.secondary">
              {t("grab.connect.cancelledBody")}
            </Typography>
          ) : (
            <>
              <Typography variant="body1">
                {t("grab.connect.body", { browser: request.name, email: user?.email ?? "" })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("grab.connect.details")}
              </Typography>
              {error && <Alert severity="error">{error}</Alert>}
              {!request.error && (
                <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                  <Button onClick={cancel} disabled={state === "busy"}>
                    {t("grab.connect.cancel")}
                  </Button>
                  <Button variant="contained" onClick={() => void approve()} disabled={state === "busy"}>
                    {t("grab.connect.approve")}
                  </Button>
                </Stack>
              )}
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
