import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ImportJob } from "../../api/imports";

// Exercise the provider's asynchronous callbacks with deterministic hook storage and timers.
const harness = vi.hoisted(() => ({
  setState: vi.fn<(job: ImportJob | null) => void>(),
  navigate: vi.fn<(path: string) => void>(),
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [null, harness.setState],
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
    getActiveImportJob: vi.fn<typeof import("../../api/imports").importsApi.getActiveImportJob>(),
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
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["completion", "error"])("ignores an old poll's %s after following a new job", async (outcome) => {
  const oldPoll = deferred<ImportJob>();
  vi.mocked(importsApi.queueFromLink)
    .mockResolvedValueOnce({ task_id: "a", job_id: "a" })
    .mockResolvedValueOnce({ task_id: "b", job_id: "b" });
  vi.mocked(importsApi.getImportJob).mockImplementation(async (id) => job(id));
  const provider = ImportJobProvider({ children: null });
  const actions = provider.props.value;
  await actions.startSingleImport({ url: "https://example.com/a" });
  vi.mocked(importsApi.getImportJob).mockReturnValueOnce(oldPoll.promise);
  await vi.advanceTimersByTimeAsync(1000);
  await actions.startSingleImport({ url: "https://example.com/b" });
  if (outcome === "completion") oldPoll.resolve(job("a", "DONE"));
  else oldPoll.reject(new Error("old request failed"));
  await Promise.resolve();
  await Promise.resolve();
  expect(harness.setState).toHaveBeenLastCalledWith(job("b"));
  expect(harness.navigate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(importsApi.getImportJob).toHaveBeenLastCalledWith("b");
  actions.dismissJob();
});

it("ignores a startup lookup after the user follows a job", async () => {
  const startup = deferred<ImportJob | null>();
  vi.mocked(importsApi.getActiveImportJob).mockReturnValue(startup.promise);
  vi.mocked(importsApi.queueFromLink).mockResolvedValue({ task_id: "b", job_id: "b" });
  vi.mocked(importsApi.getImportJob).mockResolvedValue(job("b"));
  const provider = ImportJobProvider({ children: null });
  const cleanup = harness.effects[0]();
  await provider.props.value.startSingleImport({ url: "https://example.com/b" });
  startup.resolve(job("a"));
  await Promise.resolve();
  await Promise.resolve();
  expect(harness.setState).toHaveBeenLastCalledWith(job("b"));
  if (cleanup) cleanup();
});
