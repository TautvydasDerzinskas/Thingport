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
import DriveFileMoveOutlinedIcon from "@mui/icons-material/DriveFileMoveOutlined";
import { UnauthorizedError } from "../../api/client";
import { migrateApi, type MigrateRun } from "../../api/migrate";
import { useConfirm } from "../../components/ConfirmProvider";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import { useToast } from "../../components/ToastProvider";
import MigrationRow from "./MigrationRow";
import { errorText, isActive, k, requestError, SourceTile } from "./parts";
import ThingportMigrateDialog from "./ThingportMigrateDialog";

const POLL_MS = 2000;

type Props = { onUnauthorized?: () => void };

/** Administration > Migrate: a card for each place people and their libraries can come from, then the migrations
 *  that ran. Each source's steps open in a dialog. */
export default function MigratePage({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const confirm = useConfirm();
  const showToast = useToast();
  const [runs, setRuns] = React.useState<MigrateRun[] | null>(null);
  /** Where on the server the old instance's files are read from. */
  const [root, setRoot] = React.useState("/app/migrate");
  const [loadFailed, setLoadFailed] = React.useState(false);
  /** The dialog: a new migration, or one from the list. */
  const [open, setOpen] = React.useState<{ run: MigrateRun | null } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const listed = await migrateApi.list();
      setRuns(listed.runs);
      setRoot(listed.root);
      setLoadFailed(false);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setLoadFailed(true);
    }
  }, [onUnauthorized]);

  React.useEffect(() => {
    void load();
  }, [load]);

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
    if (!run.options) return;
    try {
      await migrateApi.start(run.id, run.options);
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
          </Stack>
          <Box sx={{ mt: "auto", pt: 0.5 }}>
            <Button
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              onClick={() => setOpen({ run: null })}
              disabled={busy}
            >
              {t(k("thingport.start"))}
            </Button>
          </Box>
        </Paper>
      </Box>

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
                  onOpen={(item) => setOpen({ run: item })}
                  onStartAgain={(item) => void startAgain(item)}
                  onRemove={(item) => void remove(item)}
                />
              ))}
            </Stack>
          )}
        </Paper>
      </Stack>

      {open && (
        <ThingportMigrateDialog
          initial={open.run}
          root={root}
          onClose={() => setOpen(null)}
          onChanged={() => void load()}
          onUnauthorized={onUnauthorized}
        />
      )}
    </Stack>
  );
}
