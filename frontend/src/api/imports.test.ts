import { afterEach, describe, expect, it, vi } from "vitest";
import { importsApi } from "./imports";

afterEach(() => vi.unstubAllGlobals());

function respond(body: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("single import progress", () => {
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
