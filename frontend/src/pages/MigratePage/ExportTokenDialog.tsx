import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import { UnauthorizedError } from "../../api/client";
import { migrateApi, type ExportToken } from "../../api/migrate";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToastHost } from "../../components/ToastProvider";
import { copyText } from "../../utils/clipboard";
import { errorText, k, requestError } from "./parts";

type Props = {
  state: ExportToken | null;
  onChanged: (state: ExportToken) => void;
  onClose: () => void;
  onUnauthorized?: () => void;
};

/** On the old instance: the token that lets another instance copy this one online, for a day. Its value is shown when
 *  it's made, and never again. */
export default function ExportTokenDialog({ state, onChanged, onClose, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const paperRef = useToastHost(true);
  const [made, setMade] = React.useState<{ token: string; expires_at: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const tokenRef = React.useRef<HTMLElement>(null);
  const time = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  // Over plain HTTP the token, and the database it opens, travel as they are.
  const plainHttp =
    window.location.protocol === "http:" && !["localhost", "127.0.0.1"].includes(window.location.hostname);

  const act = async (work: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(errorText(t, requestError(err)));
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    act(async () => {
      const next = await migrateApi.createExportToken();
      setMade(next);
      setCopied(false);
      onChanged({ active: true, expires_at: next.expires_at, used_at: null });
    });

  const revoke = async () => {
    const ok = await confirm({
      title: t(k("export.revoke")),
      message: t(k("export.revokeConfirm")),
      confirmLabel: t(k("export.revoke")),
      destructive: true,
    });
    if (!ok) return;
    await act(async () => {
      await migrateApi.revokeExportToken();
      setMade(null);
      onChanged({ active: false, expires_at: null, used_at: null });
    });
  };

  // Where the browser won't copy, the token is selected, to copy by hand.
  const copy = async () => {
    if (!made) return;
    try {
      await copyText(made.token);
      setError(null);
      setCopied(true);
    } catch {
      if (tokenRef.current) window.getSelection()?.selectAllChildren(tokenRef.current);
      setError(t(k("export.copyFailed")));
    }
  };

  const active = Boolean(made || state?.active);
  const expires = made?.expires_at ?? state?.expires_at ?? null;

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" PaperProps={{ ref: paperRef }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1.5 }}>
        {t(k("export.dialogTitle"))}
        <Tooltip title={t("common:close")}>
          <IconButton size="small" onClick={onClose} disabled={busy} aria-label={t("common:close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {t(k("export.explain"))}
          </Typography>
          {plainHttp && <Alert severity="warning">{t(k("export.http"))}</Alert>}
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {made ? (
            <Stack spacing={1}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: "action.hover",
                }}
              >
                <Typography
                  ref={tokenRef}
                  component="code"
                  variant="body2"
                  sx={{ flex: 1, fontFamily: "monospace", overflowWrap: "anywhere", userSelect: "all" }}
                >
                  {made.token}
                </Typography>
                <Tooltip title={t(k(copied ? "export.copied" : "export.copy"))}>
                  <IconButton size="small" onClick={() => void copy()} aria-label={t(k("export.copy"))}>
                    {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </Box>
              <Typography variant="body2" fontWeight={600}>
                {t(k("export.copyNow"))}
              </Typography>
            </Stack>
          ) : null}
          {active && expires && (
            <Typography variant="body2">
              {t(k("export.until"), { time: time(expires) })}
              {!made && state?.used_at ? ` ${t(k("export.used"), { time: time(state.used_at) })}` : ""}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {active && (
          <Button color="error" onClick={() => void revoke()} disabled={busy}>
            {t(k("export.revoke"))}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button
          variant={made ? "text" : "contained"}
          startIcon={busy ? <CircularProgress size={16} /> : <KeyOutlinedIcon />}
          onClick={() => void create()}
          disabled={busy}
        >
          {t(k(active ? "export.replace" : "export.create"))}
        </Button>
        {made && (
          <Button variant="contained" onClick={onClose} disabled={busy}>
            {t("common:close")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
