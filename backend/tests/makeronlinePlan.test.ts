import { afterEach, describe, expect, it, vi } from "vitest";

// What Grab is asked to get signed for a MakerOnline model without print profiles, by whether it can do without a file
// it can't get signed, and whether the admin keeps the files a model has beside its own.

const kept = vi.hoisted(() => ({
  limits: { perFile: 100, perModel: 250 } as { perFile: number; perModel: number } | null,
}));
vi.mock("../src/providers/makeronline/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/providers/makeronline/api")>()),
  resolveMakeronlineModel: async () => ({
    meta: { title: "Cable box" },
    galleryImages: [],
    creatorId: null,
    profiles: [],
    modelFiles: [
      { key: "a1", name: "Guide.pdf" },
      { key: "b2", name: "body.stl" },
    ],
  }),
}));
vi.mock("../src/services/supportingImports", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/supportingImports")>()),
  supportingLimits: async () => kept.limits,
}));

import { planMakeronlineDownloads } from "../src/providers/makeronline/grabImports";

const URL = "https://makeronline.com/model/329173";
const plan = async (options?: { supporting?: boolean }) =>
  (await planMakeronlineDownloads(URL, "all", options)).requests.map((request) => [request.name, request.supporting]);

afterEach(() => {
  kept.limits = { perFile: 100, perModel: 250 };
});

describe("a MakerOnline plan for a model without profiles", () => {
  it("asks a Grab that does without a file for the model's other files last, marked", async () => {
    expect(await plan({ supporting: true })).toEqual([
      ["body.stl", undefined],
      ["Guide.pdf", true],
    ]);
  });

  it("asks it for none of them when the admin keeps none, as they'd only be thrown away", async () => {
    kept.limits = null;
    expect(await plan({ supporting: true })).toEqual([["body.stl", undefined]]);
  });

  it("asks an older Grab for the model's files as it always did", async () => {
    kept.limits = null;
    expect(await plan()).toEqual([
      ["Guide.pdf", undefined],
      ["body.stl", undefined],
    ]);
  });
});
