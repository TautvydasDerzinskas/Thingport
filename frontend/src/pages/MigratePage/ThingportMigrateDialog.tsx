import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import { UnauthorizedError } from "../../api/client";
import { migrateApi, type MigrateRun, type MigrateRunError } from "../../api/migrate";
import { useConfirm } from "../../components/ConfirmProvider";
import { useToastHost } from "../../components/ToastProvider";
import CheckStep, { canStart, checkPassed } from "./CheckStep";
import ComesStep, { DEFAULT_CHOICES, type Choices } from "./ComesStep";
import { errorText, followRun, isActive, k, requestError } from "./parts";
import PeopleStep from "./PeopleStep";
import SourceStep, { sourceReady, type SourceInput } from "./SourceStep";
import StartStep from "./StartStep";

const STEPS = ["source", "check", "people", "comes", "start"] as const;
const POLL_MS = 1500;

/** Where the dialog opens for a migration from the list: at its check while it's waiting, at its end once it ran. */
function stepFor(run: MigrateRun | null): number {
  if (!run) return 0;
  if (run.status === "running" || run.status === "done") return 4;
  if (run.status === "failed") return run.started_at ? 4 : 1;
  return 1;
}

function choicesFor(run: MigrateRun | null): Choices {
  if (!run?.options) return DEFAULT_CHOICES;
  const { people: _people, ...choices } = run.options;
  return choices;
}

type Props = {
  /** A migration from the list, or null for a new one. */
  initial: MigrateRun | null;
  /** Where on the server the dump and the storage folder must be. */
  root: string;
  onClose: () => void;
  /** Something in the list changed: one started, finished or went. */
  onChanged: () => void;
  onUnauthorized?: () => void;
};

/** From another Thingport instance, in steps: its dump and storage folder, the check, its people, what comes, start.
 *  A plain stepper rather than the app's sectioned dialog: the steps follow each other, and each needs the last. */
export default function ThingportMigrateDialog({ initial, root, onClose, onChanged, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const paperRef = useToastHost(true);
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));
  const [run, setRun] = React.useState<MigrateRun | null>(initial);
  const [step, setStep] = React.useState(() => stepFor(initial));
  const [source, setSource] = React.useState<SourceInput>({ mode: "upload", file: null, dumpPath: "", folder: "" });
  const [uploading, setUploading] = React.useState<number | null>(null);
  const [sending, setSending] = React.useState(false);
  // Its folder being checked again: what the check found before doesn't count until it's done.
  const [rechecking, setRechecking] = React.useState(false);
  const [error, setError] = React.useState<MigrateRunError | null>(null);
  const [chosen, setChosen] = React.useState<Set<string>>(
    () => new Set(initial?.options?.people ?? (initial?.plan.people ?? []).map((person) => person.id)),
  );
  const [choices, setChoices] = React.useState<Choices>(() => choicesFor(initial));

  const people = run?.plan.people ?? [];
  // Everyone, once the check has found them.
  const seeded = React.useRef(Boolean(initial?.plan.people));
  React.useEffect(() => {
    if (seeded.current || !run?.plan.people) return;
    seeded.current = true;
    setChosen(new Set(run.plan.people.map((person) => person.id)));
  }, [run?.plan.people]);

  const fail = React.useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(requestError(err));
    },
    [onUnauthorized],
  );

  // Followed while it's being prepared or run.
  const runId = run?.id;
  const active = run ? isActive(run) : false;
  React.useEffect(() => {
    if (!runId || !active) return;
    return followRun(
      () => migrateApi.get(runId),
      POLL_MS,
      (next) => {
        setRun(next);
        if (!isActive(next)) onChanged();
      },
      (err) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      },
    );
  }, [runId, active, onChanged, onUnauthorized]);

  const prepare = async () => {
    setError(null);
    setSending(true);
    try {
      const prepared =
        source.mode === "upload" && source.file
          ? await migrateApi.prepareWithUpload(source.file, source.folder.trim(), setUploading)
          : await migrateApi.prepareWithPath(source.dumpPath.trim(), source.folder.trim());
      setRun(prepared);
      setStep(1);
      onChanged();
    } catch (err) {
      fail(err);
    } finally {
      setSending(false);
      setUploading(null);
    }
  };

  const start = async () => {
    if (!run) return;
    setError(null);
    setSending(true);
    try {
      setRun(await migrateApi.start(run.id, { people: [...chosen], ...choices }));
      onChanged();
    } catch (err) {
      fail(err);
    } finally {
      setSending(false);
    }
  };

  const changeFolder = async (folder: string) => {
    if (!run) return;
    setError(null);
    setRechecking(true);
    try {
      setRun(await migrateApi.changeFolder(run.id, folder));
    } catch (err) {
      fail(err);
      throw err;
    } finally {
      setRechecking(false);
    }
  };

  const discard = async () => {
    if (!run) return onClose();
    const ok = await confirm({
      title: t(k("runs.discard")),
      message: t(k("runs.discardConfirm")),
      confirmLabel: t(k("runs.discard")),
      destructive: true,
    });
    if (!ok) return;
    try {
      await migrateApi.remove(run.id);
      onChanged();
      onClose();
    } catch (err) {
      fail(err);
    }
  };

  const waiting = run?.status === "ready" || (run?.status === "failed" && run.can_resume);
  const canNext =
    step === 0
      ? sourceReady(source) && !sending
      : step === 1
        ? checkPassed(run) && !rechecking
        : step === 2
          ? chosen.size > 0
          : true;

  let content: React.ReactNode = null;
  if (step === 0) {
    content = <SourceStep input={source} onChange={setSource} uploading={uploading} disabled={sending} root={root} />;
  } else if (run && step === 1) {
    content = <CheckStep run={run} onChangeFolder={changeFolder} />;
  } else if (run && step === 2) {
    content = <PeopleStep people={people} chosen={chosen} onChange={setChosen} disabled={!waiting} />;
  } else if (run && step === 3) {
    content = <ComesStep choices={choices} counts={run.plan.counts} onChange={setChoices} disabled={!waiting} />;
  } else if (run) {
    content = <StartStep run={run} people={people} chosen={chosen} choices={choices} />;
  }

  return (
    <Dialog
      open
      onClose={sending ? undefined : onClose}
      fullWidth
      maxWidth="md"
      fullScreen={phone}
      PaperProps={{ ref: paperRef }}
      aria-labelledby="migrate-dialog-title"
    >
      <DialogTitle
        id="migrate-dialog-title"
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1.5 }}
      >
        {t(k("dialog.title"))}
        <Tooltip title={t("common:close")}>
          <span>
            <IconButton size="small" onClick={onClose} disabled={sending} aria-label={t("common:close")}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </DialogTitle>
      <DialogContent sx={{ minHeight: { sm: 420 } }}>
        <Stepper activeStep={step} alternativeLabel={!phone} sx={{ mb: 3, mt: 1 }}>
          {STEPS.map((name, index) => (
            <Step key={name} completed={index < step || (index === 4 && run?.status === "done")}>
              <StepLabel>{phone && index !== step ? "" : t(k(`steps.${name}`))}</StepLabel>
            </Step>
          ))}
        </Stepper>
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {errorText(t, error)}
          </Alert>
        )}
        <Box
          key={step}
          sx={{
            "@keyframes migrateStepIn": { from: { opacity: 0, transform: "translateX(8px)" }, to: { opacity: 1 } },
            animation: "migrateStepIn 180ms ease-out",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          {content}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {run && (run.status === "preparing" || run.status === "ready") && (
          <Button color="error" onClick={() => void discard()} disabled={sending}>
            {t(k("runs.discard"))}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {step > 1 && waiting && (
          <Button onClick={() => setStep(step - 1)} disabled={sending}>
            {t("common:back")}
          </Button>
        )}
        {step < 4 && !(run && !waiting && step > 0) && (
          <Button
            variant="contained"
            disabled={!canNext}
            onClick={() => (step === 0 ? void prepare() : setStep(step + 1))}
          >
            {t(k("dialog.next"))}
          </Button>
        )}
        {step === 4 && waiting && (
          <Button variant="contained" onClick={() => void start()} disabled={sending || !canStart(run, rechecking)}>
            {t(k(run?.status === "failed" ? "runs.startAgain" : "start.start"))}
          </Button>
        )}
        {run && !waiting && (step === 4 || run.status === "failed") && (
          <Button variant={run.status === "done" ? "contained" : "text"} onClick={onClose}>
            {t("common:close")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
