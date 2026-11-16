// The queue itself, without a window: what a print job holds, how it moves between statuses, how the board sorts
// them, what a model's page shows for a person's jobs on it, and who already has a model queued.

/** The board's columns, in order. */
export const STATUSES = ["queued", "printing", "printed", "failed"];

/** Statuses a print is still waiting for or happening in: the ones that warn someone queueing the same model. */
export const ACTIVE = new Set(["queued", "printing"]);

/** A job's key among the user's shared entries. */
export const JOB = "job:";

const TONES = { queued: "waiting", printing: "active", printed: "done", failed: "failed" };

/** A short id, without crypto.randomUUID, which a Thingport instance on plain http doesn't have. */
export function newId(now = Date.now(), random = Math.random) {
  return `${now.toString(36)}${random().toString(36).slice(2, 8)}`;
}

/** A model as a job in the queue. */
export function newJob(model, now = new Date()) {
  return {
    status: "queued",
    modelId: model.id,
    name: model.name,
    note: "",
    queuedAt: now.toISOString(),
    startedAt: null,
    finishedAt: null,
  };
}

const text = (value) => typeof value === "string";
const maybeText = (value) => value === null || typeof value === "string";

/** Whether a shared value is a job this tool wrote, whole: anyone can write anything, and the board sorts by these. */
export function isJob(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    STATUSES.includes(value.status) &&
    text(value.name) &&
    text(value.modelId) &&
    text(value.queuedAt) &&
    maybeText(value.startedAt) &&
    maybeText(value.finishedAt) &&
    text(value.note)
  );
}

/** The job in another status, with the times that status keeps. */
export function moved(job, status, now = new Date()) {
  const at = now.toISOString();
  // Back in the queue: at its end, as though queued now.
  if (status === "queued") return { ...job, status, queuedAt: at, startedAt: null, finishedAt: null };
  if (status === "printing") return { ...job, status, startedAt: at, finishedAt: null };
  return { ...job, status, finishedAt: at };
}

/** When its status last changed. */
export function statusDate(job) {
  return job.finishedAt ?? job.startedAt ?? job.queuedAt;
}

// Which of a person's jobs on a model their chip shows: one printing, then one queued, then the latest finished.
const RANK = { printing: 0, queued: 1, printed: 2, failed: 2 };

/** What a model's page shows for a person's jobs on it, or null for none. */
export function summaryOf(jobs) {
  if (!jobs.length) return null;
  const [shown] = jobs.toSorted(
    (a, b) => RANK[a.status] - RANK[b.status] || statusDate(b).localeCompare(statusDate(a)),
  );
  return { label: `status.${shown.status}`, tone: TONES[shown.status], date: statusDate(shown) };
}

/** A model page's chips: each person with jobs on the model, or on a copy of it, once with what their jobs come to; the
 *  user first, then by name. */
export function chipsOf(entries) {
  const byPerson = new Map();
  for (const entry of entries) {
    if (!entry.key.startsWith(JOB) || !isJob(entry.value)) continue;
    const id = entry.user?.id ?? (entry.mine ? "me" : "someone");
    const person = byPerson.get(id) ?? { user: entry.user, mine: entry.mine, jobs: [] };
    person.jobs.push(entry.value);
    byPerson.set(id, person);
  }
  return [...byPerson.values()]
    .map(({ user, mine, jobs }) => ({ user, mine, summary: summaryOf(jobs) }))
    .toSorted((a, b) => Number(b.mine) - Number(a.mine) || (a.user?.name ?? "").localeCompare(b.user?.name ?? ""));
}

/** Shared entries that are jobs, with each one's user, in the board's columns: the queue oldest first, as it's worked
 *  through, and the rest newest first. `who` keeps only one person's, by id. */
export function columns(entries, who = null) {
  const jobs = entries.filter((entry) => entry.key.startsWith(JOB) && isJob(entry.value));
  const mine = who ? jobs.filter((entry) => entry.user?.id === who) : jobs;
  return Object.fromEntries(
    STATUSES.map((status) => {
      const here = mine.filter((entry) => entry.value.status === status);
      here.sort((a, b) =>
        status === "queued"
          ? a.value.queuedAt.localeCompare(b.value.queuedAt)
          : statusDate(b.value).localeCompare(statusDate(a.value)),
      );
      return [status, here];
    }),
  );
}

/** The people with jobs on the board, the user first, each once. */
export function people(entries) {
  const seen = new Map();
  for (const entry of entries) {
    if (!entry.user || !entry.key.startsWith(JOB) || seen.has(entry.user.id)) continue;
    seen.set(entry.user.id, { ...entry.user, mine: entry.mine });
  }
  return [...seen.values()].sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
}

/** Who already has the model waiting or printing: the others, and the user's own, from entries about it. */
export function clashes(entries) {
  const active = entries.filter(
    (entry) => entry.key.startsWith(JOB) && isJob(entry.value) && ACTIVE.has(entry.value.status),
  );
  return { others: active.filter((entry) => !entry.mine), mine: active.filter((entry) => entry.mine) };
}

/** A read of shared entries gives 5,000 at most, newest first. */
const PAGE = 5000;

/** Everyone's jobs, or those on a model (`{ model }`), read on page by page, so an old one still queued can't fall
 *  off behind newer ones. */
export async function allJobs(shared, options = {}, page = PAGE) {
  let read = await shared.list({ ...options, prefix: JOB });
  const all = [...read];
  while (read.length >= page) {
    read = await shared.list({ ...options, prefix: JOB, before: read.at(-1).cursor });
    all.push(...read);
  }
  return all;
}

/** Their names, each once: "Dad", "Dad and Mum", "Dad, Mum and Ann". */
export function listNames(entries, and) {
  const names = [...new Set(entries.map((entry) => entry.user?.name).filter(Boolean))];
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names.at(-1)}`;
}

/**
 * Runs each write after the ones queued under the same key before it, whether they worked or not, so two quick
 * changes to one entry are stored in the order they were made rather than the order their requests finish.
 */
export function writesInTurn() {
  const tails = new Map();
  return (key, write) => {
    const run = (tails.get(key) ?? Promise.resolve()).then(write);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}
