import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { faults, pauseAt } from "../harness/lifecycle";
import { start, useServingSites } from "./servingSites";

// Fs 1 where a model's file is served (src/utils/sendStored.ts): a disk that fails to answer is an error, never
// "missing", and leaves the file where it is; a file that's gone, or a folder in its place, is still a 404.

const app = createApp();
const sites = useServingSites(app, "door-serving");

// Each site's fault, written out so that a search for the site finds its case.
const FAIL_OPEN: Record<string, () => void> = {
  "serve.plate": () => faults.at("open:serve.plate", 1, "EIO"),
  "serve.supporting": () => faults.at("open:serve.supporting", 1, "EIO"),
  "serve.prepared": () => faults.at("open:serve.prepared", 1, "EIO"),
  "mcp.file": () => faults.at("open:mcp.file", 1, "EIO"),
  "partner.file": () => faults.at("open:partner.file", 1, "EIO"),
};

afterEach(() => vi.restoreAllMocks());

describe.each(sites.map((c) => [`${c.name} (${c.site})`, c] as const))("%s", (_title, { site, notFound, make }) => {
  it("answers 500, not 404, when opening the file fails", async () => {
    const stored = await make();
    // The server logs its own errors; they're expected here.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    FAIL_OPEN[site]();

    const answer = await stored.fetch();

    expect(answer.status).toBe(500);
    expect(fs.readFileSync(stored.abs)).toEqual(stored.bytes);
  });

  // These change the disk once the site has found its row and is about to open the file, so the open meets it.
  it("answers 404 when the file is gone by the time it's opened", async () => {
    const stored = await make();
    const gate = pauseAt(`open:${site}`);
    const answer = start(() => stored.fetch());
    await gate.reachedBy(answer);
    fs.rmSync(stored.abs);
    gate.release();

    expect(await answer).toMatchObject({ status: 404, body: Buffer.from(notFound) });
  });

  it("answers 404 for a folder in the file's place", async () => {
    const stored = await make();
    const gate = pauseAt(`open:${site}`);
    const answer = start(() => stored.fetch());
    await gate.reachedBy(answer);
    fs.rmSync(stored.abs);
    fs.mkdirSync(stored.abs);
    gate.release();

    expect(await answer).toMatchObject({ status: 404, body: Buffer.from(notFound) });
  });
});
