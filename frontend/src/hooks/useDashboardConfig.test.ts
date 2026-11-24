import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardConfig } from "../api/settings";

// The hook without a DOM: a state is its initial value, an effect runs straight away and a callback is the function.
vi.mock("react", () => ({
  useState: <T>(initial: T) => [initial, () => undefined],
  useEffect: (effect: () => void) => void effect(),
  useCallback: <T>(callback: T) => callback,
}));

const saved: DashboardConfig = {
  active: "t1",
  templates: [{ id: "t1", name: "Mine", preset: null, panels: [], layouts: { lg: [] } }],
} as unknown as DashboardConfig;

const updateDashboard = vi.fn<(config: DashboardConfig) => Promise<unknown>>();
vi.mock("../api/settings", () => ({
  settingsApi: {
    getDashboard: () => Promise.resolve({ config: saved }),
    updateDashboard: (config: DashboardConfig) => updateDashboard(config),
  },
}));
vi.mock("../utils/auth", () => ({ readUser: () => null }));
vi.mock("../pages/DashboardPage/templates", () => ({
  initialConfig: () => saved,
  offerNewPresets: (config: DashboardConfig) => config,
}));

const settle = () => vi.advanceTimersByTimeAsync(1000);

/** The hook once the saved dashboard has loaded, and a change to it that goes through the save. */
async function loaded() {
  const { onDashboardSaveFailed, useDashboardConfig } = await import("./useDashboardConfig");
  useDashboardConfig();
  await settle();
  const change = () => useDashboardConfig()!.update((config) => ({ ...config }));
  return { change, onDashboardSaveFailed };
}

describe("a dashboard change that can't be saved", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    updateDashboard.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is said once while saving keeps failing, and again after a save has gone through", async () => {
    const { change, onDashboardSaveFailed } = await loaded();
    const failed = vi.fn<() => void>();
    onDashboardSaveFailed(failed);

    updateDashboard.mockRejectedValue(new Error("400"));
    change();
    await settle();
    change();
    await settle();
    expect(updateDashboard).toHaveBeenCalledTimes(2);
    expect(failed).toHaveBeenCalledTimes(1);

    updateDashboard.mockResolvedValue({});
    change();
    await settle();
    updateDashboard.mockRejectedValue(new Error("400"));
    change();
    await settle();
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it("isn't said once nothing listens", async () => {
    const { change, onDashboardSaveFailed } = await loaded();
    const failed = vi.fn<() => void>();
    onDashboardSaveFailed(failed)();

    updateDashboard.mockRejectedValue(new Error("400"));
    change();
    await settle();
    expect(failed).not.toHaveBeenCalled();
  });
});
