import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import { UnauthorizedError } from "../../api/client";
import { connectionRequestsApi, FederationError, type MyRequest, type MyRequestStatus } from "../../api/federation";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import ToneChip from "../../components/ToneChip";
import { useToast } from "../../components/ToastProvider";
import type { StatusTone } from "../../theme";

const TONE: Record<MyRequestStatus, StatusTone> = {
  waiting_admin: "warning",
  waiting_them: "info",
  connected: "success",
  declined: "error",
};

const REFRESH_MS = 15_000;

type Props = {
  onClose: () => void;
  onUnauthorized?: () => void;
};

/** Asking to reach someone on another Thingport instance: a note for this instance's admins, who connect if they
 *  agree. Nothing goes out to that instance from here. */
export default function SomeoneElsewhereDialog({ onClose, onUnauthorized }: Props) {
  const { t } = useTranslation(["models", "common"]);
  const showToast = useToast();
  const [handle, setHandle] = React.useState("");
  const [note, setNote] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mine, setMine] = React.useState<MyRequest[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const k = (name: string) => `explore.elsewhere.${name}`;

  // Only the latest read counts.
  const latest = React.useRef(0);
  const load = React.useCallback(() => {
    const asked = ++latest.current;
    connectionRequestsApi.mine().then(
      (value) => {
        if (asked !== latest.current) return;
        setMine(value);
        setLoadFailed(false);
      },
      (err) => {
        if (asked !== latest.current) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setLoadFailed(true);
      },
    );
  }, [onUnauthorized]);
  // An admin may answer while it's open: read again now and then, so Withdraw goes once it can't.
  React.useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      latest.current += 1;
    };
  }, [load]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!handle.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const request = await connectionRequestsApi.create(handle.trim(), note.trim() || null);
      showToast({ message: t(k("sent"), { handle: request.handle }) });
      setHandle("");
      setNote("");
      load();
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else if (err instanceof FederationError && err.code) {
        setError(t(`explore.elsewhere.errors.${err.code}`, { defaultValue: err.message }));
      } else setError(err instanceof Error ? err.message : t(k("failed")));
    } finally {
      setSending(false);
    }
  };

  const withdraw = async (request: MyRequest) => {
    try {
      await connectionRequestsApi.cancel(request.id);
      showToast({ message: t(k("withdrawn"), { handle: request.handle }) });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : t(k("failed")), severity: "error" });
    }
    load();
  };

  return (
    <Dialog open onClose={sending ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1.5 }}>
        {t(k("title"))}
        <Tooltip title={t("common:close")}>
          <IconButton size="small" onClick={onClose} aria-label={t("common:close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        <Stack component="form" spacing={2} onSubmit={(event) => void send(event)}>
          <Typography variant="body2" color="text.secondary">
            {t(k("intro"))}
          </Typography>
          <TextField
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            label={t(k("handle"))}
            placeholder={t(k("handlePlaceholder"))}
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            disabled={sending}
            inputProps={{ spellCheck: false, autoCapitalize: "off", autoComplete: "off" }}
          />
          <TextField
            label={t(k("note"))}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 1000))}
            multiline
            minRows={2}
            disabled={sending}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              type="submit"
              variant="contained"
              disabled={!handle.trim() || sending}
              startIcon={sending ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {t(k("ask"))}
            </Button>
          </Box>
        </Stack>

        {loadFailed && (
          <Alert
            severity="warning"
            sx={{ mt: 2 }}
            action={
              <Button color="inherit" size="small" onClick={load}>
                {t("common:retry")}
              </Button>
            }
          >
            {t(k("loadFailed"))}
          </Alert>
        )}
        {mine === null
          ? !loadFailed && (
              <Box sx={{ mt: 2 }}>
                <ListRowSkeletons count={2} lead="circle" leadSize={32} />
              </Box>
            )
          : mine.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary" component="h3" sx={{ m: 0 }}>
                  {t(k("yours"))}
                </Typography>
                <Stack divider={<Divider flexItem />} sx={{ mt: 1 }}>
                  {mine.map((request) => (
                    <Stack key={request.id} direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
                      <Avatar sx={{ width: 32, height: 32, fontSize: 14 }} aria-hidden>
                        {request.handle[0]?.toUpperCase()}
                      </Avatar>
                      <Stack sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {request.handle.split("@")[0]}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {request.handle}
                        </Typography>
                      </Stack>
                      <ToneChip tone={TONE[request.status]} label={t(k(`status.${request.status}`))} />
                      {request.status === "waiting_admin" && (
                        <Button size="small" color="inherit" onClick={() => void withdraw(request)}>
                          {t(k("withdraw"))}
                        </Button>
                      )}
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
      </DialogContent>
    </Dialog>
  );
}
