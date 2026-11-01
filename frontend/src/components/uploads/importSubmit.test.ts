import type { TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../../api/client";
import { importsApi, type QueueSubmitAnswer } from "../../api/imports";
import type { ToastOptions } from "../ToastProvider";
import type { CollectionPromptConfig } from "./CollectionImportModal";
import { createImportSubmit, createPromptChain, type ImportSubmitDeps } from "./importSubmit";
import type { ZipPromptConfig } from "./ZipImportModal";

const MAKERWORLD_MODEL = "https://makerworld.com/en/models/123456-example-model";
const MAKERWORLD_LIST = "https://makerworld.com/en/collections/12345-example-collection";
const PRINTABLES_MODEL = "https://www.printables.com/model/123456-example-model";
const PRINTABLES_LIST = "https://www.printables.com/@username/collections/12345-example-collection";
const MAKERONLINE_MODEL = "https://www.makeronline.com/en/model/Example-Model/123456.html";
const FILE_LINK = "https://files.example.com/parts";

const JOB: QueueSubmitAnswer = { kind: "job", job_id: "j1", status: "QUEUED", position: 2 };
const CAPTCHA = { captcha_id: "c1", captcha_answer: "abc" };
const PRINT = { id: "p1", title: "A model", name: "a" };

function setup() {
  const deps = {
    queue: {
      submitLink: vi.fn<ImportSubmitDeps["queue"]["submitLink"]>(async () => JOB),
      submitLinks: vi.fn<ImportSubmitDeps["queue"]["submitLinks"]>(async () => JOB),
      submitZip: vi.fn<ImportSubmitDeps["queue"]["submitZip"]>(async () => JOB),
      submitList: vi.fn<ImportSubmitDeps["queue"]["submitList"]>(async () => JOB),
      submitProfiles: vi.fn<ImportSubmitDeps["queue"]["submitProfiles"]>(async () => JOB),
    },
    categoryId: "cat1",
    t: ((key: string, options?: object) => (options ? `${key} ${JSON.stringify(options)}` : key)) as TFunction,
    toast: vi.fn<(options: ToastOptions) => void>(),
    showZipPrompt: vi.fn<ImportSubmitDeps["showZipPrompt"]>(async () => undefined),
    showCollectionPrompt: vi.fn<ImportSubmitDeps["showCollectionPrompt"]>(async () => undefined),
    onImported: vi.fn<ImportSubmitDeps["onImported"]>(),
    onUnauthorized: vi.fn<() => void>(),
    onTryAgain: vi.fn<ImportSubmitDeps["onTryAgain"]>(),
    onSettled: vi.fn<() => void>(),
  };
  return { deps, ...createImportSubmit(deps) };
}

const toasts = (deps: ReturnType<typeof setup>["deps"]) => deps.toast.mock.calls.map(([options]) => options);

async function shownList(link = PRINTABLES_LIST) {
  const context = setup();
  await context.submitImport(link, CAPTCHA);
  return { ...context, config: context.deps.showCollectionPrompt.mock.calls[0][0] as CollectionPromptConfig };
}

async function shownZip(link = FILE_LINK) {
  vi.spyOn(importsApi, "inspectLink").mockResolvedValue({ is_zip: true, filename: "files.zip" } as never);
  const context = setup();
  await context.submitImport(link, CAPTCHA);
  return { ...context, config: context.deps.showZipPrompt.mock.calls[0][0] as ZipPromptConfig };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitImport", () => {
  it("asks the queue for a model's link, with its captcha, and sends no sign-in", async () => {
    const inspect = vi.spyOn(importsApi, "inspectLink");
    const { deps, submitImport } = setup();

    await submitImport(`  ${PRINTABLES_MODEL} `, CAPTCHA);

    expect(deps.queue.submitLink).toHaveBeenCalledWith({ url: PRINTABLES_MODEL, category_id: "cat1", ...CAPTCHA });
    expect(deps.queue.submitLink.mock.calls[0][0]).not.toHaveProperty("makerworld_cookie");
    expect(inspect).not.toHaveBeenCalled();
    expect(deps.onSettled).toHaveBeenCalledTimes(1);
  });

  it("doesn't reach the provider before a model's turn in line", async () => {
    const inspect = vi.spyOn(importsApi, "inspectLink");
    const { deps, submitImport } = setup();

    await submitImport(MAKERWORLD_MODEL, CAPTCHA);

    expect(inspect).not.toHaveBeenCalled();
    expect(deps.queue.submitLink).toHaveBeenCalledWith(expect.objectContaining({ url: MAKERWORLD_MODEL, ...CAPTCHA }));
    expect(deps.showZipPrompt).not.toHaveBeenCalled();
  });

  it("leaves the job's toast to the queue, and doesn't jump", async () => {
    const { deps, submitImport } = setup();
    await submitImport(PRINTABLES_MODEL);
    expect(deps.toast).not.toHaveBeenCalled();
    expect(deps.onImported).not.toHaveBeenCalled();
  });

  it("ignores an empty link", async () => {
    const { deps, submitImport } = setup();
    await submitImport("   ");
    expect(deps.queue.submitLink).not.toHaveBeenCalled();
    expect(deps.onSettled).not.toHaveBeenCalled();
  });

  it("refuses a list only Thingport Grab can import, before reading anything", async () => {
    const { deps, submitImport } = setup();
    await submitImport(MAKERWORLD_LIST);
    expect(toasts(deps)).toEqual([{ message: "addMenu.makerworldCollectionBlocked", severity: "warning" }]);
    expect(deps.showCollectionPrompt).not.toHaveBeenCalled();
  });

  it("sends a model's wider profile scope as a profiles import", async () => {
    const { deps, submitImport } = setup();
    await submitImport(MAKERWORLD_MODEL, CAPTCHA, "designer");
    expect(deps.queue.submitProfiles).toHaveBeenCalledWith("makerworld", {
      url: MAKERWORLD_MODEL,
      category_id: "cat1",
      scope: "designer",
      ...CAPTCHA,
    });
    expect(deps.queue.submitLink).not.toHaveBeenCalled();
  });

  it("ignores a scope on a provider with no profiles", async () => {
    const { deps, submitImport } = setup();
    await submitImport(PRINTABLES_MODEL, null, "all");
    expect(deps.queue.submitProfiles).not.toHaveBeenCalled();
    expect(deps.queue.submitLink).toHaveBeenCalledTimes(1);
  });

  it("leaves files only Thingport Grab can fetch waiting for it, with no job", async () => {
    const queueForGrab = vi.spyOn(importsApi, "queueForGrab").mockResolvedValue({} as never);
    const { deps, submitImport } = setup();
    await submitImport(MAKERONLINE_MODEL, null, "all");
    expect(queueForGrab).toHaveBeenCalledWith(
      "makeronline",
      expect.objectContaining({ url: MAKERONLINE_MODEL, scope: "all" }),
    );
    expect(toasts(deps)).toEqual([{ message: "uploadBar.makeronlineWaiting" }]);
    expect(deps.queue.submitLink).not.toHaveBeenCalled();
  });

  it("opens what was imported at once, as on a backend older than the queue", async () => {
    const { deps, submitImport } = setup();
    deps.queue.submitLink.mockResolvedValue({ kind: "print", print: PRINT } as never);
    await submitImport(PRINTABLES_MODEL);
    expect(deps.onImported).toHaveBeenCalledWith(PRINT);
    expect(deps.toast).not.toHaveBeenCalled();
  });

  it("says when what was asked for waits for Thingport Grab", async () => {
    const { deps, submitImport } = setup();
    deps.queue.submitLink.mockResolvedValue({ kind: "grab", queued: 3, collection_id: null });
    await submitImport(PRINTABLES_MODEL);
    expect(toasts(deps)).toEqual([{ message: 'uploadBar.makeronlineListWaiting {"count":3}' }]);
  });
});

describe("a list", () => {
  beforeEach(() => {
    vi.spyOn(importsApi, "listEntries").mockResolvedValue({
      title: "Workshop bits",
      total: 1,
      truncated: false,
      entries: [],
    } as never);
  });

  it("names the job from the entries it read", async () => {
    const { deps, config } = await shownList();
    expect(config.label).toBe(PRINTABLES_LIST);

    await config.loadEntries();
    await config.onImportSelected(["a", "b"]);

    expect(deps.queue.submitList).toHaveBeenCalledWith("printables", {
      url: PRINTABLES_LIST,
      category_id: "cat1",
      model_ids: ["a", "b"],
      collection_title: "Workshop bits",
      ...CAPTCHA,
    });
    expect(deps.queue.submitList.mock.calls[0][1]).not.toHaveProperty("makerworld_cookie");
  });

  it("sends no name when the list has none", async () => {
    vi.spyOn(importsApi, "listEntries").mockResolvedValue({ title: null } as never);
    const { deps, config } = await shownList();
    await config.loadEntries();
    await config.onImportSelected(["a"]);
    expect(deps.queue.submitList.mock.calls[0][1].collection_title).toBeUndefined();
  });

  it("says how many wait for Thingport Grab, when its provider's lists do", async () => {
    const { deps, config } = await shownList();
    deps.queue.submitList.mockResolvedValue({ kind: "grab", queued: 4, collection_id: "c1" });
    await config.onImportSelected(["a"]);
    expect(toasts(deps)).toEqual([{ message: 'uploadBar.makeronlineListWaiting {"count":4}' }]);
  });

  it("leaves a failed import to the prompt, which stays open for another go", async () => {
    const { deps, config } = await shownList();
    deps.queue.submitList.mockRejectedValue(new Error("Nope"));
    await expect(config.onImportSelected(["a"])).rejects.toThrow("Nope");
    expect(deps.toast).not.toHaveBeenCalled();
  });

  it("signs out from a refused import without an error in the prompt", async () => {
    const { deps, config } = await shownList();
    deps.queue.submitList.mockRejectedValue(new UnauthorizedError());
    await expect(config.onImportSelected(["a"])).resolves.toBeUndefined();
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("signs out from a refused read, which the prompt also shows", async () => {
    vi.spyOn(importsApi, "listEntries").mockRejectedValue(new UnauthorizedError());
    const { deps, config } = await shownList();
    await expect(config.loadEntries()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe("a link that may be a zip", () => {
  it("imports as any other link when it isn't one", async () => {
    vi.spyOn(importsApi, "inspectLink").mockResolvedValue({ is_zip: false } as never);
    const { deps, submitImport } = setup();
    await submitImport(FILE_LINK, CAPTCHA);
    expect(deps.queue.submitLink).toHaveBeenCalledWith(expect.objectContaining({ url: FILE_LINK, ...CAPTCHA }));
    expect(deps.showZipPrompt).not.toHaveBeenCalled();
  });

  it("asks when it is, and imports it whole", async () => {
    const { deps, config } = await shownZip();
    expect(config.label).toBe("files.zip");
    expect(deps.queue.submitLink).not.toHaveBeenCalled();

    await config.onImportAsZip();

    expect(deps.queue.submitLink).toHaveBeenCalledWith(expect.objectContaining({ url: FILE_LINK, ...CAPTCHA }));
  });

  it("asks when it is, and imports what's picked", async () => {
    const listZipEntries = vi
      .spyOn(importsApi, "listZipEntries")
      .mockResolvedValue({ entries: [{ path: "a" }] } as never);
    const { deps, config } = await shownZip();

    await expect(config.loadEntries()).resolves.toEqual([{ path: "a" }]);
    await config.onImportSelected(["a"]);

    expect(listZipEntries).toHaveBeenCalledWith(expect.objectContaining({ url: FILE_LINK }));
    expect(deps.queue.submitZip).toHaveBeenCalledWith({
      url: FILE_LINK,
      category_id: "cat1",
      entries: ["a"],
      filename: "files.zip",
      ...CAPTCHA,
    });
    expect(deps.queue.submitZip.mock.calls[0][0]).not.toHaveProperty("makerworld_cookie");
  });

  it("leaves a failed import to the prompt, and a sign-out to whoever handles it", async () => {
    const { deps, config } = await shownZip();
    deps.queue.submitLink.mockRejectedValueOnce(new Error("Nope"));
    await expect(config.onImportAsZip()).rejects.toThrow("Nope");

    deps.queue.submitZip.mockRejectedValueOnce(new UnauthorizedError());
    await expect(config.onImportSelected(["a"])).resolves.toBeUndefined();
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(deps.toast).not.toHaveBeenCalled();
  });
});

describe("a failure before anything is asked", () => {
  it("offers the dialog back with the link and scope", async () => {
    const { deps, submitImport } = setup();
    deps.queue.submitProfiles.mockRejectedValue(new Error("No such provider"));

    await submitImport(` ${MAKERWORLD_MODEL} `, null, "all");

    const [toast] = toasts(deps);
    expect(toast).toMatchObject({ message: "No such provider", severity: "error" });
    expect(toast.action?.label).toBe("importQueue.toast.tryAgain");
    expect(toast.autoHideMs).toBeGreaterThan(4000);
    expect(deps.onTryAgain).not.toHaveBeenCalled();
    toast.action?.onClick();
    expect(deps.onTryAgain).toHaveBeenCalledWith(MAKERWORLD_MODEL, "all");
    expect(deps.onSettled).toHaveBeenCalledTimes(1);
  });

  it("covers the look at the link, too", async () => {
    vi.spyOn(importsApi, "inspectLink").mockRejectedValue(new Error("Too slow"));
    const { deps, submitImport } = setup();
    await submitImport(FILE_LINK);
    expect(toasts(deps)[0].message).toBe("Too slow");
  });

  it("has words of its own when the error has none", async () => {
    const { deps, submitImport } = setup();
    deps.queue.submitLink.mockRejectedValue(new Error(""));
    await submitImport(PRINTABLES_MODEL);
    expect(toasts(deps)[0].message).toBe("uploadBar.importFailed");
  });

  it("signs out instead of offering anything", async () => {
    const { deps, submitImport } = setup();
    deps.queue.submitLink.mockRejectedValue(new UnauthorizedError());
    await submitImport(PRINTABLES_MODEL);
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(deps.toast).not.toHaveBeenCalled();
  });
});

describe("submitImportMany", () => {
  const LINKS = [PRINTABLES_MODEL, MAKERWORLD_MODEL];

  it("sends them as one job, with no sign-in", async () => {
    const { deps, submitImportMany } = setup();
    await submitImportMany(LINKS, CAPTCHA, "designer");
    expect(deps.queue.submitLinks).toHaveBeenCalledWith({
      urls: LINKS,
      scope: "designer",
      category_id: "cat1",
      ...CAPTCHA,
    });
    expect(deps.queue.submitLinks.mock.calls[0][0]).not.toHaveProperty("makerworld_cookie");
    expect(deps.toast).not.toHaveBeenCalled();
  });

  it("does nothing with no links", async () => {
    const { deps, submitImportMany } = setup();
    await submitImportMany([]);
    expect(deps.queue.submitLinks).not.toHaveBeenCalled();
  });

  it("offers the dialog back with all of them", async () => {
    const { deps, submitImportMany } = setup();
    deps.queue.submitLinks.mockRejectedValue(new Error("Nope"));
    await submitImportMany(LINKS, null, "all");
    toasts(deps)[0].action?.onClick();
    expect(deps.onTryAgain).toHaveBeenCalledWith(LINKS.join("\n"), "all");
  });

  it("signs out instead of offering anything", async () => {
    const { deps, submitImportMany } = setup();
    deps.queue.submitLinks.mockRejectedValue(new UnauthorizedError());
    await submitImportMany(LINKS);
    expect(deps.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(deps.toast).not.toHaveBeenCalled();
  });
});

describe("createPromptChain", () => {
  const deferred = () => {
    let resolve: () => void = () => undefined;
    let reject: (reason: Error) => void = () => undefined;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve: () => resolve(), reject: (reason: Error) => reject(reason) };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it("shows one prompt at a time, in the order they were asked for", async () => {
    const show = createPromptChain();
    const first = deferred();
    const second = deferred();
    const shown: string[] = [];

    const done = [
      show(() => {
        shown.push("first");
        return first.promise;
      }),
      show(() => {
        shown.push("second");
        return second.promise;
      }),
    ];

    await settle();
    expect(shown).toEqual(["first"]);

    first.resolve();
    await settle();
    expect(shown).toEqual(["first", "second"]);

    second.resolve();
    await Promise.all(done);
  });

  it("carries on after one fails, which only its caller hears about", async () => {
    const show = createPromptChain();
    const first = deferred();
    const failed = show(() => first.promise);
    const next = show(async () => "next");

    first.reject(new Error("Nope"));

    await expect(failed).rejects.toThrow("Nope");
    await expect(next).resolves.toBe("next");
  });

  it("carries on after a prompt that throws as it opens", async () => {
    const show = createPromptChain();
    const failed = show(() => {
      throw new Error("Nope");
    });
    await expect(failed).rejects.toThrow("Nope");
    await expect(show(async () => "next")).resolves.toBe("next");
  });
});
