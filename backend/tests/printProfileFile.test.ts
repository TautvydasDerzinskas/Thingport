import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { projectFilaments, readProfileFile } from "../src/services/printProfileFile";
import {
  durationSeconds,
  hexColor,
  percentText,
  plainText,
  positive,
  rounded,
} from "../src/services/printProfileFacts";
import { profileProject } from "./helpers/profileProject";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "profile-file-"));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("a print profile's 3MF", () => {
  it("gives its printer, settings and plates, with a sliced plate's time and filament", async () => {
    const facts = await readProfileFile(await profileProject(dir, "sliced.3mf", "first"));
    expect(facts).toMatchObject({
      printer: "Bambu Lab X1 Carbon",
      nozzleMm: 0.4,
      layerMm: 0.16,
      infill: "20%",
      walls: 3,
      supports: true,
    });
    expect(facts!.plates).toEqual([
      {
        index: 1,
        name: "Body & lid",
        objects: 2,
        thumb: true,
        seconds: 3600,
        grams: 12.5,
        filaments: [
          { type: "PLA", color: "#FFFFFF", grams: 10.25 },
          { type: "PETG", color: "#000000", grams: 2.25 },
        ],
      },
      { index: 2, name: null, objects: 1, thumb: true, seconds: null, grams: null, filaments: [] },
    ]);
  });

  it("reads an unsliced project's plates without inventing times", async () => {
    const facts = await readProfileFile(await profileProject(dir, "unsliced.3mf", "none"));
    expect(facts!.plates.map((plate) => [plate.index, plate.seconds, plate.grams])).toEqual([
      [1, null, null],
      [2, null, null],
    ]);
  });

  it("has nothing to say about a 3MF without slicer metadata, and nothing at all about a file that isn't one", async () => {
    const zip = new JSZip();
    zip.file("3D/3dmodel.model", "<model/>");
    const bare = path.join(dir, "bare.3mf");
    await fs.writeFile(bare, await zip.generateAsync({ type: "nodebuffer" }));
    expect(await readProfileFile(bare)).toEqual({
      printer: null,
      nozzleMm: null,
      layerMm: null,
      infill: null,
      walls: null,
      supports: null,
      plates: [],
    });
    const text = path.join(dir, "not-a-zip.3mf");
    await fs.writeFile(text, "solid nothing\nendsolid\n");
    expect(await readProfileFile(text)).toBeNull();
  });

  it("adds up the same filament across plates", () => {
    expect(
      projectFilaments([
        { filaments: [{ type: "PLA", color: "#FFFFFF", grams: 10 }] },
        {
          filaments: [
            { type: "PLA", color: "#FFFFFF", grams: 5.5 },
            { type: "PLA", color: "#000000", grams: 1 },
          ],
        },
      ]),
    ).toEqual([
      { type: "PLA", color: "#FFFFFF", grams: 15.5 },
      { type: "PLA", color: "#000000", grams: 1 },
    ]);
  });
});

describe("reading providers' numbers", () => {
  it("takes colours however sites write them", () => {
    expect(hexColor("#ffffff")).toBe("#FFFFFF");
    expect(hexColor("#6667ABFF")).toBe("#6667AB");
    expect(hexColor("0,64,128")).toBe("#004080");
    expect(hexColor("fff")).toBe("#FFFFFF");
    expect(hexColor("300,0,0")).toBeNull();
    expect(hexColor("blue")).toBeNull();
  });

  it("reads durations as seconds, numbers and text alike", () => {
    expect(durationSeconds(2415)).toBe(2415);
    expect(durationSeconds("6h41m")).toBe(24060);
    expect(durationSeconds("11h 52m 23s")).toBe(42743);
    expect(durationSeconds("7.4h")).toBe(26640);
    expect(durationSeconds("1d 2h")).toBe(93600);
    expect(durationSeconds("soon")).toBeNull();
    expect(durationSeconds(0)).toBeNull();
  });

  it("treats zero and junk as unknown", () => {
    expect(positive(0)).toBeNull();
    expect(positive("0")).toBeNull();
    expect(positive("12.5")).toBe(12.5);
    expect(positive("n/a")).toBeNull();
    expect(rounded("12.345", 2)).toBe(12.35);
  });

  it("writes infill as a percentage and descriptions as plain text", () => {
    expect(percentText(15)).toBe("15%");
    expect(percentText("15 %")).toBe("15%");
    expect(percentText("dense")).toBeNull();
    expect(plainText("<p>4 color</p><p>with <b>supports</b></p>")).toBe("4 color\n\nwith supports");
    expect(plainText("<p> </p>")).toBeNull();
  });
});
