import type { TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../../api/client";
import { createQueueStore, type QueueStoreDeps } from "./queueStore";
import type { ToastOptions } from "../ToastProvider";

const NOW = new Date(2026, 9, 31, 12, 0, 0).getTime();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const queueBody = (jobs: Record<string, unknown>[] = [], extra: Record<string, unknown> = {}) => ({
  jobs,
  finished_total: 0,
  line: { now: null, rows: [], length: 0 },
  settings: { start_grab_links: false },
  ...extra,
});

const row = (fields: Record<string, unknown> = {}) => ({
  id: "a",
  type: "LINKS",
  status: "RUNNING",
  source_url: "https://example.com/a",
  source_label: "Bits",
  total: 2,
  processed: 1,
  created_at: new Date(NOW - 60_000).toISOString(),
  updated_at: new Date(NOW - 1000).toISOString(),
  can_start: false,
  can_pause: true,
  can_retry: false,
  can_delete: false,
  attention: false,
  ...fields,
});

type Handler = () => Response | Promise<Response>;

/** Answers by "METHOD path", and keeps a record. `/api/import/queue` answers an empty queue unless told otherwise. */
function fakeServer() {
  const routes = new Map<string, Handler>();
  const calls: string[] = [];
  const bodies: unknown[] = [];
  let queue: Handler = () => json(queueBody());
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    bodies.push(init?.body);
    if (key === "GET /api/import/queue") return queue();
    const route = routes.get(key);
    return route ? route() : json({ detail: "Not found" }, 404);
  });
  return {
    bodies,
    calls,
    routes,
    setQueue: (handler: Handler) => {
      queue = handler;
    },
    answerQueue: (jobs: Record<string, unknown>[], extra?: Record<string, unknown>) => {
      queue = () => json(queueBody(jobs, extra));
    },
    /** How many times the queue was read, then forgets. */
    reads: () => {
      const count = calls.filter((call) => call === "GET /api/import/queue").length;
      calls.length = 0;
      return count;
    },
  };
}

function setup(overrides: Partial<QueueStoreDeps> = {}) {
  const server = fakeServer();
  const toasts: ToastOptions[] = [];
  const deps = {
    t: ((key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction,
    toast: (options: ToastOptions) => void toasts.push(options),
    navigate: vi.fn<(path: string) => void>(),
    onUnauthorized: vi.fn<() => void>(),
    onCompleted: vi.fn<() => void>(),
  };
  const store = createQueueStore({ viewerId: "me", isAdmin: false, isHidden: () => false, ...overrides });
  store.connect(deps);
  return { server, toasts, deps, store, state: () => store.getState() };
}

/** Lets what's already due run, without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("polling", () => {
  it("reads once when started, then every 8 seconds while nothing moves", async () => {
    const { server, store, state } = setup();
    store.start();
    await settle();
    expect(server.reads()).toBe(1);
    expect(state().loading).toBe(false);
    await vi.advanceTimersByTimeAsync(7999);
    expect(server.reads()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.reads()).toBe(1);
    store.stop();
  });

  it("speeds up while a job of the viewer's runs, and slows down after", async () => {
    const { server, store } = setup();
    server.answerQueue([row()]);
    store.start();
    await settle();
    server.reads();
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.reads()).toBe(1);
    server.answerQueue([row({ status: "DONE" })]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.reads()).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.reads()).toBe(0);
    await vi.advanceTimersByTimeAsync(6500);
    expect(server.reads()).toBe(1);
    store.stop();
  });

  it("speeds up while the dialog is open, and reads as it opens", async () => {
    const { server, store } = setup();
    store.start();
    await settle();
    server.reads();
    store.actions.open("wait");
    await settle();
    expect(server.reads()).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.reads()).toBe(1);
    store.actions.close();
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.reads()).toBe(1);
    await vi.advanceTimersByTimeAsync(7999);
    expect(server.reads()).toBe(0);
    store.stop();
  });

  it("slows down in a hidden tab, and reads at once on coming back", async () => {
    let hidden = true;
    const { server, store } = setup({ isHidden: () => hidden });
    server.answerQueue([row()]);
    store.start();
    await settle();
    server.reads();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(server.reads()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.reads()).toBe(1);
    hidden = false;
    store.wake();
    await settle();
    expect(server.reads()).toBe(1);
    store.stop();
  });

  it("never asks twice at once, and a read asked for meanwhile comes after", async () => {
    const { server, store } = setup();
    let answer: (response: Response) => void = () => undefined;
    server.setQueue(() => new Promise((resolve) => (answer = resolve)));
    store.start();
    await settle();
    expect(server.reads()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    const refreshed = store.actions.refresh();
    const again = store.actions.refresh();
    await settle();
    expect(server.reads()).toBe(0);
    server.answerQueue([]);
    answer(json(queueBody()));
    await refreshed;
    await again;
    expect(server.reads()).toBe(1);
    store.stop();
  });

  it("stops for good, dropping what's still on its way", async () => {
    const { server, store, state } = setup();
    let answer: (response: Response) => void = () => undefined;
    server.setQueue(() => new Promise((resolve) => (answer = resolve)));
    store.start();
    await settle();
    store.stop();
    answer(json(queueBody([row()])));
    await settle();
    expect(state().jobs).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts again after a stop, as React's development mode does", async () => {
    const { server, store, state } = setup();
    server.answerQueue([row()]);
    store.start();
    store.stop();
    store.start();
    await settle();
    expect(state().jobs).toHaveLength(1);
    expect(server.reads()).toBe(2);
    store.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a backend older than the line", () => {
  const notFound = () => json({ detail: "Not found" }, 404);

  it("hides the queue, with no toast and no sign-out", async () => {
    const { server, store, state, toasts, deps } = setup();
    server.setQueue(notFound);
    store.start();
    await settle();
    expect(state()).toMatchObject({ supported: false, loading: false, failed: false, jobs: [] });
    expect(toasts).toEqual([]);
    expect(deps.onUnauthorized).not.toHaveBeenCalled();
    store.stop();
  });

  it("asks again every 5 minutes and no sooner, not even on coming back to the tab", async () => {
    const { server, store } = setup();
    server.setQueue(notFound);
    store.start();
    await settle();
    server.reads();
    store.wake();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(server.reads()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.reads()).toBe(1);
    store.stop();
  });

  it("notices an upgrade, without replaying what finished before it", async () => {
    const { server, store, state, toasts, deps } = setup();
    server.setQueue(notFound);
    store.start();
    await settle();
    server.answerQueue([row({ status: "DONE" })]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(state().supported).toBe(true);
    expect(state().jobs).toHaveLength(1);
    expect(toasts).toEqual([]);
    expect(state().finishedVersion).toBe(0);
    expect(deps.onCompleted).not.toHaveBeenCalled();
    store.stop();
  });
});

describe("when a read fails", () => {
  it("passes a 401 on, says nothing else about it, and keeps trying", async () => {
    const { server, store, state, toasts, deps } = setup();
    server.setQueue(() => json({ detail: "Unauthorized" }, 401));
    store.start();
    await settle();
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual([]);
    expect(state().failed).toBe(false);
    expect(state().supported).toBe(true);
    // Nothing's known yet, so a link into the dialog waits to see whether the session is alive.
    expect(state().loading).toBe(true);
    server.reads();
    await vi.advanceTimersByTimeAsync(8000);
    expect(server.reads()).toBe(1);
    store.stop();
  });

  it("keeps what it had on anything else, and recovers", async () => {
    const { server, store, state, toasts, deps } = setup();
    server.answerQueue([row()]);
    store.start();
    await settle();
    server.setQueue(() => json({ detail: "Broken" }, 500));
    await vi.advanceTimersByTimeAsync(1500);
    expect(state().failed).toBe(true);
    expect(state().jobs).toHaveLength(1);
    expect(toasts).toEqual([]);
    expect(deps.onUnauthorized).not.toHaveBeenCalled();
    server.setQueue(() => {
      throw new TypeError("Failed to fetch");
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(state().jobs).toHaveLength(1);
    server.answerQueue([row()]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(state().failed).toBe(false);
    store.stop();
  });
});

describe("when a job finishes", () => {
  it("doesn't replay anything on the first read", async () => {
    const { server, store, state, toasts, deps } = setup();
    server.answerQueue([row({ status: "DONE" })]);
    store.start();
    await settle();
    expect(toasts).toEqual([]);
    expect(state().finishedVersion).toBe(0);
    expect(state().flash).toBe(false);
    expect(deps.onCompleted).not.toHaveBeenCalled();
    store.stop();
  });

  it("raises one toast, flashes for a few seconds and tells the app, all once", async () => {
    const { server, store, state, toasts, deps } = setup();
    server.answerQueue([row()]);
    store.start();
    await settle();
    server.answerQueue([row({ status: "DONE", imported: 3 })]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(state().finishedVersion).toBe(1);
    expect(deps.onCompleted).toHaveBeenCalledTimes(1);
    expect(state().flash).toBe(true);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ severity: "success", autoHideMs: 8000 });
    expect(toasts[0].action?.label).toBe("importQueue.toast.open");

    await vi.advanceTimersByTimeAsync(4499);
    expect(state().flash).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(state().flash).toBe(false);

    await vi.advanceTimersByTimeAsync(16_000);
    expect(toasts).toHaveLength(1);
    expect(state().finishedVersion).toBe(1);
    store.stop();
  });

  it("counts by the server's total when more finished than the list holds", async () => {
    const { server, store, toasts, deps } = setup();
    const rows = (status: string) => Array.from({ length: 50 }, (_, n) => row({ id: `j${n}`, status }));
    server.answerQueue(rows("RUNNING"), { finished_total: 100 });
    store.start();
    await settle();
    server.answerQueue(rows("DONE"), { finished_total: 160 });
    await vi.advanceTimersByTimeAsync(1500);
    expect(deps.onCompleted).toHaveBeenCalledTimes(1);
    expect(toasts[0].message).toBe('importQueue.toast.finishedMany {"count":60}');
    store.stop();
  });

  it("refreshes for a sync job too, without a toast", async () => {
    const { server, store, state, toasts, deps } = setup();
    server.answerQueue([row({ collection_sync_id: "c" })]);
    store.start();
    await settle();
    server.answerQueue([row({ collection_sync_id: "c", status: "DONE" })]);
    // A sync alone doesn't make the poll fast.
    await vi.advanceTimersByTimeAsync(8000);
    expect(state().finishedVersion).toBe(1);
    expect(deps.onCompleted).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual([]);
    store.stop();
  });

  it("fires nothing when a job is put on hold", async () => {
    const { server, store, state, toasts, deps } = setup();
    server.answerQueue([row()]);
    store.start();
    await settle();
    server.answerQueue([row({ status: "PAUSED" })]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(state().finishedVersion).toBe(0);
    expect(state().flash).toBe(false);
    expect(toasts).toEqual([]);
    expect(deps.onCompleted).not.toHaveBeenCalled();
    store.stop();
  });

  it("makes one toast of two jobs ending together", async () => {
    const { server, store, toasts } = setup();
    server.answerQueue([row(), row({ id: "b", status: "QUEUED", position: 1 })]);
    store.start();
    await settle();
    server.answerQueue([row({ status: "DONE" }), row({ id: "b", status: "DONE" })]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain("finishedMany");
    store.stop();
  });

  it("opens a finished model from the toast, closing the dialog", async () => {
    const { server, store, state, toasts, deps } = setup();
    server.answerQueue([row({ single: true })]);
    store.start();
    await settle();
    store.actions.open("run");
    server.answerQueue([row({ single: true, status: "DONE", outcome: "created", result_print_id: "p1" })]);
    await vi.advanceTimersByTimeAsync(1500);
    toasts[0].action?.onClick();
    expect(deps.navigate).toHaveBeenCalledWith("/models/p1");
    expect(state().dialog.open).toBe(false);
    store.stop();
  });

  it("opens Needs attention from a failure's toast", async () => {
    const { server, store, state, toasts, deps } = setup();
    server.answerQueue([row()]);
    store.start();
    await settle();
    server.answerQueue([row({ status: "ERROR", attention: true })]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(toasts[0].severity).toBe("error");
    toasts[0].action?.onClick();
    expect(state().dialog).toMatchObject({ open: true, section: "att", scope: "mine" });
    expect(deps.navigate).not.toHaveBeenCalled();
    store.stop();
  });

  it("has no button when there's nothing to open", async () => {
    const { server, store, toasts } = setup();
    server.answerQueue([row()]);
    store.start();
    await settle();
    server.answerQueue([row({ status: "DONE", imported: 1 })]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(toasts[0].action).toBeUndefined();
    expect(toasts[0].autoHideMs).toBeUndefined();
    store.stop();
  });
});

describe("the dialog", () => {
  it("opens on what the indicator is showing, when not told where", async () => {
    const { server, store, state } = setup();
    server.answerQueue([row({ status: "ERROR", attention: true })]);
    store.start();
    await settle();
    store.actions.open();
    expect(state().dialog).toMatchObject({ open: true, section: "att", scope: "mine", person: null });
    store.stop();
  });

  it("keeps a member to their own imports", () => {
    const { store, state } = setup();
    store.actions.open("wait", "everyone");
    expect(state().dialog.scope).toBe("mine");
    store.actions.setScope("everyone");
    expect(state().dialog.scope).toBe("mine");
  });

  it("changes section and person", () => {
    const { store, state } = setup({ isAdmin: true });
    store.actions.open("wait", "everyone");
    store.actions.setSection("done");
    store.actions.setPerson("u1");
    expect(state().dialog).toMatchObject({ section: "done", person: "u1" });
    store.actions.open("run");
    expect(state().dialog).toMatchObject({ section: "run", person: null, scope: "mine" });
  });
});

describe("everyone's list", () => {
  const ADMIN_LIST = "GET /api/admin/import-queue?queue=1";
  const adminReads = (calls: string[]) => calls.filter((call) => call === ADMIN_LIST).length;

  it("is read only while it's on screen", async () => {
    const { server, store, state } = setup({ isAdmin: true });
    server.routes.set(ADMIN_LIST, () => json({ jobs: [row({ status: "QUEUED", position: 1 })], bulk: {} }));
    store.start();
    await settle();
    expect(adminReads(server.calls)).toBe(0);

    store.actions.open("wait", "everyone");
    await settle();
    expect(adminReads(server.calls)).toBe(1);
    expect(state().everyone).toMatchObject({ loading: false, failed: false, olderBackend: false });
    expect(state().everyone.jobs).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1500);
    expect(adminReads(server.calls)).toBe(2);

    store.actions.setScope("mine");
    server.calls.length = 0;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(adminReads(server.calls)).toBe(0);

    store.actions.setScope("everyone");
    await settle();
    expect(adminReads(server.calls)).toBe(1);

    store.actions.close();
    server.calls.length = 0;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(adminReads(server.calls)).toBe(0);
    store.stop();
  });

  it("is never read for a member", async () => {
    const { server, store } = setup();
    store.start();
    store.actions.open("wait", "everyone");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(adminReads(server.calls)).toBe(0);
    store.stop();
  });

  it("still works on a backend older than the line, deriving what each row allows", async () => {
    const { server, store, state } = setup({ isAdmin: true });
    server.setQueue(() => json({ detail: "Not found" }, 404));
    server.routes.set(ADMIN_LIST, () =>
      json({
        jobs: [
          {
            id: "old",
            type: "LINKS",
            status: "PAUSED",
            source_url: "https://example.com/a",
            pending_count: 2,
            running_count: 0,
            failed_items_count: 0,
            runner_live: false,
            updated_at: new Date(NOW).toISOString(),
            created_at: new Date(NOW).toISOString(),
            owner: { id: "u1", display_name: "Mia", email: "m@e" },
          },
        ],
        bulk: { running: false, currentJobId: null, remaining: 0 },
      }),
    );
    store.start();
    await settle();
    store.actions.open("wait", "everyone");
    await settle();
    expect(state().supported).toBe(false);
    expect(state().everyone.olderBackend).toBe(true);
    expect(state().everyone.jobs[0]).toMatchObject({ can_start: true, can_delete: true, owner: { id: "u1" } });
    store.stop();
  });

  it("shows a failed read without losing what it had", async () => {
    const { server, store, state } = setup({ isAdmin: true });
    server.routes.set(ADMIN_LIST, () => json({ jobs: [row({ status: "QUEUED" })] }));
    store.start();
    store.actions.open("wait", "everyone");
    await settle();
    server.routes.set(ADMIN_LIST, () => json({ detail: "Broken" }, 500));
    await vi.advanceTimersByTimeAsync(1500);
    expect(state().everyone.failed).toBe(true);
    expect(state().everyone.jobs).toHaveLength(1);
    store.stop();
  });

  it("acts through the admin routes, and in bulk for the person picked", async () => {
    const { server, store } = setup({ isAdmin: true });
    server.routes.set(ADMIN_LIST, () => json({ jobs: [] }));
    for (const route of [
      "POST /api/admin/import-queue/jobs/j/start",
      "POST /api/admin/import-queue/jobs/j/retry",
      "POST /api/admin/import-queue/jobs/j/pause",
      "DELETE /api/admin/import-queue/jobs/j",
      "DELETE /api/admin/import-queue/items/i",
      "POST /api/admin/import-queue/start-all?queue=1&user_id=u1",
      "POST /api/admin/import-queue/retry-failed?queue=1&user_id=u1",
      "POST /api/admin/import-queue/pause-all?queue=1&user_id=u1",
      "POST /api/admin/import-queue/clear-finished?queue=1&user_id=u1",
    ]) {
      server.routes.set(route, () => json({ ok: true, queued: 1, paused: 1, deleted: 1 }));
    }
    store.start();
    store.actions.open("wait", "everyone");
    store.actions.setPerson("u1");
    await settle();
    server.calls.length = 0;

    const { actions } = store;
    await actions.startJob("j");
    await actions.retryJob("j");
    await actions.pauseJob("j");
    await actions.deleteJob("j");
    await actions.removeLink("i");
    await actions.startAll();
    await actions.retryAll();
    await actions.pauseAll();
    await actions.clearFinished();
    const made = server.calls.filter((call) => !call.startsWith("GET"));
    expect(made).toEqual([
      "POST /api/admin/import-queue/jobs/j/start",
      "POST /api/admin/import-queue/jobs/j/retry",
      "POST /api/admin/import-queue/jobs/j/pause",
      "DELETE /api/admin/import-queue/jobs/j",
      "DELETE /api/admin/import-queue/items/i",
      "POST /api/admin/import-queue/start-all?queue=1&user_id=u1",
      "POST /api/admin/import-queue/retry-failed?queue=1&user_id=u1",
      "POST /api/admin/import-queue/pause-all?queue=1&user_id=u1",
      "POST /api/admin/import-queue/clear-finished?queue=1&user_id=u1",
    ]);
    store.stop();
  });

  it("reads how many finished in all, and leaves it at nothing on a backend that doesn't say", async () => {
    const { server, store, state } = setup({ isAdmin: true });
    server.routes.set(ADMIN_LIST, () => json({ jobs: [], finished_total: 12, finished_by_owner: { u1: 7 } }));
    store.start();
    store.actions.open("done", "everyone");
    await settle();
    expect(state().everyone).toMatchObject({ finishedTotal: 12, finishedByOwner: { u1: 7 } });

    server.routes.set(ADMIN_LIST, () => json({ jobs: [] }));
    await vi.advanceTimersByTimeAsync(8000);
    expect(state().everyone).toMatchObject({ finishedTotal: 0, finishedByOwner: {} });
    store.stop();
  });

  it("clears for the person it was clicked for, who may have gone from the list by the confirmation", async () => {
    const { server, store } = setup({ isAdmin: true });
    server.routes.set(ADMIN_LIST, () => json({ jobs: [] }));
    server.routes.set("POST /api/admin/import-queue/clear-finished?queue=1&user_id=u1", () => json({ deleted: 1 }));
    store.start();
    store.actions.open("done", "everyone");
    store.actions.setPerson("u1");
    await settle();
    server.calls.length = 0;

    store.actions.setPerson(null);
    await store.actions.clearFinished("u1");
    expect(server.calls.filter((call) => !call.startsWith("GET"))).toEqual([
      "POST /api/admin/import-queue/clear-finished?queue=1&user_id=u1",
    ]);
    store.stop();
  });

  it("clears everyone's when told so, with someone picked or not", async () => {
    const { server, store } = setup({ isAdmin: true });
    server.routes.set(ADMIN_LIST, () => json({ jobs: [] }));
    server.routes.set("POST /api/admin/import-queue/clear-finished?queue=1", () => json({ deleted: 1 }));
    store.start();
    store.actions.open("done", "everyone");
    store.actions.setPerson("u1");
    await settle();
    server.calls.length = 0;

    await store.actions.clearFinished(null);
    expect(server.calls.filter((call) => !call.startsWith("GET"))).toEqual([
      "POST /api/admin/import-queue/clear-finished?queue=1",
    ]);
    store.stop();
  });

  it("loads a job's links from wherever it's listed", async () => {
    const { server, store } = setup({ isAdmin: true });
    server.routes.set(ADMIN_LIST, () => json({ jobs: [] }));
    server.routes.set("GET /api/import/jobs/j/items", () => json([{ id: "own" }]));
    server.routes.set("GET /api/admin/import-queue/jobs/j/items", () => json([{ id: "any" }]));
    await expect(store.actions.loadLinks("j")).resolves.toEqual([{ id: "own" }]);
    store.actions.open("wait", "everyone");
    await expect(store.actions.loadLinks("j")).resolves.toEqual([{ id: "any" }]);
  });
});

describe("actions", () => {
  it("call the owner's routes, and read the queue again after each", async () => {
    const { server, store, toasts } = setup();
    for (const route of [
      "POST /api/import/queue/jobs/j/start",
      "POST /api/import/queue/jobs/j/retry",
      "POST /api/import/queue/jobs/j/pause",
      "DELETE /api/import/queue/jobs/j",
      "DELETE /api/import/queue/items/i",
    ]) {
      server.routes.set(route, () => json({ ok: true }));
    }
    store.start();
    await settle();
    const { actions } = store;
    for (const act of [
      () => actions.startJob("j"),
      () => actions.retryJob("j"),
      () => actions.pauseJob("j"),
      () => actions.deleteJob("j"),
      () => actions.removeLink("i"),
    ]) {
      server.reads();
      await act();
      expect(server.reads()).toBe(1);
    }
    // None of these gets a toast: the card itself changes.
    expect(toasts).toEqual([]);
    store.stop();
  });

  it("show the server's reason for a refusal, and read again all the same", async () => {
    const { server, store, toasts } = setup();
    server.routes.set("POST /api/import/queue/jobs/j/start", () => json({ detail: "Still finishing" }, 409));
    store.start();
    await settle();
    server.reads();
    await expect(store.actions.startJob("j")).resolves.toBeNull();
    expect(toasts).toEqual([{ message: "Still finishing", severity: "error" }]);
    expect(server.reads()).toBe(1);
    store.stop();
  });

  it("pass a 401 on without a toast", async () => {
    const { server, store, toasts, deps } = setup();
    server.routes.set("POST /api/import/queue/start-all", () => json({}, 401));
    store.start();
    await settle();
    await store.actions.startAll();
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual([]);
    store.stop();
  });

  it("report what the bulk ones did, except Pause all", async () => {
    const { server, store, toasts } = setup();
    server.routes.set("POST /api/import/queue/start-all", () => json({ queued: 2 }, 202));
    server.routes.set("POST /api/import/queue/retry-failed", () => json({ queued: 3 }, 202));
    server.routes.set("POST /api/import/queue/pause-all", () => json({ paused: 1 }));
    server.routes.set("POST /api/import/queue/clear-finished", () => json({ deleted: 4 }));
    store.start();
    await settle();
    await store.actions.startAll();
    await store.actions.retryAll();
    await store.actions.pauseAll();
    await store.actions.clearFinished();
    expect(toasts.map((toast) => toast.message)).toEqual([
      'importQueue.toast.startedAll {"count":2}',
      'importQueue.toast.retriedAll {"count":3}',
      'importQueue.toast.cleared {"count":4}',
    ]);
    store.stop();
  });

  it("say nothing when a bulk action found nothing to do", async () => {
    const { server, store, toasts } = setup();
    server.routes.set("POST /api/import/queue/start-all", () => json({ queued: 0 }, 202));
    store.start();
    await settle();
    await store.actions.startAll();
    expect(toasts).toEqual([]);
    store.stop();
  });

  it("are marked busy meanwhile, and a second click does nothing", async () => {
    const { server, store, state } = setup();
    let answer: (response: Response) => void = () => undefined;
    server.routes.set("POST /api/import/queue/jobs/j/start", () => new Promise((resolve) => (answer = resolve)));
    store.start();
    await settle();
    server.calls.length = 0;
    const first = store.actions.startJob("j");
    await settle();
    expect(state().busy.has("j")).toBe(true);
    await expect(store.actions.startJob("j")).resolves.toBeNull();
    expect(server.calls.filter((call) => call.startsWith("POST"))).toHaveLength(1);
    answer(json({ job_id: "j", status: "QUEUED", position: 1, sync_waiting: false }, 202));
    await first;
    expect(state().busy.has("j")).toBe(false);
    store.stop();
  });

  it("pass on a 401 while loading links, and reject to the card", async () => {
    const { server, store, deps } = setup();
    server.routes.set("GET /api/import/jobs/j/items", () => json({}, 401));
    await expect(store.actions.loadLinks("j")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe("submits", () => {
  const payload = { url: "https://example.com/a" };

  it("say where the job landed and read the queue straight away", async () => {
    const { server, store, toasts } = setup();
    server.routes.set("POST /api/import?queue=1", () => json({ job_id: "j", status: "QUEUED", position: 2 }, 202));
    store.start();
    await settle();
    server.reads();
    await expect(store.actions.submitLink(payload)).resolves.toMatchObject({ kind: "job", position: 2 });
    expect(toasts.map((toast) => toast.message)).toEqual(['importQueue.toast.addedPlace {"n":2}']);
    await settle();
    expect(server.reads()).toBe(1);
    store.stop();
  });

  it("hand back a print or a wait for Grab, for the caller to announce", async () => {
    const { server, store, toasts } = setup();
    server.routes.set("POST /api/import?queue=1", () => json({ id: "p", name: "Dragon" }));
    server.routes.set("POST /api/import/makeronline/list?queue=1", () => json({ queued: 2, collection_id: "c" }));
    await expect(store.actions.submitLink(payload)).resolves.toMatchObject({ kind: "print" });
    await expect(store.actions.submitList("makeronline", { ...payload, model_ids: ["1"] })).resolves.toMatchObject({
      kind: "grab",
    });
    expect(toasts).toEqual([]);
  });

  it("go through each of their routes", async () => {
    const { server, store } = setup();
    const answer = () => json({ job_id: "j", status: "QUEUED", position: 1 }, 202);
    server.routes.set("POST /api/import/links?queue=1", answer);
    server.routes.set("POST /api/import/zip?queue=1", answer);
    server.routes.set("POST /api/import/printables/list?queue=1", answer);
    server.routes.set("POST /api/import/makerworld/profiles?queue=1", answer);
    const { actions } = store;
    await actions.submitLinks({ urls: ["https://example.com/a"] });
    await actions.submitZip({ ...payload, entries: ["a.stl"] });
    await actions.submitList("printables", { ...payload, model_ids: ["1"] });
    await actions.submitProfiles("makerworld", { ...payload, scope: "all" });
    expect(server.calls).toHaveLength(4);
  });

  it("reject to the caller, with no toast of their own", async () => {
    const { server, store, toasts } = setup();
    server.routes.set("POST /api/import?queue=1", () => json({ detail: "Turned off" }, 422));
    await expect(store.actions.submitLink(payload)).rejects.toThrow("Turned off");
    expect(toasts).toEqual([]);
  });
});

describe("the setting", () => {
  const SAVE = "PUT /api/import/queue/settings";

  it("reads from the queue", async () => {
    const { server, store, state } = setup();
    server.answerQueue([], { settings: { start_grab_links: true } });
    store.start();
    await settle();
    expect(state().startGrabLinks).toBe(true);
    store.stop();
  });

  it("shows straight away and isn't overwritten by a read during the save", async () => {
    const { server, store, state } = setup();
    let answer: (response: Response) => void = () => undefined;
    server.routes.set(SAVE, () => new Promise((resolve) => (answer = resolve)));
    store.start();
    await settle();
    const saving = store.actions.setStartGrabLinks(true);
    expect(state().startGrabLinks).toBe(true);
    await vi.advanceTimersByTimeAsync(8000);
    expect(state().startGrabLinks).toBe(true);
    server.answerQueue([], { settings: { start_grab_links: true } });
    answer(json({ start_grab_links: true }));
    await saving;
    await vi.advanceTimersByTimeAsync(8000);
    expect(state().startGrabLinks).toBe(true);
    store.stop();
  });

  describe("and a read that overlaps a save", () => {
    /** A store with a read of the queue on its way, whose answer `answerRead` gives. */
    async function readOnItsWay() {
      const context = setup();
      let answerRead: (body: Record<string, unknown>) => void = () => undefined;
      const { server, store } = context;
      store.start();
      await settle();
      server.setQueue(() => new Promise((resolve) => (answerRead = (body) => resolve(json(body)))));
      store.actions.refresh();
      await settle();
      return { ...context, answerRead: (body: Record<string, unknown>) => answerRead(body) };
    }
    const off = queueBody([], { settings: { start_grab_links: false } });
    const on = queueBody([], { settings: { start_grab_links: true } });

    it("doesn't snap back to what a read from before the save says, when the save answers first", async () => {
      const { server, store, state, answerRead } = await readOnItsWay();
      server.routes.set(SAVE, () => json({ start_grab_links: true }));
      await store.actions.setStartGrabLinks(true);

      answerRead(off);
      await settle();
      expect(state().startGrabLinks).toBe(true);

      // The next read began after the save, and has the last word.
      server.answerQueue([], { settings: { start_grab_links: false } });
      await vi.advanceTimersByTimeAsync(8000);
      expect(state().startGrabLinks).toBe(false);
      store.stop();
    });

    it("doesn't take a read begun during the save for one after it, even when it answers after it", async () => {
      const { server, store, state, answerRead } = await readOnItsWay();
      let answerSave: (response: Response) => void = () => undefined;
      server.routes.set(SAVE, () => new Promise((resolve) => (answerSave = resolve)));
      answerRead(off);
      await settle();

      const saving = store.actions.setStartGrabLinks(true);
      await settle();
      let answerNext: (body: Record<string, unknown>) => void = () => undefined;
      server.setQueue(() => new Promise((resolve) => (answerNext = (body) => resolve(json(body)))));
      store.actions.refresh();
      await settle();

      answerSave(json({ start_grab_links: true }));
      await saving;
      answerNext(off);
      await settle();
      expect(state().startGrabLinks).toBe(true);
      store.stop();
    });

    it("goes back to the value of the last read it could trust, when the save then fails", async () => {
      const { server, store, state, answerRead, toasts } = await readOnItsWay();
      server.routes.set(SAVE, () => json({ detail: "No" }, 500));
      await store.actions.setStartGrabLinks(true);
      expect(state().startGrabLinks).toBe(false);
      expect(toasts).toHaveLength(1);

      // It began before the save too, and says what's now been shown to be stale anyway.
      answerRead(on);
      await settle();
      expect(state().startGrabLinks).toBe(false);
      store.stop();
    });

    it("trusts a read begun once the save was over", async () => {
      const { server, store, state, answerRead } = await readOnItsWay();
      server.routes.set(SAVE, () => json({ start_grab_links: true }));
      answerRead(off);
      await settle();
      await store.actions.setStartGrabLinks(true);

      server.answerQueue([], { settings: { start_grab_links: false } });
      await store.actions.refresh();
      expect(state().startGrabLinks).toBe(false);
      store.stop();
    });
  });

  it("goes back and says why when the save fails", async () => {
    const { server, store, state, toasts } = setup();
    server.routes.set(SAVE, () => json({ detail: "No can do" }, 500));
    store.start();
    await settle();
    await store.actions.setStartGrabLinks(true);
    expect(state().startGrabLinks).toBe(false);
    expect(toasts).toEqual([{ message: "No can do", severity: "error" }]);
    store.stop();
  });

  it("keeps the last pick, saving one at a time", async () => {
    const { server, store, state } = setup();
    const answers: ((response: Response) => void)[] = [];
    server.routes.set(SAVE, () => new Promise((resolve) => answers.push(resolve)));
    const first = store.actions.setStartGrabLinks(true);
    const second = store.actions.setStartGrabLinks(false);
    await settle();
    expect(server.bodies).toEqual(['{"start_grab_links":true}']);
    answers[0](json({ start_grab_links: true }));
    await settle();
    expect(server.bodies).toEqual(['{"start_grab_links":true}', '{"start_grab_links":false}']);
    answers[1](json({ start_grab_links: false }));
    await Promise.all([first, second]);
    expect(state().startGrabLinks).toBe(false);
  });

  it("goes back to the last saved pick when only the latest save fails", async () => {
    const { server, store, state, toasts } = setup();
    let saves = 0;
    server.routes.set(SAVE, () => {
      saves += 1;
      return saves === 1 ? json({ start_grab_links: true }) : json({ detail: "No" }, 500);
    });
    await store.actions.setStartGrabLinks(true);
    await store.actions.setStartGrabLinks(false);
    expect(state().startGrabLinks).toBe(true);
    expect(toasts).toHaveLength(1);
  });
});
