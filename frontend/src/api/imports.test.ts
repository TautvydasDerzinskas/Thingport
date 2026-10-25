import { afterEach, describe, expect, it, vi } from "vitest";
import { importsApi } from "./imports";
import { UnauthorizedError } from "./client";

afterEach(() => vi.unstubAllGlobals());

function respond(body: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("single import progress", () => {
  it("preserves the synchronous model result and its queued 202 fallback", async () => {
    const payload = { url: "https://example.com/model" };
    respond({ id: "model", import_outcome: "created" });
    expect(await importsApi.fromLink(payload)).toMatchObject({ id: "model" });
    respond({ task_id: "queued", job_id: "queued", status: "QUEUED" }, 202);
    expect(await importsApi.fromLink(payload)).toEqual({ task_id: "queued", job_id: "queued", status: "QUEUED" });
  });

  it.each([{ task_id: "immediate" }, { task_id: "durable", job_id: "durable" }])(
    "preserves both asynchronous response contracts: %j",
    async (response) => {
      respond(response);
      expect(await importsApi.queueFromLink({ url: "https://example.com/model" })).toEqual(response);
    },
  );

  it.each([
    [{ status: "queued" }, { status: "QUEUED", processed: 0 }],
    [{ status: "running" }, { status: "RUNNING", processed: 0 }],
    [
      { status: "done", result: { id: "model" } },
      { status: "DONE", imported: 1, result_print_id: "model" },
    ],
    [
      { status: "done", result: { id: "model", import_outcome: "already_imported" } },
      { status: "DONE", imported: 0, already_in_library: 1 },
    ],
    [
      { status: "error", detail: "Expired cookie" },
      { status: "ERROR", failed_count: 1, error_message: "Expired cookie" },
    ],
  ])("adapts task progress %j for the progress bar", async (task, expected) => {
    const fetch = respond(task);
    expect(await importsApi.getImportTaskJob("task", "https://example.com/model")).toMatchObject(expected);
    expect(fetch.mock.calls[0][0]).toBe("/api/import/tasks/task");
  });
});

it("preserves explicitly supplied request cookies", async () => {
  const fetch = respond({ task_id: "immediate" });
  const payload = { url: "https://makerworld.com/en/models/12345", makerworld_cookie: "explicit-cookie" };
  await importsApi.queueFromLink(payload);
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual(payload);
});

describe("active import jobs", () => {
  it("loads all active jobs for recovery", async () => {
    const jobs = [
      { id: "first", status: "RUNNING" },
      { id: "second", status: "QUEUED" },
    ];
    const fetch = respond(jobs);
    expect(await importsApi.getActiveImportJobs()).toEqual(jobs);
    expect(fetch.mock.calls[0][0]).toBe("/api/import/jobs/active-list");
  });

  it("reports an authorization failure", async () => {
    respond({}, 401);
    await expect(importsApi.getActiveImportJobs()).rejects.toThrow(UnauthorizedError);
  });
});
