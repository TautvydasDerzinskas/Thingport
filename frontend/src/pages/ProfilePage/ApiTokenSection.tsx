import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { authApi, type ApiTokenInfo } from "../../api/auth";
import { UnauthorizedError } from "../../api/client";
import { useConfirm } from "../../components/ConfirmProvider";
import { relativeTime } from "../../utils/relativeTime";
import ApiTokenPermissionsDialog from "./ApiTokenPermissionsDialog";

/** Same origin as the app: nginx (or Vite in dev) passes /api through to the backend. */
function mcpEndpoint(): string {
  return `${window.location.origin}/api/mcp`;
}

type Props = {
  onUnauthorized?: () => void;
};

/** The read-only token other apps and services use to read this user's library. The token
 *  is shown once, right after it's generated; after that only its last four characters. */
export default function ApiTokenSection({ onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const [info, setInfo] = React.useState<ApiTokenInfo | null>(null);
  const [newToken, setNewToken] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<"token" | "command" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [permissionsOpen, setPermissionsOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const tokenInput = React.useRef<HTMLInputElement>(null);
  const commandBox = React.useRef<HTMLPreElement>(null);

  const handleError = React.useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(t("profile.apiToken.failed"));
    },
    [onUnauthorized, t],
  );

  React.useEffect(() => {
    let active = true;
    authApi
      .getApiToken()
      .then((res) => active && setInfo(res))
      .catch((err) => active && handleError(err));
    return () => {
      active = false;
    };
  }, [handleError]);

  const generate = async () => {
    if (info?.configured) {
      const ok = await confirm({
        title: t("profile.apiToken.regenerateTitle"),
        message: t("profile.apiToken.regenerateMessage"),
        confirmLabel: t("profile.apiToken.regenerate"),
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const { token, ...rest } = await authApi.generateApiToken();
      setInfo(rest);
      setNewToken(token);
      setCopied(null);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    const ok = await confirm({
      title: t("profile.apiToken.revokeTitle"),
      message: t("profile.apiToken.revokeMessage"),
      confirmLabel: t("profile.apiToken.revoke"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      setInfo(await authApi.revokeApiToken());
      setNewToken(null);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  // The clipboard API only exists on HTTPS or localhost, and self-hosted instances are often plain
  // HTTP on a LAN address; there the token is selected so it can be copied by hand.
  const copy = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied("token");
    } catch {
      tokenInput.current?.select();
    }
  };

  const mcpCommand = newToken
    ? `claude mcp add --transport http thingport ${mcpEndpoint()} \\\n  --header "Authorization: Bearer ${newToken}"`
    : "";
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(mcpCommand);
      setCopied("command");
    } catch {
      // As with the token: selected, to copy by hand.
      if (commandBox.current) window.getSelection()?.selectAllChildren(commandBox.current);
    }
  };

  const details = (() => {
    if (!info?.configured) return t("profile.apiToken.description");
    const parts = [`tp_••••${info.hint ?? ""}`];
    if (info.created_at) {
      parts.push(
        t("profile.apiToken.created", {
          date: new Date(info.created_at).toLocaleDateString(i18n.language, {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
        }),
      );
    }
    parts.push(
      info.last_used_at
        ? t("profile.apiToken.lastUsed", { when: relativeTime(info.last_used_at, i18n.language) })
        : t("profile.apiToken.neverUsed"),
    );
    return parts.join(" · ");
  })();

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body1">{t("profile.apiToken.heading")}</Typography>
          <Typography variant="caption" color="text.secondary">
            {details}
          </Typography>
        </Box>
        {info && (
          <Stack direction="row" gap={0.5} flexShrink={0} alignItems="center">
            {info.configured && (
              <Tooltip title={t("profile.apiToken.permissions.title")}>
                <IconButton
                  size="small"
                  onClick={() => setPermissionsOpen(true)}
                  aria-label={t("profile.apiToken.permissions.title")}
                >
                  <SettingsOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {info.configured && (
              <Button variant="text" color="error" disabled={busy} onClick={revoke}>
                {t("profile.apiToken.revoke")}
              </Button>
            )}
            <Button variant="text" disabled={busy} onClick={generate}>
              {info.configured ? t("profile.apiToken.regenerate") : t("profile.apiToken.generate")}
            </Button>
          </Stack>
        )}
      </Stack>

      {newToken && (
        <Alert severity="success" onClose={() => setNewToken(null)}>
          <Stack spacing={1}>
            <Typography variant="body2">{t("profile.apiToken.copyNow")}</Typography>
            <TextField
              value={newToken}
              size="small"
              fullWidth
              inputRef={tokenInput}
              onFocus={(e) => e.target.select()}
              slotProps={{
                htmlInput: { readOnly: true, spellCheck: false, sx: { fontFamily: "monospace" } },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title={copied === "token" ? t("profile.apiToken.copied") : t("profile.apiToken.copy")}>
                        <IconButton size="small" edge="end" onClick={copy} aria-label={t("profile.apiToken.copy")}>
                          {copied === "token" ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ),
                },
              }}
            />
            {info?.mcp_access !== "off" && (
              <>
                <Typography variant="body2">{t("profile.apiToken.mcp.connect")}</Typography>
                <Box sx={{ position: "relative" }}>
                  <Box
                    component="pre"
                    ref={commandBox}
                    sx={{
                      m: 0,
                      p: 1,
                      pr: 5,
                      borderRadius: 1,
                      bgcolor: "action.hover",
                      fontSize: "0.75rem",
                      overflowX: "auto",
                    }}
                  >
                    {mcpCommand}
                  </Box>
                  <Tooltip
                    title={copied === "command" ? t("profile.apiToken.copied") : t("profile.apiToken.mcp.copyCommand")}
                  >
                    <IconButton
                      size="small"
                      onClick={() => void copyCommand()}
                      aria-label={t("profile.apiToken.mcp.copyCommand")}
                      sx={{ position: "absolute", top: 4, right: 4 }}
                    >
                      {copied === "command" ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </Box>
              </>
            )}
          </Stack>
        </Alert>
      )}

      {info?.configured && (
        <ApiTokenPermissionsDialog
          open={permissionsOpen}
          onClose={() => setPermissionsOpen(false)}
          info={info}
          onChange={setInfo}
          onUnauthorized={onUnauthorized}
        />
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Stack>
  );
}
