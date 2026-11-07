import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import LinkIcon from "@mui/icons-material/Link";
import { UnauthorizedError } from "../../api/client";
import { FederationError, federationApi, type InstanceInfo, type LocalRequest, type Peer } from "../../api/federation";
import HelpTip from "../../components/HelpTip";
import { HttpChip, InstanceAvatar, KeyBlocks, Mono, ToneChip } from "./parts";
import { federationErrorText } from "./federationErrors";

type Props = {
  /** One of this instance's people's request to reach someone there: its address to start from, and it's settled
   *  by sending. */
  request?: LocalRequest | null;
  onClose: () => void;
  onSent: (peer: Peer) => void;
  onUnauthorized?: () => void;
};

/** Asking another instance to connect: its address, then its key compared with its admin before anything is sent. */
export default function ConnectDialog({ request = null, onClose, onSent, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [address, setAddress] = React.useState(request?.origin ?? "");
  const [info, setInfo] = React.useState<InstanceInfo | null>(null);
  const [matches, setMatches] = React.useState(false);
  // Kept open by this instance when theirs can't reach it: on when the lookup says it likely can't.
  const [link, setLink] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const k = (name: string) => `adminSettings.social.federation.connect.${name}`;
  // Whom the request will name: at the address checked, which the admin may have changed from the one guessed.
  const targetAtInstance =
    request?.targetHandle && info
      ? `${request.targetHandle.split("@")[0]}@${new URL(info.origin).host}`
      : request?.targetHandle;

  const fail = (err: unknown) => {
    if (err instanceof UnauthorizedError) onUnauthorized?.();
    else setError(federationErrorText(err, t));
  };
  // What the note by the link switch says: why a link was suggested, when it was.
  const linkNote = !link
    ? "linkOff"
    : info?.suggestLink === "unreachable"
      ? "linkUnreachable"
      : info?.suggestLink === "unconfirmed"
        ? "linkUnconfirmed"
        : info?.suggestLink
          ? "linkSuggested"
          : "linkOn";

  /** Whether the lookup found it. `force` is for a lookup the dialog starts itself while it's already busy. */
  const lookUp = async (event?: React.FormEvent, force = false): Promise<boolean> => {
    event?.preventDefault();
    if (!address.trim() || (busy && !force)) return false;
    setBusy(true);
    setError(null);
    try {
      const found = await federationApi.lookup(address.trim());
      setInfo(found);
      setMatches(false);
      setLink(Boolean(found.suggestLink));
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!info || !matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { peer } = await federationApi.connect(
        info.origin,
        info.fingerprint,
        note.trim() || null,
        request?.id,
        link,
      );
      onSent(peer);
    } catch (err) {
      // Its key changed meanwhile: look it up again, busy all the while, to compare the new one, and say why.
      if (err instanceof FederationError && err.code === "key_changed") {
        setInfo(null);
        if (await lookUp(undefined, true)) fail(err);
        return;
      }
      fail(err);
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1.5 }}>
        {t(k("title"))}
        <Tooltip title={t("common:close")}>
          <IconButton size="small" onClick={onClose} disabled={busy} aria-label={t("common:close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5}>
          <Stepper activeStep={info ? 1 : 0} sx={{ maxWidth: 320 }}>
            <Step>
              <StepLabel>{t(k("stepAddress"))}</StepLabel>
            </Step>
            <Step>
              <StepLabel>{t(k("stepKey"))}</StepLabel>
            </Step>
          </Stepper>
          {request && (
            <Alert severity="info" icon={false}>
              {request.targetHandle
                ? t(k("forPerson"), { who: request.userName ?? request.requesterHandle, whom: targetAtInstance })
                : t(k("forPersonInstance"), { who: request.userName ?? request.requesterHandle })}
              {request.note && (
                <Typography variant="body2" sx={{ mt: 0.5, fontStyle: "italic", overflowWrap: "anywhere" }}>
                  “{request.note}”
                </Typography>
              )}
            </Alert>
          )}
          {!info ? (
            <Box component="form" onSubmit={(event) => void lookUp(event)}>
              <TextField
                // oxlint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                fullWidth
                label={t(k("address"))}
                placeholder="http://192.168.1.30:8000"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                disabled={busy}
                helperText={t(k(request ? "addressGuessed" : "addressHelp"))}
                inputProps={{ spellCheck: false, autoCapitalize: "off" }}
              />
            </Box>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <InstanceAvatar origin={info.origin} name={info.name} />
                <Stack sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {info.name}
                  </Typography>
                  <Mono>{info.origin}</Mono>
                </Stack>
                {info.version && <ToneChip tone="neutral" label={`Thingport ${info.version}`} />}
                {info.http && <HttpChip />}
              </Stack>
              <KeyBlocks fingerprint={info.fingerprint} large />
              <Typography variant="body2">{t(k("compare"), { name: info.name })}</Typography>
              <FormControlLabel
                control={<Checkbox checked={matches} onChange={(event) => setMatches(event.target.checked)} />}
                label={t(k("matches"))}
              />
              <Box
                sx={{
                  display: "flex",
                  gap: 1.5,
                  alignItems: "flex-start",
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: (theme) => alpha(theme.palette.info.main, theme.palette.mode === "dark" ? 0.14 : 0.08),
                }}
              >
                <LinkIcon fontSize="small" color="info" sx={{ mt: 0.25 }} aria-hidden />
                <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {t(k(`${linkNote}Title`), { name: info.name })}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(k(`${linkNote}Text`), { name: info.name })}
                  </Typography>
                </Stack>
                <Stack direction="row" alignItems="center" sx={{ flex: "none" }}>
                  <Switch
                    checked={link}
                    onChange={(event) => setLink(event.target.checked)}
                    disabled={busy}
                    inputProps={{ role: "switch", "aria-label": t(k("linkSwitch")) }}
                  />
                  <HelpTip text={t(k("linkHelp"))} />
                </Stack>
              </Box>
              <TextField
                label={t(k("note"))}
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 1000))}
                multiline
                minRows={2}
                disabled={busy}
                helperText={t(k("noteHelp"))}
              />
            </Stack>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2, pb: 2 }}>
        {info && (
          <Button onClick={() => setInfo(null)} disabled={busy}>
            {t("common:back")}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={busy}>
          {t("common:cancel")}
        </Button>
        {info ? (
          <Button
            variant="contained"
            onClick={() => void send()}
            disabled={!matches || busy}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t(k("send"))}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={() => void lookUp()}
            disabled={!address.trim() || busy}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t(k("lookUp"))}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
