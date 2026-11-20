import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolsView } from "../api/settings";
import { storeToken } from "../utils/auth";

// Keep one mounted hook's state and run its mount effect without a DOM.
const mounted: {
  value: ToolsView | null;
  cleanup?: () => void;
} = { value: null };

vi.mock("react", () => ({
  useState: () => [mounted.value, (value: ToolsView | null) => (mounted.value = value)],
  useEffect: (effect: () => () => void) => {
    mounted.cleanup ??= effect();
  },
}));

const view: ToolsView = { layout: "categories", sort: "newest", categories: {} };
const fetchMock = vi.fn<typeof fetch>();
const token = (sub: string, iat = 0) => `header.${btoa(JSON.stringify({ sub, iat }))}.signature`;
const response = () => new Response(JSON.stringify(view));

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: storage.get.bind(storage), setItem: storage.set.bind(storage) } });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => response());
  storeToken(token("first"));
});

afterEach(() => {
  mounted.cleanup?.();
  mounted.cleanup = undefined;
  mounted.value = null;
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

async function mount() {
  vi.resetModules();
  const { useToolsView } = await import("./useToolsView");
  useToolsView();
  await vi.waitFor(() => expect(mounted.value).toEqual(view));
  return useToolsView()[1];
}

describe("Tools view save ownership", () => {
  it("drops queued saves if storage changes accounts before the tab processes the event", async () => {
    const update = await mount();
    let finishSave!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (finishSave = resolve)));
    update({ sort: "name" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    update({ sortDirection: "asc" });
    storeToken(token("second"));
    finishSave(response());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a renewed token for the account that loaded the view", async () => {
    const update = await mount();
    const renewed = token("first", 1);
    update({ sort: "name" });
    storeToken(renewed);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const headers = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${renewed}`);
  });
});
