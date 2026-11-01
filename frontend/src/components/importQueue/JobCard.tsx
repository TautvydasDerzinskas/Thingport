import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ErrorIcon from "@mui/icons-material/Error";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderZipOutlinedIcon from "@mui/icons-material/FolderZipOutlined";
import LinkIcon from "@mui/icons-material/Link";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { ImportJobItem } from "../../api/imports";
import { neutralTint, statusTint } from "../../theme";
import { useConfirm } from "../ConfirmProvider";
import HelpTip from "../HelpTip";
import { hasProviderLogo, ProviderLogo } from "../Layout/ConfigurationDialog/providerLogos";
import { reopenContextMenuBelow, useCardContextMenu } from "../Layout/ConfigurationDialog/AppTiles";
import { ListRowSkeletons } from "../ListSkeleton";
import { dialogIconButtonSx } from "../SectionedDialog";
import { useImportQueue } from "./ImportQueueContext";
import { cardMark, focusingCardAfter, keepingFocus, primaryMark } from "./queueFocus";
import {
  focusRingSx,
  InitialsAvatar,
  PlacePill,
  quietButtonSx,
  REDUCED_MOTION,
  riseInSx,
  spinSx,
  StatusChip,
  stillSkeletonsSx,
  tapTargetSx,
} from "./queueParts";
import {
  canRemoveLink,
  deleteConfirmText,
  hasLinkList,
  inLineText,
  isInLine,
  isSyncJob,
  jobBar,
  jobCaption,
  jobChip,
  jobLabel,
  jobOpenTarget,
  jobProvider,
  linkScopeText,
  linksVersion,
  linkWasCutOff,
  linkStatusText,
  ownerName,
  positionPill,
  primaryAction,
  webLink,
  whyText,
  type JobBar,
  type JobOpenTarget,
  type QueueJob,
} from "./queueView";

const sweep = keyframes`
  from { transform: translateX(-100%); }
  to   { transform: translateX(260%); }
`;

const cardFrameSx = { border: 1, borderColor: "divider", borderRadius: "10px", px: 1.5, py: 1.25 };

const captionLineSx = { lineHeight: "16px" };

// A link is often all a job is called, and one site's links differ only past where a phone's line ends.
const jobTitleSx = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: { md: "nowrap" },
  display: { xs: "-webkit-box", md: "block" },
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: { xs: 2, md: "none" },
  overflowWrap: { xs: "anywhere", md: "normal" },
};

/** What the list of cards looks like before there's anything to put in it. */
export function JobCardSkeletons() {
  return (
    <Box aria-hidden sx={{ display: "flex", flexDirection: "column", gap: 1, ...stillSkeletonsSx }}>
      {[0, 1, 2].map((n) => (
        <Box key={n} sx={cardFrameSx}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            <Skeleton variant="rounded" width={32} height={32} sx={{ flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Skeleton variant="text" sx={{ width: "50%" }} />
              <Skeleton variant="text" sx={{ width: "30%", fontSize: "0.7rem" }} />
            </Box>
          </Box>
          <Skeleton variant="rounded" height={4} sx={{ mt: 1.5 }} />
        </Box>
      ))}
    </Box>
  );
}

function ProviderTile({ job }: { job: QueueJob }) {
  const provider = jobProvider(job);
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        width: 32,
        height: 32,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "8px",
        color: "text.secondary",
        backgroundColor: neutralTint(theme),
      })}
    >
      {hasProviderLogo(provider) ? (
        <ProviderLogo id={provider} size={20} />
      ) : job.type === "ZIP" ? (
        <FolderZipOutlinedIcon fontSize="small" />
      ) : (
        <LinkIcon fontSize="small" />
      )}
    </Box>
  );
}

function SyncTag() {
  const { t } = useTranslation("app");
  return (
    <Tooltip title={t("importQueue.syncTagHint")} describeChild>
      <Box
        component="span"
        tabIndex={0}
        sx={[
          (theme) => ({ backgroundColor: neutralTint(theme) }),
          { px: "5px", borderRadius: "4px", fontSize: "0.625rem", fontWeight: 700, color: "text.secondary" },
          focusRingSx,
        ]}
      >
        {t("importQueue.syncTag")}
      </Box>
    </Tooltip>
  );
}

function barSx(theme: Theme, live: boolean) {
  return {
    flex: 1,
    minWidth: 0,
    height: 4,
    borderRadius: "2px",
    backgroundColor: neutralTint(theme),
    "& .MuiLinearProgress-bar": { borderRadius: "2px", transition: "transform 300ms ease-out" },
    ...(live && {
      "&::after": {
        content: '""',
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: "40%",
        background: `linear-gradient(90deg, transparent, ${alpha(theme.palette.common.white, 0.65)}, transparent)`,
        animation: `${sweep} 1400ms linear infinite`,
      },
    }),
    [REDUCED_MOTION]: {
      "& .MuiLinearProgress-bar": { animation: "none", transition: "none" },
      "&::after": { display: "none" },
    },
  };
}

function JobProgress({ bar }: { bar: JobBar }) {
  const { t } = useTranslation("app");
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mt: 1 }}>
      <LinearProgress
        variant={bar.indeterminate ? "indeterminate" : "determinate"}
        value={bar.value}
        color={bar.tone === "accent" ? "primary" : bar.tone}
        aria-label={bar.text ?? t("importQueue.status.running")}
        sx={(theme) => barSx(theme, bar.live)}
      />
      {bar.text && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0, ...captionLineSx }}>
          {bar.text}
        </Typography>
      )}
    </Box>
  );
}

function WhyBlock({ text }: { text: string }) {
  return (
    <Box
      sx={(theme) => {
        const tint = statusTint(theme, "error");
        return {
          display: "flex",
          alignItems: "flex-start",
          gap: 1,
          mt: 1,
          px: 1.25,
          py: 0.75,
          borderRadius: "8px",
          fontSize: "0.75rem",
          wordBreak: "break-word",
          backgroundColor: tint.background,
          color: tint.text,
        };
      }}
    >
      <ErrorIcon sx={{ fontSize: 16, mt: "1px", flexShrink: 0 }} />
      <span>{text}</span>
    </Box>
  );
}

const linkIconSx = { fontSize: 18, mt: "1px", display: "block" };

function LinkStatusIcon({ job, item }: { job: QueueJob; item: ImportJobItem }) {
  const { t } = useTranslation("app");
  if (linkWasCutOff(job, item)) {
    return (
      <WarningAmberIcon
        titleAccess={t("importQueue.itemStatus.cutOff")}
        sx={[linkIconSx, (theme) => ({ color: statusTint(theme, "warning").text })]}
      />
    );
  }
  const name = linkStatusText(item, t) ?? undefined;
  switch (item.status) {
    case "RUNNING":
      return (
        <AutorenewIcon
          titleAccess={name}
          sx={[linkIconSx, spinSx, (theme) => ({ color: statusTint(theme, "warning").text })]}
        />
      );
    case "FAILED":
      return (
        <ErrorIcon titleAccess={name} sx={[linkIconSx, (theme) => ({ color: statusTint(theme, "error").text })]} />
      );
    case "DONE":
      return (
        <CheckCircleIcon
          titleAccess={name}
          sx={[linkIconSx, (theme) => ({ color: statusTint(theme, "success").text })]}
        />
      );
    default:
      return <AccessTimeIcon titleAccess={name} sx={[linkIconSx, { color: "text.secondary" }]} />;
  }
}

/** One link of a job: how it stands, where it goes, and what went wrong. */
export function LinkRow({ job, item }: { job: QueueJob; item: ImportJobItem }) {
  const { t } = useTranslation("app");
  const { removeLink, busy } = useImportQueue();
  const href = webLink(item.url);
  const scope = linkScopeText(item, t);
  const removeLabel = t("importQueue.links.remove");
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "18px minmax(0, 1fr) 44px", md: "18px minmax(0, 1fr) 26px" },
        gap: 1.25,
        alignItems: "start",
        px: 0.75,
        py: 0.625,
        borderRadius: "6px",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <LinkStatusIcon job={job} item={item} />
      <Box sx={{ minWidth: 0 }}>
        {item.title && (
          <Typography
            variant="body2"
            fontWeight={500}
            sx={{ color: (theme) => theme.thingport.headingText, wordBreak: "break-word" }}
          >
            {item.title}
          </Typography>
        )}
        {href ? (
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: "block",
              fontSize: "0.6875rem",
              lineHeight: "19px",
              color: "text.secondary",
              textDecoration: "none",
              wordBreak: "break-all",
              "&:hover": { color: "primary.main", textDecoration: "underline" },
            }}
          >
            {item.url}
          </Link>
        ) : (
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ lineHeight: "19px", wordBreak: "break-all" }}
          >
            {item.url}
          </Typography>
        )}
        {scope && (
          <Typography variant="caption" color="text.secondary" component="div" sx={captionLineSx}>
            {scope}
          </Typography>
        )}
        {item.error_message && (
          <Typography
            variant="caption"
            component="div"
            sx={{ color: (theme) => statusTint(theme, "error").text, wordBreak: "break-word", ...captionLineSx }}
          >
            {item.error_message}
          </Typography>
        )}
      </Box>
      {canRemoveLink(job, item) && (
        <Tooltip title={removeLabel}>
          {/* A block, or the button sits on a line of text, and lower. */}
          <Box component="span" sx={{ display: "block" }}>
            <IconButton
              size="small"
              aria-label={removeLabel}
              disabled={busy.has(item.id)}
              // By mouse, moving focus would scroll a long list back up to the card's button.
              onClick={(event) =>
                void (event.detail === 0 ? keepingFocus(event, job.id, () => removeLink(item.id)) : removeLink(item.id))
              }
              sx={dialogIconButtonSx}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}

/** A job's links, read when opened and again whenever the poll shows they may have changed. */
function JobLinks({ job }: { job: QueueJob }) {
  const { t } = useTranslation(["app", "common"]);
  const { loadLinks } = useImportQueue();
  const [items, setItems] = React.useState<ImportJobItem[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const version = linksVersion(job);

  React.useEffect(() => {
    let current = true;
    loadLinks(job.id).then(
      (loaded) => {
        if (!current) return;
        setItems(Array.isArray(loaded) ? loaded : []);
        setFailed(false);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
    // The last two aren't read here: each is what asks for another read.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [loadLinks, job.id, version, attempt]);

  const body = () => {
    if (items) {
      if (!items.length) {
        return (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 0.75, py: 0.625 }}>
            {t("importQueue.links.empty")}
          </Typography>
        );
      }
      return items.map((item) => <LinkRow key={item.id} job={job} item={item} />);
    }
    if (failed) {
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 0.75 }}>
          <Typography variant="caption" sx={{ color: (theme) => statusTint(theme, "error").text }}>
            {t("importQueue.links.loadFailed")}
          </Typography>
          <Button size="small" color="inherit" onClick={() => setAttempt((n) => n + 1)} sx={tapTargetSx}>
            {t("common:retry")}
          </Button>
        </Box>
      );
    }
    return (
      <Box sx={{ py: 0.5, ...stillSkeletonsSx }}>
        <ListRowSkeletons count={Math.min(job.total || 2, 3)} lead="circle" leadSize={18} twoLines />
      </Box>
    );
  };

  return <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mt: 0.5, ...riseInSx }}>{body()}</Box>;
}

function JobMenu({
  label,
  target,
  canDelete,
  deleteDisabled,
  anchorEl,
  at,
  onClose,
  onOpenPage,
  onDelete,
}: {
  label: string;
  target: JobOpenTarget | null;
  canDelete: boolean;
  deleteDisabled: boolean;
  anchorEl: HTMLElement | null;
  at: { top: number; left: number } | null;
  onClose: () => void;
  onOpenPage: (path: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("app");
  const openIcon = (
    <ListItemIcon>
      <OpenInNewIcon fontSize="small" />
    </ListItemIcon>
  );
  return (
    <Menu
      open={Boolean(anchorEl || at)}
      onClose={onClose}
      onContextMenu={(event) => reopenContextMenuBelow(event, onClose)}
      slotProps={{ list: { "aria-label": label } }}
      {...(at ? { anchorReference: "anchorPosition" as const, anchorPosition: at } : { anchorEl })}
    >
      {target?.kind === "source" && (
        <MenuItem component="a" href={target.url} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          {openIcon}
          <ListItemText>{t("importQueue.menu.openSource")}</ListItemText>
        </MenuItem>
      )}
      {target && target.kind !== "source" && (
        <MenuItem
          onClick={() => {
            onClose();
            onOpenPage(target.path);
          }}
        >
          {openIcon}
          <ListItemText>
            {t(target.kind === "model" ? "importQueue.menu.openModel" : "importQueue.menu.openCollection")}
          </ListItemText>
        </MenuItem>
      )}
      {target && canDelete && <Divider />}
      {canDelete && (
        <MenuItem
          disabled={deleteDisabled}
          onClick={() => {
            onClose();
            onDelete();
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("importQueue.menu.delete")}</ListItemText>
        </MenuItem>
      )}
    </Menu>
  );
}

const PRIMARY_ICONS = {
  pause: <PauseIcon />,
  hold: <PauseIcon />,
  start: <PlayArrowIcon />,
  retry: <ReplayIcon />,
};

/** One import in the queue: what it is, how it stands, the one thing to do next, and a menu for the rest. */
export default function JobCard({ job }: { job: QueueJob }) {
  const { t, i18n } = useTranslation("app");
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queue = useImportQueue();
  const [linksOpen, setLinksOpen] = React.useState(false);
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const contextMenu = useCardContextMenu();
  const cardRef = React.useRef<HTMLElement | null>(null);

  const everyone = queue.dialog.scope === "everyone";
  const inMyLine = !everyone && isInLine(job);
  const label = jobLabel(job, t);
  const busy = queue.busy.has(job.id);
  const chip = jobChip(job, t);
  const pill = positionPill(job, t);
  const primary = primaryAction(job, t);
  const bar = jobBar(job, t);
  const inLine = inLineText(job, t);
  const why = whyText(job, t, queue.viewerId);
  const target = jobOpenTarget(job, queue.viewerId);
  const hasMenu = Boolean(target || job.can_delete);
  const moreLabel = t("importQueue.menu.more", { label });

  const closeMenu = () => {
    setAnchorEl(null);
    contextMenu.close();
  };

  const primaryActions = { pause: queue.pauseJob, hold: queue.pauseJob, start: queue.startJob, retry: queue.retryJob };

  const askToDelete = async () => {
    const ok = await confirm({ ...deleteConfirmText(job, t), destructive: true });
    if (ok) await focusingCardAfter(cardRef.current, () => queue.deleteJob(job.id));
  };

  const primaryButton = primary && (
    <Button
      size="small"
      variant="outlined"
      color="inherit"
      startIcon={PRIMARY_ICONS[primary.kind]}
      disabled={busy}
      onClick={(event) => void keepingFocus(event, job.id, () => primaryActions[primary.kind](job.id))}
      sx={quietButtonSx}
      {...primaryMark}
    >
      {primary.label}
    </Button>
  );

  return (
    <Box
      ref={cardRef}
      component="article"
      aria-label={label}
      // Where focus lands when an action leaves the card nothing to press.
      tabIndex={-1}
      {...cardMark(job.id)}
      // Links keep the browser's own menu, for copying their address.
      onContextMenu={
        hasMenu
          ? (event) => {
              if (!(event.target as Element).closest("a")) contextMenu.onContextMenu(event);
            }
          : undefined
      }
      sx={[
        cardFrameSx,
        { bgcolor: "background.paper", transition: "border-color 150ms", ...riseInSx },
        { "&:hover": { borderColor: "primary.main" }, [REDUCED_MOTION]: { animation: "none", transition: "none" } },
        focusRingSx,
        // A tint over the solid paper: the ladder's line runs behind the card.
        inMyLine &&
          ((theme) => ({
            borderColor: theme.palette.primary.main,
            backgroundImage: `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})`,
          })),
      ]}
    >
      <Box
        sx={{ display: "flex", alignItems: "center", flexWrap: { xs: "wrap", md: "nowrap" }, gap: 1.25, minWidth: 0 }}
      >
        {pill && <PlacePill text={pill.text} title={pill.title} />}
        <ProviderTile job={job} />
        <Box sx={{ flex: { xs: "1 1 50%", md: 1 }, minWidth: 0 }}>
          <Typography
            variant="body2"
            fontWeight={600}
            title={label}
            sx={{ color: (theme) => theme.thingport.headingText, ...jobTitleSx }}
          >
            {label}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.5, ...captionLineSx }}
          >
            {everyone && job.owner && (
              <>
                <InitialsAvatar name={ownerName(job.owner)} size={18} />
                <span>{ownerName(job.owner)} ·</span>
              </>
            )}
            {isSyncJob(job) && <SyncTag />}
            <span>{jobCaption(job, { t, locale: i18n.language })}</span>
          </Typography>
        </Box>
        <StatusChip label={chip.label} hint={chip.hint} tone={chip.tone} live={chip.live} />
        {(primary || hasMenu) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0, ml: { xs: "auto", md: 0 } }}>
            {primary?.kind === "pause" ? (
              <Tooltip title={t("importQueue.action.pauseHint")}>
                <span>{primaryButton}</span>
              </Tooltip>
            ) : (
              primaryButton
            )}
            {hasMenu && (
              <Tooltip title={moreLabel}>
                <IconButton
                  size="small"
                  aria-label={moreLabel}
                  aria-haspopup="menu"
                  aria-expanded={Boolean(anchorEl || contextMenu.at)}
                  onClick={(event) => setAnchorEl(event.currentTarget)}
                  sx={dialogIconButtonSx}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}
      </Box>

      {hasMenu && (
        <JobMenu
          label={moreLabel}
          target={target}
          canDelete={job.can_delete}
          deleteDisabled={busy}
          anchorEl={anchorEl}
          at={contextMenu.at}
          onClose={closeMenu}
          onOpenPage={(path) => {
            queue.close();
            navigate(path);
          }}
          onDelete={() => void askToDelete()}
        />
      )}

      {bar && <JobProgress bar={bar} />}
      {inLine && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75, ...captionLineSx }}>
          {inLine}
          {job.sync_waiting && <HelpTip text={t("importQueue.syncWaitingHelp")} />}
        </Typography>
      )}
      {why && <WhyBlock text={why} />}

      {hasLinkList(job) && (
        <>
          <ButtonBase
            aria-expanded={linksOpen}
            onClick={() => setLinksOpen((open) => !open)}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              mt: 0.75,
              pr: 0.5,
              py: 0.25,
              ...tapTargetSx,
              borderRadius: "4px",
              fontSize: "0.6875rem",
              fontWeight: 600,
              color: "text.secondary",
              transition: "color 150ms",
              "&:hover": { color: "text.primary" },
              "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 },
              [REDUCED_MOTION]: { transition: "none" },
            }}
          >
            {linksOpen ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
            {t(linksOpen ? "importQueue.links.hide" : "importQueue.links.show", { count: job.total })}
          </ButtonBase>
          {linksOpen && <JobLinks job={job} />}
        </>
      )}
    </Box>
  );
}
