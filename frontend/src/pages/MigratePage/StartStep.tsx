import { useTranslation } from "react-i18next";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { MigratePerson, MigrateReport, MigrateRun } from "../../api/migrate";
import ToneChip from "../../components/ToneChip";
import type { Choices } from "./ComesStep";
import { errorDetails, errorText, k } from "./parts";

type Props = {
  run: MigrateRun;
  people: MigratePerson[];
  chosen: ReadonlySet<string>;
  choices: Choices;
};

/** Before it starts, what's about to happen; then how far it is; then what it did. */
export default function StartStep({ run, people, chosen, choices }: Props) {
  const { t } = useTranslation("app");

  if (run.status === "running") {
    const step = run.progress?.step ?? "people";
    const share = run.progress && run.progress.total > 0 ? (run.progress.done / run.progress.total) * 100 : null;
    return (
      <Stack spacing={1.5} aria-live="polite">
        <Typography variant="body2" fontWeight={600}>
          {t(k(`start.phases.${step}`), { done: run.progress?.done ?? 0, total: run.progress?.total ?? 0 })}
        </Typography>
        <LinearProgress
          variant={share === null ? "indeterminate" : "determinate"}
          value={share ?? undefined}
          sx={{ borderRadius: 1 }}
          aria-hidden
        />
        <Typography variant="caption" color="text.secondary">
          {t(k("start.background"))}
        </Typography>
      </Stack>
    );
  }

  if (run.status === "done" && run.report) return <Report report={run.report} />;

  if (run.status === "failed" && run.started_at) {
    const details = errorDetails(run.error);
    return (
      <Stack spacing={2}>
        <Alert severity="error">
          <Typography variant="body2">{errorText(t, run.error)}</Typography>
          {details && (
            <Box component="pre" sx={{ mt: 1, mb: 0, fontSize: "0.75rem", whiteSpace: "pre-wrap" }}>
              {details}
            </Box>
          )}
          {run.can_resume && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t(k("start.resumeHint"))}
            </Typography>
          )}
        </Alert>
        {run.report && <Report report={run.report} partial />}
      </Stack>
    );
  }

  const coming = people.filter((person) => chosen.has(person.id));
  const merged = coming.filter((person) => person.merge).length;
  const models = coming.reduce((sum, person) => sum + person.models, 0);
  const extras = (Object.keys(choices) as (keyof Choices)[]).filter(
    (key) => choices[key] && !(key === "syncs" && !choices.collections),
  );
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="body1" fontWeight={600}>
          {t(k("start.summary"), { count: coming.length, models })}
        </Typography>
        {merged > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t(k("start.merged"), { count: merged })}
          </Typography>
        )}
        {extras.length > 0 && (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            {extras.map((key) => (
              <ToneChip key={key} tone="neutral" label={t(k(`comes.${key}`))} />
            ))}
          </Stack>
        )}
      </Box>
      <Alert severity="warning">{t(k("start.stopOld"))}</Alert>
    </Stack>
  );
}

/** Each failure with a key of its own, numbered where two say the same. */
function keyedFailures(failures: MigrateReport["failures"]) {
  const seen = new Map<string, number>();
  return failures.map((failure) => {
    const base = `${failure.kind}:${failure.name}:${failure.error}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...failure, key: `${base}:${count}` };
  });
}

function Report({ report, partial = false }: { report: MigrateReport; partial?: boolean }) {
  const { t } = useTranslation("app");
  const lines: string[] = [];
  if (report.people.created) lines.push(t(k("report.people"), { count: report.people.created }));
  if (report.people.merged) lines.push(t(k("report.peopleMerged"), { count: report.people.merged }));
  if (report.people.earlier) lines.push(t(k("report.peopleEarlier"), { count: report.people.earlier }));
  lines.push(t(k("report.models"), { count: report.models.brought }));
  if (report.models.earlier) lines.push(t(k("report.modelsEarlier"), { count: report.models.earlier }));
  const notes: [keyof MigrateReport["models"], string][] = [
    ["alreadyHere", "report.alreadyHere"],
    ["renamed", "report.renamed"],
    ["noFiles", "report.noFiles"],
    ["toolModels", "report.toolModels"],
    ["failed", "report.failed"],
    ["unfiled", "report.unfiled"],
  ];
  for (const [key, label] of notes) if (report.models[key]) lines.push(t(k(label), { count: report.models[key] }));
  if (report.files.missing) lines.push(t(k("report.missingFiles"), { count: report.files.missing }));
  const collections = report.collections.brought + report.collections.merged;
  if (collections) lines.push(t(k("report.collections"), { count: collections }));
  if (report.collections.merged) lines.push(t(k("report.collectionsMerged"), { count: report.collections.merged }));
  const extras: [keyof MigrateReport, string][] = [
    ["designs", "report.designs"],
    ["widgets", "report.widgets"],
    ["tools", "report.tools"],
    ["syncs", "report.syncs"],
    ["signIns", "report.signIns"],
    ["settings", "report.settings"],
    ["secrets", "report.secrets"],
  ];
  for (const [key, label] of extras) {
    const count = report[key] as number;
    if (count) lines.push(t(k(label), { count }));
  }
  return (
    <Stack spacing={1.5}>
      {!partial && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CheckCircleOutlineIcon color="success" aria-hidden />
          <Typography variant="body1" fontWeight={600}>
            {t(k("report.done"))}
          </Typography>
        </Stack>
      )}
      <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
        {lines.map((line) => (
          <Typography key={line} component="li" variant="body2">
            {line}
          </Typography>
        ))}
      </Stack>
      {report.failures.length > 0 && (
        <Accordion variant="outlined" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2">{t(k("report.failures"), { count: report.failures.length })}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={0.75}>
              {keyedFailures(report.failures).map((failure) => (
                <Typography key={failure.key} variant="caption" sx={{ overflowWrap: "anywhere" }}>
                  <strong>{failure.name}</strong>: {failure.error}
                </Typography>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      )}
    </Stack>
  );
}
