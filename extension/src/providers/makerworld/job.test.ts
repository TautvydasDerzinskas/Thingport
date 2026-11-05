import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MakerworldJob, Reply } from "../../shared/messages";
import { makerworldModelUrl } from "./urls.generated";

// The guided collection import, step by step: what each page visit imports and where the run goes next. The page and
// the instance are stand-ins; a step is what the page asks for once its countdown ends.
const TAB = 7;
const ORIGIN = "https://makerworld.com/en/collections/5";
const MODEL_A = makerworldModelUrl("100");
const MODEL_B = makerworldModelUrl("200");
const profileOf = (model: string, instanceId: string) => `${model}#profileId-${instanceId}`;

const store: Record<string, unknown> = {};
const sent: { type: string; payload: unknown }[] = [];
const visited: string[] = [];
/** What the page answers, by message. */
let page: Record<string, (payload: { instanceId?: string }) => Reply<unknown>>;
/** Profile links the library already holds. */
const held = new Set<string>();
const imported: { url: string; resolved: unknown }[] = [];

vi.mock("../../background/api", () => ({
  apiCall: async (method: string, path: string) => {
    if (method === "GET" && path.startsWith("/import/status?url=")) {
      const url = decodeURIComponent(path.slice("/import/status?url=".length));
      return held.has(url) ? { already_imported: true, print_id: "existing" } : { already_imported: false };
    }
    return null;
  },
}));

vi.mock("../../background/importJobs", () => ({
  importSingle: async ({ url, resolved }: { url: string; resolved: unknown }) => {
    imported.push({ url, resolved });
    return { id: `print-${url.match(/models\/(\d+)/)![1]}` };
  },
}));

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (values: Record<string, unknown>) => void Object.assign(store, values),
      remove: async (key: string) => void delete store[key],
    },
  },
  tabs: {
    update: async (_tabId: number, { url }: { url: string }) => void visited.push(url),
    reload: async () => undefined,
    sendMessage: async (_tabId: number, { type, payload }: { type: string; payload: { instanceId?: string } }) => {
      sent.push({ type, payload });
      return page[type]?.(payload) ?? { ok: true, data: null };
    },
  },
});

const { advanceJob, forceAdvanceJob, resumeJob, startJob } = await import("./job");

const job = () => store.makerworldCollectionJob as MakerworldJob | undefined;
const importedUrls = () => imported.map(({ url }) => url);

/** Started, and on the first model's page: from there on `visited` holds where the run goes next. */
async function start(urls: string[], profileScope: MakerworldJob["profileScope"], stepDelayMs = 30_000) {
  await startJob(TAB, { urls, collectionId: "col1", originalUrl: ORIGIN, stepDelayMs, profileScope: profileScope! });
  expect(visited).toEqual([urls[0]]);
  visited.length = 0;
}

/** The page's countdown ran out and it asked for its step. */
async function step(): Promise<void> {
  store.makerworldCollectionJob = { ...job()!, startAt: 0 };
  await advanceJob(TAB);
}

describe("the guided MakerWorld collection import", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    sent.length = 0;
    visited.length = 0;
    imported.length = 0;
    held.clear();
    page = {
      READ_MAKERWORLD_PROFILES: () => ({ ok: true, data: ["10", "11", "12"] }),
      RESOLVE_MAKERWORLD_PROFILE_DOWNLOAD: ({ instanceId }) => ({
        ok: true,
        data: { downloadUrl: `https://s3.example.com/${instanceId}.3mf`, instanceId: instanceId! },
      }),
      RESOLVE_MAKERWORLD_DOWNLOAD_URL: () => ({
        ok: true,
        data: { downloadUrl: "https://s3.example.com/page.3mf", instanceId: "10" },
      }),
    };
  });

  it("imports each model's own profile once when that's all that's wanted, as before", async () => {
    await start([MODEL_A, MODEL_B], "url");
    await step();

    expect(imported).toEqual([
      { url: MODEL_A, resolved: { downloadUrl: "https://s3.example.com/page.3mf", instanceId: "10" } },
    ]);
    expect(sent.map(({ type }) => type)).not.toContain("READ_MAKERWORLD_PROFILES");
    expect(visited).toEqual([MODEL_B]);
    expect(job()).toMatchObject({ index: 1, imported: 1, profiles: null });
  });

  it("brings a new model's profiles in one at a time, each after the wait, on the same page", async () => {
    await start([MODEL_A, MODEL_B], "designer");
    const before = Date.now();
    await step();

    expect(importedUrls()).toEqual([profileOf(MODEL_A, "10")]);
    expect(imported[0].resolved).toEqual({ downloadUrl: "https://s3.example.com/10.3mf", instanceId: "10" });
    expect(job()).toMatchObject({
      index: 0,
      imported: 0,
      awaitingLoad: true,
      profiles: { ids: ["11", "12"], done: 1 },
    });
    expect(job()!.startAt).toBeGreaterThanOrEqual(before + 30_000);
    expect(sent.map(({ type }) => type)).toContain("MAKERWORLD_JOB_UPDATED");
    expect(visited).toEqual([]);

    await step();
    await step();
    expect(importedUrls()).toEqual(["10", "11", "12"].map((id) => profileOf(MODEL_A, id)));
    expect(visited).toEqual([MODEL_B]);
    expect(job()).toMatchObject({ index: 1, imported: 1, profiles: null });
  });

  it("visits a model already in the library only for the profiles it lacks", async () => {
    held.add(profileOf(MODEL_A, "10"));
    held.add(profileOf(MODEL_A, "12"));
    await start([MODEL_A, MODEL_B], "all");
    await step();
    expect(importedUrls()).toEqual([profileOf(MODEL_A, "11")]);
    expect(visited).toEqual([MODEL_B]);

    held.add(profileOf(MODEL_B, "10"));
    held.add(profileOf(MODEL_B, "11"));
    held.add(profileOf(MODEL_B, "12"));
    await step();
    expect(importedUrls()).toEqual([profileOf(MODEL_A, "11")]);
    expect(sent.filter(({ type }) => type === "RESOLVE_MAKERWORLD_PROFILE_DOWNLOAD")).toHaveLength(1);
    expect(visited).toEqual([MODEL_B, ORIGIN]);
    expect(job()).toBeUndefined();
  });

  it("pauses on a CAPTCHA and picks up from the same profile once resumed", async () => {
    await start([MODEL_A], "designer");
    await step();
    const resolve = page.RESOLVE_MAKERWORLD_PROFILE_DOWNLOAD;
    page.RESOLVE_MAKERWORLD_PROFILE_DOWNLOAD = () => ({ ok: false, error: "MakerWorld is asking for a CAPTCHA" });
    await step();
    expect(job()).toMatchObject({ paused: true, profiles: { ids: ["11", "12"], done: 1 } });

    page.RESOLVE_MAKERWORLD_PROFILE_DOWNLOAD = resolve;
    await resumeJob(TAB);
    expect(visited).toEqual([MODEL_A]);
    await step();
    expect(importedUrls()).toEqual(["10", "11"].map((id) => profileOf(MODEL_A, id)));
    expect(job()).toMatchObject({ paused: false, profiles: { ids: ["12"], done: 2 } });
  });

  it("moves past a stuck profile on Import next, not past the whole model", async () => {
    await start([MODEL_A, MODEL_B], "designer");
    await step();
    await forceAdvanceJob(TAB);

    expect(job()).toMatchObject({ index: 0, profiles: { ids: ["12"], done: 2 } });
    expect(visited).toEqual([]);
  });

  it("brings the page's own profile where the page can't say which it has", async () => {
    page.READ_MAKERWORLD_PROFILES = () => ({ ok: true, data: null });
    await start([MODEL_A, MODEL_B], "designer");
    await step();

    expect(importedUrls()).toEqual([MODEL_A]);
    expect(visited).toEqual([MODEL_B]);
  });
});
