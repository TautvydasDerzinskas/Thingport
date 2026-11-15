import React from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import LinkIcon from "@mui/icons-material/Link";
import { adminApi } from "../../api/admin";
import { copyText } from "../../utils/clipboard";

type Props = {
  open: boolean;
  onClose: () => void;
  /** SMTP is set up, so invitations go by email; otherwise each one is a link for the admin to send. */
  emailing: boolean;
};

/** A link made in this dialog, kept until it closes. */
type MadeLink = { email: string; link: string; expiresAt: string };

const rowIn = keyframes`
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
`;
const motion = { "@media (prefers-reduced-motion: reduce)": { animation: "none" } } as const;

/** Stays open after each one, so several people can be invited in a row. */
export default function InviteUsersDialog({ open, onClose, emailing }: Props) {
  const { t } = useTranslation("app");
  const [email, setEmail] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState<{ email: string; days: number } | null>(null);
  const [links, setLinks] = React.useState<MadeLink[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const field = React.useRef<HTMLInputElement>(null);
  // The field is disabled while a request runs, which takes its focus: it gets it back after, for the next address.
  const refocus = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    setEmail("");
    setSent(null);
    setLinks([]);
    setError(null);
  }, [open]);

  React.useEffect(() => {
    if (sending || !refocus.current) return;
    refocus.current = false;
    field.current?.focus();
  }, [sending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || sending) return;
    refocus.current = true;
    setSending(true);
    setError(null);
    setSent(null);
    try {
      const res = await adminApi.inviteUser(email.trim());
      const { link } = res;
      // Any new invitation retires the address's earlier link, even an emailed one (SMTP set up meanwhile), so
      // that row goes.
      setLinks((list) => {
        const others = list.filter((other) => other.email !== res.email);
        return link ? [{ email: res.email, link, expiresAt: res.expires_at }, ...others] : others;
      });
      if (!link) setSent({ email: res.email, days: res.expires_in_days });
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("adminSettings.registrations.invite.failed"));
    } finally {
      setSending(false);
    }
  };

  const emailField = (
    <TextField
      type="email"
      label={t("adminSettings.registrations.invite.emailLabel")}
      value={email}
      onChange={(e) => setEmail(e.target.value)}
      inputRef={field}
      required
      fullWidth
      size="small"
      disabled={sending}
    />
  );

  return (
    <Dialog open={open} onClose={sending ? undefined : onClose} fullWidth maxWidth="xs">
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          {emailing ? t("adminSettings.registrations.invite.title") : t("adminSettings.registrations.invite.linkTitle")}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <DialogContentText>
              {emailing
                ? t("adminSettings.registrations.invite.description")
                : t("adminSettings.registrations.invite.linkDescription")}
            </DialogContentText>
            {sent && (
              <Alert severity="success">
                {t("adminSettings.registrations.invite.sent", { email: sent.email, count: sent.days })}
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            {emailing ? (
              emailField
            ) : (
              <Stack direction="row" spacing={1} alignItems="flex-start">
                {emailField}
                <Button type="submit" variant="contained" disabled={sending || !email.trim()} sx={{ flexShrink: 0 }}>
                  {sending
                    ? t("adminSettings.registrations.invite.creating")
                    : t("adminSettings.registrations.invite.create")}
                </Button>
              </Stack>
            )}
            {links.length > 0 && (
              <List
                dense
                disablePadding
                aria-live="polite"
                sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}
              >
                {links.map((made, i) => (
                  <LinkRow key={made.link} made={made} divider={i < links.length - 1} />
                ))}
              </List>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={sending}>
            {t("adminSettings.registrations.invite.close")}
          </Button>
          {emailing && (
            <Button type="submit" variant="contained" disabled={sending || !email.trim()}>
              {sending ? t("adminSettings.registrations.invite.sending") : t("adminSettings.registrations.invite.send")}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** One link to send: its address, when it stops working, and a copy button. Where the browser won't copy, the link
 *  shows in place of the date, selected, to copy by hand. */
function LinkRow({ made, divider }: { made: MadeLink; divider: boolean }) {
  const { t, i18n } = useTranslation("app");
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const shown = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1500);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  React.useEffect(() => {
    if (copyState === "failed" && shown.current) window.getSelection()?.selectAllChildren(shown.current);
  }, [copyState]);

  const copy = async () => {
    try {
      await copyText(made.link);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const until = new Date(made.expiresAt).toLocaleDateString(i18n.language, { day: "numeric", month: "short" });
  const tip =
    copyState === "copied"
      ? t("adminSettings.registrations.invite.copied")
      : copyState === "failed"
        ? t("adminSettings.registrations.invite.copyFailed")
        : t("adminSettings.registrations.invite.copyLink");

  return (
    <ListItem
      divider={divider}
      sx={{ animation: `${rowIn} 200ms ease-out`, ...motion }}
      secondaryAction={
        <Tooltip title={tip}>
          <IconButton
            edge="end"
            aria-label={t("adminSettings.registrations.invite.copyLinkFor", { email: made.email })}
            color={copyState === "copied" ? "success" : "default"}
            onClick={() => void copy()}
          >
            {copyState === "copied" ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      }
    >
      <ListItemIcon sx={{ minWidth: 36 }}>
        <LinkIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText
        primary={made.email}
        secondary={
          copyState === "failed" ? (
            <Box
              component="span"
              ref={shown}
              sx={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", wordBreak: "break-all" }}
            >
              {made.link}
            </Box>
          ) : (
            t("adminSettings.registrations.invite.worksUntil", { date: until })
          )
        }
        slotProps={{ primary: { noWrap: true } }}
      />
    </ListItem>
  );
}
