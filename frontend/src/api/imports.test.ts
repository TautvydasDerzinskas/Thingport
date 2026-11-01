import { afterEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "./client";
import { adminQueueApi, importQueueApi, toSubmitAnswer } from "./imports";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(response: () => Response) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toSubmitAnswer", () => {
  it("reads a job in line", () => {
    expect(toSubmitAnswer({ job_id: "j", status: "QUEUED", position: 3 })).toEqual({
      kind: "job",
      job_id: "j",
      status: "QUEUED",
      position: 3,
    });
  });

  it("reads a job from a backend older than the line, which says only its id", () => {
    expect(toSubmitAnswer({ job_id: "j" })).toEqual({ kind: "job", job_id: "j", status: null, position: null });
  });

  it("reads models left waiting for Thingport Grab", () => {
    expect(toSubmitAnswer({ queued: 4, collection_id: "c" })).toEqual({ kind: "grab", queued: 4, collection_id: "c" });
    expect(toSubmitAnswer({ queued: 1 })).toEqual({ kind: "grab", queued: 1, collection_id: null });
  });

  it("reads a print imported before answering", () => {
    const print = { id: "p", name: "Dragon", import_outcome: "created" };
    expect(toSubmitAnswer(print)).toEqual({ kind: "print", print });
  });

  it("takes anything else for an import that was accepted", () => {
    const accepted = { kind: "job", job_id: null, status: null, position: null };
    expect(toSubmitAnswer({ task_id: "t" })).toEqual(accepted);
    expect(toSubmitAnswer({})).toEqual(accepted);
    expect(toSubmitAnswer(null)).toEqual(accepted);
  });
});

describe("submitting to the line", () => {
  const payload = { url: "https://example.com/a", category_id: "c" };

  it.each([
    ["a link", () => importQueueApi.submitLink(payload), "/api/import?queue=1"],
    ["links", () => importQueueApi.submitLinks({ urls: ["https://example.com/a"] }), "/api/import/links?queue=1"],
    ["a zip", () => importQueueApi.submitZip({ ...payload, entries: ["a.stl"] }), "/api/import/zip?queue=1"],
    [
      "a list",
      () => importQueueApi.submitList("printables", { ...payload, model_ids: ["1"], collection_title: "Props" }),
      "/api/import/printables/list?queue=1",
    ],
    [
      "profiles",
      () => importQueueApi.submitProfiles("makerworld", { ...payload, scope: "designer" }),
      "/api/import/makerworld/profiles?queue=1",
    ],
  ])("asks for the line when submitting %s", async (_name, submit, url) => {
    const fetchMock = stubFetch(() => json({ job_id: "j", status: "QUEUED", position: 1 }, 202));
    await expect(submit()).resolves.toEqual({ kind: "job", job_id: "j", status: "QUEUED", position: 1 });
    const [called, init] = fetchMock.mock.calls[0];
    expect(called).toBe(url);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject(url.includes("links") ? {} : payload);
  });

  it("hands a list's answer on when its models wait for Grab", async () => {
    stubFetch(() => json({ queued: 2, collection_id: "c" }, 200));
    await expect(importQueueApi.submitList("makeronline", { ...payload, model_ids: ["1", "2"] })).resolves.toEqual({
      kind: "grab",
      queued: 2,
      collection_id: "c",
    });
  });

  it("hands a print on from a backend that imported first", async () => {
    stubFetch(() => json({ id: "p", name: "Dragon" }));
    await expect(importQueueApi.submitLink(payload)).resolves.toMatchObject({ kind: "print", print: { id: "p" } });
  });

  it("rejects with the server's reason", async () => {
    stubFetch(() => json({ detail: "This site is turned off" }, 422));
    await expect(importQueueApi.submitLink(payload)).rejects.toThrow("This site is turned off");
  });

  it("tells a signed-out request apart", async () => {
    stubFetch(() => json({ detail: "Unauthorized" }, 401));
    await expect(importQueueApi.submitLink(payload)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("importQueueApi", () => {
  it("answers null when the backend has no line", async () => {
    stubFetch(() => json({ detail: "Not found" }, 404));
    await expect(importQueueApi.get()).resolves.toBeNull();
  });

  it("gives the queue", async () => {
    const queue = { jobs: [], finished_total: 0, line: { now: null, rows: [], length: 0 }, settings: {} };
    const fetchMock = stubFetch(() => json(queue));
    await expect(importQueueApi.get()).resolves.toEqual(queue);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/import/queue");
  });

  it("throws on anything else that goes wrong", async () => {
    stubFetch(() => json({ detail: "Broken" }, 500));
    await expect(importQueueApi.get()).rejects.toThrow("Broken");
    stubFetch(() => json({}, 401));
    await expect(importQueueApi.get()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("saves the setting", async () => {
    const fetchMock = stubFetch(() => json({ start_grab_links: true }));
    await importQueueApi.saveSettings({ start_grab_links: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/import/queue/settings");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ start_grab_links: true });
  });

  it.each([
    ["start", () => importQueueApi.start("a/b"), "POST", "/api/import/queue/jobs/a%2Fb/start"],
    ["retry", () => importQueueApi.retry("j"), "POST", "/api/import/queue/jobs/j/retry"],
    ["pause", () => importQueueApi.pause("j"), "POST", "/api/import/queue/jobs/j/pause"],
    ["remove", () => importQueueApi.remove("j"), "DELETE", "/api/import/queue/jobs/j"],
    ["removeLink", () => importQueueApi.removeLink("i"), "DELETE", "/api/import/queue/items/i"],
    ["startAll", () => importQueueApi.startAll(), "POST", "/api/import/queue/start-all"],
    ["retryFailed", () => importQueueApi.retryFailed(), "POST", "/api/import/queue/retry-failed"],
    ["pauseAll", () => importQueueApi.pauseAll(), "POST", "/api/import/queue/pause-all"],
    ["clearFinished", () => importQueueApi.clearFinished(), "POST", "/api/import/queue/clear-finished"],
  ])("%s calls its route", async (_name, call, method, url) => {
    const fetchMock = stubFetch(() => json({ ok: true }));
    await call();
    expect(fetchMock.mock.calls[0][0]).toBe(url);
    expect(fetchMock.mock.calls[0][1]?.method).toBe(method);
  });

  it("shows the server's reason for a refusal", async () => {
    stubFetch(() => json({ detail: "This import is still finishing its current link" }, 409));
    await expect(importQueueApi.start("j")).rejects.toThrow("still finishing");
  });
});

describe("adminQueueApi", () => {
  it("reads every user's jobs with their real status", async () => {
    const fetchMock = stubFetch(() => json({ jobs: [], bulk: {} }));
    await adminQueueApi.get();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/import-queue?queue=1");
  });

  it.each([
    ["links", () => adminQueueApi.links("j"), undefined, "/api/admin/import-queue/jobs/j/items"],
    ["start", () => adminQueueApi.start("j"), "POST", "/api/admin/import-queue/jobs/j/start"],
    ["retry", () => adminQueueApi.retry("j"), "POST", "/api/admin/import-queue/jobs/j/retry"],
    ["pause", () => adminQueueApi.pause("j"), "POST", "/api/admin/import-queue/jobs/j/pause"],
    ["remove", () => adminQueueApi.remove("j"), "DELETE", "/api/admin/import-queue/jobs/j"],
    ["removeLink", () => adminQueueApi.removeLink("i"), "DELETE", "/api/admin/import-queue/items/i"],
  ])("%s calls its route", async (_name, call, method, url) => {
    const fetchMock = stubFetch(() => json({ ok: true }));
    await call();
    expect(fetchMock.mock.calls[0][0]).toBe(url);
    expect(fetchMock.mock.calls[0][1]?.method).toBe(method);
  });

  it.each([
    ["startAll", adminQueueApi.startAll, "start-all"],
    ["retryFailed", adminQueueApi.retryFailed, "retry-failed"],
    ["pauseAll", adminQueueApi.pauseAll, "pause-all"],
    ["clearFinished", adminQueueApi.clearFinished, "clear-finished"],
  ])("%s asks for the new meaning, for one person when given", async (_name, call, route) => {
    const fetchMock = stubFetch(() => json({ queued: 0 }));
    await call();
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/admin/import-queue/${route}?queue=1`);
    await call("user 1");
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/admin/import-queue/${route}?queue=1&user_id=user+1`);
  });
});
