import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkpoint, setCheckpointHookForTest } from "../../src/modelFiles/checkpoints";
import { fileState, openStored } from "../../src/modelFiles/storageFs";
import { beginTest, endTest, faults, hits, pauseAt, reached, track } from "./lifecycle";

// The harness's own tests: a fault or pause it was asked for and never met fails the test, a parked operation is
// undone, and the door gives the answers Fs 1 asks for. Where a test watches the harness fail, it ends the test itself
// with endTest() and begins a new one, so setup.ts's own endTest finds nothing left.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-harness-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const file = (name: string, body = "bytes") => {
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, body);
  return abs;
};

/** How many files this process has open: /proc on Linux, lsof elsewhere. */
function openFiles(): number {
  if (process.platform === "linux") return fs.readdirSync("/proc/self/fd").length;
  return execFileSync("lsof", ["-p", String(process.pid)], { encoding: "utf8" }).split("\n").length;
}

describe("checkpoints", () => {
  it("do nothing without a hook, and the hook is a test seam", () => {
    setCheckpointHookForTest(null);
    expect(checkpoint("fileState:zip.entry")).toBeUndefined();
    const vitest = process.env.VITEST;
    delete process.env.VITEST;
    try {
      expect(() => setCheckpointHookForTest(() => undefined)).toThrow(/test seam/);
    } finally {
      process.env.VITEST = vitest;
      beginTest();
    }
  });
});

describe("faults", () => {
  it("fire once, at their nth call, as the disk would report it, before the disk is touched", async () => {
    const abs = file("nth.stl");
    faults.at("fileState:zip.entry", 2, "EACCES");
    expect((await fileState(abs, "zip.entry")).state).toBe("file");
    await expect(fileState(abs, "zip.entry")).rejects.toMatchObject({
      code: "EACCES",
      errno: -os.constants.errno.EACCES,
      syscall: "stat",
      path: abs,
    });
    expect((await fileState(abs, "zip.entry")).state).toBe("file");
    expect(fs.readFileSync(abs, "utf8")).toBe("bytes");
  });

  it("count only their own file when given a path", async () => {
    const a = file("a.stl");
    const b = file("b.stl");
    faults.at("fileState:copy.source", 1, "EIO", { path: b });
    expect((await fileState(a, "copy.source")).state).toBe("file");
    await expect(fileState(b, "copy.source")).rejects.toMatchObject({ code: "EIO" });
  });

  it("fail the test when never reached", async () => {
    faults.at("fileState:zip.entry", 1, "EIO");
    await expect(endTest()).rejects.toThrow(/never reached: fileState:zip.entry #1 EIO/);
    beginTest();
  });

  it("are refused at once for a checkpoint or code that doesn't exist", () => {
    expect(() => faults.at("fileState:nowhere" as never, 1, "EIO")).toThrow(/No checkpoint/);
    expect(() => faults.at("fileState:zip.entry", 1, "EBOGUS" as never)).toThrow(/No error/);
  });
});

describe("reached and hits", () => {
  it("fail the test when a checkpoint asked for is never reached", async () => {
    reached("opened:serve.supporting");
    await expect(endTest()).rejects.toThrow(/never reached: opened:serve.supporting/);
    beginTest();
  });

  it("count every call from the test's start", async () => {
    const abs = file("count.stl");
    await fileState(abs, "scan.plate");
    await fileState(abs, "scan.plate");
    expect(hits("fileState:scan.plate")).toBe(2);
    expect(hits("open:scan.plate")).toBe(0);
  });
});

describe("pauses", () => {
  it("hold their operation until released", async () => {
    const abs = file("paused.stl");
    const gate = pauseAt("fileState:browser.location");
    let done = false;
    const op = track(fileState(abs, "browser.location")).then((state) => {
      done = true;
      return state;
    });
    await gate.reachedBy(op);
    expect([hits("fileState:browser.location"), done]).toEqual([1, false]);
    gate.release();
    expect((await op).state).toBe("file");
  });

  it("say so when the operation settles before reaching them", async () => {
    const gate = pauseAt("fileState:repair.look");
    await expect(gate.reachedBy(track(fileState(file("other.stl"), "repair.sweep")))).rejects.toThrow(
      /settled before reaching/,
    );
    await expect(endTest()).rejects.toThrow(/never reached: a pause at fileState:repair.look #1/);
    beginTest();
  });

  it("are undone when the test ends with an operation parked, which then rejects", async () => {
    const gate = pauseAt("open:serve.plate");
    const op = track(openStored(file("parked.stl"), "serve.plate"));
    await gate.reachedBy(op);
    await expect(endTest()).rejects.toThrow(/left parked: open:serve.plate #1/);
    beginTest();
    await expect(op).rejects.toThrow(/ended with an operation parked/);
  });
});

describe("fileState", () => {
  it("tells a file from nothing and from a folder, follows links, and throws on any other error", async () => {
    const abs = file("there.stl", "12345");
    expect(await fileState(abs, "scan.plate")).toMatchObject({ state: "file", size: 5 });
    expect(await fileState(path.join(dir, "gone.stl"), "scan.plate")).toEqual({ state: "missing" });
    // A file where a folder should be: ENOTDIR, which is missing too.
    expect(await fileState(path.join(abs, "inside.stl"), "scan.plate")).toEqual({ state: "missing" });
    expect(await fileState(dir, "scan.plate")).toEqual({ state: "not-a-file" });
    const link = path.join(dir, "link.stl");
    fs.symlinkSync(abs, link);
    expect((await fileState(link, "scan.plate")).state).toBe("file");
    const dangling = path.join(dir, "dangling.stl");
    fs.symlinkSync(path.join(dir, "nowhere.stl"), dangling);
    expect(await fileState(dangling, "scan.plate")).toEqual({ state: "missing" });
    faults.at("fileState:scan.plate", 1, "EIO");
    await expect(fileState(abs, "scan.plate")).rejects.toMatchObject({ code: "EIO" });
    // A planted ENOENT is missing, as a real one is.
    faults.at("fileState:scan.plate", 1, "ENOENT");
    expect(await fileState(abs, "scan.plate")).toEqual({ state: "missing" });
  });
});

describe("openStored", () => {
  it("opens a file, gives null for a folder or nothing, and closes what it opened when it fails", async () => {
    const abs = file("open.stl", "abc");
    const opened = await openStored(abs, "serve.supporting");
    expect(opened?.size).toBe(3);
    await opened?.handle.close();
    expect(await openStored(dir, "serve.supporting")).toBeNull();
    expect(await openStored(path.join(dir, "gone.stl"), "serve.supporting")).toBeNull();
    const before = openFiles();
    faults.at("opened:serve.supporting", 1, "EIO");
    await expect(openStored(abs, "serve.supporting")).rejects.toMatchObject({ code: "EIO" });
    expect(openFiles()).toBe(before);
  });
});
