import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import { setThingiverseAccessToken } from "../../src/providers/thingiverse/token";
import { setSocialSettings } from "../../src/services/settingsService";
import { installFetch, type FetchHandler, type FetchStub } from "../providers/support";
import { CASES, caseName, treeOf } from "./cases";
import { linesOf, modelsOf, register, runWay, THINGIVERSE_TOKEN } from "./ways";
import { filesOf } from "./files";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Every cell of the cases table (cases.ts), run through its way in: the outcome it pins is all of what the way in made,
// so a change to how files become models fails exactly the cells it changes. See docs/STORAGE_DEVELOPMENT.md.

const app = createApp();
let handler: FetchHandler = () => undefined;
let stub: FetchStub;
// INTAKE_RECORD=<file> writes what every cell made to <file> instead of checking it: how a pull request that changes
// cells reads their new outcomes, to look over before they go in the table.
const recording = process.env.INTAKE_RECORD;
const recorded: Record<string, string[]> = {};

beforeAll(async () => {
  await setThingiverseAccessToken(THINGIVERSE_TOKEN);
  await setSocialSettings({ enabled: true });
  stub = installFetch((call) => handler(call));
});

afterEach(() => {
  handler = () => undefined;
});

afterAll(async () => {
  stub.restore();
  await setThingiverseAccessToken(null);
  await setSocialSettings({ enabled: false });
  await prisma.setting.deleteMany({ where: { key: { in: ["consume_mode", "consume_user_id"] } } });
  if (recording) fs.writeFileSync(recording, `${JSON.stringify(recorded, null, 2)}\n`);
});

describe("how each way in turns files into models", () => {
  it.each(CASES.map((cell) => [caseName(cell), cell] as const))("%s", async (_name, cell) => {
    const outcome = linesOf(
      await runWay(
        {
          app,
          serve: (next) => {
            const previous = handler;
            handler = async (call) => (await next(call)) ?? previous(call);
          },
        },
        cell.way,
        treeOf(cell),
        caseName(cell),
      ),
    );
    if (recording) recorded[caseName(cell)] = outcome;
    // oxlint-disable-next-line vitest/no-conditional-expect -- a recording run writes outcomes down instead
    else expect(outcome).toEqual(cell.today);
  });
});

describe("how an outcome reads", () => {
  it("marks a file the disk doesn't hold, and a prepared file the model doesn't point at", async () => {
    const account = await register(app, "outcome-marks");
    const req = request(app)
      .post("/api/upload")
      .set({ Authorization: `Bearer ${account.session}` })
      .field("mode", "multiplate");
    for (const file of await filesOf({ "Frog.stl": null, "Tower.gcode": null }, "outcome-marks")) {
      req.attach("files", file.bytes, { filename: file.path });
    }
    const id = (await req).body.prints[0].id as string;
    expect(linesOf({ models: await modelsOf(account.id) })).toEqual(["Frog: P Frog.stl, PP Tower.gcode"]);

    const print = await prisma.print.update({
      where: { id },
      data: { preparedFile: { disconnect: true } },
      include: { plates: true },
    });
    fs.rmSync(path.join(STORAGE, print.plates[0].storagePath));
    expect(linesOf({ models: await modelsOf(account.id) })).toEqual(["Frog: P Frog.stl (missing), pp Tower.gcode"]);
  });
});
