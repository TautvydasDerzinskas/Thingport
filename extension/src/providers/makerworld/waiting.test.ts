import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Grab's offer of the imports MakerWorld's CAPTCHA stopped on the instance, and its run through them once asked. The
// instance, the page's resolution, MakerWorld's puzzle and the cards are stand-ins.

const MODEL_A = "https://makerworld.com/en/models/100-a";
const MODEL_B = "https://makerworld.com/en/models/200-b#profileId-20";
const WAITING = [
  { id: "w1", url: MODEL_A, scope: "url", collection_id: null, attempts: 0, revision: 2 },
  { id: "w2", url: MODEL_B, scope: "url", collection_id: null, attempts: 0, revision: 0 },
];

const calls = vi.hoisted(() => ({
  api: [] as { method: string; path: string; body?: unknown }[],
  waiting: [] as unknown,
  callout: null as null | { title: string; primary: () => void; secondary: () => void },
  shown: [] as string[],
  resolve: (async () => null) as (url: string, instanceId: string | null) => Promise<unknown>,
  puzzle: { kind: "solved" } as Record<string, unknown>,
  puzzles: 0,
  store: {} as Record<string, unknown>,
  task: (() => "done") as (path: string) => string,
  onSleep: () => undefined as void,
}));

vi.mock("../../content/runtime", () => ({
  api: vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.api.push({ method, path, body });
    if (method === "GET" && path === "/import/makerworld/waiting") {
      if (calls.waiting instanceof Error) throw calls.waiting;
      return calls.waiting;
    }
    if (method === "POST" && path.endsWith("?async=1")) return { task_id: `task-${path}` };
    if (method === "GET" && path.startsWith("/import/tasks/")) return { status: calls.task(path) };
    return null;
  }),
  sleep: async () => calls.onSleep(),
  escapeHtml: (value: string) => value,
}));
vi.mock("../../content/providerSettings", () => ({ providerEnabled: async () => true }));
vi.mock("../../content/shell", () => ({
  sideHost: () => ({ querySelector: () => null, querySelectorAll: () => [] }),
  removeSideHost: () => undefined,
}));
vi.mock("../../content/callout", () => ({
  mountCallout: (
    _root: unknown,
    options: { title: string; primary: { onClick: () => void }; secondary: { onClick: () => void } },
  ) => {
    calls.callout = { title: options.title, primary: options.primary.onClick, secondary: options.secondary.onClick };
    return { remove: () => undefined };
  },
}));
const card = (name: string) => () => {
  calls.shown.push(name);
  return { remove: () => undefined, isConnected: true, classList: { add: () => undefined } };
};
vi.mock("../../content/overlays", () => ({
  overlaySwitcher: () => ({ show: () => undefined, current: () => null }),
  progressOverlay: card("progress"),
  spotlightOverlay: card("spotlight"),
  solvedOverlay: card("solved"),
  closedOverlay: card("closed"),
  doneOverlay: card("done"),
  PUZZLE_SOLVED_MS: 0,
}));
vi.mock("./downloadResolver", () => {
  class MakerworldCaptchaError extends Error {
    constructor(readonly puzzle: unknown) {
      super("captcha");
    }
  }
  return {
    MakerworldCaptchaError,
    resolveMakerworldViaApi: (url: string, instanceId: string | null) => calls.resolve(url, instanceId),
  };
});
vi.mock("./puzzle", () => ({
  solveMakerworldPuzzle: async () => {
    calls.puzzles++;
    return calls.puzzle;
  },
}));
vi.mock("../../shared/messages", () => ({
  send: async () => ({ ok: true, data: { instanceUrl: "http://nas.lan:3000" } }),
}));
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: calls.store[key] }),
      set: async (values: Record<string, unknown>) => void Object.assign(calls.store, values),
    },
  },
});

const { MakerworldCaptchaError } = await import("./downloadResolver");

/** A fresh tab: the module's once-per-tab memory starts over. */
async function freshOffer() {
  vi.resetModules();
  const { offerMakerworldWaiting } = await import("./waiting");
  await offerMakerworldWaiting();
}

const fileOf = (url: string, instanceId: string | null) => ({
  downloadUrl: `https://makerworld.bblmw.com/${encodeURIComponent(url)}.3mf`,
  instanceId,
  design: { id: 1 },
});

/** The run started by Solve, to its end. */
async function solve() {
  calls.callout!.primary();
  await vi.waitFor(() => expect(calls.shown.at(-1)).toMatch(/done|closed/));
}

describe("the imports waiting for MakerWorld's puzzle", () => {
  beforeEach(() => {
    calls.api = [];
    calls.waiting = WAITING;
    calls.callout = null;
    calls.shown = [];
    calls.puzzles = 0;
    calls.store = {};
    calls.puzzle = { kind: "solved", resolved: fileOf(MODEL_A, null) };
    calls.resolve = async (url, instanceId) => fileOf(url, instanceId);
    calls.task = () => "done";
    calls.onSleep = () => undefined;
  });
  afterEach(() => vi.restoreAllMocks());

  it("are offered by the icon, and nothing opens until asked", async () => {
    await freshOffer();
    expect(calls.callout?.title).toBe("2 imports wait for MakerWorld's puzzle");
    expect(calls.shown).toEqual([]);
    expect(calls.api.filter(({ method }) => method === "POST")).toEqual([]);
  });

  it("aren't offered again for a while once put off, nor by an instance that has none to list", async () => {
    await freshOffer();
    calls.callout!.secondary();
    await vi.waitFor(() => expect(calls.store.makerworldWaitingLaterUntil).toBeGreaterThan(Date.now()));
    calls.callout = null;
    await freshOffer();
    expect(calls.callout).toBeNull();

    calls.store = {};
    calls.waiting = new Error("404 Not Found");
    await freshOffer();
    expect(calls.callout).toBeNull();
  });

  it("open MakerWorld's puzzle for the first one refused, then bring each in with the file this page got", async () => {
    let refusals = 1;
    calls.resolve = async (url, instanceId) => {
      if (refusals-- > 0) throw new MakerworldCaptchaError({ refused: {} } as never);
      return fileOf(url, instanceId);
    };
    await freshOffer();
    await solve();

    expect(calls.puzzles).toBe(1);
    const posts = calls.api.filter(({ method }) => method === "POST");
    expect(posts).toEqual([
      {
        method: "POST",
        path: "/import/makerworld/waiting/w1?async=1",
        body: {
          resolved_download_url: fileOf(MODEL_A, null).downloadUrl,
          resolved_instance_id: null,
          makerworld_design: { id: 1 },
          revision: 2,
        },
      },
      {
        method: "POST",
        path: "/import/makerworld/waiting/w2?async=1",
        body: {
          resolved_download_url: fileOf(MODEL_B, "20").downloadUrl,
          resolved_instance_id: "20",
          makerworld_design: { id: 1 },
          revision: 0,
        },
      },
    ]);
    expect(calls.shown).toEqual(["progress", "spotlight", "solved", "progress", "done"]);
  });

  it("leave the rest waiting where the puzzle is closed", async () => {
    calls.resolve = async () => {
      throw new MakerworldCaptchaError({ refused: {} } as never);
    };
    calls.puzzle = { kind: "closed" };
    await freshOffer();
    await solve();

    expect(calls.api.filter(({ method }) => method === "POST")).toEqual([]);
    expect(calls.shown.at(-1)).toBe("closed");
  });

  it("tell the instance about one MakerWorld gave no file for, and go on with the rest", async () => {
    calls.resolve = async (url, instanceId) => (url === MODEL_A ? null : fileOf(url, instanceId));
    await freshOffer();
    await solve();

    const posts = calls.api.filter(({ method }) => method === "POST").map(({ path }) => path);
    expect(posts).toEqual(["/import/makerworld/waiting/w1/failed", "/import/makerworld/waiting/w2?async=1"]);
    // Said of the link as it was listed: a try at it doesn't count against it queued again since.
    expect(calls.api.find(({ path }) => path.endsWith("/failed"))?.body).toEqual({
      error: "MakerWorld gave no file for it",
      revision: 2,
    });
  });

  it("go on past an import the instance doesn't finish in time", async () => {
    calls.task = (path) => (path.includes("/w1?") ? "running" : "done");
    // Time passes only while Grab waits between its asks.
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    calls.onSleep = () => void (now += 60_000);
    await freshOffer();
    await solve();

    const asks = calls.api.filter(({ path }) => path.startsWith("/import/tasks/") && path.includes("/w1?"));
    expect(asks.length).toBeGreaterThan(1);
    expect(asks.length).toBeLessThanOrEqual(11);
    const posts = calls.api.filter(({ method }) => method === "POST").map(({ path }) => path);
    expect(posts).toEqual(["/import/makerworld/waiting/w1?async=1", "/import/makerworld/waiting/w2?async=1"]);
    expect(calls.shown.at(-1)).toBe("done");
  });
});
