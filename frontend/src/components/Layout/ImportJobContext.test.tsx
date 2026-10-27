import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ImportJob } from "../../api/imports";

// Exercise the provider's asynchronous callbacks with deterministic hook storage and timers.
const harness = vi.hoisted(() => ({
  state: [] as ImportJob[],
  setState: vi.fn<(update: (current: ImportJob[]) => ImportJob[]) => void>(),
  navigate: vi.fn<(path: string) => void>(),
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [harness.state, harness.setState],
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void | (() => void)) => harness.effects.push(effect),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => harness.navigate }));
vi.mock("../../api/imports", () => ({
  importsApi: {
    queueFromLink: vi.fn<typeof import("../../api/imports").importsApi.queueFromLink>(),
    getImportJob: vi.fn<typeof import("../../api/imports").importsApi.getImportJob>(),
    getImportTaskJob: vi.fn<typeof import("../../api/imports").importsApi.getImportTaskJob>(),
    getActiveImportJobs: vi.fn<typeof import("../../api/imports").importsApi.getActiveImportJobs>(),
    retryImportJob: vi.fn<typeof import("../../api/imports").importsApi.retryImportJob>(),
  },
}));
import { importsApi } from "../../api/imports";
import { ImportJobProvider } from "./ImportJobContext";

function job(id: string, status: ImportJob["status"] = "RUNNING"): ImportJob {
  return {
    id,
    status,
    type: "SINGLE",
    source_url: "https://example.com",
    source_label: null,
    provider: null,
    total: 1,
    processed: status === "DONE" ? 1 : 0,
    imported: 1,
    already_in_library: 0,
    failed_count: 0,
    error_message: null,
    result_collection_id: null,
    result_print_id: id,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  harness.effects.length = 0;
  harness.state = [];
  harness.setState.mockImplementation((update) => {
    harness.state = update(harness.state);
  });
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["completion", "error"])("keeps polling the second job after the first job's %s", async (outcome) => {
  const oldPoll = deferred<ImportJob>();
  vi.mocked(importsApi.queueFromLink)
    .mockResolvedValueOnce({ task_id: "a", job_id: "a" })
    .mockResolvedValueOnce({ task_id: "b", job_id: "b" });
  vi.mocked(importsApi.getImportJob).mockImplementation(async (id) => job(id));
  const actions = ImportJobProvider({ children: null }).props.value;
  await actions.startSingleImport({ url: "https://example.com/a" });
  vi.mocked(importsApi.getImportJob).mockReturnValueOnce(oldPoll.promise);
  await vi.advanceTimersByTimeAsync(1000);
  await actions.startSingleImport({ url: "https://example.com/b" });
  expect(harness.state.map((item) => item.id)).toEqual(["a", "b"]);
  if (outcome === "completion") oldPoll.resolve(job("a", "DONE"));
  else oldPoll.reject(new Error("old request failed"));
  await Promise.resolve();
  await Promise.resolve();
  expect(harness.state).toEqual([job("b")]);
  expect(harness.navigate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(importsApi.getImportJob).toHaveBeenLastCalledWith("b");
  actions.dismissJob("b");
});

it("merges recovered jobs with imports started during startup", async () => {
  const startup = deferred<ImportJob[]>();
  vi.mocked(importsApi.getActiveImportJobs).mockReturnValue(startup.promise);
  vi.mocked(importsApi.queueFromLink).mockResolvedValue({ task_id: "b", job_id: "b" });
  vi.mocked(importsApi.getImportJob).mockImplementation(async (id) => job(id));
  const provider = ImportJobProvider({ children: null });
  const cleanup = harness.effects[0]();
  await provider.props.value.startSingleImport({ url: "https://example.com/b" });
  startup.resolve([job("a"), job("b")]);
  await Promise.resolve();
  await Promise.resolve();
  expect(harness.state.map((item) => item.id)).toEqual(["b", "a"]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(importsApi.getImportJob).toHaveBeenCalledWith("a");
  expect(importsApi.getImportJob).toHaveBeenCalledWith("b");
  if (cleanup) cleanup();
});

it("completes an immediate task once without installing another poll", async () => {
  vi.mocked(importsApi.queueFromLink).mockResolvedValue({ task_id: "task" });
  vi.mocked(importsApi.getImportTaskJob).mockResolvedValue(job("task", "DONE"));
  const completed = vi.fn<() => void>();
  const actions = ImportJobProvider({ children: null, onJobCompleted: completed }).props.value;
  await actions.startSingleImport({ url: "https://printables.com/model/1" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(importsApi.getImportTaskJob).toHaveBeenCalledExactlyOnceWith("task", "https://printables.com/model/1");
  expect(completed).toHaveBeenCalledTimes(1);
  expect(harness.navigate).toHaveBeenCalledWith("/models/task");
});

it("retains failures for dismissal without completing them repeatedly", async () => {
  vi.mocked(importsApi.queueFromLink).mockResolvedValue({ task_id: "a", job_id: "a" });
  const failed = { ...job("a", "ERROR"), failed_count: 1 };
  vi.mocked(importsApi.getImportJob).mockResolvedValue(failed);
  const completed = vi.fn<() => void>();
  const actions = ImportJobProvider({ children: null, onJobCompleted: completed }).props.value;
  await actions.startSingleImport({ url: "https://makerworld.com/model/1" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(harness.state).toEqual([failed]);
  expect(completed).toHaveBeenCalledTimes(1);
  actions.dismissJob("a");
  expect(harness.state).toEqual([]);
});

it.each(["retry", "a"])("retries as %s without removing another running job", async (retryId) => {
  vi.mocked(importsApi.queueFromLink)
    .mockResolvedValueOnce({ task_id: "a", job_id: "a" })
    .mockResolvedValueOnce({ task_id: "b", job_id: "b" });
  vi.mocked(importsApi.getImportJob).mockImplementation(async (id) => job(id, id === "a" ? "ERROR" : "RUNNING"));
  vi.mocked(importsApi.retryImportJob).mockResolvedValue({ job_id: retryId });
  const actions = ImportJobProvider({ children: null }).props.value;
  await actions.startSingleImport({ url: "https://example.com/a" });
  await actions.startSingleImport({ url: "https://example.com/b" });
  await actions.retryJob("a");
  expect(harness.state.map((item) => item.id)).toEqual(["b", retryId]);
  actions.dismissJob(retryId);
  await vi.advanceTimersByTimeAsync(1000);
  expect(harness.state.map((item) => item.id)).toEqual(["b"]);
});
