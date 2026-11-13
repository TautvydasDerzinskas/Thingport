import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ReplayIcon from "@mui/icons-material/Replay";
import type { TFunction } from "i18next";
import { manyfoldReport, type MigrateRun } from "../../api/migrate";
import ToneChip from "../../components/ToneChip";
import { errorText, k, runTitle, SourceTile } from "./parts";

/** One line, cut off at its end, where there's room; wrapped on a phone. */
const NARROW_WRAP = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: { xs: "normal", sm: "nowrap" },
} as const;

const TONES = { preparing: "info", ready: "info", running: "info", done: "success", failed: "error" } as const;

/** What one from another Thingport instance is doing, or did, with its people. */
function thingportLine(t: TFunction, run: MigrateRun, when: string): string {
  const people = run.options?.people.length ?? run.plan.counts?.people ?? 0;
  const merged = (run.plan.people ?? []).filter(
    (person) => person.merge && (!run.options || run.options.people.includes(person.id)),
  ).length;
  const peopleLine = [t(k("runs.people"), { count: people }), merged ? t(k("runs.merged"), { count: merged }) : null]
    .filter(Boolean)
    .join(", ");
  if (run.status === "preparing") return t(k(`check.steps.${run.progress?.step ?? "restoring"}`));
  if (run.status === "running") {
    const step = run.progress?.step ?? "people";
    return [
      t(k(`start.phases.${step}`), { done: run.progress?.done ?? 0, total: run.progress?.total ?? 0 }),
      peopleLine,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (run.status === "ready") {
    return t(k("runs.readyLine"), { people: peopleLine, count: run.plan.counts?.models ?? 0 });
  }
  if (run.status === "done" && run.report) {
    const left = run.report.models.noFiles;
    return [
      when,
      t(k("runs.doneLine"), { count: run.report.models.brought, people: peopleLine }),
      left ? t(k("runs.leftOut"), { count: left }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [when, errorText(t, run.error)].filter(Boolean).join(" · ");
}

/** What one from Manyfold is doing, or did. */
function manyfoldLine(t: TFunction, run: MigrateRun, when: string): string {
  if (run.status === "running") {
    const step = run.progress?.step ?? "owners";
    return t(k(`manyfold.phases.${step}`), { done: run.progress?.done ?? 0, total: run.progress?.total ?? 0 });
  }
  if (run.status === "ready") return t(k("manyfold.readyLine"), { count: run.plan.manyfold?.models ?? 0 });
  const report = manyfoldReport(run);
  if (run.status === "done" && report) {
    const left = report.models.noFiles;
    return [
      when,
      t(k("report.models"), { count: report.models.brought }),
      left ? t(k("manyfold.leftOut"), { count: left }) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [when, errorText(t, run.error)].filter(Boolean).join(" · ");
}

type Props = {
  run: MigrateRun;
  onOpen: (run: MigrateRun) => void;
  onStartAgain: (run: MigrateRun) => void;
  onRemove: (run: MigrateRun) => void;
};

/** One migration in the page's list: where it came from, how far it got, and its actions under ⋮. */
export default function MigrationRow({ run, onOpen, onStartAgain, onRemove }: Props) {
  const { t, i18n } = useTranslation("app");
  const [menu, setMenu] = React.useState<{ anchor: HTMLElement | null; at?: { left: number; top: number } } | null>(
    null,
  );
  const when = new Date(run.finished_at ?? run.created_at).toLocaleString(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const manyfold = run.source === "manyfold";
  let progress: number | null = null;
  if (run.status === "running" && run.progress && run.progress.total > 0) {
    progress = (run.progress.done / run.progress.total) * 100;
  }
  const line = manyfold ? manyfoldLine(t, run, when) : thingportLine(t, run, when);

  const close = () => setMenu(null);
  const openMenu = (event: React.MouseEvent<HTMLElement>, atPointer = false) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu(
      atPointer ? { anchor: null, at: { left: event.clientX, top: event.clientY } } : { anchor: event.currentTarget },
    );
  };

  return (
    <Box
      onContextMenu={(event) => openMenu(event, true)}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        "@keyframes migrateRowIn": { from: { opacity: 0, transform: "translateY(4px)" }, to: { opacity: 1 } },
        animation: "migrateRowIn 200ms ease-out",
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <ButtonBase
        onClick={() => onOpen(run)}
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          textAlign: "left",
          px: 1,
          py: 1.25,
          borderRadius: 2,
          "&:hover": { bgcolor: "action.hover" },
          "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" },
        }}
      >
        <SourceTile source={run.source} />
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} sx={NARROW_WRAP}>
            {runTitle(t, run)}
            {!manyfold && (
              <Typography component="span" variant="body2" color="text.secondary">
                {" · "}
                {t(k(run.source === "thingport-online" ? "runs.viaOnline" : "runs.viaDump"))}
              </Typography>
            )}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={NARROW_WRAP}>
            {line}
          </Typography>
          {(run.status === "preparing" || run.status === "running") && (
            <LinearProgress
              variant={progress === null ? "indeterminate" : "determinate"}
              value={progress ?? undefined}
              aria-label={line}
              sx={{ borderRadius: 1, maxWidth: 520 }}
            />
          )}
        </Stack>
        <ToneChip tone={TONES[run.status]} label={t(k(`runs.status.${run.status}`))} />
      </ButtonBase>
      <Tooltip title={t(k("runs.actions"))}>
        <IconButton size="small" aria-label={t(k("runs.actions"))} onClick={(event) => openMenu(event)}>
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        open={menu !== null}
        anchorEl={menu?.anchor ?? null}
        anchorReference={menu?.at ? "anchorPosition" : "anchorEl"}
        anchorPosition={menu?.at}
        onClose={close}
      >
        <MenuItem
          onClick={() => {
            close();
            onOpen(run);
          }}
        >
          <ListItemIcon>
            <OpenInNewIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t(k(run.status === "ready" ? "runs.continue" : "runs.details"))}</ListItemText>
        </MenuItem>
        {run.can_resume && (
          <MenuItem
            onClick={() => {
              close();
              onStartAgain(run);
            }}
          >
            <ListItemIcon>
              <ReplayIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t(k("runs.startAgain"))}</ListItemText>
          </MenuItem>
        )}
        {run.status !== "running" && <Divider />}
        {run.status !== "running" && (
          <MenuItem
            onClick={() => {
              close();
              onRemove(run);
            }}
          >
            <ListItemIcon>
              <DeleteOutlineIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText>
              {t(k(run.status === "preparing" || run.status === "ready" ? "runs.discard" : "runs.remove"))}
            </ListItemText>
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}
