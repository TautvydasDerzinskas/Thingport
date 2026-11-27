import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "./client";
import {
  BULK_LIMIT,
  PlateUploadCapabilityError,
  PlateUploadOutcomeUnknownError,
  printsApi,
  UploadReceiptLookupError,
  ZipTooLargeError,
} from "./prints";

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

describe("printsApi.downloadZip", () => {
  beforeEach(() => vi.stubGlobal("window", { localStorage: { getItem: () => null } }));

  afterEach(() => vi.unstubAllGlobals());

  const answer = (body: string, status: number) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(body, { status }))),
    );

  it("tells a zip too big to make from any other refusal", async () => {
    answer(JSON.stringify({ detail: "Too much", code: "zip_too_large" }), 413);
    await expect(printsApi.downloadZip({ print_ids: ["a"] })).rejects.toBeInstanceOf(ZipTooLargeError);
    // A 413 from something in front of the server, with no code: an ordinary failure.
    answer("Request Entity Too Large", 413);
    await expect(printsApi.downloadZip({ print_ids: ["a"] })).rejects.not.toBeInstanceOf(ZipTooLargeError);
  });
});

const uploadPrint = {
  id: "print",
  name: "Example",
  tags: [],
  preview_images: [],
  created_at: "2026-01-01T00:00:00.000Z",
  supporting_file_count: 0,
  view_count: 0,
  print_count: 0,
  is_favorite: false,
  plates: [
    {
      id: "plate",
      print_id: "print",
      filename: "file.stl",
      position: 0,
      url: "/file.stl",
      mime: "model/stl",
      size: 1,
    },
  ],
};

describe("plate uploads", () => {
  beforeEach(() => vi.stubGlobal("window", { localStorage: { getItem: () => null } }));

  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body: string) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));

  it.each([408, 500, 502, 503, 504])("keeps the upload outcome unknown after HTTP %i", async (status) => {
    respond(status, "Upstream failure");
    await expect(printsApi.addPlates("print", [])).rejects.toBeInstanceOf(PlateUploadOutcomeUnknownError);
  });

  it.each([
    "The matching plate upload is still processing",
    "The plate upload claim was lost; try again",
    "Multiple plates match this upload attempt",
    "The original plate upload is no longer available",
    "The plate upload attempt has an invalid status",
    "Another file was just saved at the same path; try again",
  ])("keeps a conflicted upload unresolved when the server reports %s", async (detail) => {
    respond(409, JSON.stringify({ detail }));
    await expect(printsApi.addPlates("print", [])).rejects.toBeInstanceOf(PlateUploadOutcomeUnknownError);
  });

  it("keeps the upload outcome unknown when a successful response cannot be decoded", async () => {
    respond(200, "Invalid JSON");
    await expect(printsApi.addPlates("print", [])).rejects.toBeInstanceOf(PlateUploadOutcomeUnknownError);
  });

  it.each([
    {},
    { print: null },
    { print: { id: "print", name: "Example", tags: [], preview_images: [], plates: [null] } },
  ])("keeps a plate upload unresolved when its successful JSON has no usable print (%j)", async (body) => {
    respond(200, JSON.stringify(body));
    await expect(printsApi.addPlates("print", [])).rejects.toBeInstanceOf(PlateUploadOutcomeUnknownError);
  });

  it("keeps an upload unresolved if a returned plate has no file URL", async () => {
    const [plate] = uploadPrint.plates;
    const print = { ...uploadPrint, plates: [{ ...plate, url: undefined }] };
    respond(200, JSON.stringify({ print, added_plate_ids: [plate.id] }));
    await expect(printsApi.addPlates("print", [])).rejects.toBeInstanceOf(PlateUploadOutcomeUnknownError);
  });

  it("accepts a valid legacy upload response without added_plate_ids", async () => {
    respond(200, JSON.stringify({ print: uploadPrint }));
    await expect(printsApi.addPlates("print", [])).resolves.toStrictEqual({ print: uploadPrint });
  });

  it("treats a validation error as a definite rejection", async () => {
    respond(400, JSON.stringify({ detail: "Invalid plate" }));
    const upload = printsApi.addPlates("print", []);
    await expect(upload).rejects.toThrow("Invalid plate");
    await expect(upload).rejects.not.toBeInstanceOf(PlateUploadOutcomeUnknownError);
  });

  it.each([
    [502, "Bad gateway"],
    [200, "Invalid JSON"],
    [200, JSON.stringify({ supported: false })],
  ])("reports a typed capability error for HTTP %i with %s", async (status, body) => {
    respond(status, body);
    await expect(printsApi.supportsIdempotentPlateUploads("print")).rejects.toBeInstanceOf(PlateUploadCapabilityError);
  });

  it("detects older servers and preserves authentication errors", async () => {
    respond(404, "Not found");
    await expect(printsApi.supportsIdempotentPlateUploads("print")).resolves.toBe(false);
    respond(200, JSON.stringify({ supported: true }));
    await expect(printsApi.supportsIdempotentPlateUploads("print")).resolves.toBe(true);
    respond(401, "Unauthorized");
    await expect(printsApi.supportsIdempotentPlateUploads("print")).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe.each([
  { resource: "plate", resultId: "plate_id", lookup: printsApi.getPlateUploadResults },
  { resource: "preview", resultId: "image_id", lookup: printsApi.getPreviewUploadResults },
])("$resource upload receipts", ({ lookup, resultId }) => {
  beforeEach(() => vi.stubGlobal("window", { localStorage: { getItem: () => null } }));

  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body: string) =>
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));

  it("returns completed receipts even when the uploaded file has since been removed", async () => {
    const body = {
      print: uploadPrint,
      upload_results: [
        { upload_id: "first", [resultId]: "removed" },
        { upload_id: "second", [resultId]: null },
      ],
    };
    respond(200, JSON.stringify(body));
    await expect(lookup("print", ["first", "second", "pending"])).resolves.toEqual(body);
  });

  it.each([
    { print: {}, upload_results: [] },
    { print: { ...uploadPrint, id: "different" }, upload_results: [] },
    { print: uploadPrint, upload_results: {} },
    { print: uploadPrint, upload_results: [{ upload_id: "first" }] },
    { print: uploadPrint, upload_results: [{ upload_id: "other", plate_id: null, image_id: null }] },
    {
      print: uploadPrint,
      upload_results: [
        { upload_id: "first", plate_id: null, image_id: null },
        { upload_id: "first", plate_id: null, image_id: null },
      ],
    },
  ])("rejects an incomplete or inconsistent receipt response (%j)", async (body) => {
    respond(200, JSON.stringify(body));
    await expect(lookup("print", ["first"])).rejects.toBeInstanceOf(UploadReceiptLookupError);
  });

  it.each([
    [200, "Invalid JSON"],
    [502, "Bad gateway"],
  ])("returns a typed lookup error for HTTP %i with %s", async (status, body) => {
    respond(status, body);
    await expect(lookup("print", [])).rejects.toBeInstanceOf(UploadReceiptLookupError);
  });

  it("detects older servers and preserves authentication errors", async () => {
    respond(404, "Not found");
    await expect(lookup("print", [])).resolves.toBeNull();
    respond(401, "Unauthorized");
    await expect(lookup("print", [])).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
