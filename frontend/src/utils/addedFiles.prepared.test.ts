import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Print } from "../api/prints";

const get = vi.fn<(id: string) => Promise<Print>>();
vi.mock("../api/prints", () => ({ printsApi: { get: (id: string) => get(id) } }));
const { preparedAfterFailure } = await import("./addedFiles");

const withPrepared = (filename: string | null) =>
  ({
    id: "m1",
    slicer_filename: filename,
    prepared_print: filename ? { removable: true } : null,
  }) as unknown as Print;

describe("a sliced print whose upload failed, by what the model says", () => {
  beforeEach(() => get.mockReset());

  it("is in where the model's prepared print is it, and not where it's another or none", async () => {
    get.mockResolvedValue(withPrepared("A.gcode"));
    expect(await preparedAfterFailure("m1", "A.gcode", null)).toBe(true);
    get.mockResolvedValue(withPrepared("old.gcode"));
    expect(await preparedAfterFailure("m1", "A.gcode", 502)).toBe(false);
    get.mockResolvedValue(withPrepared(null));
    expect(await preparedAfterFailure("m1", "A.gcode", null)).toBe(false);
  });

  it("is taken as in when the model can't be read, and as out when the server turned it away, unread", async () => {
    get.mockRejectedValue(new Error("offline"));
    expect(await preparedAfterFailure("m1", "A.gcode", null)).toBe(true);
    get.mockReset();
    expect(await preparedAfterFailure("m1", "A.gcode", 413)).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(await preparedAfterFailure("m1", "notes.txt", null)).toBe(false);
  });
});
