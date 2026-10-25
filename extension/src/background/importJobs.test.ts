import { beforeEach, expect, it, vi } from "vitest";
const apiCall = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ apiCall }));
vi.mock("./recentImports", () => ({ recordRecentImport: vi.fn() }));
import { importSingle } from "./importJobs";
beforeEach(() => apiCall.mockReset());
it("stops a paused single task without filing it into a collection", async () => {
  apiCall.mockResolvedValueOnce({ task_id: "single" }).mockResolvedValueOnce({
    status: "error",
    detail: "Import was paused; resume it from the import queue",
    http_status: 409,
  });
  await expect(importSingle({ url: "https://example.com/model.stl", collectionId: "collection" })).rejects.toThrow(
    "Import was paused",
  );
  expect(apiCall).toHaveBeenCalledTimes(2);
});
it("does not report a paused ZIP import as success", async () => {
  apiCall.mockResolvedValueOnce({ job_id: "zip" }).mockResolvedValueOnce({ status: "PAUSED" });
  await expect(
    importSingle({ url: "https://example.com/model.zip", entries: ["model.stl"], collectionId: "collection" }),
  ).rejects.toThrow("Import was paused");
  expect(apiCall).toHaveBeenCalledTimes(2);
});
