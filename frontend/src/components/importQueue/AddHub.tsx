import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, type Theme } from "@mui/material/styles";
import ErrorIcon from "@mui/icons-material/Error";
import { neutralTint, statusTint } from "../../theme";
import { ImportLinkIcon, UploadFilesIcon, UploadFolderIcon } from "../Layout/topBarIcons";
import { useImportQueue } from "./ImportQueueContext";
import { Comet, Ring } from "./ImportQueueIndicator";
import { focusRingSx, PlacePill, quietButtonSx, tapTargetSx } from "./queueParts";
import {
  hubIdleText,
  hubRows,
  jobBar,
  positionPill,
  QUEUE_SECTIONS,
  sectionCounts,
  type HubRow,
  type QueueSection,
} from "./queueView";

export type AddHubActions = {
  /** With every provider turned off there's nothing to import from. */
  canImport: boolean;
  /** Something is already being added, so nothing else can start. */
  busy: boolean;
  onImport: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
};

const hoverAccentSx = (theme: Theme) => ({
  "&:hover": { bgcolor: alpha(theme.palette.primary.main, 0.08) },
});

function Tile({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      disabled={disabled}
      onClick={onClick}
      sx={[
        (theme) => ({
          flexDirection: "column",
          gap: 0.75,
          py: 1.5,
          px: 0.5,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          fontSize: 12,
          fontWeight: 600,
          color: theme.thingport.headingText,
          transition: "background-color 150ms, border-color 150ms",
          "&:hover": { borderColor: "primary.main" },
          "& svg": { color: "action.active" },
          "&.Mui-disabled": { opacity: 0.45 },
        }),
        hoverAccentSx,
        focusRingSx,
      ]}
    >
      {icon}
      {label}
    </ButtonBase>
  );
}

const STAT_TONES = { run: "warning", att: "error", wait: "info" } as const;

function Stat({
  section,
  count,
  label,
  onOpen,
}: {
  section: QueueSection;
  count: number;
  label: string;
  onOpen: (section: QueueSection) => void;
}) {
  const tone = section === "done" || count === 0 ? null : STAT_TONES[section];
  return (
    <ButtonBase
      onClick={() => onOpen(section)}
      sx={[
        (theme) => ({
          flexDirection: "column",
          alignItems: "flex-start",
          minWidth: 0,
          px: 1,
          py: 0.75,
          borderRadius: 1,
          fontSize: 10,
          whiteSpace: "nowrap",
          overflow: "hidden",
          bgcolor: tone ? statusTint(theme, tone).background : neutralTint(theme),
          color: tone ? statusTint(theme, tone).text : "text.secondary",
        }),
        focusRingSx,
      ]}
    >
      <Box
        component="span"
        sx={{
          fontSize: 15,
          fontWeight: 700,
          lineHeight: 1.3,
          color: tone ? "inherit" : (theme) => theme.thingport.headingText,
        }}
      >
        {count}
      </Box>
      {label}
    </ButtonBase>
  );
}

function RowMark({ row }: { row: HubRow }) {
  const { t } = useTranslation("app");
  if (row.kind === "att") return <ErrorIcon color="error" sx={{ fontSize: 22 }} />;
  if (row.kind === "wait") {
    const pill = positionPill(row.job, t);
    return pill ? <PlacePill text={pill.text} title={pill.title} /> : null;
  }
  return (
    <Box component="span" sx={{ position: "relative", display: "block", width: 22, height: 22 }}>
      <Ring arc={jobBar(row.job, t)?.value ?? 0} />
      <Comet />
    </Box>
  );
}

function Row({ row, onOpen }: { row: HubRow; onOpen: (section: QueueSection) => void }) {
  const { t } = useTranslation("app");
  const { retryJob, busy } = useImportQueue();
  const textSx = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <ButtonBase
        onClick={() => onOpen(row.kind)}
        sx={[
          {
            flex: 1,
            minWidth: 0,
            justifyContent: "flex-start",
            gap: 1.25,
            p: 0.75,
            borderRadius: 1,
            textAlign: "left",
          },
          hoverAccentSx,
          focusRingSx,
        ]}
      >
        <RowMark row={row} />
        <Box component="span" sx={{ minWidth: 0 }}>
          <Typography
            component="span"
            variant="caption"
            fontWeight={600}
            sx={{ ...textSx, color: (theme) => theme.thingport.headingText }}
          >
            {row.name}
          </Typography>
          <Typography
            component="span"
            variant="caption"
            sx={{ ...textSx, fontSize: 11, color: row.kind === "att" ? "error.main" : "text.secondary" }}
          >
            {row.text}
          </Typography>
        </Box>
      </ButtonBase>
      {row.kind === "att" && row.job.can_retry && (
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          disabled={busy.has(row.job.id)}
          onClick={() => void retryJob(row.job.id)}
          sx={[{ flexShrink: 0 }, quietButtonSx as object]}
        >
          {t("importQueue.action.retry")}
        </Button>
      )}
    </Stack>
  );
}

/** The viewer's imports at a glance, and the way to the queue. Not there when the backend is older than the queue. */
function QueueSummary({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const queue = useImportQueue();
  const counts = sectionCounts(queue.jobs, queue.finishedTotal);
  const rows = hubRows(queue.jobs, t, queue.viewerId);
  const openQueue = (section?: QueueSection) => {
    onClose();
    queue.open(section);
  };
  const labels: Record<QueueSection, string> = {
    run: t("importQueue.sections.run"),
    att: t("importQueue.hub.attention"),
    wait: t("importQueue.sections.wait"),
    done: t("importQueue.sections.done"),
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" fontWeight={700} color="text.secondary" component="h2" sx={{ fontSize: 11 }}>
          {t("importQueue.title")}
        </Typography>
        <Button
          size="small"
          onClick={() => openQueue()}
          sx={(theme) => ({
            minWidth: 0,
            ...tapTargetSx,
            color: theme.palette.mode === "dark" ? "primary.light" : "primary.dark",
          })}
        >
          {t("importQueue.hub.open")}
        </Button>
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 0.75 }}>
        {QUEUE_SECTIONS.map((section) => (
          <Stat key={section} section={section} count={counts[section]} label={labels[section]} onOpen={openQueue} />
        ))}
      </Box>
      {rows.length ? (
        <Stack spacing={0.25}>
          {rows.map((row) => (
            <Row key={row.job.id} row={row} onOpen={openQueue} />
          ))}
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
          {hubIdleText(queue.jobs, { t, locale: i18n.language })}
        </Typography>
      )}
    </Stack>
  );
}

export function AddHubContent({
  canImport,
  busy,
  onImport,
  onUploadFiles,
  onUploadFolder,
  onClose,
}: AddHubActions & { onClose: () => void }) {
  const { t } = useTranslation(["app", "common"]);
  const { supported } = useImportQueue();
  return (
    <Stack spacing={1.25}>
      <Box sx={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(0, 1fr)", gap: 1 }}>
        {canImport && (
          <Tile
            icon={<ImportLinkIcon sx={{ fontSize: 24 }} />}
            label={t("common:import")}
            disabled={busy}
            onClick={onImport}
          />
        )}
        <Tile
          icon={<UploadFilesIcon sx={{ fontSize: 24 }} />}
          label={t("addMenu.uploadFiles")}
          disabled={busy}
          onClick={onUploadFiles}
        />
        <Tile
          icon={<UploadFolderIcon sx={{ fontSize: 24 }} />}
          label={t("addMenu.uploadFolder")}
          disabled={busy}
          onClick={onUploadFolder}
        />
      </Box>
      {busy && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
          {t("addMenu.finishFirst")}
        </Typography>
      )}
      {supported && <QueueSummary onClose={onClose} />}
    </Stack>
  );
}

/** What the top bar's Add button opens: the ways to add a model, and how the viewer's imports are getting on. */
export default function AddHub({
  anchorEl,
  onClose,
  ...actions
}: AddHubActions & { anchorEl: HTMLElement | null; onClose: () => void }) {
  const { t } = useTranslation("common");
  return (
    <Popover
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{
        paper: {
          role: "dialog",
          "aria-label": t("add"),
          sx: { mt: 0.75, p: 1.25, width: 380, maxWidth: "calc(100vw - 32px)" },
        },
      }}
    >
      <AddHubContent {...actions} onClose={onClose} />
    </Popover>
  );
}
