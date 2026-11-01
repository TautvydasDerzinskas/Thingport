import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en.json";
import es from "../../i18n/locales/es.json";
import fr from "../../i18n/locales/fr.json";
import lt from "../../i18n/locales/lt.json";
import type { AdminQueueJobOut, ImportJobStatus, LineOut } from "../../api/imports";
import {
  canRemoveLink,
  clearFinishedConfirmText,
  deepLinkTarget,
  handsOnQueueParam,
  deleteConfirmText,
  dialogTitle,
  diffSnapshots,
  EMPTY_LINE,
  emptyState,
  everyoneDelay,
  everyoneFinished,
  finishedBeyondList,
  finishedListNote,
  finishToastOf,
  hasLinkList,
  indicatorLabel,
  indicatorState,
  indicatorTip,
  inLineText,
  jobBar,
  jobCaption,
  jobChip,
  jobLabel,
  jobOpenTarget,
  jobProvider,
  jobState,
  ladderRows,
  linkScopeText,
  linkStatusText,
  nowRowText,
  opensQueueLink,
  panelAction,
  panelSubtitle,
  peopleOf,
  personInitials,
  pollDelay,
  positionPill,
  primaryAction,
  privateRowText,
  queueGroups,
  runningNow,
  sectionCounts,
  sectionOf,
  submittedText,
  toEveryoneQueue,
  toQueueJob,
  toQueueSnapshot,
  visibleJobs,
  webLink,
  whenText,
  whyText,
  type QueueJob,
  type QueueRow,
  queueLinkPath,
} from "./queueView";

const i18n = i18next.createInstance();
await i18n.init({
  lng: "en",
  defaultNS: "app",
  resources: { en: { app: en.app } },
  interpolation: { escapeValue: false },
});
const t = i18n.getFixedT("en", "app");

const NOW = new Date(2026, 9, 31, 12, 0, 0).getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function job(fields: Partial<QueueJob> = {}): QueueJob {
  return toQueueJob(
    {
      id: "j1",
      type: "LINKS",
      status: "RUNNING",
      source_url: "https://example.com/a",
      total: 0,
      processed: 0,
      can_start: false,
      can_pause: false,
      can_retry: false,
      can_delete: false,
      attention: false,
      created_at: ago(HOUR),
      updated_at: ago(MINUTE),
      ...fields,
    },
    NOW,
  );
}

const context = { t, locale: "en", now: NOW };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toQueueJob", () => {
  const oldAdminRow = (fields: Partial<AdminQueueJobOut>): AdminQueueJobOut => ({
    id: "old",
    type: "LINKS",
    status: "PAUSED",
    source_url: "https://example.com/a",
    source_label: null,
    provider: null,
    total: 3,
    processed: 0,
    imported: 0,
    already_in_library: 0,
    failed_count: 0,
    error_message: null,
    result_collection_id: null,
    result_print_id: null,
    owner: { id: "u1", display_name: "Mia", email: "mia@example.com" },
    pending_count: 3,
    running_count: 0,
    done_count: 0,
    failed_items_count: 0,
    runner_live: false,
    created_at: ago(HOUR),
    updated_at: ago(HOUR),
    ...fields,
  });
  const actions = (row: AdminQueueJobOut) => {
    const { can_start, can_pause, can_retry, can_delete } = toQueueJob(row, NOW);
    return { can_start, can_pause, can_retry, can_delete };
  };

  it("derives what an older backend's row allows, by its admin page's rules", () => {
    expect(actions(oldAdminRow({}))).toEqual({ can_start: true, can_pause: false, can_retry: false, can_delete: true });
    expect(actions(oldAdminRow({ status: "RUNNING", runner_live: true }))).toEqual({
      can_start: false,
      can_pause: true,
      can_retry: false,
      can_delete: false,
    });
    // Still finishing the link it's on.
    expect(actions(oldAdminRow({ runner_live: true }))).toEqual({
      can_start: false,
      can_pause: false,
      can_retry: false,
      can_delete: false,
    });
    // Cut off with links still waiting, and starts like a paused one.
    expect(actions(oldAdminRow({ status: "ERROR", failed_items_count: 2 })).can_start).toBe(true);
    expect(actions(oldAdminRow({ status: "ERROR", failed_items_count: 2 })).can_retry).toBe(true);
    expect(actions(oldAdminRow({ status: "DONE", pending_count: 0, failed_items_count: 1 })).can_retry).toBe(true);
    expect(actions(oldAdminRow({ status: "DONE", pending_count: 0 }))).toEqual({
      can_start: false,
      can_pause: false,
      can_retry: false,
      can_delete: true,
    });
  });

  it("allows an older backend nothing but deleting on anything but link lists", () => {
    for (const type of ["ZIP", "COLLECTION", "PROFILES"] as const) {
      expect(actions(oldAdminRow({ type, status: "ERROR", failed_items_count: 1 }))).toEqual({
        can_start: false,
        can_pause: false,
        can_retry: false,
        can_delete: true,
      });
      expect(actions(oldAdminRow({ type, status: "RUNNING" })).can_pause).toBe(false);
    }
  });

  it("works out attention for an older backend's row, leaving out old failures and finished ZIPs", () => {
    const attention = (fields: Partial<AdminQueueJobOut>) => toQueueJob(oldAdminRow(fields), NOW).attention;
    expect(attention({ status: "ERROR" })).toBe(true);
    expect(attention({ status: "DONE", failed_count: 1 })).toBe(true);
    expect(attention({ status: "DONE" })).toBe(false);
    expect(attention({ status: "DONE", type: "ZIP", failed_count: 1 })).toBe(false);
    expect(attention({ status: "ERROR", type: "ZIP" })).toBe(true);
    expect(attention({ status: "ERROR", updated_at: ago(8 * DAY) })).toBe(false);
    expect(attention({ status: "ERROR", updated_at: "not a date" })).toBe(false);
  });

  it("takes the server's word when it has one", () => {
    const row = toQueueJob(oldAdminRow({ can_start: false, can_delete: false, attention: true }), NOW);
    expect(row.can_start).toBe(false);
    expect(row.can_delete).toBe(false);
    expect(row.attention).toBe(true);
  });

  it("survives a row with next to nothing in it", () => {
    const bare = toQueueJob({ id: "x" }, NOW);
    expect(bare).toMatchObject({
      total: 0,
      single: false,
      position: null,
      source_url: "",
      owner: null,
      sync_waiting: false,
      can_start: false,
      can_delete: true,
    });
    expect(sectionOf(bare)).toBe("done");
    expect(jobState(bare)).toBe("unknown");
    expect(jobLabel(bare, t)).toBe("Untitled import");
    expect(jobCaption(bare, context)).toBe("");
    expect(whyText(bare, t)).toBeNull();
    expect(primaryAction(bare, t)).toBeNull();
    expect(indicatorState([bare], false).kind).toBe("idle");
  });

  it("uses the error message as the reason when there's no other", () => {
    expect(toQueueJob({ id: "x", error_message: "Nope" }, NOW).failure_reason).toBe("Nope");
    expect(toQueueJob({ id: "x", error_message: "Nope", failure_reason: "Why" }, NOW).failure_reason).toBe("Why");
  });

  it("reads a link's title, which an older backend doesn't send", () => {
    expect(toQueueJob({ id: "x", link_title: "Benchy" }, NOW).link_title).toBe("Benchy");
    expect(toQueueJob({ id: "x", link_title: "" }, NOW).link_title).toBeNull();
    expect(toQueueJob({ id: "x" }, NOW).link_title).toBeNull();
  });
});

describe("toQueueSnapshot and toEveryoneQueue", () => {
  it("fills in whatever an answer lacks", () => {
    expect(toQueueSnapshot({}, NOW)).toEqual({ jobs: [], finishedTotal: 0, line: EMPTY_LINE, startGrabLinks: false });
    expect(toQueueSnapshot(null, NOW).jobs).toEqual([]);
    expect(toQueueSnapshot({ jobs: "nope" } as never, NOW).jobs).toEqual([]);
  });

  it("drops rows that aren't rows", () => {
    expect(toQueueSnapshot({ jobs: [null, {}, { id: "a" }] } as never, NOW).jobs.map((row) => row.id)).toEqual(["a"]);
  });

  it("reads the line and the setting", () => {
    const snapshot = toQueueSnapshot(
      {
        finished_total: 12,
        settings: { start_grab_links: true },
        line: {
          now: { mine: true, person: "p", job_id: "j" },
          rows: [{ position: 1, mine: false, person: "q", job_id: null }],
          length: 4,
        },
      },
      NOW,
    );
    expect(snapshot.finishedTotal).toBe(12);
    expect(snapshot.startGrabLinks).toBe(true);
    expect(snapshot.line.now).toEqual({ mine: true, person: "p", job_id: "j" });
    expect(snapshot.line.rows).toHaveLength(1);
    expect(snapshot.line.length).toBe(4);
  });

  it("tells an older backend's admin list by its rows", () => {
    expect(toEveryoneQueue({ jobs: [{ id: "a", status: "PAUSED" } as AdminQueueJobOut] }, NOW).olderBackend).toBe(true);
    expect(toEveryoneQueue({ jobs: [{ id: "a", can_start: true } as AdminQueueJobOut] }, NOW).olderBackend).toBe(false);
    expect(toEveryoneQueue({}, NOW)).toEqual({ jobs: [], olderBackend: false, finishedTotal: 0, finishedByOwner: {} });
  });

  it("reads how many finished, all told and per person, from a backend that says", () => {
    const queue = toEveryoneQueue({ jobs: [], finished_total: 1400, finished_by_owner: { u1: 1100, u2: 300 } }, NOW);
    expect(queue).toMatchObject({ finishedTotal: 1400, finishedByOwner: { u1: 1100, u2: 300 } });
    expect(everyoneFinished(queue, null)).toBe(1400);
    expect(everyoneFinished(queue, "u2")).toBe(300);
    expect(everyoneFinished(queue, "u3")).toBe(0);
  });

  it("counts on nothing from one that doesn't, or sends something else", () => {
    expect(everyoneFinished(toEveryoneQueue({ jobs: [] }, NOW), null)).toBe(0);
    expect(everyoneFinished(toEveryoneQueue({ jobs: [] }, NOW), "u1")).toBe(0);
    const odd = toEveryoneQueue({ finished_total: "many", finished_by_owner: "lots" } as never, NOW);
    expect(odd).toMatchObject({ finishedTotal: 0, finishedByOwner: {} });
    expect(everyoneFinished({ finishedTotal: 0, finishedByOwner: { u1: "x" as never } }, "u1")).toBe(0);
  });
});

describe("sectionOf", () => {
  it.each<[ImportJobStatus, boolean, string]>([
    ["RUNNING", false, "run"],
    ["RUNNING", true, "run"],
    ["QUEUED", false, "wait"],
    ["PAUSED", false, "wait"],
    ["PAUSED", true, "wait"],
    ["ERROR", true, "att"],
    ["DONE", true, "att"],
    ["ERROR", false, "done"],
    ["DONE", false, "done"],
  ])("%s with attention %s goes in %s", (status, attention, section) => {
    expect(sectionOf(job({ status, attention }))).toBe(section);
  });

  it("files a status this build doesn't know under Finished", () => {
    expect(sectionOf(job({ status: "CANCELLED" as ImportJobStatus }))).toBe("done");
  });
});

describe("indicatorState", () => {
  const running = (fields: Partial<QueueJob> = {}) =>
    job({ id: "r", status: "RUNNING", total: 40, processed: 24, ...fields });
  const queued = (position: number, fields: Partial<QueueJob> = {}) =>
    job({ id: `q${position}`, status: "QUEUED", position, ...fields });
  const failed = (id = "f") => job({ id, status: "ERROR", attention: true });
  const held = (id = "h") => job({ id, status: "PAUSED" });
  const syncWaiting = () => job({ id: "s", status: "PAUSED", sync_waiting: true, collection_sync_id: "c" });

  it("shows a running job with its progress, what's in line and what needs attention", () => {
    const state = indicatorState([running({ failed_count: 1 }), queued(3), failed()], false);
    expect(state).toMatchObject({
      kind: "running",
      ring: { arc: 60 },
      comet: true,
      number: 2,
      numberTone: "accent",
      glyph: null,
      badge: { count: 1, tone: "error" },
      section: "run",
    });
    expect(indicatorTip(state, t)).toBe("Importing, 60%. 1 in line. 1 needs attention");
    expect(indicatorLabel(state, t)).toBe("Import queue: Importing, 60%. 1 in line. 1 needs attention");
  });

  it("leaves out of the tooltip what there's none of", () => {
    expect(indicatorTip(indicatorState([running()], false), t)).toBe("Importing, 60%");
  });

  it("adds up several running jobs", () => {
    const state = indicatorState(
      [running({ total: 10, processed: 10 }), running({ id: "b", total: 90, processed: 0 })],
      false,
    );
    expect(state.percent).toBe(10);
    expect(state.number).toBe(2);
  });

  it("leaves a running sync out of the ring and the number", () => {
    const state = indicatorState(
      [running({ total: 10, processed: 10 }), running({ id: "s", total: 90, collection_sync_id: "c", processed: 0 })],
      false,
    );
    expect(state.percent).toBe(100);
    expect(state.number).toBe(1);
  });

  it("shows no ring or comet for a sync alone, and says it's coming in", () => {
    const state = indicatorState([running({ id: "s", collection_sync_id: "c" })], false);
    expect(state).toMatchObject({
      kind: "idle",
      ring: null,
      comet: false,
      number: null,
      glyph: "tray",
      syncing: true,
      section: "run",
    });
    expect(indicatorTip(state, t)).toBe("A synced collection is updating");
  });

  it("still counts what a sync needs from them", () => {
    const stopped = job({ id: "s", status: "PAUSED", collection_sync_id: "c" });
    expect(indicatorState([stopped], false)).toMatchObject({ kind: "hold", badge: { count: 1, tone: "neutral" } });
    const failedSync = job({ id: "s", status: "ERROR", attention: true, collection_sync_id: "c" });
    expect(indicatorState([failedSync], false)).toMatchObject({
      kind: "attention",
      badge: { count: 1, tone: "error" },
    });
  });

  it("has no percent for a single link, which has no steps to count", () => {
    const state = indicatorState([running({ single: true, total: 1, processed: 0 })], false);
    expect(state.percent).toBeNull();
    expect(indicatorTip(state, t)).toBe("Importing");
  });

  it("has no percent while nothing has a total yet", () => {
    const state = indicatorState([running({ total: 0, processed: 0 })], false);
    expect(state.percent).toBeNull();
    expect(state.ring).toEqual({ arc: 0 });
    expect(state.comet).toBe(true);
    expect(indicatorTip(state, t)).toBe("Importing");
  });

  it("keeps the percent in range when a count overshoots", () => {
    expect(indicatorState([running({ total: 2, processed: 5 })], false).percent).toBe(100);
  });

  it("shows a job in line by its place, with the track and no comet", () => {
    const next = indicatorState([queued(1)], false);
    expect(next).toMatchObject({
      kind: "inLine",
      ring: { arc: null },
      comet: false,
      number: 1,
      numberTone: "info",
      badge: null,
      section: "wait",
    });
    expect(indicatorTip(next, t)).toBe("Your next import is next up");

    const later = indicatorState([queued(9), queued(4), failed()], false);
    expect(later.number).toBe(2);
    expect(later.badge).toEqual({ count: 1, tone: "error" });
    expect(indicatorTip(later, t)).toBe("Your next import is #4 in line. 1 needs attention");
  });

  it("leaves a waiting sync job out of the number and the place", () => {
    const both = indicatorState([queued(4), syncWaiting()], false);
    expect(both.number).toBe(1);
    expect(both.nextPlace).toBe(4);
    expect(indicatorTip(both, t)).toBe("Your next import is #4 in line");

    const alone = indicatorState([syncWaiting()], false);
    expect(alone).toMatchObject({ kind: "idle", number: null, ring: null, nextPlace: null, section: "wait" });
    expect(indicatorTip(alone, t)).toBe("A synced collection is updating");

    expect(indicatorTip(indicatorState([running(), syncWaiting()], false), t)).toBe("Importing, 60%");
  });

  it("flashes a tick when they've just finished", () => {
    const state = indicatorState([job({ status: "DONE" })], true);
    expect(state).toMatchObject({
      kind: "finished",
      ring: { arc: 100 },
      comet: false,
      number: null,
      glyph: "tick",
      badge: null,
      section: "done",
    });
    expect(indicatorTip(state, t)).toBe("All imports finished");
  });

  it("keeps the attention count on the tick, and opens where that's shown", () => {
    const state = indicatorState([failed(), failed("g")], true);
    expect(state.badge).toEqual({ count: 2, tone: "error" });
    expect(indicatorTip(state, t)).toBe("All imports finished. 2 need attention");
    expect(state.section).toBe("att");
  });

  it("opens Finished from the tick, where the job just went, whatever else is on hold", () => {
    expect(indicatorState([job({ status: "DONE" }), held()], true).section).toBe("done");
  });

  describe("with a job that's pausing", () => {
    const pausing = (fields: Partial<QueueJob> = {}) =>
      job({ id: "p", status: "PAUSED", runner_live: true, total: 4, processed: 1, ...fields });

    it("keeps its ring and comet until the link it's on is done", () => {
      const state = indicatorState([pausing()], false);
      expect(state).toMatchObject({ kind: "running", comet: true, number: 1, percent: 25, section: "run", hold: 0 });
      expect(indicatorTip(state, t)).toBe("Importing, 25%");
    });

    it("then shows it on hold", () => {
      expect(indicatorState([pausing({ runner_live: false })], false)).toMatchObject({
        kind: "hold",
        comet: false,
        hold: 1,
      });
    });

    it("leaves a sync's out, as it does all of a sync's", () => {
      const state = indicatorState([pausing({ collection_sync_id: "c" })], false);
      expect(state).toMatchObject({ kind: "idle", ring: null, comet: false, number: null, syncing: true });
      expect(state.section).toBe("run");
    });
  });

  it("shows what needs attention with a red arrow", () => {
    const state = indicatorState([failed(), held()], false);
    expect(state).toMatchObject({
      kind: "attention",
      ring: null,
      comet: false,
      glyph: "tray",
      arrowTone: "error",
      badge: { count: 1, tone: "error" },
      section: "att",
    });
    expect(indicatorTip(state, t)).toBe("1 needs attention");
    expect(indicatorTip(indicatorState([failed(), failed("g")], false), t)).toBe("2 need attention");
  });

  it("shows what's on hold with a neutral badge", () => {
    const state = indicatorState([held(), held("i")], false);
    expect(state).toMatchObject({
      kind: "hold",
      ring: null,
      glyph: "tray",
      arrowTone: "accent",
      badge: { count: 2, tone: "neutral" },
      section: "wait",
    });
    expect(indicatorTip(state, t)).toBe("2 on hold");
  });

  it("is plain when there's nothing, or only what finished long ago", () => {
    for (const jobs of [[], [job({ status: "DONE" })], [job({ status: "ERROR", attention: false })]]) {
      const state = indicatorState(jobs, false);
      expect(state).toMatchObject({
        kind: "idle",
        ring: null,
        comet: false,
        number: null,
        glyph: "tray",
        arrowTone: "accent",
        badge: null,
        section: "run",
      });
      expect(indicatorTip(state, t)).toBe("Import queue is empty");
    }
  });

  it("goes by priority: running, in line, just finished, attention, on hold", () => {
    const all = [running(), queued(1), failed(), held()];
    expect(indicatorState(all, true).kind).toBe("running");
    expect(indicatorState(all.slice(1), true).kind).toBe("inLine");
    expect(indicatorState(all.slice(2), true).kind).toBe("finished");
    expect(indicatorState(all.slice(2), false).kind).toBe("attention");
    expect(indicatorState(all.slice(3), false).kind).toBe("hold");
  });

  it("doesn't count a running job's failures as needing attention yet", () => {
    expect(indicatorState([running({ failed_count: 2, attention: true })], false).badge).toBeNull();
  });
});

describe("sections and counts", () => {
  const list = [
    job({ id: "a", status: "RUNNING" }),
    job({ id: "b", status: "QUEUED", position: 1 }),
    job({ id: "c", status: "PAUSED" }),
    job({ id: "d", status: "PAUSED", sync_waiting: true }),
    job({ id: "e", status: "ERROR", attention: true }),
    job({ id: "f", status: "DONE" }),
  ];

  it("counts every section, and zero too", () => {
    expect(sectionCounts(list)).toEqual({ run: 1, att: 1, wait: 3, done: 1 });
    expect(sectionCounts([])).toEqual({ run: 0, att: 0, wait: 0, done: 0 });
  });

  it("trusts the server for how many finished, as the list has only the newest", () => {
    expect(sectionCounts(list, 80).done).toBe(80);
    expect(sectionCounts(list, 0).done).toBe(1);
  });

  it("counts what's importing now in the list it's given", () => {
    expect(runningNow(list)).toBe(1);
    expect(runningNow([])).toBe(0);
  });

  it("counts a job that's pausing as importing, until the link it's on is done", () => {
    const pausing = job({ id: "p", status: "PAUSED", runner_live: true });
    expect(sectionCounts([pausing])).toEqual({ run: 1, att: 0, wait: 0, done: 0 });
    expect(runningNow([pausing])).toBe(1);
    const paused = job({ id: "p", status: "PAUSED" });
    expect(sectionCounts([paused])).toEqual({ run: 0, att: 0, wait: 1, done: 0 });
    expect(runningNow([paused])).toBe(0);
  });

  it("lists one's own, or everyone's narrowed to one person", () => {
    const own = [job({ id: "m" })];
    const mia = job({ id: "x", owner: { id: "u1", display_name: "Mia", email: "m@e" } });
    const sam = job({ id: "y", owner: { id: "u2", display_name: "Sam", email: "s@e" } });
    expect(visibleJobs("mine", own, [mia, sam], "u1")).toBe(own);
    expect(visibleJobs("everyone", own, [mia, sam])).toEqual([mia, sam]);
    expect(visibleJobs("everyone", own, [mia, sam], "u2")).toEqual([sam]);
  });

  it("names the people with their count of all jobs, by name", () => {
    const owner = (id: string, display_name: string) => ({ owner: { id, display_name, email: `${id}@e` } });
    expect(
      peopleOf([
        job({ id: "1", status: "DONE", ...owner("u2", "Sam Okafor") }),
        job({ id: "2", status: "RUNNING", ...owner("u1", "Mia Chen") }),
        job({ id: "3", status: "QUEUED", ...owner("u2", "Sam Okafor") }),
        job({ id: "4" }),
      ]),
    ).toEqual([
      { id: "u1", name: "Mia Chen", email: "u1@e", count: 1 },
      { id: "u2", name: "Sam Okafor", email: "u2@e", count: 2 },
    ]);
  });

  it("makes initials from a name", () => {
    expect(personInitials("Mia Chen")).toBe("MC");
    expect(personInitials("  noor ")).toBe("N");
    expect(personInitials("Anna Maria Lopez")).toBe("AM");
    expect(personInitials("")).toBe("");
  });
});

describe("the dialog's words", () => {
  it("names the dialog by whose imports it shows", () => {
    expect(dialogTitle("mine", t)).toBe("Import queue");
    expect(dialogTitle("everyone", t)).toBe("Server import queue");
  });

  it("gives each panel its subtitle, and Waiting one per scope", () => {
    expect(panelSubtitle("run", "mine", t)).toBe("What's running now, live.");
    expect(panelSubtitle("att", "everyone", t)).toBe("Failed or cut off, with what to do next.");
    expect(panelSubtitle("done", "mine", t)).toBe("Imports that have finished.");
    expect(panelSubtitle("wait", "mine", t)).toBe(
      "One import runs at a time, in order. Other people's imports stay private.",
    );
    expect(panelSubtitle("wait", "everyone", t)).toBe("One import runs at a time for the whole server, in order.");
  });
});

describe("panelAction", () => {
  const action = (section: Parameters<typeof panelAction>[0], list: QueueJob[], finished = 0) =>
    panelAction(section, list, sectionCounts(list, finished), t);

  it("has no button while its section is empty", () => {
    for (const section of ["run", "att", "wait", "done"] as const) expect(action(section, [])).toBeNull();
  });

  it("offers Pause all, off unless a running job can pause", () => {
    expect(action("run", [job({ type: "COLLECTION" })])).toEqual({
      kind: "pauseAll",
      label: "Pause all",
      primary: false,
      disabled: true,
    });
    expect(action("run", [job({ can_pause: true })])?.disabled).toBe(false);
  });

  it("offers Retry all for what can be retried", () => {
    const zip = job({ id: "z", status: "ERROR", attention: true, type: "ZIP" });
    expect(action("att", [zip])).toEqual({
      kind: "retryAll",
      label: "Retry all (0)",
      primary: true,
      disabled: true,
    });
    const links = job({ id: "l", status: "DONE", attention: true, can_retry: true, failed_count: 1 });
    expect(action("att", [zip, links])).toMatchObject({ label: "Retry all (1)", disabled: false });
  });

  it("offers Start all for what's on hold, and not for what's merely in line", () => {
    const inLine = job({ id: "q", status: "QUEUED", position: 1, can_pause: true });
    expect(action("wait", [inLine])).toMatchObject({
      kind: "startAll",
      label: "Start all on hold (0)",
      disabled: true,
    });
    const syncing = job({ id: "s", status: "PAUSED", sync_waiting: true, can_start: false });
    const pausing = job({ id: "p", status: "PAUSED", runner_live: true, can_start: false });
    const held = job({ id: "h", status: "PAUSED", can_start: true });
    expect(action("wait", [inLine, syncing, pausing, held])).toMatchObject({
      label: "Start all on hold (1)",
      disabled: false,
    });
  });

  it("keeps Pause all, turned off, over a job that's already pausing", () => {
    const pausing = job({ status: "PAUSED", runner_live: true });
    expect(action("run", [pausing])).toMatchObject({ kind: "pauseAll", disabled: true });
  });

  it("clears as many finished as the server has", () => {
    expect(action("done", [job({ status: "DONE" })], 72)).toEqual({
      kind: "clearFinished",
      label: "Clear finished (72)",
      primary: false,
      disabled: false,
    });
  });

  it("offers no bulk action that would reach more people than the list shows", () => {
    const list = [job({ status: "PAUSED", can_start: true })];
    expect(panelAction("wait", list, sectionCounts(list), t, { actsOnAll: true })).toBeNull();
  });
});

describe("clearFinishedConfirmText", () => {
  it("is the same as ever for one's own", () => {
    expect(clearFinishedConfirmText(t)).toEqual({
      title: "Clear finished imports?",
      message:
        "They leave this list, along with any failed links in them, which can't be retried afterwards. Models already imported stay in the library.",
      confirmLabel: "Clear",
    });
  });

  it("says how many on everyone's list, true even when there's only one person", () => {
    const { title, message } = clearFinishedConfirmText(t, { count: 1400, person: null });
    expect(title).toBe("Clear finished imports?");
    expect(message).toContain("This clears 1400 finished imports, whoever they belong to");
  });

  it("doesn't claim one is someone else's", () => {
    const { message } = clearFinishedConfirmText(t, { count: 1, person: null });
    expect(message).toContain("This clears 1 finished import, whoever it belongs to");
    expect(message).toContain("any failed links in it");
    expect(message).not.toContain("other people's");
  });

  it("names the person picked, and no one else", () => {
    const many = clearFinishedConfirmText(t, { count: 3, person: "Sam Okafor" }).message;
    expect(many).toContain("This clears 3 finished imports of Sam Okafor");
    expect(many).not.toContain("other people's");
    expect(clearFinishedConfirmText(t, { count: 1, person: "Sam Okafor" }).message).toContain(
      "This clears 1 finished import of Sam Okafor",
    );
  });

  it("has a form for every number in Lithuanian", async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: "lt", defaultNS: "app", resources: { lt: { app: lt.app } } });
    const inLithuanian = instance.getFixedT("lt", "app");
    const message = (count: number, person: string | null = null) =>
      clearFinishedConfirmText(inLithuanian, { count, person }).message;
    expect(message(1)).toContain("Bus išvalytas 1 baigtas importas, kad ir kieno jis būtų");
    expect(message(3)).toContain("Bus išvalyti 3 baigti importai, kad ir kieno jie būtų");
    expect(message(12)).toContain("Bus išvalyta 12 baigtų importų, kad ir kieno jie būtų");
    expect(message(3, "Jonas")).toContain("Bus išvalyti 3 baigti importai (Jonas)");
  });
});

describe("finishedListNote", () => {
  const finished = (count: number, fields: Partial<QueueJob> = {}) =>
    Array.from({ length: count }, (_, n) => job({ id: `d${n}`, status: "DONE", ...fields }));
  const note = (list: QueueJob[], total: number) => finishedListNote(list, sectionCounts(list, total), t);

  it("says nothing when every finished job is listed", () => {
    expect(note(finished(3), 3)).toBeNull();
    expect(note(finished(3), 0)).toBeNull();
    expect(note([], 0)).toBeNull();
  });

  it("says how many the list stops at, and of how many", () => {
    expect(note(finished(50), 312)).toBe("Showing the newest 50 of 312");
  });

  it("counts only what's listed under Finished", () => {
    const failed = job({ id: "f", status: "ERROR", attention: true });
    expect(note([...finished(50), failed], 312)).toBe("Showing the newest 50 of 312");
  });

  it("says so when all of someone's are older than the newest of the whole server", () => {
    expect(note([job({ id: "q", status: "QUEUED" })], 3)).toBe("3 older imports aren't listed here");
    expect(note([], 1)).toBe("1 older import isn't listed here");
  });
});

describe("emptyState", () => {
  const busy: LineOut = { now: { mine: false, person: "p", job_id: null }, rows: [], length: 1 };

  it("tells someone waiting behind another import where they stand", () => {
    expect(
      emptyState(
        "run",
        {
          scope: "mine",
          line: busy,
          own: [job({ id: "a", status: "QUEUED", position: 5 }), job({ status: "QUEUED", position: 3 })],
          autoStart: false,
        },
        t,
      ),
    ).toEqual({
      icon: "wait",
      title: "Another import is running",
      text: "Your next import is #3 in line, and starts by itself.",
    });
  });

  it("says imports wait their turn, to someone with none in line", () => {
    expect(emptyState("run", { scope: "mine", line: busy, own: [], autoStart: false }, t).text).toBe(
      "Imports run one at a time. Yours start by themselves when their turn comes.",
    );
  });

  it("is plain when nothing runs, or when looking at everyone's", () => {
    const plain = { icon: "run", title: "Nothing importing", text: "Imports show their progress here while they run." };
    expect(emptyState("run", { scope: "mine", line: EMPTY_LINE, own: [], autoStart: false }, t)).toEqual(plain);
    expect(emptyState("run", { scope: "everyone", line: busy, own: [], autoStart: false }, t)).toEqual(plain);
  });

  it("has a message for each other section", () => {
    const facts = { scope: "mine" as const, line: EMPTY_LINE, own: [], autoStart: false };
    expect(emptyState("att", facts, t).title).toBe("All clear");
    expect(emptyState("wait", facts, t).title).toBe("Nothing waiting");
    expect(emptyState("wait", facts, t).text).toContain('"Add to the queue"');
    expect(emptyState("done", facts, t).title).toBe("Nothing finished yet");
  });

  it("doesn't promise a hold to someone whose Grab links start by themselves", () => {
    const facts = { scope: "mine" as const, line: EMPTY_LINE, own: [], autoStart: true };
    expect(emptyState("wait", facts, t)).toEqual({
      icon: "wait",
      title: "Nothing waiting",
      text: "New imports wait here for their turn.",
    });
  });
});

describe("ladderRows", () => {
  const mine = (id: string, position: number) => job({ id, status: "QUEUED", position });
  const place = (position: number, person: string, jobId: string | null = null) => ({
    position,
    mine: jobId !== null,
    person,
    job_id: jobId,
  });
  const shape = (rows: QueueRow[]) =>
    rows.map((row) => {
      if (row.kind === "card") return `card:${row.job.id}`;
      if (row.kind === "now") return `now:${row.mine ? "mine" : row.person}`;
      return `private:${row.person}:${row.from}-${row.to}`;
    });

  it("runs from what's on now to the viewer's last job, merging one person's run of places", () => {
    const line: LineOut = {
      now: { mine: false, person: "noor", job_id: null },
      rows: [
        place(1, "noor"),
        place(2, "noor"),
        place(3, "me", "a"),
        place(4, "sam"),
        place(5, "noor"),
        place(6, "me", "b"),
      ],
      length: 9,
    };
    expect(shape(ladderRows(line, [mine("b", 6), mine("a", 3)]))).toEqual([
      "now:noor",
      "private:noor:1-2",
      "card:a",
      "private:sam:4-4",
      "private:noor:5-5",
      "card:b",
    ]);
  });

  it("shows nothing behind the viewer's last job, whatever the server sends", () => {
    const line: LineOut = { now: null, rows: [place(1, "me", "a"), place(2, "sam"), place(3, "sam")], length: 3 };
    expect(shape(ladderRows(line, [mine("a", 1)]))).toEqual(["card:a"]);
  });

  it("doesn't merge across the viewer's job, another person or a gap", () => {
    const line: LineOut = {
      now: null,
      rows: [place(1, "sam"), place(2, "me", "a"), place(3, "sam"), place(5, "sam"), place(6, "me", "b")],
      length: 6,
    };
    expect(shape(ladderRows(line, [mine("a", 2), mine("b", 6)]))).toEqual([
      "private:sam:1-1",
      "card:a",
      "private:sam:3-3",
      "private:sam:5-5",
      "card:b",
    ]);
  });

  it("names the viewer's own running job in the Now row", () => {
    const running = job({ id: "r", source_label: "Grab queue" });
    const line: LineOut = { now: { mine: true, person: "me", job_id: "r" }, rows: [place(1, "me", "a")], length: 1 };
    const [now] = ladderRows(line, [running, mine("a", 1)]);
    expect(now).toMatchObject({ kind: "now", mine: true, job: running });
    expect(nowRowText(now as Extract<QueueRow, { kind: "now" }>, t)).toBe("Your import: Grab queue");
  });

  it("says nothing of someone else's in the Now row", () => {
    const row = { kind: "now", key: "now", mine: false, person: "p", job: null } as const;
    expect(nowRowText(row, t)).toBe("Private import");
    expect(nowRowText({ ...row, mine: true }, t)).toBe("Private import");
  });

  it("puts waiting sync jobs after the numbered ones, without a number", () => {
    const sync = job({ id: "s", status: "PAUSED", sync_waiting: true, collection_sync_id: "c" });
    const line: LineOut = { now: null, rows: [place(1, "me", "a")], length: 1 };
    expect(shape(ladderRows(line, [sync, mine("a", 1)]))).toEqual(["card:a", "card:s"]);
    expect(positionPill(sync, t)).toBeNull();
  });

  it("shows only the sync jobs, with no Now row, when nothing of the viewer's has a place", () => {
    const sync = job({ id: "s", status: "PAUSED", sync_waiting: true, collection_sync_id: "c" });
    const line: LineOut = { now: { mine: false, person: "p", job_id: null }, rows: [], length: 4 };
    expect(shape(ladderRows(line, [sync]))).toEqual(["card:s"]);
  });

  it("treats a place marked as the viewer's, with no such job, as a private one", () => {
    const line: LineOut = { now: null, rows: [place(1, "me", "gone"), place(2, "me", "a")], length: 2 };
    expect(shape(ladderRows(line, [mine("a", 2)]))).toEqual(["private:me:1-1", "card:a"]);
  });

  it("writes private rows as a place and a count", () => {
    const row = { kind: "private", key: "k", person: "p", from: 3, to: 3 } as const;
    expect(privateRowText(row, t)).toEqual({ pill: "#3", text: "Private import" });
    expect(privateRowText({ ...row, to: 5 }, t)).toEqual({ pill: "#3-5", text: "3 private imports" });
  });
});

describe("queueGroups", () => {
  const facts = { scope: "mine" as const, line: EMPTY_LINE, autoStart: false };

  it("puts the other sections in one unlabelled group, or none", () => {
    expect(queueGroups("run", { ...facts, list: [] }, t)).toEqual([]);
    const [group] = queueGroups("done", { ...facts, list: [job({ status: "DONE" })] }, t);
    expect(group).toMatchObject({ id: "all", label: null, hint: null, ladder: false });
    expect(group.rows).toHaveLength(1);
  });

  it("lists what finished newest first", () => {
    const older = job({ id: "older", status: "DONE", updated_at: ago(2 * DAY) });
    const newer = job({ id: "newer", status: "DONE", updated_at: ago(DAY) });
    const [group] = queueGroups("done", { ...facts, list: [older, newer] }, t);
    expect(group.rows.map((row) => row.key)).toEqual(["newer", "older"]);
  });

  it("splits Waiting into its groups, leaving out an empty one", () => {
    const inLine = job({ id: "q", status: "QUEUED", position: 2 });
    const held = job({ id: "h", status: "PAUSED" });
    const groups = queueGroups("wait", { ...facts, list: [inLine, held] }, t);
    expect(groups.map((group) => [group.id, group.label, group.hint, group.ladder])).toEqual([
      ["inLine", "In line · 1", "Your number only goes down", true],
      ["onHold", "On hold · 1", "Won't run until started", false],
    ]);
    expect(queueGroups("wait", { ...facts, list: [held] }, t).map((group) => group.id)).toEqual(["onHold"]);
    expect(queueGroups("wait", { ...facts, list: [inLine] }, t).map((group) => group.id)).toEqual(["inLine"]);
    expect(queueGroups("wait", { ...facts, list: [] }, t)).toEqual([]);
  });

  it("hints at the auto-start setting on the On hold group", () => {
    const list = [job({ status: "PAUSED" })];
    expect(queueGroups("wait", { ...facts, list, autoStart: true }, t)[0].hint).toBe("New Grab links skip this");
  });

  it("counts jobs in the group's label, not merged rows", () => {
    const line: LineOut = {
      now: null,
      rows: [
        { position: 1, mine: false, person: "p", job_id: null },
        { position: 2, mine: false, person: "p", job_id: null },
        { position: 3, mine: true, person: "me", job_id: "q" },
      ],
      length: 3,
    };
    const [group] = queueGroups("wait", { ...facts, line, list: [job({ id: "q", status: "QUEUED", position: 3 })] }, t);
    expect(group.label).toBe("In line · 1");
    expect(group.rows).toHaveLength(2);
  });

  it("shows everyone's as plain cards by place, sync jobs after, and no private rows", () => {
    const line: LineOut = { now: { mine: false, person: "p", job_id: null }, rows: [], length: 3 };
    const list = [
      job({ id: "sync", status: "PAUSED", sync_waiting: true }),
      job({ id: "third", status: "QUEUED", position: 3 }),
      job({ id: "first", status: "QUEUED", position: 1 }),
    ];
    const [group] = queueGroups("wait", { ...facts, scope: "everyone", line, list }, t);
    expect(group.hint).toBe("Start by themselves");
    expect(group.ladder).toBe(false);
    expect(group.rows.map((row) => `${row.kind}:${row.key}`)).toEqual(["card:first", "card:third", "card:sync"]);
  });

  it("promises a number going down only to someone who has one, not for a sync on its own", () => {
    const sync = job({ id: "s", status: "PAUSED", sync_waiting: true, collection_sync_id: "c" });
    const [group] = queueGroups("wait", { ...facts, list: [sync] }, t);
    expect(group.hint).toBe("Start by themselves");
    expect(group.ladder).toBe(false);
    const numbered = job({ id: "q", status: "QUEUED", position: 2 });
    expect(queueGroups("wait", { ...facts, list: [sync, numbered] }, t)[0].hint).toBe("Your number only goes down");
  });
});

describe("jobChip", () => {
  it.each<[Partial<QueueJob>, string, string, string, boolean, string]>([
    [{ status: "RUNNING" }, "running", "Importing", "warning", true, "Importing now."],
    [{ status: "QUEUED" }, "queued", "In line", "info", false, "Starts by itself when its turn comes."],
    [{ status: "PAUSED" }, "paused", "On hold", "neutral", false, "Won't run until someone starts it."],
    [
      { status: "PAUSED", runner_live: true },
      "pausing",
      "Pausing",
      "neutral",
      true,
      "Finishing the link it's on, then it stops.",
    ],
    [
      { status: "PAUSED", sync_waiting: true },
      "queued",
      "In line",
      "info",
      false,
      "Starts by itself when its turn comes.",
    ],
    [{ status: "ERROR" }, "error", "Error", "error", false, "The import failed."],
    [
      { status: "DONE", failed_count: 2 },
      "partial",
      "Some failed",
      "warning",
      false,
      "Finished, but some links failed.",
    ],
    [{ status: "DONE", failed_count: 1, single: true }, "error", "Error", "error", false, "The import failed."],
    [{ status: "DONE" }, "done", "Done", "success", false, "Every link imported."],
    [
      { status: "SOMETHING" as ImportJobStatus },
      "unknown",
      "Unknown",
      "neutral",
      false,
      "This version of Thingport doesn't know this state.",
    ],
  ])("%j", (fields, state, label, tone, live, hint) => {
    expect(jobState(job(fields))).toBe(state);
    expect(jobChip(job(fields), t)).toEqual({ label, tone, live, hint });
  });

  it.each(["ZIP", "COLLECTION", "PROFILES"] as const)("speaks of models on a %s, which has no links", (type) => {
    expect(jobChip(job({ type, status: "DONE" }), t).hint).toBe("Every model imported.");
    expect(jobChip(job({ type, status: "DONE", failed_count: 2 }), t).hint).toBe("Finished, but some models failed.");
  });

  it("still speaks of links on a list of them, and of the one on a single link", () => {
    expect(jobChip(job({ status: "DONE", single: true }), t).hint).toBe("Every link imported.");
    expect(jobChip(job({ status: "DONE", failed_count: 1 }), t).hint).toBe("Finished, but some links failed.");
  });

  it("has words for the other states whatever the job is", () => {
    expect(jobChip(job({ type: "ZIP", status: "RUNNING" }), t).hint).toBe("Importing now.");
    expect(jobChip(job({ type: "ZIP", status: "ERROR" }), t).hint).toBe("The import failed.");
  });
});

describe("primaryAction", () => {
  const primary = (fields: Partial<QueueJob>) => {
    const action = primaryAction(job(fields), t);
    return action && `${action.kind}: ${action.label}`;
  };

  it("offers Pause on a running job that can pause, and nothing on one that can't", () => {
    expect(primary({ status: "RUNNING", can_pause: true })).toBe("pause: Pause");
    expect(primary({ status: "RUNNING", can_pause: false })).toBeNull();
  });

  it("offers Hold on what's in line, a waiting sync job too", () => {
    expect(primary({ status: "QUEUED", can_pause: true })).toBe("hold: Hold");
    expect(primary({ status: "PAUSED", sync_waiting: true, can_pause: true })).toBe("hold: Hold");
    expect(primary({ status: "PAUSED", sync_waiting: true, can_pause: false, can_start: true })).toBeNull();
  });

  it("offers Start on what's on hold", () => {
    expect(primary({ status: "PAUSED", can_start: true })).toBe("start: Start");
  });

  it("offers nothing while it's still pausing", () => {
    expect(primary({ status: "PAUSED", runner_live: true, can_start: true, can_retry: true })).toBeNull();
  });

  it("offers Retry on what's on hold with only failed links left", () => {
    expect(primary({ status: "PAUSED", can_retry: true, failed_items_count: 1 })).toBe("retry: Retry");
  });

  it("numbers Retry only past one failure", () => {
    expect(primary({ status: "ERROR", can_retry: true, failed_items_count: 1 })).toBe("retry: Retry");
    expect(primary({ status: "DONE", can_retry: true, failed_items_count: 3 })).toBe("retry: Retry 3");
    expect(primary({ status: "DONE", can_retry: true, failed_count: 2 })).toBe("retry: Retry 2");
  });

  it("offers nothing on a failed ZIP or a clean finish", () => {
    expect(primary({ status: "ERROR", type: "ZIP" })).toBeNull();
    expect(primary({ status: "DONE" })).toBeNull();
  });

  it("starts an errored job with links waiting and none failed", () => {
    expect(primary({ status: "ERROR", can_start: true })).toBe("start: Start");
  });

  it("works from an older backend's row", () => {
    const row = (fields: Partial<AdminQueueJobOut>) =>
      primaryAction(toQueueJob({ id: "o", type: "LINKS", updated_at: ago(HOUR), ...fields }, NOW), t)?.kind;
    expect(row({ status: "RUNNING" })).toBe("pause");
    expect(row({ status: "PAUSED", pending_count: 2 })).toBe("start");
    expect(row({ status: "ERROR", pending_count: 2 })).toBe("start");
    expect(row({ status: "ERROR", failed_items_count: 2 })).toBe("retry");
    expect(row({ status: "PAUSED", runner_live: true, pending_count: 2 })).toBeUndefined();
    expect(row({ status: "RUNNING", type: "ZIP" })).toBeUndefined();
  });
});

describe("links of a job", () => {
  it("lists links only on a job of several", () => {
    expect(hasLinkList(job({ type: "LINKS" }))).toBe(true);
    expect(hasLinkList(job({ type: "LINKS", single: true }))).toBe(false);
    expect(hasLinkList(job({ type: "ZIP" }))).toBe(false);
  });

  it("lets a link go unless it's done or something's running", () => {
    const held = job({ status: "PAUSED" });
    expect(canRemoveLink(held, { status: "PENDING" })).toBe(true);
    expect(canRemoveLink(held, { status: "FAILED" })).toBe(true);
    expect(canRemoveLink(held, { status: "DONE" })).toBe(false);
    expect(canRemoveLink(job({ status: "RUNNING" }), { status: "PENDING" })).toBe(false);
    expect(canRemoveLink(job({ status: "PAUSED", runner_live: true }), { status: "PENDING" })).toBe(false);
    expect(canRemoveLink(job({ status: "QUEUED" }), { status: "PENDING" })).toBe(true);
  });

  it("words a link's status and scope, and leaves out what it doesn't know", () => {
    expect(linkStatusText({ status: "PENDING" }, t)).toBe("waiting");
    expect(linkStatusText({ status: "FAILED" }, t)).toBe("failed");
    expect(linkStatusText({ status: "LOST" as "DONE" }, t)).toBeNull();
    expect(linkScopeText({ scope: "designer" }, t)).toBe("All designer print profiles");
    expect(linkScopeText({ scope: "all" }, t)).toBe("Designer and community print profiles");
    expect(linkScopeText({ scope: "url" }, t)).toBeNull();
    expect(linkScopeText({ scope: null }, t)).toBeNull();
  });

  it("makes links safe to follow", () => {
    expect(webLink("https://example.com/a")).toBe("https://example.com/a");
    expect(webLink("http://192.168.1.20/a")).toBe("http://192.168.1.20/a");
    expect(webLink("example.com/a")).toBe("https://example.com/a");
    expect(webLink("javascript:alert(1)")).toBeNull();
    expect(webLink("javascript://x%0Aalert(1)")).toBeNull();
    expect(webLink("")).toBeNull();
  });
});

describe("jobOpenTarget", () => {
  it("opens a finished single job's model, and otherwise its source", () => {
    const done = job({ status: "DONE", single: true, result_print_id: "p1" });
    expect(jobOpenTarget(done, null)).toEqual({ kind: "model", path: "/models/p1" });
    expect(jobOpenTarget(job({ status: "ERROR", single: true }), null)).toEqual({
      kind: "source",
      url: "https://example.com/a",
    });
    expect(jobOpenTarget(job({ status: "DONE", single: true }), null)?.kind).toBe("source");
    expect(jobOpenTarget(job({ status: "RUNNING", result_print_id: "p1" }), null)?.kind).toBe("source");
  });

  it("opens the collection an import made", () => {
    expect(jobOpenTarget(job({ status: "DONE", type: "COLLECTION", result_collection_id: "c1" }), null)).toEqual({
      kind: "collection",
      path: "/models/collections/c1",
    });
  });

  it("opens the source of someone else's import, whose model isn't in the viewer's library", () => {
    const theirs = job({
      status: "DONE",
      single: true,
      result_print_id: "p1",
      owner: { id: "u2", display_name: "Sam", email: "s@e" },
    });
    expect(jobOpenTarget(theirs, "u1")?.kind).toBe("source");
    expect(jobOpenTarget(theirs, "u2")?.kind).toBe("model");
  });

  it("offers nothing without a link it can follow", () => {
    expect(jobOpenTarget(job({ source_url: "javascript:alert(1)" }), null)).toBeNull();
  });
});

describe("jobLabel", () => {
  it("falls back from the label to the link", () => {
    expect(jobLabel(job({ source_label: "Cosplay props" }), t)).toBe("Cosplay props");
    expect(jobLabel(job({ source_label: null }), t)).toBe("https://example.com/a");
    expect(jobLabel(job({ source_label: "  " }), t)).toBe("https://example.com/a");
    expect(jobLabel(job({ source_label: null, source_url: "" }), t)).toBe("Untitled import");
  });

  it("names a zip waiting for its turn by its file, where the link has one", () => {
    const zip = (source_url: string) => job({ type: "ZIP", source_label: null, source_url });
    expect(jobLabel(zip("https://example.com/packs/My%20minis.zip?x=1"), t)).toBe("My minis.zip");
    expect(jobLabel(zip("https://example.com/download/42"), t)).toBe("https://example.com/download/42");
    expect(jobLabel(job({ type: "ZIP", source_label: "spot.zip", source_url: "https://e.com/a.zip" }), t)).toBe(
      "spot.zip",
    );
  });

  it("takes the prefix off a sync job's name only where the tag says the same", () => {
    expect(jobLabel(job({ source_label: "Sync: Animals", collection_sync_id: "c" }), t)).toBe("Animals");
    expect(jobLabel(job({ source_label: "Sync: Animals" }), t)).toBe("Sync: Animals");
  });

  it("translates the label the server writes for Grab's links", () => {
    expect(jobLabel(job({ source_label: "Sent from Thingport Grab" }), t)).toBe("Sent from Thingport Grab");
    const translated = ((key: string) => (key === "importQueue.sentFromGrab" ? "Iš Grab" : key)) as typeof t;
    expect(jobLabel(job({ source_label: "Sent from Thingport Grab" }), translated)).toBe("Iš Grab");
  });

  it("names Grab's one link by its page's title, when there is one", () => {
    const grab = { source_label: "Sent from Thingport Grab" };
    expect(jobLabel(job({ ...grab, link_title: "Benchy" }), t)).toBe("Benchy");
    expect(jobLabel(job({ ...grab, link_title: "  " }), t)).toBe("Sent from Thingport Grab");
    // An older backend sends none, and neither does this one for several links.
    expect(jobLabel(job({ ...grab, link_title: null }), t)).toBe("Sent from Thingport Grab");
  });

  it("leaves any other name alone", () => {
    expect(jobLabel(job({ source_label: "Props", link_title: "Benchy" }), t)).toBe("Props");
    expect(jobLabel(job({ source_label: null, link_title: "Benchy" }), t)).toBe("https://example.com/a");
  });

  it("gives the whole name, however long, for the delete confirmation", () => {
    const url = "https://makerworld.com/en/models/1234567-a-model-with-a-very-long-name-indeed#profileId-987654";
    expect(jobLabel(job({ source_label: null, source_url: url }), t)).toBe(url);
    expect(deleteConfirmText(job({ source_label: null, source_url: url }), t).message).toContain(url);
  });
});

describe("a job that's pausing", () => {
  const pausing = job({
    id: "p",
    status: "PAUSED",
    runner_live: true,
    total: 4,
    started_at: ago(12 * MINUTE),
    queued_at: ago(HOUR),
  });

  it("stays in Importing with its Pausing chip, and in no group of Waiting", () => {
    expect(sectionOf(pausing)).toBe("run");
    expect(jobChip(pausing, t).label).toBe("Pausing");
    const facts = { list: [pausing], scope: "mine" as const, line: EMPTY_LINE, autoStart: false };
    expect(queueGroups("run", facts, t).flatMap((group) => group.rows.map((row) => row.key))).toEqual(["p"]);
    expect(queueGroups("wait", facts, t)).toEqual([]);
  });

  it("says when it started, and keeps its bar, with its failures for when it has stopped", () => {
    expect(whenText(pausing, context)).toBe("Started 12 minutes ago");
    expect(jobBar(pausing, t)).toMatchObject({ value: 0, live: false, text: "0 of 4" });
    expect(whyText({ ...pausing, failed_items_count: 1 }, t)).toBeNull();
  });

  it("goes to Waiting once its runner has stopped", () => {
    const stopped = { ...pausing, runner_live: false };
    expect(sectionOf(stopped)).toBe("wait");
    expect(whenText(stopped, context)).toBe("On hold");
    expect(whyText({ ...stopped, failed_items_count: 1 }, t)).toBe("1 link failed. Open the links to see why.");
  });

  it("isn't what a sync waiting for its lane is, even with its runner still ending", () => {
    const waiting = { ...pausing, sync_waiting: true, collection_sync_id: "c" };
    expect(sectionOf(waiting)).toBe("wait");
    expect(jobState(waiting)).toBe("queued");
    expect(whenText(waiting, context)).toBe("Waiting");
    expect(runningNow([waiting])).toBe(0);
  });

  it("isn't mistaken for someone else holding things up", () => {
    const line: LineOut = { now: { mine: false, person: "p", job_id: null }, rows: [], length: 0 };
    expect(emptyState("run", { scope: "mine", line, own: [pausing], autoStart: false }, t).icon).toBe("run");
  });

  it("keeps the poll fast, unless it's a sync's", () => {
    const facts = { supported: true, hidden: false, dialogOpen: false, line: EMPTY_LINE };
    expect(pollDelay({ ...facts, jobs: [pausing] })).toBe(1500);
    expect(pollDelay({ ...facts, jobs: [{ ...pausing, collection_sync_id: "c" }] })).toBe(8000);
    expect(pollDelay({ ...facts, jobs: [{ ...pausing, runner_live: false }] })).toBe(8000);
  });

  it("holds back the tick, as the link it's on is still going", () => {
    const running = job({ id: "a", status: "RUNNING" });
    const done = job({ id: "a", status: "DONE" });
    expect(diffSnapshots([running, pausing], [done, pausing]).flash).toBe(false);
    expect(diffSnapshots([running, pausing], [done, { ...pausing, runner_live: false }]).flash).toBe(true);
  });
});

describe("whenText", () => {
  const when = (fields: Partial<QueueJob>) => whenText(job(fields), context);

  it("says when a running job started, or was created if that's all there is", () => {
    expect(when({ status: "RUNNING", started_at: ago(12 * MINUTE) })).toBe("Started 12 minutes ago");
    expect(when({ status: "RUNNING", started_at: ago(5000) })).toBe("Started just now");
    expect(when({ status: "RUNNING", started_at: null, created_at: ago(3 * HOUR) })).toBe("Started 3 hours ago");
  });

  it("says when a job in line was added, and just Waiting after a Start or Retry", () => {
    expect(when({ status: "QUEUED", created_at: ago(20 * MINUTE), queued_at: ago(20 * MINUTE) })).toBe(
      "Added 20 minutes ago",
    );
    expect(when({ status: "QUEUED", created_at: ago(10000), queued_at: ago(9000) })).toBe("Added just now");
    expect(when({ status: "QUEUED", created_at: ago(DAY), queued_at: ago(MINUTE) })).toBe("Waiting");
  });

  it("says when something on hold was added, and just On hold after a Hold or Pause", () => {
    expect(when({ status: "PAUSED", created_at: ago(DAY), queued_at: null, started_at: null })).toBe("Added yesterday");
    expect(when({ status: "PAUSED", created_at: ago(DAY), queued_at: ago(HOUR) })).toBe("On hold");
    expect(when({ status: "PAUSED", created_at: ago(DAY), started_at: ago(HOUR) })).toBe("On hold");
    expect(when({ status: "PAUSED", sync_waiting: true })).toBe("Waiting");
  });

  it("dates what finished by when it last changed", () => {
    expect(when({ status: "DONE", updated_at: ago(5000) })).toBe("Just now");
    expect(when({ status: "ERROR", updated_at: new Date(2026, 9, 31, 8, 12).toISOString() })).toMatch(/^Today, 08:12/);
    expect(when({ status: "DONE", updated_at: new Date(2026, 9, 30, 23, 0).toISOString() })).toBe("Yesterday");
    expect(when({ status: "DONE", updated_at: new Date(2026, 9, 28, 9, 0).toISOString() })).toBe("Oct 28");
    expect(when({ status: "DONE", updated_at: new Date(2025, 9, 28, 9, 0).toISOString() })).toBe("Oct 28, 2025");
  });

  it("says just now when the clocks disagree", () => {
    expect(when({ status: "DONE", updated_at: new Date(NOW + 30_000).toISOString() })).toBe("Just now");
    expect(when({ status: "RUNNING", started_at: new Date(NOW + 30_000).toISOString() })).toBe("Started just now");
  });

  it("says nothing of a date it can't read", () => {
    expect(when({ status: "DONE", updated_at: "soon" })).toBeNull();
    expect(when({ status: "RUNNING", started_at: null, created_at: "" })).toBeNull();
  });
});

describe("jobCaption", () => {
  const caption = (fields: Partial<QueueJob>) =>
    jobCaption(job({ status: "DONE", updated_at: ago(5000), ...fields }), context);

  it("joins type, provider and when", () => {
    expect(caption({ type: "COLLECTION", provider: "printables" })).toBe("Collection · Printables · Just now");
    expect(caption({ type: "PROFILES", provider: "makerworld" })).toBe("Print profiles · MakerWorld · Just now");
    expect(caption({ type: "ZIP" })).toBe("ZIP · Just now");
  });

  it("calls one link a single link", () => {
    expect(caption({ type: "LINKS", single: true, provider: "thangs" })).toBe("Single link · Thangs · Just now");
  });

  it("reads a link list's provider off its link", () => {
    const row = job({ provider: null, source_url: "https://www.thingiverse.com/thing:1" });
    expect(jobProvider(row)).toBe("thingiverse");
    expect(caption({ provider: null, source_url: "https://www.thingiverse.com/thing:1" })).toBe(
      "Links · Thingiverse · Just now",
    );
    expect(jobProvider(job({ provider: null, source_url: "" }))).toBeNull();
  });

  it("leaves out a type or provider it doesn't know", () => {
    expect(caption({ type: "NEW" as QueueJob["type"], provider: "somewhere" })).toBe("Just now");
  });
});

describe("inLineText", () => {
  const text = (fields: Partial<QueueJob>) => inLineText(job({ status: "QUEUED", ...fields }), t);

  it("says how near it is, and how much it holds", () => {
    expect(text({ position: 1, total: 8 })).toBe("Next up · 8 links");
    expect(text({ position: 2, total: 8 })).toBe("1 import ahead · 8 links");
    expect(text({ position: 5, total: 8 })).toBe("4 imports ahead · 8 links");
  });

  it("uses the right word for what it holds", () => {
    expect(text({ position: 1, total: 1, single: true })).toBe("Next up · 1 model");
    expect(text({ position: 1, total: 1 })).toBe("Next up · 1 link");
    expect(text({ position: 1, total: 1, type: "COLLECTION" })).toBe("Next up · 1 link");
    expect(text({ position: 1, total: 10, type: "COLLECTION" })).toBe("Next up · 10 models");
    expect(text({ position: 1, total: 6, type: "ZIP" })).toBe("Next up · 6 models");
  });

  it("leaves the count out until it's known", () => {
    expect(text({ position: 1, total: 0, type: "PROFILES" })).toBe("Next up");
    expect(text({ position: 3, total: 0, type: "PROFILES" })).toBe("2 imports ahead");
  });

  it("has only a promise for a waiting sync job, and nothing for anything else", () => {
    expect(inLineText(job({ status: "PAUSED", sync_waiting: true }), t)).toBe("Starts by itself when its turn comes.");
    expect(inLineText(job({ status: "RUNNING" }), t)).toBeNull();
    expect(inLineText(job({ status: "QUEUED", position: null }), t)).toBeNull();
  });
});

describe("positionPill", () => {
  it("numbers a job in line", () => {
    expect(positionPill(job({ status: "QUEUED", position: 1 }), t)).toEqual({ text: "#1", title: "Next up" });
    expect(positionPill(job({ status: "QUEUED", position: 4 }), t)).toEqual({ text: "#4", title: "#4 in line" });
  });

  it("has none for anything else", () => {
    expect(positionPill(job({ status: "RUNNING", position: 4 }), t)).toBeNull();
    expect(positionPill(job({ status: "QUEUED", position: null }), t)).toBeNull();
  });
});

describe("jobBar", () => {
  it("shows on what's running or got somewhere, and not on what's in line or a single link", () => {
    expect(jobBar(job({ status: "RUNNING", total: 10 }), t)).not.toBeNull();
    expect(jobBar(job({ status: "PAUSED", total: 10, processed: 3 }), t)).not.toBeNull();
    expect(jobBar(job({ status: "PAUSED", total: 10, processed: 0 }), t)).toBeNull();
    expect(jobBar(job({ status: "QUEUED", total: 10, processed: 3 }), t)).toBeNull();
    expect(jobBar(job({ status: "RUNNING", total: 1, single: true }), t)).toBeNull();
    expect(jobBar(job({ status: "DONE", total: 1, processed: 1, single: true }), t)).toBeNull();
  });

  it("says how far along, with what failed", () => {
    expect(jobBar(job({ total: 40, processed: 10 }), t)).toEqual({
      value: 25,
      indeterminate: false,
      tone: "accent",
      live: true,
      text: "10 of 40",
    });
    expect(jobBar(job({ total: 40, processed: 23, failed_count: 1 }), t)).toMatchObject({
      tone: "warning",
      text: "23 of 40, 1 failed",
    });
  });

  it("turns red on an error, and stops sweeping once stopped", () => {
    expect(jobBar(job({ status: "ERROR", total: 14, processed: 6, failed_count: 2 }), t)).toMatchObject({
      tone: "error",
      live: false,
    });
  });

  it("has nothing to measure before it has a total", () => {
    expect(jobBar(job({ status: "RUNNING", total: 0, processed: 0 }), t)).toEqual({
      value: 0,
      indeterminate: true,
      tone: "accent",
      live: true,
      text: null,
    });
    expect(jobBar(job({ status: "ERROR", total: 0, processed: 2 }), t)).toMatchObject({
      value: 0,
      indeterminate: false,
      text: null,
    });
  });

  it("stays full when a count overshoots", () => {
    expect(jobBar(job({ total: 2, processed: 5 }), t)?.value).toBe(100);
  });
});

describe("whyText", () => {
  it("gives the reason as it came", () => {
    const row = job({
      status: "DONE",
      failed_count: 3,
      failure_reason: "3 links: daily download limit reached on Thangs.",
    });
    expect(whyText(row, t)).toBe("3 links: daily download limit reached on Thangs.");
  });

  it("counts the failures itself when the reason is only what a notification says about them", () => {
    const row = job({
      status: "DONE",
      failed_items_count: 1,
      failed_count: 1,
      failure_reason: "2 failed — retry them from the import queue.",
    });
    expect(whyText(row, t)).toBe("1 link failed. Open the links to see why.");
  });

  it("says a restart cut it off, in the viewer's language and by what's next", () => {
    const cut = "Cut off by a server restart. A model may be incomplete in your library: delete it before retrying.";
    const cutZip =
      "Cut off by a server restart. Some models are already in. Start a new import with only the missing files.";
    for (const failure_reason of [
      "Interrupted by server restart",
      "Import interrupted. Some models or files may already be in your library; check before retrying.",
      "Import interrupted; this model may be incomplete in your library. Delete it before retrying.",
    ]) {
      expect(whyText(job({ status: "ERROR", failure_reason, can_retry: true }), t)).toBe(cut);
      expect(whyText(job({ status: "ERROR", type: "ZIP", failure_reason }), t)).toBe(cutZip);
    }
  });

  it("doesn't mention retrying a cut-off import that can't be retried", () => {
    const failure_reason = "Interrupted by server restart";
    expect(whyText(job({ status: "ERROR", type: "COLLECTION", failure_reason }), t)).toBe(
      "Cut off by a server restart. Some files may already be in your library.",
    );
  });

  describe("on someone else's job", () => {
    const failure_reason = "Interrupted by server restart";
    const owner = { id: "u2", display_name: "Milo", email: "milo@example.com" };

    it("says it's their library that may need fixing", () => {
      expect(whyText(job({ status: "ERROR", failure_reason, can_retry: true, owner }), t, "u1")).toBe(
        "Cut off by a server restart. A model may be incomplete in their library: it should be deleted before retrying.",
      );
      expect(whyText(job({ status: "ERROR", type: "COLLECTION", failure_reason, owner }), t, "u1")).toBe(
        "Cut off by a server restart. Some files may already be in their library.",
      );
    });

    it("says yours for your own, on either list", () => {
      const own = { status: "ERROR", failure_reason, can_retry: true } as const;
      const yours =
        "Cut off by a server restart. A model may be incomplete in your library: delete it before retrying.";
      expect(whyText(job({ ...own, owner }), t, "u2")).toBe(yours);
      expect(whyText(job(own), t, "u2")).toBe(yours);
    });

    it("has nothing of anyone's to say about a ZIP", () => {
      expect(whyText(job({ status: "ERROR", type: "ZIP", failure_reason, owner }), t, "u1")).toBe(
        "Cut off by a server restart. Some models are already in. Start a new import with only the missing files.",
      );
    });
  });

  it("leaves nothing on a job done with no failures, whatever the server still has saved", () => {
    const failure_reason = "The rest not downloaded — Thangs's daily download limit was reached.";
    expect(whyText(job({ status: "DONE", failure_reason }), t)).toBeNull();
    expect(whyText(job({ status: "DONE", failure_reason, failed_count: 1 }), t)).toBe(failure_reason);
    expect(whyText(job({ status: "DONE", failure_reason, failed_items_count: 1 }), t)).toBe(failure_reason);
    expect(whyText(job({ status: "ERROR", failure_reason }), t)).toBe(failure_reason);
  });

  it("translates the watchdog's words and an old row's", () => {
    const stalled = "This import stopped responding, so the line moved on. If Retry isn't offered, restart the server.";
    expect(whyText(job({ status: "ERROR", failure_reason: stalled }), t)).toBe(stalled);
    expect(whyText(job({ status: "ERROR", failure_reason: "This older import has no saved request" }), t)).toBe(
      "This older import has no saved request.",
    );
  });

  it("counts failures when there's no reason", () => {
    expect(whyText(job({ status: "DONE", failed_items_count: 1 }), t)).toBe(
      "1 link failed. Open the links to see why.",
    );
    expect(whyText(job({ status: "DONE", failed_count: 3 }), t)).toBe("3 links failed. Open the links to see why.");
    expect(whyText(job({ status: "DONE", type: "COLLECTION", failed_count: 3 }), t)).toBe("3 models failed.");
    expect(whyText(job({ status: "DONE", single: true, failed_count: 1 }), t)).toBe("1 model failed.");
  });

  it("shows why something's on hold", () => {
    expect(whyText(job({ status: "PAUSED", failure_reason: "Sign-in expired." }), t)).toBe("Sign-in expired.");
  });

  it("says nothing while it's on its way, or when nothing went wrong", () => {
    expect(whyText(job({ status: "RUNNING", failed_count: 1, failure_reason: "x" }), t)).toBeNull();
    expect(whyText(job({ status: "QUEUED", failed_count: 1, failure_reason: "x" }), t)).toBeNull();
    expect(whyText(job({ status: "PAUSED", sync_waiting: true, failure_reason: "x" }), t)).toBeNull();
    expect(whyText(job({ status: "DONE" }), t)).toBeNull();
    expect(whyText(job({ status: "ERROR" }), t)).toBeNull();
  });
});

describe("deleteConfirmText", () => {
  it("names the import, and warns that a sync won't bring links back", () => {
    expect(deleteConfirmText(job({ source_label: "Props" }), t)).toEqual({
      title: "Delete this import?",
      message: 'This removes "Props" from the queue. Models already imported stay in the library.',
      confirmLabel: "Delete",
    });
    expect(deleteConfirmText(job({ source_label: "Sync: Props", collection_sync_id: "c" }), t).message).toContain(
      "the sync won't bring its links back",
    );
  });
});

describe("diffSnapshots", () => {
  const running = job({ id: "a", status: "RUNNING", updated_at: ago(HOUR) });
  const done = job({ id: "a", status: "DONE", updated_at: ago(MINUTE) });

  it("only seeds from the first snapshot, so a reload replays nothing", () => {
    expect(diffSnapshots(null, [done])).toEqual({ finished: [], flash: false });
  });

  it("reports a job that ended, once", () => {
    expect(diffSnapshots([running], [done])).toEqual({ finished: [done], flash: true });
    expect(diffSnapshots([done], [done])).toEqual({ finished: [], flash: false });
  });

  it("reports an error like any other ending", () => {
    const failed = job({ id: "a", status: "ERROR" });
    expect(diffSnapshots([running], [failed]).finished).toEqual([failed]);
  });

  it("reports a job that ran and ended between two polls", () => {
    expect(diffSnapshots([job({ id: "a", status: "QUEUED" })], [done]).finished).toEqual([done]);
    expect(diffSnapshots([job({ id: "a", status: "PAUSED" })], [done]).finished).toEqual([done]);
  });

  it("reports nothing for a job put on hold, and no flash", () => {
    expect(diffSnapshots([running], [job({ id: "a", status: "PAUSED" })])).toEqual({ finished: [], flash: false });
  });

  it("reports nothing for a job that drops out of the list", () => {
    expect(diffSnapshots([running], [])).toEqual({ finished: [], flash: false });
  });

  it("reports a job it never saw that has just ended", () => {
    expect(diffSnapshots([], [done]).finished).toEqual([done]);
    expect(
      diffSnapshots([running], [running, job({ id: "b", status: "DONE", updated_at: ago(MINUTE) })]).finished,
    ).toHaveLength(1);
  });

  it("doesn't take an old job rising into the list for a new one", () => {
    const newest = job({ id: "n", status: "DONE", updated_at: ago(HOUR) });
    const old = job({ id: "o", status: "DONE", updated_at: ago(30 * DAY) });
    expect(diffSnapshots([newest], [newest, old]).finished).toEqual([]);
  });

  it("flashes only when nothing of theirs is running or waiting", () => {
    const other = (status: ImportJobStatus, fields: Partial<QueueJob> = {}) => job({ id: "b", status, ...fields });
    expect(diffSnapshots([running], [done, other("RUNNING")]).flash).toBe(false);
    expect(diffSnapshots([running], [done, other("QUEUED", { position: 1 })]).flash).toBe(false);
    expect(diffSnapshots([running], [done, other("PAUSED")]).flash).toBe(true);
  });

  it("neither flashes for a sync, nor lets one hold the tick back", () => {
    const sync = (status: ImportJobStatus, fields: Partial<QueueJob> = {}) =>
      job({ id: "s", status, collection_sync_id: "c", updated_at: ago(MINUTE), ...fields });
    expect(diffSnapshots([running], [done, sync("RUNNING")]).flash).toBe(true);
    expect(diffSnapshots([running], [done, sync("PAUSED", { sync_waiting: true })]).flash).toBe(true);

    const ended = diffSnapshots([sync("RUNNING")], [sync("DONE")]);
    expect(ended.finished).toHaveLength(1);
    expect(ended.flash).toBe(false);
  });

  it("gives every job that ended in one poll", () => {
    const second = job({ id: "b", status: "RUNNING" });
    const secondDone = job({ id: "b", status: "ERROR" });
    expect(diffSnapshots([running, second], [done, secondDone]).finished).toEqual([done, secondDone]);
  });
});

describe("finishToastOf", () => {
  const single = (fields: Partial<QueueJob>) =>
    job({ status: "DONE", single: true, source_label: "Dragon", result_print_id: "p1", total: 1, ...fields });
  const batch = (fields: Partial<QueueJob>) => job({ status: "DONE", source_label: "Bits", ...fields });

  it("has nothing to say with nothing finished, or only a sync", () => {
    expect(finishToastOf([], t)).toBeNull();
    expect(finishToastOf([batch({ collection_sync_id: "c" })], t)).toBeNull();
  });

  it("says what became of a single link, and opens the model", () => {
    const open = { path: "/models/p1" };
    expect(finishToastOf([single({ outcome: "created" })], t)).toEqual({
      message: 'Imported "Dragon"',
      severity: "success",
      open,
    });
    expect(finishToastOf([single({ outcome: "profile_added" })], t)?.message).toBe('Added a print profile to "Dragon"');
    expect(finishToastOf([single({ outcome: "already_imported" })], t)).toEqual({
      message: '"Dragon" is already in your library',
      severity: "success",
      open,
    });
    expect(finishToastOf([single({ outcome: null })], t)?.message).toBe('Imported "Dragon"');
  });

  it("doesn't claim an import when a single link went on to wait for Grab", () => {
    expect(finishToastOf([single({ outcome: null, result_print_id: null })], t)).toEqual({
      message: '"Dragon" finished',
      severity: "success",
      open: null,
    });
  });

  it("points at Needs attention when a single link failed", () => {
    const failure = { message: 'Couldn\'t import "Dragon"', severity: "error", open: { section: "att" } };
    expect(finishToastOf([single({ status: "ERROR", attention: true, result_print_id: null })], t)).toEqual(failure);
    expect(finishToastOf([single({ failed_count: 1, attention: true, result_print_id: null })], t)).toEqual(failure);
  });

  it("counts what a batch brought in", () => {
    expect(finishToastOf([batch({ imported: 5 })], t)).toEqual({
      message: "Imported 5 models.",
      severity: "success",
      open: { path: "/models" },
    });
    expect(finishToastOf([batch({ imported: 1 })], t)).toEqual({
      message: "Imported 1 model.",
      severity: "success",
      open: null,
    });
    expect(finishToastOf([batch({ imported: 2, already_in_library: 3 })], t)?.message).toBe(
      "Imported 2, 3 already in your library.",
    );
  });

  it("opens what a batch made: a model, then a collection, then the grid", () => {
    expect(finishToastOf([batch({ imported: 1, result_print_id: "p" })], t)?.open).toEqual({ path: "/models/p" });
    expect(finishToastOf([batch({ imported: 4, result_collection_id: "c" })], t)?.open).toEqual({
      path: "/models/collections/c",
    });
    expect(finishToastOf([batch({ imported: 1, already_in_library: 1 })], t)?.open).toEqual({ path: "/models" });
  });

  it("warns when part of a batch failed", () => {
    expect(finishToastOf([batch({ imported: 2, already_in_library: 1, failed_count: 3, attention: true })], t)).toEqual(
      {
        message: "Imported 2, 1 already in your library, 3 failed.",
        severity: "warning",
        open: { section: "att" },
      },
    );
  });

  it.each([
    ["none already there", { imported: 1 }, "Imported 1 model, 2 failed."],
    ["none already there, several in", { imported: 3 }, "Imported 3 models, 2 failed."],
    ["none in", { already_in_library: 4 }, "4 already in your library, 2 failed."],
    ["nothing but failures", {}, "Couldn't import 2 models."],
  ])("names no zero when a batch failed in part: %s", (_what, fields, message) => {
    const failing = { failed_count: 2, failed_items_count: 2, attention: true };
    expect(finishToastOf([batch({ ...fields, ...failing })], t)?.message).toBe(message);
  });

  it("counts one failed link on its own", () => {
    const failing = { failed_count: 1, failed_items_count: 1, attention: true };
    expect(finishToastOf([batch(failing)], t)?.message).toBe("Couldn't import 1 model.");
  });

  it("names no zero when everything was already there", () => {
    expect(finishToastOf([batch({ already_in_library: 3 })], t)?.message).toBe("3 already in your library.");
  });

  it("doesn't claim an import when a batch went on to wait for Grab", () => {
    expect(finishToastOf([batch({ total: 2, processed: 2 })], t)).toEqual({
      message: '"Bits" finished',
      severity: "success",
      open: null,
    });
  });

  it("says an errored batch failed", () => {
    expect(finishToastOf([batch({ status: "ERROR", attention: true })], t)).toEqual({
      message: 'Couldn\'t import "Bits"',
      severity: "error",
      open: { section: "att" },
    });
  });

  it("makes one toast of several, leaving out syncs", () => {
    expect(finishToastOf([batch({ id: "a" }), batch({ id: "b" })], t)).toEqual({
      message: "2 imports finished.",
      severity: "success",
      open: { path: "/models" },
    });
    expect(finishToastOf([batch({ id: "a" }), batch({ id: "b", status: "ERROR", attention: true })], t)).toEqual({
      message: "2 imports finished, some with problems.",
      severity: "warning",
      open: { section: "att" },
    });
    expect(
      finishToastOf([batch({ id: "a", imported: 2 }), batch({ id: "b", collection_sync_id: "c" })], t)?.message,
    ).toBe("Imported 2 models.");
  });
});

describe("how many finished beyond the list", () => {
  const finished = (count: number, fields: Partial<QueueJob> = {}) =>
    Array.from({ length: count }, (_, n) => job({ id: `j${n}`, status: "DONE", ...fields }));

  it("goes by the server's total once the list is full", () => {
    expect(finishedBeyondList(finished(50), 100, 160)).toBe(10);
    expect(finishToastOf(finished(50), t, 10)?.message).toBe("60 imports finished.");
  });

  it("leaves those asking for attention out of it: they're all listed, and outside the total", () => {
    expect(finishedBeyondList([...finished(50), ...finished(5, { attention: true })], 100, 160)).toBe(10);
  });

  it("comes up short, never over, when a finished job is cleared meanwhile", () => {
    expect(finishedBeyondList(finished(50), 100, 159)).toBe(9);
    expect(finishedBeyondList(finished(50), 100, 120)).toBe(0);
    expect(finishToastOf(finished(50), t, 0)?.message).toBe("50 imports finished.");
  });

  it("isn't asked of a list that has room: the total moves for other reasons too", () => {
    expect(finishedBeyondList(finished(2), 100, 103)).toBe(0);
    expect(finishedBeyondList(finished(49), 0, 90)).toBe(0);
    expect(finishedBeyondList([], 0, 90)).toBe(0);
  });
});

describe("submittedText", () => {
  const answer = (position: number | null) => ({ kind: "job", position }) as const;

  it("says where a job landed", () => {
    expect(submittedText(answer(1), t)).toBe("Added to the queue. It's next up.");
    expect(submittedText(answer(4), t)).toBe("Added to the queue. It's #4 in line.");
  });

  it("says it started when it runs without waiting", () => {
    expect(submittedText(answer(null), t)).toBe("Import started.");
  });

  it("leaves the other answers to the caller", () => {
    expect(submittedText({ kind: "grab", queued: 2 }, t)).toBeNull();
    expect(submittedText({ kind: "print", print: {} as never }, t)).toBeNull();
  });
});

describe("pollDelay", () => {
  const facts = { supported: true, hidden: false, dialogOpen: false, jobs: [] as QueueJob[], line: EMPTY_LINE };
  const busyLine: LineOut = { now: { mine: false, person: "p", job_id: null }, rows: [], length: 1 };

  it("idles at 8 seconds", () => {
    expect(pollDelay(facts)).toBe(8000);
    expect(pollDelay({ ...facts, jobs: [job({ status: "PAUSED" })] })).toBe(8000);
    expect(pollDelay({ ...facts, jobs: [job({ status: "DONE" })] })).toBe(8000);
  });

  it("is quick while the modal is open or a job of theirs runs", () => {
    expect(pollDelay({ ...facts, dialogOpen: true })).toBe(1500);
    expect(pollDelay({ ...facts, jobs: [job({ status: "RUNNING" })] })).toBe(1500);
  });

  it("isn't quick for a sync, which can run for hours", () => {
    const sync = [job({ status: "RUNNING", collection_sync_id: "c" })];
    expect(pollDelay({ ...facts, jobs: sync })).toBe(8000);
    expect(pollDelay({ ...facts, jobs: sync, dialogOpen: true })).toBe(1500);
  });

  it("is quick for a job about to run, and not for one behind someone else's", () => {
    const queued = [job({ status: "QUEUED", position: 1 })];
    expect(pollDelay({ ...facts, jobs: queued })).toBe(1500);
    expect(pollDelay({ ...facts, jobs: queued, line: busyLine })).toBe(8000);
  });

  it("slows down in a hidden tab, whatever's going on", () => {
    expect(pollDelay({ ...facts, hidden: true, dialogOpen: true, jobs: [job()] })).toBe(30_000);
  });

  it("asks an older backend every 5 minutes", () => {
    expect(pollDelay({ ...facts, supported: false })).toBe(300_000);
    expect(pollDelay({ ...facts, supported: false, dialogOpen: true, hidden: true })).toBe(300_000);
  });

  it("reads everyone's list quickly only while something moves", () => {
    expect(everyoneDelay({ hidden: false, jobs: [] })).toBe(8000);
    expect(everyoneDelay({ hidden: false, jobs: [job({ status: "DONE" })] })).toBe(8000);
    expect(everyoneDelay({ hidden: false, jobs: [job({ status: "QUEUED" })] })).toBe(1500);
    expect(everyoneDelay({ hidden: false, jobs: [job({ status: "PAUSED", runner_live: true })] })).toBe(1500);
    expect(everyoneDelay({ hidden: true, jobs: [job()] })).toBe(30_000);
  });
});

describe("queueLinkPath", () => {
  it("keeps the section, and a bare link stays bare, for the dialog to read", () => {
    expect(queueLinkPath("att")).toBe("/?import-queue=att");
    expect(queueLinkPath(null)).toBe("/?import-queue=");
    expect(queueLinkPath("")).toBe("/?import-queue=");
  });

  it("can't be talked into anything else", () => {
    expect(queueLinkPath("a&b=c#d")).toBe("/?import-queue=a%26b%3Dc%23d");
    expect(new URLSearchParams(queueLinkPath("a&b=c").slice(2)).get("import-queue")).toBe("a&b=c");
  });
});

describe("handsOnQueueParam", () => {
  it("is only for the two addresses that redirect", () => {
    expect(handsOnQueueParam("/admin-queue")).toBe(true);
    expect(handsOnQueueParam("/import-queue")).toBe(true);
    expect(handsOnQueueParam("/")).toBe(false);
    expect(handsOnQueueParam("/models")).toBe(false);
  });
});

describe("opensQueueLink", () => {
  it("waits for the first read, as the session may turn out to have ended", () => {
    expect(opensQueueLink("/", true)).toBe(false);
    expect(opensQueueLink("/models", true)).toBe(false);
    expect(opensQueueLink("/", false)).toBe(true);
    expect(opensQueueLink("/models", false)).toBe(true);
  });

  it("leaves the two addresses that redirect to do that", () => {
    expect(opensQueueLink("/admin-queue", false)).toBe(false);
    expect(opensQueueLink("/import-queue", false)).toBe(false);
  });
});

describe("deepLinkTarget", () => {
  it("opens the viewer's own imports on a named section", () => {
    for (const section of ["run", "att", "wait", "done"] as const) {
      expect(deepLinkTarget(section, true)).toEqual({ section, scope: "mine" });
      expect(deepLinkTarget(section, false)).toEqual({ section, scope: "mine" });
    }
  });

  it("opens Waiting on a bare link: everyone's for an admin, one's own for anyone else", () => {
    expect(deepLinkTarget("", true)).toEqual({ section: "wait", scope: "everyone" });
    expect(deepLinkTarget("", false)).toEqual({ section: "wait", scope: "mine" });
  });

  it("treats an unknown section like a bare link", () => {
    expect(deepLinkTarget("nonsense", false)).toEqual({ section: "wait", scope: "mine" });
  });
});

describe("translations", () => {
  const PLURAL = /_(zero|one|two|few|many|other)$/;
  const keysOf = (node: object, prefix = ""): string[] =>
    Object.entries(node).flatMap(([key, value]) =>
      value && typeof value === "object" ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`.replace(PLURAL, "")],
    );

  it.each([
    ["lt", lt],
    ["es", es],
    ["fr", fr],
  ])("has every string in %s", (_code, locale) => {
    expect([...new Set(keysOf(locale.app.importQueue))].toSorted()).toEqual(
      [...new Set(keysOf(en.app.importQueue))].toSorted(),
    );
  });

  const valuesOf = (node: object, prefix = ""): [string, string][] =>
    Object.entries(node).flatMap(([key, value]): [string, string][] =>
      value && typeof value === "object" ? valuesOf(value, `${prefix}${key}.`) : [[`${prefix}${key}`, String(value)]],
    );
  const placeholders = (text: string) => [...text.matchAll(/{{(\w+)}}/g)].map((match) => match[1]).toSorted();

  it.each([
    ["lt", lt],
    ["es", es],
    ["fr", fr],
  ])("keeps the placeholders in %s", (_code, locale) => {
    const english = new Map(valuesOf(en.app.importQueue).map(([key, text]) => [key.replace(PLURAL, ""), text]));
    for (const [key, text] of valuesOf(locale.app.importQueue)) {
      expect([key, placeholders(text)]).toEqual([key, placeholders(english.get(key.replace(PLURAL, "")) ?? "")]);
    }
  });

  it("reads right in French, Spanish and Lithuanian where it first didn't", async () => {
    const fixedT = async (lng: string, app: object) => {
      const instance = i18next.createInstance();
      await instance.init({ lng, defaultNS: "app", resources: { [lng]: { app } } });
      return instance.getFixedT(lng, "app");
    };
    const inFrench = await fixedT("fr", fr.app);
    const held = job({ status: "PAUSED", can_start: true });
    expect(jobChip(held, inFrench).label).toBe("En suspens");
    expect(whenText({ ...held, queued_at: ago(MINUTE) }, { t: inFrench, locale: "fr", now: NOW })).toBe("En suspens");
    expect(primaryAction(job({ status: "QUEUED", can_pause: true }), inFrench)?.label).toBe("Mettre en suspens");
    expect(panelAction("wait", [held], sectionCounts([held]), inFrench)?.label).toBe(
      "Lancer tout ce qui est en suspens (1)",
    );
    expect(inLineText(job({ status: "QUEUED", position: 4, total: 2 }), inFrench)).toBe(
      "3 importations devant · 2 liens",
    );
    expect(inLineText(job({ status: "QUEUED", position: 2, total: 2 }), inFrench)).toBe(
      "1 importation devant · 2 liens",
    );
    expect(fr.app.importQueue.autoStartOff).toContain("restent en suspens");
    expect(fr.app.importQueue.empty.wait.text).toContain("restent en suspens");

    const inSpanish = await fixedT("es", es.app);
    const nothing = { scope: "mine" as const, line: EMPTY_LINE, own: [], autoStart: false };
    expect(emptyState("run", nothing, inSpanish).title).toBe("No se está importando nada");

    expect(lt.app.importQueue.syncTagHint).toMatch(/todėl eilės niekada nestabdo$/);
  });

  it("picks the right plural form in Lithuanian", async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: "lt", defaultNS: "app", resources: { lt: { app: lt.app } } });
    const inLithuanian = instance.getFixedT("lt", "app");
    expect(inLineText(job({ status: "QUEUED", position: 1, total: 1 }), inLithuanian)).toBe("Kitas eilėje · 1 nuoroda");
    expect(inLineText(job({ status: "QUEUED", position: 4, total: 3 }), inLithuanian)).toBe(
      "Prieš jį 3 importai · 3 nuorodos",
    );
    expect(inLineText(job({ status: "QUEUED", position: 12, total: 10 }), inLithuanian)).toBe(
      "Prieš jį 11 importų · 10 nuorodų",
    );
    expect(
      whenText(job({ status: "RUNNING", started_at: ago(12 * MINUTE) }), { t: inLithuanian, locale: "lt", now: NOW }),
    ).toBe("Pradėta prieš 12 minučių");
  });
});
