import React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import BlockIcon from "@mui/icons-material/Block";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import { UnauthorizedError } from "../../api/client";
import {
  federationApi,
  type IncomingRequest,
  type Instances,
  type LocalRequest,
  type Peer,
} from "../../api/federation";
import { useConfirm } from "../../components/ConfirmProvider";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import Segmented from "../../components/controls/Segmented";
import { useToast } from "../../components/ToastProvider";
import { relativeTime } from "../../utils/relativeTime";
import ConnectDialog from "./ConnectDialog";
import { federationErrorText } from "./federationErrors";
import KeyDialog from "./KeyDialog";
import { HttpChip, InstanceAvatar, Mono, ToneChip } from "./parts";
import { RequestReviewDialog, RequestReviewInline, type ReviewOutcome } from "./RequestReview";

type Tab = "requests" | "partners" | "blocked";
const k = (name: string) => `adminSettings.social.federation.instances.${name}`;
const REFRESH_MS = 20_000;

type Props = {
  onUnauthorized?: () => void;
};

/** Requests, partners and blocked instances, while connected instances are on. */
export default function InstancesSection({ onUnauthorized }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const showToast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = React.useState<Instances | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>("requests");
  const [connecting, setConnecting] = React.useState(false);
  // Connecting for one of this instance's people, from their request.
  const [connectingFor, setConnectingFor] = React.useState<LocalRequest | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [key, setKey] = React.useState<Peer | null>(null);
  const ago = (iso: string | null) => (iso ? relativeTime(iso, i18n.language) : null);

  const load = React.useCallback(() => {
    federationApi.instances().then(
      (value) => {
        setData(value);
        setLoadFailed(false);
      },
      (err) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setLoadFailed(true);
      },
    );
  }, [onUnauthorized]);

  // Requests can come in at any time: read again now and then, and when the tab comes back.
  React.useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    const onReturn = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [load]);

  // Opened from a notification: that request, in its own dialog -- another instance's to review, or one of this
  // instance's people's to connect for.
  const asked = searchParams.get("request");
  const reviewing = asked ? (data?.incoming.find((request) => request.id === asked) ?? null) : null;
  React.useEffect(() => {
    if (!asked || !data) return;
    if (data.incoming.some((request) => request.id === asked)) return;
    const local = data.local.find((request) => request.id === asked);
    if (local) setConnectingFor(local);
    else showToast({ message: t(k("alreadyAnswered")), severity: "info" });
    setSearchParams({}, { replace: true });
  }, [asked, data, setSearchParams, showToast, t]);
  const closeReview = () => setSearchParams({}, { replace: true });

  const reviewed = (request: IncomingRequest, outcome: ReviewOutcome) => {
    setOpen(null);
    closeReview();
    showToast({ message: t(k(`outcome.${outcome}`), { name: request.name }) });
    load();
  };

  const counts = {
    requests: (data?.incoming.length ?? 0) + (data?.local.length ?? 0) + (data?.outgoing.length ?? 0),
    partners: data?.partners.length ?? 0,
    blocked: data?.blocked.length ?? 0,
  };
  const label = (name: Tab) => (counts[name] ? `${t(k(`tabs.${name}`))} (${counts[name]})` : t(k(`tabs.${name}`)));

  return (
    <Paper variant="outlined">
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 2.5, py: 1.75 }}>
        <Segmented
          label={t(k("tabsLabel"))}
          value={tab}
          onChange={setTab}
          options={(["requests", "partners", "blocked"] as const).map((value) => ({ value, label: label(value) }))}
        />
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setConnecting(true)}>
          {t(k("connect"))}
        </Button>
      </Stack>
      <Divider />
      {loadFailed && (
        <Alert
          severity="error"
          sx={{ m: 2 }}
          action={
            <Button color="inherit" size="small" onClick={load}>
              {t("common:retry")}
            </Button>
          }
        >
          {t(k("loadFailed"))}
        </Alert>
      )}
      {!data && !loadFailed && (
        <Box sx={{ px: 2.5, py: 1.5 }}>
          <ListRowSkeletons count={3} twoLines />
        </Box>
      )}
      {data && tab === "requests" && (
        <Box sx={{ pb: 1 }}>
          {counts.requests === 0 && <Empty text={t(k("noRequests"))} hint={t(k("noRequestsHint"))} />}
          {data.incoming.length > 0 && <GroupLabel>{t(k("asking"))}</GroupLabel>}
          {data.incoming.map((request) => (
            <Box key={request.id} sx={open === request.id ? { bgcolor: "action.hover" } : undefined}>
              <Row
                origin={request.origin}
                name={request.name}
                http={request.http}
                line={[
                  request.requesterHandle
                    ? t(k("askedByPerson"), { who: request.requesterHandle })
                    : t(k("askedByAdmin")),
                  ago(request.createdAt),
                ]}
                trailing={
                  <Tooltip title={open === request.id ? t(k("hide")) : t(k("review"))}>
                    <IconButton
                      onClick={() => setOpen(open === request.id ? null : request.id)}
                      aria-expanded={open === request.id}
                      aria-label={t(open === request.id ? k("hideNamed") : k("reviewNamed"), { name: request.name })}
                    >
                      {open === request.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  </Tooltip>
                }
              />
              <Collapse in={open === request.id} unmountOnExit>
                <Box sx={{ px: 2.5, pb: 2, pl: { xs: 2.5, sm: 9 } }}>
                  <RequestReviewInline
                    request={request}
                    onDone={(outcome) => reviewed(request, outcome)}
                    onUnauthorized={onUnauthorized}
                  />
                </Box>
              </Collapse>
            </Box>
          ))}
          {data.local.length > 0 && <GroupLabel>{t(k("fromUsers"))}</GroupLabel>}
          {data.local.map((request) => (
            <LocalRow
              key={request.id}
              request={request}
              ago={ago}
              onConnect={() => setConnectingFor(request)}
              onChanged={load}
              onUnauthorized={onUnauthorized}
            />
          ))}
          {data.outgoing.length > 0 && <GroupLabel>{t(k("waiting"))}</GroupLabel>}
          {data.outgoing.map((peer) => (
            <OutgoingRow key={peer.id} peer={peer} onChanged={load} onUnauthorized={onUnauthorized} ago={ago} />
          ))}
        </Box>
      )}
      {data && tab === "partners" && (
        <Box sx={{ pb: 1 }}>
          {data.partners.length === 0 && (
            <Empty
              text={t(k("noPartners"))}
              hint={t(k("noPartnersHint"))}
              action={
                <Button startIcon={<AddIcon />} onClick={() => setConnecting(true)}>
                  {t(k("connect"))}
                </Button>
              }
            />
          )}
          {data.partners.map((peer) => (
            <PartnerRow
              key={peer.id}
              peer={peer}
              ago={ago}
              onChanged={load}
              onShowKey={() => setKey(peer)}
              onUnauthorized={onUnauthorized}
            />
          ))}
        </Box>
      )}
      {data && tab === "blocked" && (
        <Box sx={{ pb: 1 }}>
          {data.blocked.length === 0 && <Empty text={t(k("noBlocked"))} hint={t(k("noBlockedHint"))} />}
          {data.blocked.map((peer) => (
            <BlockedRow key={peer.id} peer={peer} ago={ago} onChanged={load} onUnauthorized={onUnauthorized} />
          ))}
        </Box>
      )}

      {(connecting || connectingFor) && (
        <ConnectDialog
          request={connectingFor}
          onClose={() => {
            setConnecting(false);
            setConnectingFor(null);
          }}
          onSent={(peer) => {
            setConnecting(false);
            setConnectingFor(null);
            setTab("requests");
            showToast({ message: t(k("sent"), { name: peer.name }) });
            load();
          }}
          onUnauthorized={onUnauthorized}
        />
      )}
      {reviewing && (
        <RequestReviewDialog
          request={reviewing}
          onClose={closeReview}
          onDone={(outcome) => reviewed(reviewing, outcome)}
          onUnauthorized={onUnauthorized}
        />
      )}
      {key?.fingerprint && (
        <KeyDialog fingerprint={key.fingerprint} name={key.name} origin={key.origin} onClose={() => setKey(null)} />
      )}
    </Paper>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      fontWeight={700}
      color="text.secondary"
      component="div"
      sx={{ px: 2.5, pt: 1.75, pb: 0.5 }}
    >
      {children}
    </Typography>
  );
}

function Empty({ text, hint, action }: { text: string; hint: string; action?: React.ReactNode }) {
  return (
    <Stack alignItems="center" spacing={0.5} sx={{ py: 5, px: 2, textAlign: "center" }}>
      <Typography variant="body2" fontWeight={600}>
        {text}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {hint}
      </Typography>
      {action}
    </Stack>
  );
}

/** One instance in a list: who it is, a line about it, and what can be done. */
function Row({
  origin,
  name,
  http,
  line,
  note,
  status,
  trailing,
  onContextMenu,
}: {
  origin: string;
  name: string;
  http: boolean;
  line: (string | null)[];
  /** What someone wrote with a request. */
  note?: string | null;
  status?: React.ReactNode;
  trailing?: React.ReactNode;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return (
    <Stack direction="row" spacing={1.75} alignItems="center" sx={{ px: 2.5, py: 1.25 }} onContextMenu={onContextMenu}>
      <InstanceAvatar origin={origin} name={name} />
      <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.25}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" fontWeight={600}>
            {name}
          </Typography>
          <Mono>{origin}</Mono>
          {http && <HttpChip />}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {line.filter(Boolean).join(" · ")}
        </Typography>
        {note && (
          <Typography variant="caption" sx={{ fontStyle: "italic", overflowWrap: "anywhere" }}>
            “{note}”
          </Typography>
        )}
      </Stack>
      {status}
      {trailing}
    </Stack>
  );
}

type RowProps = {
  peer: Peer;
  ago: (iso: string | null) => string | null;
  onChanged: () => void;
  onUnauthorized?: () => void;
};

function useAct(onChanged: () => void, onUnauthorized?: () => void) {
  const { t } = useTranslation(["app", "common"]);
  const showToast = useToast();
  return async (run: () => Promise<unknown>, done?: string) => {
    try {
      await run();
      if (done) showToast({ message: done });
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: federationErrorText(err, t), severity: "error" });
    }
    onChanged();
  };
}

/** One of this instance's people asking to reach someone on an instance it isn't connected with. */
function LocalRow({
  request,
  ago,
  onConnect,
  onChanged,
  onUnauthorized,
}: {
  request: LocalRequest;
  ago: (iso: string | null) => string | null;
  onConnect: () => void;
  onChanged: () => void;
  onUnauthorized?: () => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const act = useAct(onChanged, onUnauthorized);
  const host = new URL(request.origin).host;
  const who = request.userName ?? request.requesterHandle ?? t(k("someone"));
  const decline = async () => {
    const ok = await confirm({
      title: t(k("declineUserTitle"), { who }),
      message: t(k("declineUserText"), { who, host }),
      confirmLabel: t(k("decline")),
      destructive: true,
    });
    if (ok) await act(() => federationApi.decline(request.id), t(k("declinedUser"), { who }));
  };
  return (
    <Row
      origin={request.origin}
      name={host}
      http={request.http}
      line={[
        request.targetHandle
          ? t(k("wantsToReach"), { who, whom: request.targetHandle })
          : t(k("wantsToConnect"), { who }),
        ago(request.createdAt),
      ]}
      note={request.note}
      trailing={
        <Stack direction="row" spacing={1}>
          <Button size="small" color="inherit" onClick={() => void decline()}>
            {t(k("decline"))}
          </Button>
          <Button size="small" variant="outlined" onClick={onConnect}>
            {t(k("connectFor"))}
          </Button>
        </Stack>
      }
    />
  );
}

function OutgoingRow({ peer, ago, onChanged, onUnauthorized }: RowProps) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const act = useAct(onChanged, onUnauthorized);
  const cancel = async () => {
    const ok = await confirm({
      title: t(k("cancelTitle"), { name: peer.name }),
      message: t(k("cancelText"), { name: peer.name }),
      confirmLabel: t(k("cancel")),
      destructive: true,
    });
    if (ok) await act(() => federationApi.disconnect(peer.id), t(k("cancelled"), { name: peer.name }));
  };
  return (
    <Row
      origin={peer.origin}
      name={peer.name}
      http={peer.http}
      line={[t(k("waitingForThem")), ago(peer.createdAt), peer.lastError && peer.pending ? t(k("notDelivered")) : null]}
      trailing={
        <Button size="small" color="inherit" variant="outlined" onClick={() => void cancel()}>
          {t(k("cancel"))}
        </Button>
      }
    />
  );
}

function PartnerRow({ peer, ago, onChanged, onShowKey, onUnauthorized }: RowProps & { onShowKey: () => void }) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const act = useAct(onChanged, onUnauthorized);
  const [anchor, setAnchor] = React.useState<{ el?: HTMLElement; x?: number; y?: number } | null>(null);
  const close = () => setAnchor(null);
  const unreachable = Boolean(peer.lastError && peer.pending > 0);
  const status =
    peer.status === "PAUSED" ? (
      <ToneChip tone="neutral" icon={<PauseIcon />} label={t(k("paused"))} />
    ) : unreachable ? (
      <Tooltip title={peer.lastError ?? ""}>
        <span>
          <ToneChip tone="warning" label={t(k("unreachable"))} />
        </span>
      </Tooltip>
    ) : (
      <ToneChip tone="success" label={t(k("active"))} />
    );

  const destroy = async (kind: "disconnect" | "block") => {
    close();
    const ok = await confirm({
      title: t(k(`${kind}Title`), { name: peer.name }),
      message: t(k(`${kind}Text`), { name: peer.name }),
      confirmLabel: t(k(kind)),
      destructive: true,
    });
    if (!ok) return;
    await act(
      () => (kind === "block" ? federationApi.block(peer.id) : federationApi.disconnect(peer.id)),
      t(k(kind === "block" ? "blocked" : "disconnected"), { name: peer.name }),
    );
  };

  return (
    <>
      <Row
        origin={peer.origin}
        name={peer.name}
        http={peer.http}
        line={[
          peer.connectedAt ? t(k("connectedSince"), { when: ago(peer.connectedAt) }) : null,
          peer.lastSeenAt ? t(k("seen"), { when: ago(peer.lastSeenAt) }) : null,
          peer.pending ? t(k("pending"), { count: peer.pending }) : null,
        ]}
        status={status}
        onContextMenu={(event) => {
          event.preventDefault();
          setAnchor({ x: event.clientX, y: event.clientY });
        }}
        trailing={
          <Tooltip title={t(k("more"))}>
            <IconButton
              onClick={(event) => setAnchor({ el: event.currentTarget })}
              aria-label={t(k("moreNamed"), { name: peer.name })}
            >
              <MoreVertIcon />
            </IconButton>
          </Tooltip>
        }
      />
      <Menu
        open={anchor !== null}
        onClose={close}
        anchorEl={anchor?.el}
        anchorReference={anchor?.el ? "anchorEl" : "anchorPosition"}
        anchorPosition={anchor?.x !== undefined ? { top: anchor.y!, left: anchor.x } : undefined}
      >
        <MenuItem
          onClick={() => {
            close();
            void act(() => federationApi.checkPeer(peer.id), t(k("checked"), { name: peer.name }));
          }}
        >
          <ListItemIcon>
            <RefreshIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t(k("check"))}</ListItemText>
        </MenuItem>
        {peer.fingerprint && (
          <MenuItem
            onClick={() => {
              close();
              onShowKey();
            }}
          >
            <ListItemIcon>
              <KeyOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t(k("showKey"))}</ListItemText>
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            close();
            const paused = peer.status !== "PAUSED";
            void act(
              () => federationApi.pause(peer.id, paused),
              t(k(paused ? "pausedDone" : "resumedDone"), { name: peer.name }),
            );
          }}
        >
          <ListItemIcon>
            {peer.status === "PAUSED" ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{t(k(peer.status === "PAUSED" ? "resume" : "pause"))}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => void destroy("disconnect")} sx={{ color: "error.main" }}>
          <ListItemIcon sx={{ color: "inherit" }}>
            <LinkOffIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t(k("disconnect"))}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => void destroy("block")} sx={{ color: "error.main" }}>
          <ListItemIcon sx={{ color: "inherit" }}>
            <BlockIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t(k("block"))}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

function BlockedRow({ peer, onChanged, onUnauthorized }: RowProps) {
  const { t } = useTranslation(["app", "common"]);
  const act = useAct(onChanged, onUnauthorized);
  return (
    <Row
      origin={peer.origin}
      name={peer.name}
      http={peer.http}
      line={[t(k("blockedHint"))]}
      trailing={
        <Button
          size="small"
          color="inherit"
          variant="outlined"
          onClick={() => void act(() => federationApi.unblock(peer.id), t(k("unblocked"), { name: peer.name }))}
        >
          {t(k("unblock"))}
        </Button>
      }
    />
  );
}
