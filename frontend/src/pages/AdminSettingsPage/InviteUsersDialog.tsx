import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { adminApi } from "../../api/admin";

type Props = {
  open: boolean;
  onClose: () => void;
};

/** Stays open after sending, so several people can be invited in a row. */
export default function InviteUsersDialog({ open, onClose }: Props) {
  const { t } = useTranslation("app");
  const [email, setEmail] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState<{ email: string; days: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEmail("");
    setSent(null);
    setError(null);
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || sending) return;
    setSending(true);
    setError(null);
    setSent(null);
    try {
      const res = await adminApi.inviteUser(email.trim());
      setSent({ email: res.email, days: res.expires_in_days });
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("adminSettings.registrations.invite.failed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} fullWidth maxWidth="xs">
      <form onSubmit={handleSubmit}>
        <DialogTitle>{t("adminSettings.registrations.invite.title")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <DialogContentText>{t("adminSettings.registrations.invite.description")}</DialogContentText>
            {sent && (
              <Alert severity="success">
                {t("adminSettings.registrations.invite.sent", { email: sent.email, count: sent.days })}
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              type="email"
              label={t("adminSettings.registrations.invite.emailLabel")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
              size="small"
              disabled={sending}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={sending}>
            {t("adminSettings.registrations.invite.close")}
          </Button>
          <Button type="submit" variant="contained" disabled={sending || !email.trim()}>
            {sending ? t("adminSettings.registrations.invite.sending") : t("adminSettings.registrations.invite.send")}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
