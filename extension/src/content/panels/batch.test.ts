import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportContext } from "../context";

// The batch panel from Import selected to what it ends on, the instance answering through the background's API_CALL.
const INSTANCE = "http://192.168.1.20:8080";
const COLLECTION_URL = "https://www.printables.com/@someone/collections/42";
const START = "POST /import/printables-collection";

const rendered: string[] = [];
const actions = new Map<string, () => void>();
let answers: Record<string, unknown[]>;
const calls: string[] = [];
let mounted = true;

vi.mock("../shell", () => ({
  isPanelMounted: () => mounted,
  onPanelAction: (name: string, handler: () => void) => actions.set(name, handler),
  panelQuery: () => null,
  panelQueryAll: () => [{ value: "1" }, { value: "2" }],
  renderPanel: (html: string) => rendered.push(html),
}));

vi.mock("../runtime", async (original) => ({
  ...(await original<typeof import("../runtime")>()),
  sleep: async () => undefined,
}));

// Reads the list as its signed-in owner, in a page; the instance's own read is what's under test here.
vi.mock("../../providers/printables/content", () => ({
  printablesToken: async () => null,
  pushPrintablesNow: async () => undefined,
  readCollectionForPanel: async () => ({ entries: [] }),
}));

vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: async ({ type, payload }: { type: string; payload: { method: string; path: string } }) => {
      if (type !== "API_CALL") throw new Error(`Unexpected message: ${type}`);
      const route = `${payload.method} ${payload.path.split("?")[0]}`;
      calls.push(route);
      const queued = answers[route];
      if (!queued?.length) return { ok: false, error: "Not found" };
      const answer = queued.length > 1 ? queued.shift() : queued[0];
      return answer instanceof Error ? { ok: false, error: answer.message } : { ok: true, data: answer };
    },
  },
});

const { setContext } = await import("../context");
const { loadBatchEntries } = await import("./batch");

const last = () => rendered[rendered.length - 1];
const job = (status: string, extra: object = {}) => ({ status, processed: 3, imported: 3, total: 10, ...extra });

/** Clicks Import selected, until the panel settles on where it ends up. */
async function importSelected(statuses: unknown[]): Promise<void> {
  answers["GET /import/jobs/job1"] = statuses;
  await loadBatchEntries();
  actions.get("import")!();
  await vi.waitFor(() => {
    if (last().includes("tg-status")) throw new Error("still going");
  });
}

describe("the batch panel's import", () => {
  beforeEach(() => {
    rendered.length = 0;
    calls.length = 0;
    actions.clear();
    mounted = true;
    answers = {
      "POST /import/printables-collection/entries": [
        {
          title: "Things",
          entries: [
            { design_id: "1", title: "One" },
            { design_id: "2", title: "Two" },
          ],
        },
      ],
      "GET /collection-sync": [{ supported: false, sync: null }],
      [START]: [{ job_id: "job1" }],
    };
    setContext({
      url: COLLECTION_URL,
      instanceUrl: INSTANCE,
      classification: { kind: "batch", provider: "printables", type: "collection" },
      library: null,
      canQueue: false,
      importQueue: false,
    } satisfies ImportContext);
  });

  it("ends on success at DONE, as ever", async () => {
    await importSelected([job("RUNNING"), job("DONE", { imported: 10, processed: 10 })]);
    expect(last()).toContain("Imported!");
    expect(last()).toContain("Imported 10 of 10.");
    expect(last()).toContain(`href="${INSTANCE}/models"`);
  });

  it("links DONE to the one model it made, as ever", async () => {
    await importSelected([job("DONE", { imported: 1, total: 1, result_print_id: "print1" })]);
    expect(last()).toContain(`href="${INSTANCE}/models/print1"`);
  });

  it("ends on the error at ERROR, as ever", async () => {
    await importSelected([job("RUNNING"), job("ERROR", { error_message: "Printables said no" })]);
    expect(last()).toContain("Something went wrong");
    expect(last()).toContain("Printables said no");
    expect(last()).not.toContain("Imported!");
  });

  it("shows no success at PAUSED: it says how far it got, and where it carries on", async () => {
    await importSelected([job("RUNNING"), job("PAUSED")]);
    expect(last()).not.toContain("Imported!");
    expect(last()).toContain("Import paused");
    expect(last()).toContain("Imported 3 of 10 so far.");
    expect(last()).toContain("continues from the import queue");
    expect(last()).toContain(`href="${INSTANCE}/admin-queue"`);
    expect(last()).not.toContain("Something went wrong");
  });

  it("leaves out how far it got when it hasn't counted yet", async () => {
    await importSelected([job("PAUSED", { imported: 0, total: 0 })]);
    expect(last()).toContain("Import paused");
    expect(last()).not.toContain("0 of 0");
  });

  it("shows no success on a status Grab has never heard of", async () => {
    await importSelected([job("SOMETHING_NEW")]);
    expect(last()).not.toContain("Imported!");
    expect(last()).toContain("Import paused");
  });

  it("keeps polling through QUEUED, should that ever reach it", async () => {
    await importSelected([job("QUEUED", { processed: 0 }), job("RUNNING"), job("DONE", { imported: 10 })]);
    expect(rendered.some((html) => html.includes("Importing 0 of 10…"))).toBe(true);
    expect(rendered.filter((html) => html.includes("Imported!") || html.includes("paused"))).toHaveLength(1);
    expect(last()).toContain("Imported 10 of 10.");
    expect(calls.filter((route) => route === "GET /import/jobs/job1")).toHaveLength(3);
  });

  it("shows a busy older instance's 409 in its own words, and never polls", async () => {
    answers[START] = [new Error("An import is already in progress")];
    await importSelected([job("RUNNING")]);
    expect(last()).toContain("An import is already in progress");
    expect(calls).not.toContain("GET /import/jobs/job1");
  });

  it("shows a 404 in its own words too", async () => {
    delete answers[START];
    await importSelected([job("RUNNING")]);
    expect(last()).toContain("Something went wrong");
    expect(last()).toContain("Not found");
  });

  it("stops when the panel is gone: the job runs on without it", async () => {
    answers["GET /import/jobs/job1"] = [job("RUNNING")];
    await loadBatchEntries();
    mounted = false;
    actions.get("import")!();
    await vi.waitFor(() => expect(calls).toContain(START));
    await new Promise((resolve) => setTimeout(resolve));
    expect(calls).not.toContain("GET /import/jobs/job1");
    expect(last()).not.toContain("Imported!");
  });
});
