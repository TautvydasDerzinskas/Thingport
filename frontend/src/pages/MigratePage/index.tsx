import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import MoveUpOutlinedIcon from "@mui/icons-material/MoveUpOutlined";
import DriveFileMoveOutlinedIcon from "@mui/icons-material/DriveFileMoveOutlined";
import { UnauthorizedError } from "../../api/client";
import { migrateApi, type ExportToken, type ManyfoldRun, type MigrateRun, type ThingportRun } from "../../api/migrate";
import { useConfirm } from "../../components/ConfirmProvider";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import ToneChip from "../../components/ToneChip";
import { useToast } from "../../components/ToastProvider";
import ExportTokenDialog from "./ExportTokenDialog";
import ManyfoldMigrateDialog from "./ManyfoldMigrateDialog";
import MigrationRow from "./MigrationRow";
import { errorText, isActive, k, requestError, SourceTile } from "./parts";
import ThingportMigrateDialog from "./ThingportMigrateDialog";

const POLL_MS = 2000;

type Props = { onUnauthorized?: () => void };

/** Administration > Migrate: a card for each place people and their libraries can come from, then the migrations
 *  that ran. Each source's steps open in a dialog. */
export default function MigratePage({ onUnauthorized }: Props) {
  const { t, i18n } = useTranslation("app");
  const confirm = useConfirm();
  const showToast = useToast();
  const [runs, setRuns] = React.useState<MigrateRun[] | null>(null);
  /** Where on the server the old instance's files are read from. */
  const [root, setRoot] = React.useState("/app/migrate");
  const [loadFailed, setLoadFailed] = React.useState(false);
  /** The dialog: a new migration from a source, or one from the list. */
  const [open, setOpen] = React.useState<
    { manyfold: true; run: ManyfoldRun | null } | { manyfold: false; run: ThingportRun | null } | null
  >(null);
  /** The token letting another instance copy this one, and its dialog. */
  const [exportToken, setExportToken] = React.useState<ExportToken | null>(null);
  const [exporting, setExporting] = React.useState(false);
  /** Set once the dialog has made or revoked a token: the first read, answering later, mustn't undo that. */
  const tokenChanged = React.useRef(false);
  const tokenChangedTo = React.useCallback((next: ExportToken) => {
    tokenChanged.current = true;
    setExportToken(next);
  }, []);

  /** Counts the lists asked for, so one that answers after a later one is dropped: it could say a run that's started
   *  is still waiting, and polling would stop. */
  const listAsked = React.useRef(0);
  const load = React.useCallback(async () => {
    const asked = ++listAsked.current;
    try {
      const listed = await migrateApi.list();
      if (asked !== listAsked.current) return;
      setRuns(listed.runs);
      setRoot(listed.root);
      setLoadFailed(false);
    } catch (err) {
      if (asked !== listAsked.current) return;
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setLoadFailed(true);
    }
  }, [onUnauthorized]);
  // The same function from one render to the next, or each refresh would restart the dialogs' own polling.
  const reload = React.useCallback(() => void load(), [load]);

  React.useEffect(() => {
    void load();
    migrateApi.exportToken().then(
      (read) => {
        if (!tokenChanged.current) setExportToken(read);
      },
      (err) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      },
    );
  }, [load, onUnauthorized]);

  const busy = Boolean(runs?.some(isActive));
  React.useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [busy, load]);

  const fail = (err: unknown) => {
    if (err instanceof UnauthorizedError) onUnauthorized?.();
    else showToast({ message: errorText(t, requestError(err)), severity: "error" });
  };

  const startAgain = async (run: MigrateRun) => {
    try {
      if (run.source === "manyfold") {
        if (!run.options) return;
        await migrateApi.startManyfold(run.id, run.options);
      } else {
        if (!run.options) return;
        await migrateApi.start(run.id, run.options);
      }
      await load();
    } catch (err) {
      fail(err);
    }
  };

  const remove = async (run: MigrateRun) => {
    const discarding = run.status === "preparing" || run.status === "ready";
    const ok = await confirm({
      title: t(k(discarding ? "runs.discard" : "runs.remove")),
      message: t(k(discarding ? "runs.discardConfirm" : "runs.removeConfirm")),
      confirmLabel: t(k(discarding ? "runs.discard" : "runs.remove")),
      destructive: true,
    });
    if (!ok) return;
    try {
      await migrateApi.remove(run.id);
      // A list asked for before it went would bring it back.
      listAsked.current += 1;
      setRuns((previous) => previous?.filter((item) => item.id !== run.id) ?? previous);
    } catch (err) {
      fail(err);
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 1040 }}>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
        <Paper variant="outlined" sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <SourceTile source="manyfold" />
            <Typography variant="subtitle1" fontWeight={600}>
              {t(k("manyfold.title"))}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t(k("manyfold.text"))}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label={t(k("manyfold.apiKey"))} />
            <Chip size="small" variant="outlined" label={t(k("manyfold.anywhere"))} />
          </Stack>
          <Box sx={{ mt: "auto", pt: 0.5 }}>
            <Button
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              onClick={() => setOpen({ run: null, manyfold: true })}
              disabled={busy}
            >
              {t(k("thingport.start"))}
            </Button>
          </Box>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <SourceTile />
            <Typography variant="subtitle1" fontWeight={600}>
              {t(k("thingport.title"))}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t(k("thingport.text"))}
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" variant="outlined" label={t(k("thingport.dump"))} />
            <Chip size="small" variant="outlined" label={t(k("thingport.online"))} />
          </Stack>
          <Box sx={{ mt: "auto", pt: 0.5 }}>
            <Button
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              onClick={() => setOpen({ run: null, manyfold: false })}
              disabled={busy}
            >
              {t(k("thingport.start"))}
            </Button>
          </Box>
        </Paper>
      </Box>

      <Paper
        variant="outlined"
        sx={{ px: 2.5, py: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: { xs: "wrap", sm: "nowrap" } }}
      >
        <MoveUpOutlinedIcon color="action" aria-hidden />
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="body2" fontWeight={600}>
            {t(k("export.title"))}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(k("export.text"))}
          </Typography>
        </Box>
        {exportToken?.active && exportToken.expires_at && (
          <ToneChip
            tone="success"
            label={t(k("export.activeUntil"), {
              time: new Date(exportToken.expires_at).toLocaleTimeString(i18n.language, {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          />
        )}
        <Button
          variant="outlined"
          startIcon={<KeyOutlinedIcon />}
          onClick={() => setExporting(true)}
          sx={{ flexShrink: 0 }}
        >
          {t(k(exportToken?.active ? "export.manage" : "export.create"))}
        </Button>
      </Paper>

      <Stack spacing={1}>
        <Typography variant="subtitle1" fontWeight={600}>
          {t(k("runs.heading"))}
        </Typography>
        <Paper variant="outlined" sx={{ py: 1 }}>
          {loadFailed && !runs ? (
            <Alert severity="error" sx={{ mx: 1.5 }}>
              {t(k("runs.loadFailed"))}
            </Alert>
          ) : !runs ? (
            <Box sx={{ p: 1.5 }}>
              <ListRowSkeletons count={2} twoLines trailing />
            </Box>
          ) : runs.length === 0 ? (
            <Stack alignItems="center" spacing={1} sx={{ py: 4, px: 2, color: "text.secondary" }}>
              <DriveFileMoveOutlinedIcon sx={{ fontSize: 36, opacity: 0.6 }} aria-hidden />
              <Typography variant="body2">{t(k("runs.empty"))}</Typography>
            </Stack>
          ) : (
            <Stack divider={<Divider flexItem sx={{ mx: 2 }} />}>
              {runs.map((run) => (
                <MigrationRow
                  key={run.id}
                  run={run}
                  onOpen={(item) =>
                    setOpen(item.source === "manyfold" ? { manyfold: true, run: item } : { manyfold: false, run: item })
                  }
                  onStartAgain={(item) => void startAgain(item)}
                  onRemove={(item) => void remove(item)}
                />
              ))}
            </Stack>
          )}
        </Paper>
      </Stack>

      {exporting && (
        <ExportTokenDialog
          state={exportToken}
          onChanged={tokenChangedTo}
          onClose={() => setExporting(false)}
          onUnauthorized={onUnauthorized}
        />
      )}
      {open?.manyfold && (
        <ManyfoldMigrateDialog
          initial={open.run}
          onClose={() => setOpen(null)}
          onChanged={reload}
          onUnauthorized={onUnauthorized}
        />
      )}
      {open && !open.manyfold && (
        <ThingportMigrateDialog
          initial={open.run}
          root={root}
          onClose={() => setOpen(null)}
          onChanged={reload}
          onUnauthorized={onUnauthorized}
        />
      )}
    </Stack>
  );
}
