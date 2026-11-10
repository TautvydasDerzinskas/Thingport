import { beforeEach, describe, expect, it, vi } from "vitest";
import { IMPORT_PAUSED } from "../../shared/messages";
import { MANIFESTS, PROVIDER_IDS, type ProviderId } from "../../providers/index.generated";
import type { LibraryState } from "../context";

// The single-model panel, down to who it offers "Add to the queue" and what that then says.
const INSTANCE = "http://192.168.1.20:8080";
const URL_PRINTABLES = "https://www.printables.com/model/1-thing";
const QUEUE_BUTTON = 'data-action="queue"';

const rendered: string[] = [];
const actions = new Map<string, () => void>();
const messages: { type: string; payload: Record<string, unknown> }[] = [];
let answers: Record<string, unknown>;
let profileScope: string | null = null;
const store: Record<string, unknown> = {};

/** The profile picker's value as a browser would give it: a hidden field's, the option marked selected, or the first. */
function pickedProfiles(): { value: string } | null {
  const html = rendered[rendered.length - 1] ?? "";
  const hidden = html.match(/<input type="hidden" id="tg-profiles" value="([^"]+)"/);
  if (hidden) return { value: hidden[1] };
  const options = html.match(/<select id="tg-profiles"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? "";
  const option = options.match(/<option value="([^"]+)" selected>/) ?? options.match(/<option value="([^"]+)"/);
  return option ? { value: option[1] } : null;
}

vi.mock("../shell", () => ({
  onPanelAction: (name: string, handler: () => void) => actions.set(name, handler),
  panelQuery: (selector: string) =>
    selector === "#tg-profiles" ? (profileScope ? { value: profileScope } : pickedProfiles()) : null,
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

// What sites do of their own on a page: nothing, unless a test gives one something, so every provider goes the same
// way through the panel.
const contentModules: Record<string, Record<string, unknown>> = {};
vi.mock("../../providers/content", () => ({
  CONTENT_MODULES: new Proxy({}, { get: (_target, provider: string) => contentModules[provider] ?? {} }),
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

const asked = (path: string) => messages.some(({ type, payload }) => type === "API_CALL" && payload.path === path);

/** A MakerWorld design whose profiles are the page's own and `designer` more of the designer's. */
function withProfiles(designer: number): void {
  const ids = Array.from({ length: designer + 1 }, (_, index) => String(index + 1));
  contentModules.makerworld = {
    loadProfiles: async () => (scope: string) => (scope === "url" ? ids.slice(0, 1) : ids),
  };
}

function atProvider(
  provider: ProviderId,
  access: { canQueue: boolean; importQueue: boolean },
  library: LibraryState | null = null,
): void {
  setContext({
    url: provider === "printables" ? URL_PRINTABLES : `https://example.test/${provider}`,
    instanceUrl: INSTANCE,
    classification: { kind: "single", provider, externalId: "1" },
    library,
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
async function click(action: string, timeout = 1000): Promise<void> {
  const before = rendered.length;
  actions.get(action)!();
  await vi.waitFor(
    () => {
      if (rendered.length === before || last().includes("tg-status")) throw new Error("still working");
    },
    { timeout },
  );
}

/** Through the button, to what the panel then says, entities read back. */
async function addToQueue(access: { canQueue: boolean; importQueue: boolean }): Promise<string> {
  atProvider("printables", access);
  await loadSingleItem();
  await click("queue");
  return last().replaceAll("&#39;", "'").replaceAll("&gt;", ">");
}

const SNAPMAKER = "https://example.test/snapmaker";

function held(state: LibraryState["state"], heldProfiles: string[] | null): LibraryState {
  return { state, printId: "print1", gaps: [], heldProfiles };
}

/** The panel on a Snapmaker model in the library, whose page shows profile 1 of the designer's 1 and 2 and the
 *  community's 3 and 4. */
async function openInLibrary(library: LibraryState, access = { canQueue: false, importQueue: false }): Promise<string> {
  contentModules.snapmaker = {
    loadProfiles: async () => (scope: string) =>
      scope === "url" ? ["1"] : scope === "designer" ? ["1", "2"] : ["1", "2", "3", "4"],
  };
  atProvider("snapmaker", access, library);
  await loadSingleItem();
  return last().replaceAll("&#39;", "'");
}

/** The links the panel imported, in order. */
function importedUrls(): string[] {
  return messages.filter(({ type }) => type === "IMPORT_SINGLE").map(({ payload }) => payload.url as string);
}

describe("the single-model panel", () => {
  beforeEach(() => {
    rendered.length = 0;
    messages.length = 0;
    profileScope = null;
    actions.clear();
    for (const provider of Object.keys(contentModules)) delete contentModules[provider];
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

  describe("on a model already in the library", () => {
    it("offers the profiles it lacks when the page's own is on it, every missing one picked", async () => {
      const html = await openInLibrary(held("imported", ["1"]));

      expect(html).toContain("You have 1 of this model's 4 print profiles. Add the 3 missing as more files on it?");
      expect(html).toContain('<option value="missing" selected>All missing print profiles (3)</option>');
      expect(html).toContain("Missing designer print profiles (1)");
      expect(html).not.toContain("Currently selected");
      expect(html).toContain(">Add profiles</button>");
    });

    it("adds only the missing ones, downloading nothing the model has", async () => {
      answers.IMPORT_SINGLE = { id: "print1", import_outcome: "profile_added" };
      const html = await openInLibrary(held("imported", ["1", "3", "4"]));
      // One choice left, so no list to pick from.
      expect(html).not.toContain("<select");
      await click("import");

      expect(importedUrls()).toEqual([`${SNAPMAKER}#profileId-2`]);
      expect(last()).toContain("Profile added");
      expect(last()).toContain("1 print profile imported.");
      expect(last()).toContain(`href="${INSTANCE}/models/print1"`);
    });

    it("names the profile in each link, even the one a link without a profile would bring", async () => {
      // MakerWorld's page link may name no profile: then the instance takes the model's default, which it has.
      answers.IMPORT_SINGLE = { id: "print1", import_outcome: "profile_added" };
      contentModules.makerworld = {
        loadProfiles: async () => (scope: string) => (scope === "url" ? ["1"] : ["1", "2"]),
      };
      atProvider("makerworld", { canQueue: false, importQueue: false }, held("imported", ["2"]));
      await loadSingleItem();
      await click("import");

      expect(importedUrls()).toEqual(["https://example.test/makerworld#profileId-1"]);
    });

    it("queues the missing ones as every profile, which the instance adds without those it has", async () => {
      answers.QUEUE_IMPORT = { job_id: "job1", item_id: "item1", duplicate: false, waiting: 1 };
      await openInLibrary(held("imported", ["1"]), { canQueue: true, importQueue: true });
      await click("queue");

      expect(messages.find(({ type }) => type === "QUEUE_IMPORT")?.payload).toMatchObject({ scope: "all" });
      expect(importedUrls()).toEqual([]);
    });

    it("offers the page's own profile first while the model lacks it, then every missing one", async () => {
      const html = await openInLibrary(held("profile_missing", ["2"]));

      expect(html).toContain("You already have this model. Add this print profile as another file on it?");
      expect(html).toContain('<option value="url" selected>Currently selected print profile</option>');
      expect(html).toContain("All missing print profiles (3)");
      // The designer's missing one is the page's own, which the first choice already is.
      expect(html).not.toContain("Missing designer");
      expect(html).toContain(">Add profile</button>");
    });

    it("opens a model that has everything in Thingport, with nothing to add", async () => {
      const html = await openInLibrary({ ...held("complete", ["1", "2", "3", "4"]), profiles: 4 });

      expect(html).toContain("Everything here is in your library: the model, its 4 print profiles and its details.");
      expect(html).toContain(`href="${INSTANCE}/models/print1"`);
      expect(html).toContain(">Open in Thingport</a>");
      expect(html).not.toContain("data-action");
    });

    it("draws that panel at once, asking the site nothing more", async () => {
      // A site that never answers: the panel must not be waiting on it.
      contentModules.snapmaker = { loadProfiles: () => new Promise(() => undefined) };
      atProvider("snapmaker", { canQueue: false, importQueue: false }, { ...held("complete", ["1"]), profiles: 1 });
      await loadSingleItem();

      expect(last()).toContain("Everything here is in your library: the model, its print profile and its details.");
    });

    it("opens the library where the instance only says it has the model, not which it is", async () => {
      const html = await openInLibrary({ ...held("complete", null), printId: null });

      expect(html).toContain("This model is in your library.");
      expect(html).toContain(`href="${INSTANCE}/models"`);
      expect(html).not.toContain("data-action");
    });

    it("only fills in details when the model has every profile", async () => {
      const html = await openInLibrary({ ...held("imported", ["1", "2", "3", "4"]), gaps: ["tags"] });

      expect(html).toContain("This model is missing its tags.");
      expect(html).not.toContain('data-action="import"');
    });

    it("offers the page's scopes as before where the instance doesn't say which profiles the model has", async () => {
      const html = await openInLibrary(held("profile_missing", null));

      expect(html).toContain("All designer print profiles (2)");
      expect(html).toContain("Designer &amp; community print profiles (4)");
      expect(html).not.toContain("missing print profiles");
    });
  });

  describe("importing several print profiles", () => {
    it("says why the ones that failed did, when some came in", async () => {
      profileScope = "all";
      contentModules.printables = { loadProfiles: async () => () => ["1", "2", "3"] };
      let calls = 0;
      Object.defineProperty(answers, "IMPORT_SINGLE", {
        configurable: true,
        get: () =>
          ++calls === 1 ? { id: "print1", import_outcome: "created" } : new Error("MakerWorld wants a CAPTCHA"),
      });
      atProvider("printables", { canQueue: false, importQueue: false });
      await loadSingleItem();
      await click("import", 5000); // the pause between two profiles is real

      expect(last()).toContain("Partly imported");
      expect(last()).toContain("1 print profile imported, 2 failed.");
      expect(last()).toContain("Last error: MakerWorld wants a CAPTCHA");
    });
  });

  describe("on MakerWorld", () => {
    it("opens a design with print profiles without waiting on the instance, its profiles offered", async () => {
      withProfiles(1);
      atProvider("makerworld", { canQueue: false, importQueue: false });
      await loadSingleItem();

      expect(asked("/import/inspect")).toBe(false);
      expect(last()).toContain('id="tg-profiles"');
      expect(last()).toContain("All designer print profiles (2)");
      expect(last()).not.toContain('data-action="choose-files"');
    });

    it("still looks first at a design without them, which may come as a zip of raw files", async () => {
      withProfiles(-1);
      answers["POST /import/inspect"] = { title: "Thing", is_zip: true, filename: "raw.zip" };
      atProvider("makerworld", { canQueue: false, importQueue: false });
      await loadSingleItem();

      expect(asked("/import/inspect")).toBe(true);
      expect(last()).toContain("raw.zip contains multiple files.");
      expect(last()).toContain('data-action="choose-files"');
    });

    it("lists a zip's files by path, as the instance sends them", async () => {
      withProfiles(-1);
      answers["POST /import/inspect"] = { title: "Thing", is_zip: true, filename: "raw.zip" };
      // What /import/zip/entries answers (services/zipService.ts): files only, folders already left out.
      answers["POST /import/zip/entries"] = { entries: [{ path: "parts/hull.stl", size: 120 }] };
      atProvider("makerworld", { canQueue: false, importQueue: false });
      await loadSingleItem();
      await click("choose-files");

      expect(last()).toContain('value="parts/hull.stl"');
      expect(last()).toContain(">parts/hull.stl<");
      expect(last()).not.toContain("[object Object]");
    });
  });
});
