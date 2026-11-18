import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "./client";
import { BULK_LIMIT, printsApi } from "./prints";

/** Answers each batch in turn; a model in `prints` went through, a status is that batch failing. */
function answerBatches(...answers: (number | { prints: { id: string }[]; skipped?: number; failed?: number })[]) {
  const answer = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => {
    const next = answers.shift();
    return Promise.resolve(
      typeof next === "number"
        ? new Response(JSON.stringify({ detail: "No" }), { status: next })
        : new Response(JSON.stringify({ skipped: 0, failed: 0, ...next }), { status: 200 }),
    );
  });
  vi.stubGlobal("fetch", answer);
  return answer;
}

describe("printsApi.bulkAssignCategory", () => {
  const ids = Array.from({ length: BULK_LIMIT + 2 }, (_, index) => `model-${index}`);

  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("adds up its batches", async () => {
    const fetched = answerBatches({ prints: [{ id: "a" }], skipped: 1 }, { prints: [{ id: "b" }], failed: 1 });
    const result = await printsApi.bulkAssignCategory(ids, "category");
    const sent = fetched.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(sent.map((body) => body.print_ids)).toEqual([ids.slice(0, BULK_LIMIT), ids.slice(BULK_LIMIT)]);
    expect(sent.map((body) => body.category_id)).toEqual(["category", "category"]);
    expect(result.prints.map((print) => print.id)).toEqual(["a", "b"]);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("answers what went through when a later batch fails, counting the rest as failed", async () => {
    answerBatches({ prints: [{ id: "a" }], skipped: 1, failed: 1 }, 500);
    const result = await printsApi.bulkAssignCategory(ids, "category");
    expect(result.prints.map((print) => print.id)).toEqual(["a"]);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(3);
  });

  it("throws when nothing went through", async () => {
    answerBatches(500);
    await expect(printsApi.bulkAssignCategory(ids, "category")).rejects.toThrow("No");
  });

  it("throws a 401 even after a batch went through, for the session to be renewed", async () => {
    answerBatches({ prints: [{ id: "a" }] }, 401);
    await expect(printsApi.bulkAssignCategory(ids, "category")).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("printsApi.upload", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sent = async (files: File[], folders?: (string | null)[]) => {
    const answer = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      Response.json({ prints: [] }),
    );
    vi.stubGlobal("fetch", answer);
    await printsApi.upload(files, { mode: "multiplate", folders });
    const body = answer.mock.calls[0][1].body;
    if (!(body instanceof FormData)) throw new Error("The upload wasn't sent as multipart form data");
    return body;
  };
  const foldersSent = async (files: File[], folders?: (string | null)[]) => (await sent(files, folders)).get("folders");
  const file = (name: string) => new File(["solid x endsolid"], name);

  it("sends where a lone file sat, as it does each of several, and nothing when none sat in a folder", async () => {
    // A zip's "parts/body.stl" with its photo, which goes to the gallery: the model file goes up alone.
    expect(await foldersSent([file("body.stl")], ["parts"])).toBe(JSON.stringify(["parts"]));
    expect(await foldersSent([file("body.stl"), file("guide.pdf")], ["parts", "docs"])).toBe(
      JSON.stringify(["parts", "docs"]),
    );
    expect(await foldersSent([file("body.stl")], [null])).toBeNull();
    expect(await foldersSent([file("body.stl")])).toBeNull();
  });

  it("sends the files themselves, in order, beside their folders, a file at the top keeping its place", async () => {
    const body = await sent([file("body.stl"), file("guide.pdf")], [null, "docs"]);
    expect(body.getAll("files").map((each) => (each as File).name)).toEqual(["body.stl", "guide.pdf"]);
    expect(body.get("folders")).toBe(JSON.stringify([null, "docs"]));
  });
});
