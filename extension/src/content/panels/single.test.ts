import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_PAUSED } from "../../shared/messages";
import { MANIFESTS, PROVIDER_IDS, type ProviderId } from "../../providers/index.generated";

// The single-model panel, down to who it offers "Add to the queue" and what that then says.
const INSTANCE = "http://192.168.1.20:8080";
const URL_PRINTABLES = "https://www.printables.com/model/1-thing";
const QUEUE_BUTTON = 'data-action="queue"';

const rendered: string[] = [];
const actions = new Map<string, () => void>();
const messages: { type: string; payload: Record<string, unknown> }[] = [];
let answers: Record<string, unknown>;
const store: Record<string, unknown> = {};

vi.mock("../shell", () => ({
  onPanelAction: (name: string, handler: () => void) => actions.set(name, handler),
  panelQuery: () => null,
  panelQueryAll: () => [{ value: "a.stl" }],
  renderPanel: (html: string) => rendered.push(html),
  setPanelNote: () => undefined,
}));

vi.mock("./collectionPicker", () => ({
  collectionIdFor: async () => "col1",
  collectionPickerHtml: async () => "",
  readCollectionChoice: () => null,
  wireCollectionPicker: () => undefined,
}));

vi.mock("../pageModel", () => ({ pageImage: () => null, pageTitle: () => "Thing" }));

// What sites do of their own on a page: nothing here, so every provider goes the same way through the panel.
vi.mock("../../providers/content", () => ({
  CONTENT_MODULES: new Proxy({}, { get: () => ({}) }),
}));

vi.stubGlobal("fetch", async () => {
  throw new TypeError("Failed to fetch");
});

vi.stubGlobal("chrome", {
  runtime: {
    sendMessage: async ({ type, payload }: { type: string; payload: Record<string, unknown> }) => {
      messages.push({ type, payload });
      const answer = answers[type === "API_CALL" ? `${payload.method} ${payload.path}` : type];
      if (answer === undefined) return { ok: false, error: `Nothing answers ${type}` };
      return answer instanceof Error ? { ok: false, error: answer.message } : { ok: true, data: answer };
    },
  },
  storage: {
    local: {
      get: async () => ({ ...store }),
      set: async (values: Record<string, unknown>) => void Object.assign(store, values),
    },
  },
});

const { setContext } = await import("../context");
const { getState } = await import("../../background/config");
const { loadSingleItem } = await import("./single");

const last = () => rendered[rendered.length - 1];

function atProvider(provider: ProviderId, access: { canQueue: boolean; importQueue: boolean }): void {
  setContext({
    url: provider === "printables" ? URL_PRINTABLES : `https://example.test/${provider}`,
    instanceUrl: INSTANCE,
    classification: { kind: "single", provider, externalId: "1" },
    library: null,
    ...access,
  });
}

/** What GET_STATE gives this user on this instance, into the panel as content/index.ts passes it. */
async function panelFor(stored: { isAdmin: boolean; importQueue?: boolean }): Promise<string> {
  for (const key of Object.keys(store)) delete store[key];
  Object.assign(store, { instanceUrl: INSTANCE, email: "me@example.com", password: "secret", ...stored });
  const { canQueue, importQueue } = await getState();
  atProvider("printables", { canQueue, importQueue });
  await loadSingleItem();
  return last();
}

/** Clicks a panel button whose work is started rather than awaited, until the panel moves on from `before`. */
async function click(action: string): Promise<void> {
  const before = rendered.length;
  actions.get(action)!();
  await vi.waitFor(() => {
    if (rendered.length === before || last().includes("tg-status")) throw new Error("still working");
  });
}

/** Through the button, to what the panel then says, entities read back. */
async function addToQueue(access: { canQueue: boolean; importQueue: boolean }): Promise<string> {
  atProvider("printables", access);
  await loadSingleItem();
  await click("queue");
  return last().replaceAll("&#39;", "'").replaceAll("&gt;", ">");
}

describe("the single-model panel", () => {
  beforeEach(() => {
    rendered.length = 0;
    messages.length = 0;
    actions.clear();
    answers = {
      "POST /import/inspect": { title: "Thing", is_zip: false },
    };
  });

  describe("who's offered Add to the queue", () => {
    it("hides it from a member when the instance has no flag: today's behaviour", async () => {
      expect(await panelFor({ isAdmin: false })).not.toContain(QUEUE_BUTTON);
      expect(await panelFor({ isAdmin: false, importQueue: false })).not.toContain(QUEUE_BUTTON);
    });

    it("shows it to a member when the instance has the flag", async () => {
      expect(await panelFor({ isAdmin: false, importQueue: true })).toContain(QUEUE_BUTTON);
    });

    it("shows it to an admin either way", async () => {
      expect(await panelFor({ isAdmin: true })).toContain(QUEUE_BUTTON);
      expect(await panelFor({ isAdmin: true, importQueue: true })).toContain(QUEUE_BUTTON);
    });

    it("leaves the Import button there for everyone", async () => {
      expect(await panelFor({ isAdmin: false })).toContain('data-action="import"');
    });

    it.each(PROVIDER_IDS)("goes by the provider's own need for Grab on %s", async (provider) => {
      atProvider(provider, { canQueue: true, importQueue: true });
      await loadSingleItem();
      expect(last().includes(QUEUE_BUTTON)).toBe(MANIFESTS[provider].helpers.grab !== "required");

      atProvider(provider, { canQueue: false, importQueue: false });
      await loadSingleItem();
      expect(last()).not.toContain(QUEUE_BUTTON);
    });

    it("hides it where only Grab can get the files, flag or not", async () => {
      atProvider("makeronline", { canQueue: true, importQueue: true });
      await loadSingleItem();
      expect(last()).toContain('data-action="import"');
      expect(last()).not.toContain(QUEUE_BUTTON);
    });

    it("offers a member with the flag to park a link a CAPTCHA stopped, and one without nothing", async () => {
      answers.IMPORT_SINGLE = new Error("MakerWorld wants a CAPTCHA");

      atProvider("printables", { canQueue: true, importQueue: true });
      await loadSingleItem();
      await click("import");
      expect(last()).toContain("MakerWorld wants a CAPTCHA");
      expect(last()).toContain(QUEUE_BUTTON);

      atProvider("printables", { canQueue: false, importQueue: false });
      await loadSingleItem();
      await click("import");
      expect(last()).toContain("MakerWorld wants a CAPTCHA");
      expect(last()).not.toContain(QUEUE_BUTTON);
    });
  });

  describe("Import", () => {
    it("stays immediate, flag or not: it's never Add to the queue", async () => {
      answers.IMPORT_SINGLE = { id: "print1", import_outcome: "created" };
      atProvider("printables", { canQueue: true, importQueue: true });
      await loadSingleItem();
      await click("import");

      expect(messages.map(({ type }) => type)).toContain("IMPORT_SINGLE");
      expect(messages.map(({ type }) => type)).not.toContain("QUEUE_IMPORT");
      expect(last()).toContain("Imported!");
      expect(last()).toContain(`href="${INSTANCE}/models/print1"`);
    });

    it("says a job paused before it finished is paused, not that it failed or came in", async () => {
      answers.IMPORT_SINGLE = new Error(IMPORT_PAUSED);
      atProvider("printables", { canQueue: false, importQueue: false });
      await loadSingleItem();
      await click("import");

      expect(last()).toContain("Import paused");
      expect(last()).toContain(`href="${INSTANCE}/admin-queue"`);
      expect(last()).not.toContain("Imported!");
      expect(last()).not.toContain("Something went wrong");
    });
  });

  describe("Add to the queue", () => {
    const queued = { job_id: "job1", item_id: "item1", duplicate: false, waiting: 1 };

    it("sends the panel's choices and nothing is imported", async () => {
      answers.QUEUE_IMPORT = queued;
      await addToQueue({ canQueue: true, importQueue: true });

      expect(messages.find(({ type }) => type === "QUEUE_IMPORT")?.payload).toEqual({
        url: URL_PRINTABLES,
        collectionId: "col1",
        scope: "url",
        title: "Thing",
      });
      expect(messages.map(({ type }) => type)).not.toContain("IMPORT_SINGLE");
    });

    it("says today's words to an admin on an older instance, with its link", async () => {
      answers.QUEUE_IMPORT = queued;
      const html = await addToQueue({ canQueue: true, importQueue: false });

      expect(html).toContain("Paused until it's started from Administration > Import queue (1 link waiting).");
      expect(html).toContain(`href="${INSTANCE}/admin-queue"`);
    });

    it("says the new words to a member where the flag is set, with the same link", async () => {
      answers.QUEUE_IMPORT = { ...queued, started: false, position: null };
      const html = await addToQueue({ canQueue: true, importQueue: true });

      expect(html).toContain("On hold in your import queue until you start it (1 link waiting).");
      expect(html).toContain(`href="${INSTANCE}/admin-queue"`);
    });

    it("says it's in line when the user's setting put it there", async () => {
      answers.QUEUE_IMPORT = { ...queued, started: true, position: 4 };
      const html = await addToQueue({ canQueue: true, importQueue: true });

      expect(html).toContain("#4 in line in your import queue (1 link waiting).");
    });

    it("shows an instance's refusal in its own words", async () => {
      answers.QUEUE_IMPORT = new Error("Not found");
      const html = await addToQueue({ canQueue: true, importQueue: false });

      expect(html).toContain("Something went wrong");
      expect(html).toContain("Not found");
    });
  });
});
