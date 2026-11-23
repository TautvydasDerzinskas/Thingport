// Tests for queue.js. Run from the tool's folder: node source/test_queue.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allJobs,
  chipsOf,
  clashes,
  columns,
  isJob,
  listNames,
  moved,
  newId,
  newJob,
  people,
  queueOrderAt,
  summaryOf,
  writesInTurn,
} from "./queue.js";
import { addPicked, run } from "./ui.js";

const dad = { id: "dad", name: "Dad", avatarUrl: null };
const mum = { id: "mum", name: "Mum", avatarUrl: null };
const me = { id: "me", name: "Ann", avatarUrl: null };
const at = (day, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));
const model = { id: "m1", name: "Bracket" };

function entry(key, user, job, mine = false) {
  return { key, user, mine, value: job, info: null, modelId: job.modelId, updatedAt: job.queuedAt };
}

test("a new job waits in the queue", () => {
  const job = newJob(model, at(1));
  assert.deepEqual(job, {
    status: "queued",
    modelId: "m1",
    name: "Bracket",
    note: "",
    queuedAt: "2026-11-01T12:00:00.000Z",
    startedAt: null,
    finishedAt: null,
  });
  assert.ok(isJob(job));
  assert.ok(!isJob({ status: "lost", name: "x" }));
  assert.ok(!isJob("job"));
  // Anyone can share anything under a job's key: one missing what the board sorts by isn't one.
  assert.ok(!isJob({ status: "queued", name: "Bad" }));
  assert.ok(!isJob({ ...job, startedAt: 5 }));
});

test("moving a job keeps the times its status has", () => {
  const queued = newJob(model, at(1));
  const printing = moved(queued, "printing", at(2));
  assert.equal(printing.startedAt, "2026-11-02T12:00:00.000Z");
  const printed = moved(printing, "printed", at(3));
  assert.equal(printed.finishedAt, "2026-11-03T12:00:00.000Z");
  assert.equal(printed.startedAt, printing.startedAt);
  const again = moved(printed, "queued", at(4));
  assert.equal(again.startedAt, null);
  assert.equal(again.finishedAt, null);
  // Back at the end of the queue, as though queued then.
  assert.equal(again.queuedAt, "2026-11-04T12:00:00.000Z");
});

test("a person's chip shows a print happening, then one waiting, then the latest finished", () => {
  const queued = newJob(model, at(1));
  const printed = moved(moved(newJob(model, at(1)), "printing", at(2)), "printed", at(3));
  const failed = moved(newJob(model, at(1)), "failed", at(5));
  assert.equal(summaryOf([]), null);
  assert.deepEqual(summaryOf([printed, queued]), {
    label: "status.queued",
    tone: "waiting",
    date: "2026-11-01T12:00:00.000Z",
  });
  assert.equal(summaryOf([printed, queued, moved(queued, "printing", at(6))]).label, "status.printing");
  assert.equal(summaryOf([printed, failed]).label, "status.failed");
});

test("the board sorts each column, the queue oldest first and the rest newest first", () => {
  const entries = [
    entry("job:b", dad, newJob(model, at(3))),
    entry("job:a", me, newJob(model, at(1)), true),
    entry("job:c", dad, moved(newJob(model, at(1)), "printed", at(2))),
    entry("job:d", mum, moved(newJob(model, at(1)), "printed", at(4))),
    entry("about:m1", me, { jobs: 1 }, true),
  ];
  const cols = columns(entries);
  assert.deepEqual(
    cols.queued.map((e) => e.key),
    ["job:a", "job:b"],
  );
  assert.deepEqual(
    cols.printed.map((e) => e.key),
    ["job:d", "job:c"],
  );
  assert.deepEqual(cols.printing, []);
  assert.deepEqual(
    columns(entries, "dad").printed.map((e) => e.key),
    ["job:c"],
  );
  assert.deepEqual(
    people(entries).map((p) => p.id),
    ["me", "dad", "mum"],
  );
});

test("manual moves preserve the added dates and new or requeued jobs go to the end", () => {
  const first = entry("job:1", me, newJob(model, at(1)), true);
  const other = entry("job:2", dad, newJob(model, at(2)));
  const third = entry("job:3", me, newJob(model, at(3)), true);
  const entries = [third, other, first];
  const ordered = (who) => columns(entries, who).queued;
  const reorder = (entry, next) => {
    const queueOrder = queueOrderAt(ordered(), entry, next);
    assert.ok(queueOrder);
    entry.value = { ...entry.value, queueOrder };
  };

  reorder(third, other);
  assert.deepEqual(ordered(), [first, third, other]);
  assert.equal(third.value.queuedAt, at(3).toISOString());
  assert.equal(queueOrderAt(ordered(), third, other), null);
  reorder(first, null);
  assert.deepEqual(ordered(), [third, other, first]);
  assert.deepEqual(ordered(me.id), [third, first]);
  assert.deepEqual(other.value, newJob(model, at(2)));

  const fourth = entry("job:4", me, newJob(model, at(4)), true);
  entries.push(fourth);
  assert.deepEqual(ordered(), [third, other, first, fourth]);
  third.value = moved(moved(third.value, "printing", at(5)), "queued", at(6));
  assert.equal(third.value.queueOrder, undefined);
  assert.deepEqual(ordered(), [other, first, fourth, third]);
});

test("jobs added at the same time can repeatedly be placed between close positions", () => {
  const entries = ["a", "b", "c"].map((id) => entry(`job:${id}`, me, newJob(model, at(1)), true));
  assert.deepEqual(columns(entries.toReversed()).queued, entries);
  for (let moves = 0; moves < 100; moves++) {
    const [top, middle, bottom] = columns(entries).queued;
    const order = queueOrderAt([top, middle, bottom], bottom, middle);
    bottom.value = { ...bottom.value, queueOrder: order };
    assert.deepEqual(columns(entries).queued, [top, bottom, middle]);
  }
});

test("someone else's print waiting or happening is a clash; a finished one isn't", () => {
  const entries = [
    entry("job:1", dad, newJob(model, at(1))),
    entry("job:2", mum, moved(newJob(model, at(1)), "printed", at(2))),
    entry("job:3", me, newJob(model, at(1)), true),
    entry("job:4", mum, moved(newJob(model, at(1)), "printing", at(2))),
  ];
  const { others, mine } = clashes(entries);
  assert.deepEqual(
    others.map((e) => e.key),
    ["job:1", "job:4"],
  );
  assert.deepEqual(
    mine.map((e) => e.key),
    ["job:3"],
  );
  assert.equal(listNames(others, "and"), "Dad and Mum");
  assert.equal(listNames([others[0], others[0]], "and"), "Dad");
  assert.equal(listNames([...others, entry("job:5", me, newJob(model, at(1)))], "and"), "Dad, Mum and Ann");
});

test("bulk add queues in grid order, skips active copies and reports failures while continuing", async () => {
  const stored = [
    entry("job:existing", dad, moved(newJob({ id: "busy", name: "Busy" }), "printing", at(1))),
    entry("job:history", me, moved(newJob({ id: "last", name: "Last" }), "printed", at(1)), true),
  ];
  const saved = [];
  const toasts = [];
  const originalId = (id) => (id === "copy" ? "first" : id);
  const thingport = {
    context: { modelIds: ["busy", "first", "copy", "missing", "last", "first"] },
    models: {
      get: async (id) => {
        if (id === "missing") throw new Error("No such model");
        return { id, name: id };
      },
    },
    shared: {
      list: async ({ model }) => stored.filter(({ value }) => originalId(model) === originalId(value.modelId)),
      set: async (key, value, { model }) => {
        assert.equal(model, value.modelId);
        stored.push(entry(key, me, value, true));
        saved.push(model);
      },
    },
    ui: {
      confirm: () => assert.fail("bulk add does not open a confirmation for each duplicate"),
      toast: (...args) => toasts.push(args),
    },
    t: (key, { count, error } = {}) => [key, count, error].filter(Boolean).join(" "),
  };

  await run("queue-selection", thingport);

  assert.deepEqual(saved, ["first", "last"]);
  assert.deepEqual(toasts, [
    [
      "toast.bulkAdded 2 · toast.bulkSkipped 2 · toast.bulkFailed 1 No such model",
      "error",
      { openWindow: "toast.openQueue" },
    ],
  ]);
});

test("bulk removal confirms once and removes only still-matching owned waiting jobs", async () => {
  const byMe = newJob(model, at(1));
  const first = entry("job:a", me, byMe, true);
  const changing = entry("job:b", me, newJob(model, at(2)), true);
  const other = entry("job:a", dad, byMe);
  const printing = entry("job:c", me, moved(byMe, "printing", at(3)), true);
  const printed = entry("job:d", me, moved(byMe, "printed", at(4)), true);
  const unselected = entry("job:e", me, newJob({ id: "other", name: "Other" }, at(3)), true);
  const stored = [first, changing, other, printing, printed, unselected];
  const confirmations = [];
  const toasts = [];
  const written = [];
  const thingport = {
    context: { modelIds: [model.id, "copy"] },
    shared: {
      list: async ({ model: id }) => stored.filter(({ value }) => value.modelId === (id === "copy" ? model.id : id)),
      replace: async ({ key, store, value }, next) => {
        assert.equal(store, "shared");
        assert.equal(next, null);
        const index = stored.findIndex(
          (candidate) => candidate.mine && candidate.key === key && candidate.value === value,
        );
        written.push(key);
        if (index < 0) return false;
        stored.splice(index, 1);
        return true;
      },
    },
    ui: {
      confirm: async (options) => {
        confirmations.push(options);
        changing.value = moved(changing.value, "printing", at(5));
        return true;
      },
      toast: (...args) => toasts.push(args),
    },
    t: (key, { count } = {}) => (count ? `${key} ${count}` : key),
  };

  await run("remove-selection", thingport);

  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].message, "remove.bulkMessage 2");
  assert.equal(confirmations[0].destructive, true);
  assert.deepEqual(written, [first.key, changing.key]);
  assert.deepEqual(stored, [changing, other, printing, printed, unselected]);
  assert.deepEqual(toasts, [
    ["toast.bulkRemoved 1 · toast.bulkChanged 1", "success", { openWindow: "toast.openQueue" }],
  ]);
});

test("models picked on the board: one asks about a duplicate, several skip them, and no toast reopens the board", async () => {
  const stored = [entry("job:busy", dad, newJob({ id: "busy", name: "Busy" }, at(1)))];
  const saved = [];
  const toasts = [];
  const confirmations = [];
  let picks = [];
  const thingport = {
    models: { get: async (id) => ({ id, name: id }) },
    shared: {
      list: async ({ model }) => stored.filter(({ value }) => value.modelId === model),
      set: async (key, value) => {
        stored.push(entry(key, me, value, true));
        saved.push(value.modelId);
      },
    },
    ui: {
      pickModels: async (options) => {
        assert.deepEqual(options, { title: "add.title", confirmLabel: "add.confirm" });
        return picks;
      },
      confirm: async (options) => {
        confirmations.push(options.title);
        return true;
      },
      toast: (...args) => toasts.push(args),
    },
    t: (key, { count, name } = {}) => [key, count, name].filter(Boolean).join(" "),
  };

  assert.equal(await addPicked(thingport), false);
  picks = [{ id: "busy" }];
  assert.equal(await addPicked(thingport), true);
  assert.deepEqual(confirmations, ["dup.queued"]);
  picks = [{ id: "busy" }, { id: "new" }];
  assert.equal(await addPicked(thingport), true);
  assert.deepEqual(saved, ["busy", "new"]);
  assert.deepEqual(toasts, [
    ["toast.queued busy", "success"],
    ["toast.bulkAdded 1 · toast.bulkSkipped 1", "success"],
  ]);
});

test("ids differ without crypto.randomUUID", () => {
  assert.notEqual(newId(), newId());
  assert.equal(
    newId(36, () => 0.5),
    "10i",
  );
});

test("writes to one entry land in the order they were made, after a failed one too", async () => {
  const inTurn = writesInTurn();
  const stored = [];
  const later =
    (ms, value, fail = false) =>
    () =>
      new Promise((resolve, reject) =>
        setTimeout(() => (fail ? reject(new Error("offline")) : resolve(stored.push(value))), ms),
      );
  const first = inTurn("job:1", later(30, "printing"));
  const failed = inTurn("job:1", later(1, "printed", true));
  const last = inTurn("job:1", later(1, "failed"));
  // Another entry doesn't wait for this one's.
  const other = inTurn("job:2", later(1, "other"));
  await other;
  assert.deepEqual(stored, ["other"]);
  await first;
  await assert.rejects(failed, /offline/);
  await last;
  assert.deepEqual(stored, ["other", "printing", "failed"]);
});

test("the board reads every page of jobs, and stops at the first that isn't full", async () => {
  const stored = Array.from({ length: 7 }, (_, i) => ({ key: `job:${i}`, cursor: `c${i}` }));
  const asked = [];
  const shared = {
    list: async (options) => {
      asked.push(options);
      const from = options.before ? stored.findIndex((e) => e.cursor === options.before) + 1 : 0;
      return stored.slice(from, from + 3);
    },
  };
  assert.deepEqual(
    (await allJobs(shared, { model: "m1" }, 3)).map((e) => e.key),
    stored.map((e) => e.key),
  );
  assert.deepEqual(asked, [
    { model: "m1", prefix: "job:" },
    { model: "m1", prefix: "job:", before: "c2" },
    { model: "m1", prefix: "job:", before: "c5" },
  ]);
});

test("a model's page shows one chip a person, the user's first, saying where their prints of it are", () => {
  const job = (status, day) => moved(newJob(model, at(day)), status, at(day + 1));
  const chips = chipsOf([
    entry("job:1", dad, job("printed", 1)),
    entry("job:2", dad, job("printing", 2)),
    entry("job:3", me, job("queued", 3), true),
    entry("about:x", mum, { jobs: 1 }),
  ]);
  assert.deepEqual(
    chips.map((chip) => [chip.user.id, chip.summary.label]),
    [
      ["me", "status.queued"],
      ["dad", "status.printing"],
    ],
  );
});
