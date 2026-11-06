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
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import BlockIcon from "@mui/icons-material/Block";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { UnauthorizedError } from "../../api/client";
import { FederationError, federationApi, type IncomingRequest, type RequestDetails } from "../../api/federation";
import { useConfirm } from "../../components/ConfirmProvider";
import HelpTip from "../../components/HelpTip";
import { federationErrorText } from "./federationErrors";
import { HttpChip, InstanceAvatar, KeyBlocks, Mono, ToneChip } from "./parts";

export type ReviewOutcome = "approved" | "declined" | "blocked";

/** An incoming request opened: checked against the instance's key, and the admin's three answers. The dialog and the
 *  row that opens in place both use it. */
function useRequestReview(
  request: IncomingRequest,
  onDone: (outcome: ReviewOutcome) => void,
  onUnauthorized: (() => void) | undefined,
  header: boolean,
) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const [details, setDetails] = React.useState<RequestDetails | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<ReviewOutcome | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Ticked once the key shown matches what their admin reads out: compared again whenever it's read again.
  const [matches, setMatches] = React.useState(false);
  const k = (name: string) => `adminSettings.social.federation.review.${name}`;

  // Only the latest read counts: an older one answering late would show a key other than the one ticked as compared.
  const latest = React.useRef(0);
  const load = React.useCallback(() => {
    const asked = ++latest.current;
    setLoadError(null);
    setDetails(null);
    setMatches(false);
    federationApi.request(request.id).then(
      (value) => {
        if (asked === latest.current) setDetails(value);
      },
      (err) => {
        if (asked !== latest.current) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setLoadError(federationErrorText(err, t));
      },
    );
  }, [request.id, onUnauthorized, t]);
  React.useEffect(() => {
    load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  const act = async (outcome: ReviewOutcome) => {
    const name = details?.name ?? request.name;
    if (outcome !== "approved") {
      const ok = await confirm({
        title: t(k(outcome === "blocked" ? "blockTitle" : "declineTitle"), { name }),
        message: t(k(outcome === "blocked" ? "blockText" : "declineText"), { name }),
        confirmLabel: t(k(outcome === "blocked" ? "block" : "decline")),
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(outcome);
    setError(null);
    // The request that checked out: a newer one under the same address may have been forged and dropped.
    const id = details?.id ?? request.id;
    try {
      if (outcome === "approved") await federationApi.approve(id, details!.fingerprint);
      else if (outcome === "declined") await federationApi.decline(id);
      else await federationApi.blockRequest(id);
      onDone(outcome);
    } catch (err) {
      setBusy(null);
      if (err instanceof UnauthorizedError) {
        onUnauthorized?.();
        return;
      }
      // Its key changed since it was read: read it again, to compare the new one.
      if (err instanceof FederationError && err.code === "key_changed") load();
      setError(federationErrorText(err, t));
    }
  };

  const help = [t(k("helpShare")), t(k("helpLater"))];
  // Once it's checked, what the request that checked out says; until then, what the list had, as it came.
  const verified = details?.request;
  const listed = request.asks?.length
    ? request.asks
    : request.requesterHandle
      ? [{ requesterHandle: request.requesterHandle, targetHandle: request.targetHandle }]
      : [];
  const asks = (
    verified
      ? verified.asks
      : listed.map(({ requesterHandle, targetHandle }) => ({ requesterHandle, targetHandle, target: null }))
  )
    .filter((ask) => ask.requesterHandle)
    .map(({ requesterHandle, targetHandle, target }, position) => ({
      requesterHandle,
      targetHandle,
      target,
      key: `${position}:${requesterHandle}`,
    }));
  const note = verified ? verified.note : request.note;
  const content = (
    <Stack spacing={2}>
      <Stack spacing={1.25}>
        {header && (
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <InstanceAvatar origin={request.origin} name={details?.name ?? request.name} size={44} />
            <Stack sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" fontWeight={600}>
                {details?.name ?? request.name}
              </Typography>
              <Mono>{request.origin}</Mono>
            </Stack>
            {details?.version && <ToneChip tone="neutral" label={`Thingport ${details.version}`} />}
            {request.http && <HttpChip />}
          </Stack>
        )}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" color="text.secondary">
            {t(k("key"))}
          </Typography>
          {details ? (
            <KeyBlocks fingerprint={details.fingerprint} />
          ) : loadError ? null : (
            <Skeleton variant="rounded" width={260} height={22} />
          )}
          {details && <HelpTip text={t(k("keyHelp"))} />}
        </Stack>
        {details && (
          <FormControlLabel
            sx={{ m: 0 }}
            control={<Checkbox size="small" checked={matches} onChange={(event) => setMatches(event.target.checked)} />}
            label={<Typography variant="body2">{t(k("compare"), { name: details.name })}</Typography>}
          />
        )}
      </Stack>
      <Box>
        <Typography variant="caption" color="text.secondary" fontWeight={700} component="div" sx={{ mb: 0.5 }}>
          {t(k("askedBy"))}
        </Typography>
        {asks.length ? (
          <Stack spacing={0.75}>
            {asks.map((ask) => (
              <Box key={ask.key}>
                <Typography variant="body2">
                  {ask.targetHandle
                    ? t(k("personForPerson"), { who: ask.requesterHandle, whom: ask.targetHandle })
                    : t(k("person"), { who: ask.requesterHandle })}
                </Typography>
                {details && ask.targetHandle && (
                  <Typography variant="caption" color={ask.target ? "text.secondary" : "warning.main"} component="div">
                    {ask.target
                      ? t(k("targetHere"), { name: ask.target.displayName, handle: `@${ask.target.username}` })
                      : t(k("targetMissing"), { handle: ask.targetHandle })}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2">{t(k("theirAdmin"))}</Typography>
        )}
      </Box>
      {note && (
        <Typography
          variant="body2"
          sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1.5, py: 1, overflowWrap: "anywhere" }}
        >
          {note}
        </Typography>
      )}
      {loadError && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={load}>
              {t("common:retry")}
            </Button>
          }
        >
          {loadError}
        </Alert>
      )}
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography variant="body2" color="text.secondary">
          {t(k("approving"))}
        </Typography>
        <HelpTip
          text={help.join(" ")}
          content={
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {help.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </Box>
          }
        />
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );

  const spinner = (outcome: ReviewOutcome) =>
    busy === outcome ? <CircularProgress size={16} color="inherit" /> : undefined;
  const actions = (
    <>
      <Button
        color="error"
        startIcon={spinner("blocked") ?? <BlockIcon />}
        onClick={() => void act("blocked")}
        disabled={busy !== null}
      >
        {t(k("block"))}
      </Button>
      <Box sx={{ flex: 1 }} />
      <Button
        color="inherit"
        onClick={() => void act("declined")}
        disabled={busy !== null}
        startIcon={spinner("declined")}
      >
        {t(k("decline"))}
      </Button>
      <Button
        variant="contained"
        startIcon={spinner("approved") ?? <CheckIcon />}
        onClick={() => void act("approved")}
        disabled={busy !== null || !details || !matches}
      >
        {t(k("approve"))}
      </Button>
    </>
  );
  return { content, actions, name: details?.name ?? request.name };
}

type Props = {
  request: IncomingRequest;
  onDone: (outcome: ReviewOutcome) => void;
  onUnauthorized?: () => void;
};

/** 3A: a request opened from its notification, in a dialog of its own. Closed undecided, it stays in Requests. */
export function RequestReviewDialog({ request, onDone, onClose, onUnauthorized }: Props & { onClose: () => void }) {
  const { t } = useTranslation(["app", "common"]);
  const { content, actions, name } = useRequestReview(request, onDone, onUnauthorized, true);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1.5 }}>
        {t("adminSettings.social.federation.review.title", { name })}
        <Tooltip title={t("common:close")}>
          <IconButton size="small" onClick={onClose} aria-label={t("common:close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent>{content}</DialogContent>
      <DialogActions sx={{ px: 2, pb: 2 }}>{actions}</DialogActions>
    </Dialog>
  );
}

/** 3B: the same, opened in place in the Requests list. */
export function RequestReviewInline({ request, onDone, onUnauthorized }: Props) {
  const { content, actions } = useRequestReview(request, onDone, onUnauthorized, false);
  return (
    <Stack spacing={2}>
      {content}
      <Stack direction="row" spacing={1} alignItems="center">
        {actions}
      </Stack>
    </Stack>
  );
}
