import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_PAUSED } from "../shared/messages";
import type { QueueImportResult } from "../shared/api";

// New Grab against what instances actually answer, older ones most of all: answered over fetch, so each goes through
// apiCall as it would for real, with only the error's words surviving it.
type Answer = { status?: number; body: unknown };

const INSTANCE = "http://192.168.1.20:8080";
const URL_PRINTABLES = "https://www.printables.com/model/1-thing";

let answers: Record<string, Answer[]>;
const requests: { route: string; body: unknown }[] = [];
const store: Record<string, unknown> = {};

const recordRecentImport = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
vi.mock("./recentImports", () => ({
  recordRecentImport: (...args: unknown[]) => recordRecentImport(...args),
}));

vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
  const route = `${init.method ?? "GET"} ${url.replace(`${INSTANCE}/api`, "")}`;
  requests.push({ route, body: init.body ? JSON.parse(init.body as string) : undefined });
  const queued = answers[route];
  if (!queued?.length) return new Response(JSON.stringify({ detail: "Not found" }), { status: 404 });
  // The last answer stands from then on, as a job's final status does.
  const { status = 200, body } = queued.length > 1 ? queued.shift()! : queued[0];
  return new Response(JSON.stringify(body), { status });
});

vi.stubGlobal("chrome", {
  action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
  cookies: { get: async () => null },
  storage: {
    local: {
      get: async () => ({ ...store }),
      set: async (values: Record<string, unknown>) => void Object.assign(store, values),
    },
  },
});

const { importSingle, queueImport } = await import("./importJobs");

/** Runs the 1s waits between polls without waiting for them. */
async function settle<T>(work: Promise<T>): Promise<T> {
  const state = { pending: true };
  const done = () => {
    state.pending = false;
  };
  work.then(done, done);
  while (state.pending) await vi.advanceTimersByTimeAsync(1000);
  return work;
}

const routes = () => requests.map((request) => request.route);
const importZip = () => settle(importSingle({ url: URL_PRINTABLES, entries: ["a.stl"], collectionId: "col1" }));
const addToQueue = () => queueImport({ url: URL_PRINTABLES, collectionId: "col1", scope: "designer", title: "Thing" });

describe("importing against an instance of any age", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    answers = {};
    requests.length = 0;
    recordRecentImport.mockClear();
    for (const key of Object.keys(store)) delete store[key];
    Object.assign(store, {
      instanceUrl: INSTANCE,
      email: "me@example.com",
      password: "secret",
      token: "t",
      tokenExpiresAt: Date.now() + 3_600_000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows { task_id } until the print, then files it and records it", async () => {
    answers["POST /import?async=1"] = [{ status: 202, body: { task_id: "task1" } }];
    answers["GET /import/tasks/task1"] = [
      { body: { status: "running" } },
      { body: { status: "done", result: { id: "print1", import_outcome: "created" } } },
    ];
    answers["POST /collection/col1/items/print1"] = [{ body: {} }];

    const print = await settle(importSingle({ url: URL_PRINTABLES, collectionId: "col1", title: "Thing" }));

    expect(print?.id).toBe("print1");
    expect(routes()).toContain("POST /collection/col1/items/print1");
    expect(recordRecentImport).toHaveBeenCalledTimes(1);
  });

  it("takes an answer without task_id for the print: an instance that ignores async sends it whole", async () => {
    answers["POST /import?async=1"] = [{ body: { id: "print1", import_outcome: "created" } }];
    answers["POST /collection/col1/items/print1"] = [{ body: {} }];

    const print = await settle(importSingle({ url: URL_PRINTABLES, collectionId: "col1" }));

    expect(print?.id).toBe("print1");
    expect(routes()).toEqual(["POST /import?async=1", "POST /collection/col1/items/print1"]);
  });

  it("never asks for the line: Import runs now, on old and new instances alike", async () => {
    answers["POST /import?async=1"] = [{ body: { id: "print1" } }];
    answers["POST /import/zip"] = [{ status: 202, body: { job_id: "job1" } }];
    answers["GET /import/jobs/job1"] = [{ body: { status: "DONE", result_print_id: "print2" } }];

    await settle(importSingle({ url: URL_PRINTABLES }));
    await settle(importSingle({ url: URL_PRINTABLES }, { notify: false }));
    await settle(importSingle({ url: URL_PRINTABLES, entries: ["a.stl"] }));

    expect(routes().join(" ")).not.toContain("queue");
    for (const { body } of requests) expect(JSON.stringify(body ?? {})).not.toContain("queue");
  });

  it("shows a busy instance's 409 in its own words, and doesn't poll", async () => {
    answers["POST /import/zip"] = [{ status: 409, body: { detail: "An import is already in progress" } }];

    await expect(settle(importSingle({ url: URL_PRINTABLES, entries: ["a.stl"] }))).rejects.toThrow(
      "An import is already in progress",
    );
    expect(routes()).toEqual(["POST /import/zip"]);
  });

  it("shows a 404 for a task the instance lost as a failed import, in its own words", async () => {
    answers["POST /import?async=1"] = [{ status: 202, body: { task_id: "task1" } }];
    answers["GET /import/tasks/task1"] = [
      { status: 404, body: { detail: "Import task not found -- it may have expired or the server restarted" } },
    ];

    await expect(settle(importSingle({ url: URL_PRINTABLES }))).rejects.toThrow("Import task not found");
    expect(recordRecentImport).not.toHaveBeenCalled();
  });

  describe("a zip's job", () => {
    beforeEach(() => {
      answers["POST /import/zip"] = [{ status: 202, body: { job_id: "job1" } }];
      answers["POST /collection/col1/items/print1"] = [{ body: {} }];
    });

    it("is followed to DONE, as ever", async () => {
      answers["GET /import/jobs/job1"] = [
        { body: { status: "RUNNING" } },
        { body: { status: "DONE", result_print_id: "print1" } },
      ];

      expect(await importZip()).toEqual({ id: "print1" });
      expect(routes()).toContain("POST /collection/col1/items/print1");
    });

    it("gives no print when DONE names none, as ever", async () => {
      answers["GET /import/jobs/job1"] = [{ body: { status: "DONE", result_print_id: null } }];

      expect(await importZip()).toBeNull();
    });

    it("fails on ERROR, as ever", async () => {
      answers["GET /import/jobs/job1"] = [{ body: { status: "ERROR", error_message: "Disk full" } }];

      await expect(importZip()).rejects.toThrow("Disk full");
    });

    it("isn't a success when PAUSED: nothing filed, nothing recorded", async () => {
      answers["GET /import/jobs/job1"] = [{ body: { status: "RUNNING" } }, { body: { status: "PAUSED" } }];

      await expect(importZip()).rejects.toThrow(IMPORT_PAUSED);
      expect(routes().filter((route) => route.startsWith("POST /collection"))).toEqual([]);
      expect(recordRecentImport).not.toHaveBeenCalled();
    });

    it("isn't a success on a status Grab has never heard of either", async () => {
      answers["GET /import/jobs/job1"] = [{ body: { status: "SOMETHING_NEW" } }];

      await expect(importZip()).rejects.toThrow(IMPORT_PAUSED);
    });

    it("is still going when QUEUED, should that ever reach it", async () => {
      answers["GET /import/jobs/job1"] = [
        { body: { status: "QUEUED" } },
        { body: { status: "QUEUED" } },
        { body: { status: "DONE", result_print_id: "print1" } },
      ];

      expect(await importZip()).toEqual({ id: "print1" });
      expect(routes().filter((route) => route === "GET /import/jobs/job1")).toHaveLength(3);
    });
  });

  describe("Add to the queue", () => {
    it("hands back an older instance's answer, with nothing new in it", async () => {
      const answer: QueueImportResult = { job_id: "job1", item_id: "item1", duplicate: false, waiting: 2 };
      answers["POST /import/queue"] = [{ status: 201, body: answer }];

      expect(await addToQueue()).toEqual(answer);
      expect(requests[0].body).toEqual({
        url: URL_PRINTABLES,
        collection_id: "col1",
        scope: "designer",
        title: "Thing",
      });
    });

    it("hands back where a newer instance put it", async () => {
      answers["POST /import/queue"] = [
        {
          status: 201,
          body: { job_id: "job1", item_id: "item1", duplicate: false, waiting: 1, started: true, position: 3 },
        },
      ];

      expect(await addToQueue()).toMatchObject({ started: true, position: 3 });
    });

    it("says so when the instance has no such route", async () => {
      await expect(addToQueue()).rejects.toThrow("Not found");
    });
  });
});
