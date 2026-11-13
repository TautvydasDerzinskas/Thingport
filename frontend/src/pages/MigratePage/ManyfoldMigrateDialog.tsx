import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import { adminApi, type AdminUser } from "../../api/admin";
import { UnauthorizedError } from "../../api/client";
import { migrateApi, type ManyfoldReport, type ManyfoldRun, type MigrateRunError } from "../../api/migrate";
import { useConfirm } from "../../components/ConfirmProvider";
import HelpTip from "../../components/HelpTip";
import ToneChip from "../../components/ToneChip";
import { useToastHost } from "../../components/ToastProvider";
import { readUser } from "../../utils/auth";
import { errorText, followRun, hostOf, isActive, k, requestError } from "./parts";
import { ReportLines, RunningView, StoppedView } from "./StartStep";

/** Its steps, with the Thingport dialog's names where they're the same step. */
const STEPS = [
  { key: "connect", label: "manyfold.steps.connect" },
  { key: "check", label: "steps.check" },
  { key: "owners", label: "manyfold.steps.owners" },
  { key: "comes", label: "steps.comes" },
  { key: "start", label: "steps.start" },
] as const;
const LAST = STEPS.length - 1;
const POLL_MS = 1500;
const m = (key: string) => k(`manyfold.${key}`);

/** A Manyfold username, how many models they own there, and who has them here. */
type Owner = { username: string; userId: string; models: number | null };

/** Where the dialog opens for one from the list: its check while it waits, its end once it ran. */
function stepFor(run: ManyfoldRun | null): number {
  if (!run) return 0;
  return run.started_at ? LAST : 1;
}

/** Who here a Manyfold username most likely is: the same name, or the same start of an email; else whoever asks. */
export function guessUser(username: string, users: AdminUser[], fallback: string): string {
  const name = username.toLowerCase();
  const same = users.find(
    (user) => user.display_name.toLowerCase() === name || user.email.toLowerCase().split("@")[0] === name,
  );
  return same?.id ?? fallback;
}

/** The lines of what a run from Manyfold did. */
export function manyfoldLines(t: TFunction, report: ManyfoldReport): string[] {
  const lines = [t(k("report.models"), { count: report.models.brought })];
  if (report.models.earlier) lines.push(t(k("report.modelsEarlier"), { count: report.models.earlier }));
  if (report.models.alreadyHere) lines.push(t(k("report.alreadyHere"), { count: report.models.alreadyHere }));
  if (report.models.noFiles) lines.push(t(m("report.noFiles"), { count: report.models.noFiles }));
  if (report.models.failed) lines.push(t(k("report.failed"), { count: report.models.failed }));
  if (report.files.missing) lines.push(t(m("report.missingFiles"), { count: report.files.missing }));
  const collections = report.collections.brought + report.collections.merged;
  if (collections) lines.push(t(k("report.collections"), { count: collections }));
  if (report.collections.merged) lines.push(t(k("report.collectionsMerged"), { count: report.collections.merged }));
  return lines;
}

type Props = {
  /** A migration from the list, or null for a new one. */
  initial: ManyfoldRun | null;
  onClose: () => void;
  /** Something in the list changed: one started, finished or went. */
  onChanged: () => void;
  onUnauthorized?: () => void;
};

/** From Manyfold, in steps: its address and API key, what it has, whose models go to whom, what comes, start. A plain
 *  stepper like the Thingport one, as each step needs the one before. */
export default function ManyfoldMigrateDialog({ initial, onClose, onChanged, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const confirm = useConfirm();
  const paperRef = useToastHost(true);
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));
  const me = React.useMemo(() => readUser(), []);
  const [run, setRun] = React.useState<ManyfoldRun | null>(initial);
  const [step, setStep] = React.useState(() => stepFor(initial));
  const [connection, setConnection] = React.useState({ address: "", clientId: "", clientSecret: "" });
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<MigrateRunError | null>(null);
  const [users, setUsers] = React.useState<AdminUser[] | null>(null);
  const [owners, setOwners] = React.useState<Owner[]>(
    () => initial?.options?.owners.map(({ username, userId }) => ({ username, userId, models: null })) ?? [],
  );
  const [username, setUsername] = React.useState("");
  const [collections, setCollections] = React.useState(() => initial?.options?.collections ?? true);

  const fail = React.useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(requestError(err));
    },
    [onUnauthorized],
  );

  React.useEffect(() => {
    adminApi.listUsers().then(setUsers, fail);
  }, [fail]);

  // Followed while it runs.
  const runId = run?.id;
  const active = run ? isActive(run) : false;
  React.useEffect(() => {
    if (!runId || !active) return;
    return followRun(
      () => migrateApi.get(runId),
      POLL_MS,
      (next) => {
        // The same run, so always Manyfold's: this tells TypeScript.
        if (next.source !== "manyfold") return;
        setRun(next);
        if (!isActive(next)) onChanged();
      },
      (err) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
      },
    );
  }, [runId, active, onChanged, onUnauthorized]);

  const act = async (work: () => Promise<void>) => {
    setError(null);
    setSending(true);
    try {
      await work();
    } catch (err) {
      fail(err);
    } finally {
      setSending(false);
    }
  };

  const connect = () =>
    act(async () => {
      setRun(
        await migrateApi.prepareManyfold(
          connection.address.trim(),
          connection.clientId.trim(),
          connection.clientSecret.trim(),
        ),
      );
      setStep(1);
      onChanged();
    });

  const addOwner = () =>
    act(async () => {
      const name = username.trim();
      // Who they go to is guessed from the people here, so not before they're known.
      if (!run || !name || !users) return;
      if (owners.some((owner) => owner.username.toLowerCase() === name.toLowerCase())) {
        setUsername("");
        return;
      }
      const { models } = await migrateApi.manyfoldOwner(run.id, name);
      if (!models) {
        setError({ code: "manyfold_no_owner", message: "", values: { username: name } });
        return;
      }
      setOwners((previous) => [...previous, { username: name, models, userId: guessUser(name, users, me?.id ?? "") }]);
      setUsername("");
    });

  const start = () =>
    act(async () => {
      if (!run) return;
      setRun(
        await migrateApi.startManyfold(run.id, {
          owners: owners.map((owner) => ({ username: owner.username, userId: owner.userId })),
          collections,
        }),
      );
      onChanged();
    });

  const discard = async () => {
    if (!run) return onClose();
    const ok = await confirm({
      title: t(k("runs.discard")),
      message: t(m("discardConfirm")),
      confirmLabel: t(k("runs.discard")),
      destructive: true,
    });
    if (ok) {
      await act(async () => {
        await migrateApi.remove(run.id);
        onChanged();
        onClose();
      });
    }
  };

  const waiting = run?.status === "ready" || (run?.status === "failed" && run.can_resume);
  const counts = run?.plan.manyfold;
  const canNext =
    step === 0
      ? Boolean(connection.address.trim() && connection.clientId.trim() && connection.clientSecret.trim())
      : true;
  const field = (key: keyof typeof connection) => ({
    value: connection[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setConnection({ ...connection, [key]: event.target.value }),
    disabled: sending,
    fullWidth: true,
  });

  let content: React.ReactNode = null;
  if (step === 0) {
    content = (
      <Stack spacing={2.5}>
        <TextField
          {...field("address")}
          label={t(m("address"))}
          placeholder="http://192.168.1.30:3214"
          helperText={t(m("addressHelp"))}
          slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "off", inputMode: "url" } }}
        />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField
            {...field("clientId")}
            label={t(m("clientId"))}
            autoComplete="off"
            slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "off" } }}
          />
          <TextField {...field("clientSecret")} label={t(m("clientSecret"))} type="password" autoComplete="off" />
        </Stack>
        <Typography variant="body2" color="text.secondary" component="div">
          {t(m("key"))}
          <HelpTip text={t(m("keyHelp"))} />
        </Typography>
      </Stack>
    );
  } else if (run && step === 1) {
    content = (
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <CheckCircleOutlineIcon color="success" aria-hidden />
          <Box>
            <Typography variant="body1" fontWeight={600}>
              {t(m("checked"), { host: hostOf(run.plan.address ?? "") })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t(m("keyWorks"))}
            </Typography>
          </Box>
        </Stack>
        {counts && (
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            {(["models", "collections", "creators"] as const).map((key) => (
              <Box key={key} sx={{ px: 1.5, py: 1, borderRadius: 2, border: "1px solid", borderColor: "divider" }}>
                <Typography variant="h6" component="p" sx={{ lineHeight: 1.2 }}>
                  {counts[key].toLocaleString()}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t(m(`counts.${key}`), { count: counts[key] })}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        {(counts?.before ?? 0) > 0 && <Alert severity="info">{t(m("before"), { count: counts!.before })}</Alert>}
        <Typography variant="body2" color="text.secondary" component="div">
          {t(m("staysBehind"))}
          <HelpTip text={t(m("staysBehindHelp"))} />
        </Typography>
      </Stack>
    );
  } else if (run && step === 2) {
    content = (
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary" component="div">
          {t(m("ownersIntro"))}
          <HelpTip text={t(m("ownersHelp"))} />
        </Typography>
        {waiting && (
          <Stack
            component="form"
            direction="row"
            spacing={1}
            alignItems="flex-start"
            onSubmit={(event: React.FormEvent) => {
              event.preventDefault();
              void addOwner();
            }}
          >
            <TextField
              size="small"
              label={t(m("username"))}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={sending}
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "off" } }}
            />
            <Button
              type="submit"
              variant="outlined"
              startIcon={sending ? <CircularProgress size={16} /> : <AddIcon />}
              disabled={sending || !users || !username.trim()}
              sx={{ flexShrink: 0, height: 40 }}
            >
              {t(m("add"))}
            </Button>
          </Stack>
        )}
        {owners.length > 0 ? (
          <Stack divider={<Divider flexItem />}>
            {owners.map((owner) => (
              <Stack
                key={owner.username}
                direction={{ xs: "column", sm: "row" }}
                spacing={{ xs: 0.75, sm: 1.5 }}
                alignItems={{ xs: "stretch", sm: "center" }}
                sx={{
                  py: 1,
                  "@keyframes manyfoldOwnerIn": {
                    from: { opacity: 0, transform: "translateY(4px)" },
                    to: { opacity: 1 },
                  },
                  animation: "manyfoldOwnerIn 200ms ease-out",
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
                  <PersonOutlineIcon fontSize="small" color="action" aria-hidden />
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {owner.username}
                  </Typography>
                  {owner.models !== null && (
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {t(m("models"), { count: owner.models })}
                    </Typography>
                  )}
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Select
                    size="small"
                    value={users ? owner.userId : ""}
                    disabled={!waiting || !users}
                    onChange={(event) =>
                      setOwners((previous) =>
                        previous.map((item) =>
                          item.username === owner.username ? { ...item, userId: String(event.target.value) } : item,
                        ),
                      )
                    }
                    inputProps={{ "aria-label": t(m("goesTo"), { username: owner.username }) }}
                    sx={{ flex: 1, minWidth: { sm: 220 } }}
                  >
                    {(users ?? []).map((user) => (
                      <MenuItem key={user.id} value={user.id}>
                        {user.id === me?.id ? t(m("you"), { name: user.display_name }) : user.display_name}
                      </MenuItem>
                    ))}
                  </Select>
                  {waiting && (
                    <Tooltip title={t(m("remove"))}>
                      <IconButton
                        size="small"
                        aria-label={t(m("removeOwner"), { username: owner.username })}
                        onClick={() => setOwners((previous) => previous.filter((item) => item !== owner))}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1.5, textAlign: "center" }}>
            {t(m("noOwners"))}
          </Typography>
        )}
      </Stack>
    );
  } else if (run && step === 3) {
    content = (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {t(m("always"))}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 0.75 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" component="span">
              {t(k("comes.collections"))}
            </Typography>
            <HelpTip text={t(m("collectionsHelp"))} />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 32, textAlign: "right" }}>
            {(counts?.collections ?? 0).toLocaleString()}
          </Typography>
          <Switch
            checked={collections}
            disabled={!waiting}
            onChange={(event) => setCollections(event.target.checked)}
            slotProps={{ input: { "aria-label": t(k("comes.collections")) } }}
          />
        </Stack>
      </Stack>
    );
  } else if (run) {
    content = <ManyfoldEnd run={run} owners={owners.length} collections={collections} />;
  }

  return (
    <Dialog
      open
      onClose={sending ? undefined : onClose}
      fullWidth
      maxWidth="md"
      fullScreen={phone}
      PaperProps={{ ref: paperRef }}
      aria-labelledby="manyfold-dialog-title"
    >
      <DialogTitle
        id="manyfold-dialog-title"
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1.5 }}
      >
        {t(m("dialogTitle"))}
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
          {STEPS.map(({ key, label }, index) => (
            <Step key={key} completed={index < step || (index === LAST && run?.status === "done")}>
              <StepLabel>{phone && index !== step ? "" : t(k(label))}</StepLabel>
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
        {run?.status === "ready" && (
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
        {step < LAST && (step === 0 || waiting) && (
          <Button
            variant="contained"
            disabled={!canNext || sending}
            onClick={() => (step === 0 ? void connect() : setStep(step + 1))}
          >
            {step === 0 && sending ? <CircularProgress size={20} color="inherit" /> : t(k("dialog.next"))}
          </Button>
        )}
        {step === LAST && waiting && (
          <Button variant="contained" onClick={() => void start()} disabled={sending}>
            {t(k(run?.status === "failed" ? "runs.startAgain" : "start.start"))}
          </Button>
        )}
        {run && !waiting && step === LAST && (
          <Button variant={run.status === "done" ? "contained" : "text"} onClick={onClose}>
            {t("common:close")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Before it starts, what's about to happen; then how far it is; then what it did. */
function ManyfoldEnd({ run, owners, collections }: { run: ManyfoldRun; owners: number; collections: boolean }) {
  const { t } = useTranslation("app");
  if (run.status === "running") {
    const step = run.progress?.step ?? "owners";
    const values = { done: run.progress?.done ?? 0, total: run.progress?.total ?? 0 };
    return <RunningView run={run} label={t(m(`phases.${step}`), values)} />;
  }
  const report = run.report;
  if (run.status === "done" && report)
    return <ReportLines lines={manyfoldLines(t, report)} failures={report.failures} />;
  if (run.status === "failed" && run.started_at) {
    return (
      <StoppedView run={run}>
        {report && <ReportLines lines={manyfoldLines(t, report)} failures={report.failures} partial />}
      </StoppedView>
    );
  }
  return (
    <Stack spacing={1}>
      <Typography variant="body1" fontWeight={600}>
        {t(m("summary"), { count: run.plan.manyfold?.models ?? 0 })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {owners ? t(m("ownersSummary"), { count: owners }) : t(m("allToYou"))}
      </Typography>
      {collections && (
        <Stack direction="row" spacing={0.75} sx={{ pt: 0.5 }}>
          <ToneChip tone="neutral" label={t(k("comes.collections"))} />
        </Stack>
      )}
    </Stack>
  );
}
