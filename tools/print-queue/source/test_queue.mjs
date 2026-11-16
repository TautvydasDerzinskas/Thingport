// Tests for queue.js. Run from the tool's folder: node source/test_queue.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { clashes, columns, isJob, listNames, moved, newId, newJob, people, summaryOf } from "./queue.js";

const dad = { id: "dad", name: "Dad", avatarUrl: null };
const mum = { id: "mum", name: "Mum", avatarUrl: null };
const me = { id: "me", name: "Ann", avatarUrl: null };
const at = (day, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));
const model = { id: "m1", name: "Bracket" };

function entry(key, user, job, mine = false) {
  return { key, user, mine, value: job, info: null, modelId: job.modelId, updatedAt: job.queuedAt };
}

test("a new job waits in the queue, with the file picked when there was one", () => {
  const job = newJob(model, { id: "p1", name: "bracket.stl" }, at(1));
  assert.deepEqual(job, {
    status: "queued",
    modelId: "m1",
    name: "Bracket",
    fileId: "p1",
    fileName: "bracket.stl",
    note: "",
    queuedAt: "2026-11-01T12:00:00.000Z",
    startedAt: null,
    finishedAt: null,
  });
  assert.equal(newJob(model, null, at(1)).fileId, null);
  assert.ok(isJob(job));
  assert.ok(!isJob({ status: "lost", name: "x" }));
  assert.ok(!isJob("job"));
});

test("moving a job keeps the times its status has", () => {
  const queued = newJob(model, null, at(1));
  const printing = moved(queued, "printing", at(2));
  assert.equal(printing.startedAt, "2026-11-02T12:00:00.000Z");
  const printed = moved(printing, "printed", at(3));
  assert.equal(printed.finishedAt, "2026-11-03T12:00:00.000Z");
  assert.equal(printed.startedAt, printing.startedAt);
  const again = moved(printed, "queued", at(4));
  assert.equal(again.startedAt, null);
  assert.equal(again.finishedAt, null);
});

test("a person's chip shows a print happening, then one waiting, then the latest finished", () => {
  const queued = newJob(model, null, at(1));
  const printed = moved(moved(newJob(model, null, at(1)), "printing", at(2)), "printed", at(3));
  const failed = moved(newJob(model, null, at(1)), "failed", at(5));
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
    entry("job:b", dad, newJob(model, null, at(3))),
    entry("job:a", me, newJob(model, null, at(1)), true),
    entry("job:c", dad, moved(newJob(model, null, at(1)), "printed", at(2))),
    entry("job:d", mum, moved(newJob(model, null, at(1)), "printed", at(4))),
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

test("someone else's print waiting or happening is a clash; a finished one isn't", () => {
  const entries = [
    entry("job:1", dad, newJob(model, null, at(1))),
    entry("job:2", mum, moved(newJob(model, null, at(1)), "printed", at(2))),
    entry("job:3", me, newJob(model, null, at(1)), true),
    entry("job:4", mum, moved(newJob(model, null, at(1)), "printing", at(2))),
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
  assert.equal(listNames([...others, entry("job:5", me, newJob(model, null, at(1)))], "and"), "Dad, Mum and Ann");
});

test("ids differ without crypto.randomUUID", () => {
  assert.notEqual(newId(), newId());
  assert.equal(
    newId(36, () => 0.5),
    "10i",
  );
});
