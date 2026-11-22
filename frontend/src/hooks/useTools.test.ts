import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "../api/tools";

const mounted: { value: unknown; cleanup?: () => void } = { value: null };
const calls = vi.hoisted(() => ({
  list: vi.fn<() => Promise<{ access: { canUse: boolean; canCreate: boolean }; tools: Tool[] }>>(),
  status: vi.fn<() => Promise<{ access: { canUse: boolean; canCreate: boolean }; ids: string[] }>>(),
}));
vi.mock("../api/tools", () => ({ toolsApi: calls }));
vi.mock("react", () => ({
  useState: (initial: unknown) => [mounted.value ?? initial, (value: unknown) => (mounted.value = value)],
  useEffect: (effect: () => () => void) => {
    mounted.cleanup ??= effect();
  },
  useCallback: (callback: unknown) => callback,
}));

const tool = { id: "tool-1" } as Tool;
const access = { canUse: true, canCreate: false };
const state = { access, tools: [tool] };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { addEventListener: vi.fn<() => void>(), removeEventListener: vi.fn<() => void>() });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: vi.fn<() => void>(),
    removeEventListener: vi.fn<() => void>(),
  });
  calls.list.mockResolvedValue(state);
  calls.status.mockResolvedValue({ access, ids: [tool.id] });
});

afterEach(() => {
  mounted.cleanup?.();
  mounted.cleanup = undefined;
  mounted.value = null;
  calls.list.mockReset();
  calls.status.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount() {
  vi.resetModules();
  const hooks = await import("./useTools");
  hooks.useTools();
  await vi.advanceTimersByTimeAsync(0);
  expect(mounted.value).toEqual(state);
  return hooks;
}

describe("tool availability refresh", () => {
  it("reloads the list when an administrator disables a tool in another session", async () => {
    await mount();
    calls.status.mockResolvedValue({ access, ids: [] });
    calls.list.mockResolvedValue({ access, tools: [] });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mounted.value).toEqual({ access, tools: [] });
    expect(calls.list).toHaveBeenCalledTimes(2);
  });

  it("ignores an old status response after a newer local reload", async () => {
    const { reloadTools } = await mount();
    let finish!: (result: { access: typeof access; ids: string[] }) => void;
    calls.status.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await vi.advanceTimersByTimeAsync(30_000);
    calls.list.mockResolvedValue({ access, tools: [] });
    await reloadTools();
    finish({ access, ids: [tool.id] });
    await vi.advanceTimersByTimeAsync(0);
    expect(mounted.value).toEqual({ access, tools: [] });
    expect(calls.list).toHaveBeenCalledTimes(2);
  });

  it("loads the list again when the first load failed", async () => {
    vi.resetModules();
    calls.list.mockRejectedValueOnce(new Error("offline"));
    const hooks = await import("./useTools");
    hooks.useTools();
    await vi.advanceTimersByTimeAsync(0);
    expect(mounted.value).toEqual({ access: { canUse: false, canCreate: false }, tools: [] });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mounted.value).toEqual(state);
    expect(calls.list).toHaveBeenCalledTimes(2);
    expect(calls.status).not.toHaveBeenCalled();
  });

  it("loads the list again when a failed reload superseded the first load", async () => {
    vi.resetModules();
    let finish!: (result: typeof state) => void;
    calls.list.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const hooks = await import("./useTools");
    hooks.useTools();
    calls.list.mockRejectedValueOnce(new Error("offline"));
    await expect(hooks.reloadTools()).rejects.toThrow("offline");
    finish(state);
    await vi.advanceTimersByTimeAsync(0);
    calls.list.mockResolvedValue({ access, tools: [] });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mounted.value).toEqual({ access, tools: [] });
    expect(calls.list).toHaveBeenCalledTimes(3);
  });

  it("keeps the last list and retries when the availability check fails", async () => {
    await mount();
    calls.status.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ access, ids: [tool.id] });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mounted.value).toEqual(state);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.status).toHaveBeenCalledTimes(2);
    expect(calls.list).toHaveBeenCalledTimes(1);
  });
});
