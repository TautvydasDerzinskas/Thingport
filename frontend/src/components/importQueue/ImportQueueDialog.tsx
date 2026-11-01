import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import ErrorIcon from "@mui/icons-material/Error";
import PauseIcon from "@mui/icons-material/Pause";
import PeopleIcon from "@mui/icons-material/People";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import Segmented from "../controls/Segmented";
import { PanelHeader, SectionLabel } from "../Layout/ConfigurationDialog/parts";
import { useConfirm } from "../ConfirmProvider";
import SectionedDialog, { SectionNavButton, type DialogSection } from "../SectionedDialog";
import { useCurrentToast } from "../ToastProvider";
import { useImportQueue } from "./ImportQueueContext";
import JobCard, { JobCardSkeletons } from "./JobCard";
import LineRow from "./LineRow";
import { headingMark, keepingPanelFocus } from "./queueFocus";
import {
  focusRingSx,
  InitialsAvatar,
  LiveDot,
  popInSx,
  quietButtonSx,
  tapTargetSx,
  visuallyHiddenSx,
} from "./queueParts";
import QueueSettingsPopover from "./QueueSettingsPopover";
import {
  clearFinishedConfirmText,
  dialogTitle,
  emptyState,
  everyoneFinished,
  finishedListNote,
  ownerName,
  panelAction,
  panelSubtitle,
  peopleOf,
  QUEUE_SECTIONS,
  queueGroups,
  runningNow,
  SECTION_COUNT_TONES,
  sectionCounts,
  visibleJobs,
  type PanelAction,
  type QueueEmptyState,
  type QueueGroup,
  type QueueJob,
  type QueuePerson,
  type QueueScope,
  type QueueSection,
  type SectionCounts,
} from "./queueView";

const SECTION_ICONS: Record<QueueSection, React.ReactNode> = {
  run: <AutorenewIcon fontSize="small" />,
  att: <ErrorIcon fontSize="small" />,
  wait: <AccessTimeIcon fontSize="small" />,
  done: <CheckCircleIcon fontSize="small" />,
};

const ACTION_ICONS: Record<PanelAction["kind"], React.ReactNode> = {
  pauseAll: <PauseIcon />,
  retryAll: <ReplayIcon />,
  startAll: <PlayArrowIcon />,
  clearFinished: <DeleteSweepIcon />,
};

const EMPTY_ICONS: Record<QueueEmptyState["icon"], typeof AutorenewIcon> = {
  run: AutorenewIcon,
  wait: AccessTimeIcon,
  check: CheckCircleIcon,
};

const paperSx = {
  ...popInSx,
  // A plain button takes the browser's font, not the page's.
  "& .MuiButtonBase-root": { fontFamily: "inherit" },
};

// The line behind a viewer's place in the queue, joining the pills: 1px of border and 12px of padding from the card's
// edge, then half a pill. The rows on it hide it wherever they're solid.
const ladderSx = {
  position: "relative",
  "&::before": { content: '""', position: "absolute", left: 28, top: 20, bottom: 24, width: 2, bgcolor: "divider" },
  "& > *": { position: "relative" },
};

function GroupView({ group }: { group: QueueGroup }) {
  return (
    <div>
      {group.label && (
        <Box sx={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 1 }}>
          <SectionLabel>{group.label}</SectionLabel>
          {group.hint && (
            <Typography variant="caption" color="text.secondary" sx={{ ml: "auto", mb: 1 }}>
              {group.hint}
            </Typography>
          )}
        </Box>
      )}
      <Box sx={[{ display: "flex", flexDirection: "column", gap: 1 }, group.ladder && ladderSx]}>
        {group.rows.map((row) =>
          row.kind === "card" ? <JobCard key={row.key} job={row.job} /> : <LineRow key={row.key} row={row} />,
        )}
      </Box>
    </div>
  );
}

function EmptyPanel({ state }: { state: QueueEmptyState }) {
  const Icon = EMPTY_ICONS[state.icon];
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 6, px: 3, textAlign: "center" }}>
      <Icon sx={{ fontSize: 32, color: "text.secondary" }} />
      <Typography variant="body2" fontWeight={600} sx={{ color: (theme) => theme.thingport.headingText }}>
        {state.title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 340 }}>
        {state.text}
      </Typography>
    </Stack>
  );
}

/** The chosen section's title, its bulk action, and what's in it. */
function QueuePanel({ list, counts }: { list: QueueJob[]; counts: SectionCounts }) {
  const { t } = useTranslation(["app", "common"]);
  const queue = useImportQueue();
  const { section, scope, person } = queue.dialog;
  const everyone = scope === "everyone";
  const loading = everyone ? queue.everyone.loading : queue.loading;
  const failed = everyone ? queue.everyone.failed : queue.failed;

  const groups = queueGroups(section, { list, scope, line: queue.line, autoStart: queue.startGrabLinks }, t);
  const action = panelAction(section, list, counts, t, {
    actsOnAll: everyone && queue.everyone.olderBackend && person !== null,
  });
  const confirm = useConfirm();
  const finishedNote = section === "done" ? finishedListNote(list, counts, t) : null;

  const clearFinished = async () => {
    const owner = list.find((job) => job.owner?.id === person)?.owner;
    const text = clearFinishedConfirmText(
      t,
      // A backend older than the line counts and clears by its own rule, so there's no number to promise.
      everyone && !queue.everyone.olderBackend
        ? { count: counts.done, person: person && (owner ? ownerName(owner) : person) }
        : undefined,
    );
    if (await confirm({ ...text, destructive: true })) await queue.clearFinished(person);
  };

  const runAction = (kind: PanelAction["kind"]) => (kind === "clearFinished" ? clearFinished() : queue[kind]());

  return (
    <>
      <Box {...headingMark} sx={focusRingSx}>
        <PanelHeader
          title={t(`importQueue.sections.${section}`)}
          subtitle={panelSubtitle(section, scope, t)}
          action={
            action && (
              <Button
                size="small"
                variant={action.primary ? "contained" : "outlined"}
                color={action.primary ? "primary" : "inherit"}
                startIcon={ACTION_ICONS[action.kind]}
                disabled={action.disabled || queue.busy.has(action.kind)}
                onClick={(event) => void keepingPanelFocus(event, () => runAction(action.kind))}
                sx={action.primary ? tapTargetSx : quietButtonSx}
              >
                {action.label}
              </Button>
            )
          }
        />
      </Box>
      {failed && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void queue.refresh()} sx={tapTargetSx}>
              {t("common:retry")}
            </Button>
          }
          sx={{ mb: 1.5 }}
        >
          {t("importQueue.loadFailed")}
        </Alert>
      )}
      {loading ? (
        <JobCardSkeletons />
      ) : groups.length ? (
        <Stack spacing={2.25}>
          {groups.map((group) => (
            <GroupView key={group.id} group={group} />
          ))}
        </Stack>
      ) : (
        // An unread list says nothing about what's in it, so no "Nothing waiting" under the error.
        !failed &&
        !finishedNote && (
          <EmptyPanel
            state={emptyState(
              section,
              { scope, line: queue.line, own: queue.jobs, autoStart: queue.startGrabLinks },
              t,
            )}
          />
        )
      )}
      {!loading && finishedNote && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5, textAlign: "center" }}>
          {finishedNote}
        </Typography>
      )}
    </>
  );
}

// Longer than a confirmation takes to close: until then it hides this dialog from screen readers too, and words that
// come meanwhile aren't said.
const ECHO_DELAY_MS = 250;

/** A modal dialog hides what's beside it from screen readers, and that takes in the toast. Here, it goes when the
 *  dialog does, so nothing is said twice. A new element each time, so the same words are said again. */
function ToastEcho() {
  const toast = useCurrentToast();
  const [said, setSaid] = React.useState(toast);
  React.useEffect(() => {
    const timer = setTimeout(() => setSaid(toast), ECHO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <Box component="output" aria-live="polite" sx={visuallyHiddenSx}>
      {said && <span key={said.key}>{said.message}</span>}
    </Box>
  );
}

type PeopleProps = {
  people: QueuePerson[];
  total: number;
  person: string | null;
  onPick: (person: string | null) => void;
};

function PeopleList({ people, total, person, onPick }: PeopleProps) {
  const { t } = useTranslation("app");
  return (
    <Box sx={{ mt: 1.75, display: "flex", flexDirection: "column", gap: 0.25 }}>
      <Box sx={{ px: 1.5 }}>
        <SectionLabel>{t("importQueue.people")}</SectionLabel>
      </Box>
      <SectionNavButton
        label={t("importQueue.everyone")}
        icon={<PeopleIcon fontSize="small" />}
        count={total}
        chosen={person === null}
        onClick={() => onPick(null)}
      />
      {people.map(({ id, name, email, count }) => (
        <SectionNavButton
          key={id}
          label={name}
          title={email ? `${name} · ${email}` : name}
          icon={<InitialsAvatar name={name} size={22} />}
          count={count}
          chosen={person === id}
          onClick={() => onPick(id)}
        />
      ))}
    </Box>
  );
}

/** Phones: a list of everyone would leave no room for their imports. */
function PeopleSelect({ people, total, person, onPick }: PeopleProps) {
  const { t } = useTranslation("app");
  return (
    <Select
      size="small"
      fullWidth
      displayEmpty
      value={person !== null && people.some(({ id }) => id === person) ? person : ""}
      onChange={(event) => onPick(event.target.value || null)}
      inputProps={{ "aria-label": t("importQueue.people") }}
      // The part that opens it is the inner one, so that's what has to be big enough to tap.
      sx={{ "& .MuiSelect-select": { py: "11.5px" } }}
    >
      <MenuItem value="">
        {t("importQueue.everyone")} · {total}
      </MenuItem>
      {people.map(({ id, name, count }) => (
        <MenuItem key={id} value={id}>
          {name} · {count}
        </MenuItem>
      ))}
    </Select>
  );
}

type Props = { isAdmin: boolean };

/** The import queue, for the indicator and any link to open: one's own imports, and for an admin everyone's. */
export default function ImportQueueDialog({ isAdmin }: Props) {
  const { t } = useTranslation("app");
  const queue = useImportQueue();
  const { supported, setScope, setPerson } = queue;
  const { open, section, scope, person } = queue.dialog;
  const everyone = queue.everyone;

  // A backend older than the line keeps no list of one's own, so all an admin can look at is everyone's.
  React.useEffect(() => {
    if (open && isAdmin && !supported && scope !== "everyone") setScope("everyone");
  }, [open, isAdmin, supported, scope, setScope]);

  const people = scope === "everyone" ? peopleOf(everyone.jobs) : [];

  // The one being looked at can leave the list, as when their last import is cleared, and take the rail's row with it.
  const personGone =
    scope === "everyone" && !everyone.loading && person !== null && !people.some(({ id }) => id === person);
  React.useEffect(() => {
    if (personGone) setPerson(null);
  }, [personGone, setPerson]);

  const list = visibleJobs(scope, queue.jobs, everyone.jobs, person);
  const counts = sectionCounts(list, scope === "mine" ? queue.finishedTotal : everyoneFinished(everyone, person));
  const importingNow = runningNow(list);

  const sections: DialogSection<QueueSection>[] = QUEUE_SECTIONS.map((id) => ({
    id,
    label: t(`importQueue.sections.${id}`),
    icon: SECTION_ICONS[id],
    count: counts[id],
    countTone: SECTION_COUNT_TONES[id],
  }));

  const scopeOptions: { value: QueueScope; label: string }[] = [
    { value: "mine", label: t("importQueue.scope.mine") },
    { value: "everyone", label: t("importQueue.scope.everyone") },
  ];
  const showPeople = scope === "everyone" && !everyone.loading;
  const peopleProps: PeopleProps = { people, total: everyone.jobs.length, person, onPick: setPerson };

  return (
    <SectionedDialog
      open={open}
      onClose={queue.close}
      title={dialogTitle(scope, t)}
      sections={sections}
      section={section}
      onSectionChange={queue.setSection}
      size="large"
      phoneNav="grid"
      navLabel={t("importQueue.sectionsLabel")}
      paperSx={paperSx}
      titleExtra={
        importingNow > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}
          >
            <LiveDot live color="warning.main" />
            {t("importQueue.importingNow", { count: importingNow })}
          </Typography>
        )
      }
      headerActions={supported ? <QueueSettingsPopover /> : undefined}
      railHeader={
        isAdmin && supported ? (
          <Box sx={{ mb: { xs: 0.5, md: 1.25 }, "& button": tapTargetSx }}>
            <Segmented
              fullWidth
              label={t("importQueue.scope.label")}
              value={scope}
              options={scopeOptions}
              onChange={setScope}
            />
          </Box>
        ) : undefined
      }
      railFooter={showPeople ? <PeopleList {...peopleProps} /> : undefined}
      phoneRailFooter={showPeople ? <PeopleSelect {...peopleProps} /> : undefined}
    >
      <ToastEcho />
      <QueuePanel list={list} counts={counts} />
    </SectionedDialog>
  );
}
