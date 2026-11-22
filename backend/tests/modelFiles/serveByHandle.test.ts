import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { STORAGE } from "../../src/config";
import { prisma } from "../../src/db";
import type { StorageSite } from "../../src/modelFiles/storageFs";
import { attachmentDisposition } from "../../src/utils/fileUtils";
import { sendStored } from "../../src/utils/sendStored";
import { hits, pauseAt } from "../harness/lifecycle";
import {
  dropRow,
  giveAwayPath,
  moveRow,
  renameOnto,
  sameSizeAs,
  start,
  useServingSites,
  type Stored,
} from "./servingSites";

// Fs 2 (src/utils/sendStored.ts): a download serves the file it opened, and only while its row, read again, still
// names that path. A file put at the path once it's open never goes out, nor does one whose row went or moved.

const app = createApp();
const sites = useServingSites(app, "serve-by-handle");
const siteCase = (name: string) => sites.find((site) => site.name === name)!;

/** Asks for the file, and once the site has it open, does `meanwhile` before letting it go on. */
async function whileOpen(site: StorageSite, stored: Stored, meanwhile: () => unknown) {
  const gate = pauseAt(`opened:${site}`);
  const answer = start(() => stored.fetch());
  await gate.reachedBy(answer);
  await meanwhile();
  gate.release();
  return answer;
}

describe.each(sites.map((c) => [`${c.name} (${c.site})`, c] as const))("%s", (_title, { site, notFound, make }) => {
  it("serves the bytes it opened, never a file renamed onto the path after", async () => {
    const stored = await make();
    // The same size, so only the open file tells them apart.
    const other = sameSizeAs(stored.bytes);

    const answer = await whileOpen(site, stored, () => renameOnto(stored.abs, other));

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(stored.bytes);
    expect(fs.readFileSync(stored.abs)).toEqual(other);
    expect(hits(`open:${site}`)).toBe(1);
  });

  it("answers 404 when its row went by the time the file is open", async () => {
    const stored = await make();

    const answer = await whileOpen(site, stored, () => dropRow(stored));

    expect(answer).toMatchObject({ status: 404, body: Buffer.from(notFound) });
    // The file's headers go out only with the file.
    expect(answer.headers["content-disposition"]).toBeUndefined();
  });

  it("answers 404 when another row took the path by then", async () => {
    const stored = await make();

    const answer = await whileOpen(site, stored, () => giveAwayPath(stored));

    expect(answer).toMatchObject({ status: 404, body: Buffer.from(notFound) });
  });

  it("answers 404 when its row names another path by then", async () => {
    const stored = await make();

    const answer = await whileOpen(site, stored, () => moveRow(stored));

    expect(answer).toMatchObject({ status: 404, body: Buffer.from(notFound) });
  });
});

describe("a plate's download", () => {
  it("keeps send's Range, ETag and 304, and its own headers", async () => {
    const stored = await siteCase("a plate's download").make();
    const plate = await prisma.plate.findUniqueOrThrow({ where: { id: stored.row.id } });

    const whole = await stored.fetch();
    expect(whole.status).toBe(200);
    expect(whole.body).toEqual(stored.bytes);
    expect(whole.headers).toMatchObject({
      "content-type": plate.mime,
      "content-disposition": attachmentDisposition("Part.stl"),
      "cache-control": "private, max-age=86400",
      "accept-ranges": "bytes",
    });
    // Told from the stored file itself, not from the handle's path.
    const modified = Math.floor(fs.statSync(stored.abs).mtimeMs / 1000) * 1000;
    expect(new Date(whole.headers["last-modified"]!).getTime()).toBe(modified);

    const part = await stored.fetch({ Range: "bytes=6-11" });
    expect(part.status).toBe(206);
    expect(part.headers["content-range"]).toBe(`bytes 6-11/${stored.bytes.length}`);
    expect(part.body).toEqual(stored.bytes.subarray(6, 12));
    expect((await stored.fetch({ "If-None-Match": whole.headers.etag! })).status).toBe(304);
    expect((await stored.fetch({ "If-Modified-Since": whole.headers["last-modified"]! })).status).toBe(304);
    expect(hits("open:serve.plate")).toBe(4);
  });
});

describe("the prepared print's download", () => {
  it("answers 404 when another file became the model's prepared print by then", async () => {
    const stored = await siteCase("the prepared print's download").make();

    const answer = await whileOpen("serve.prepared", stored, async () => {
      const other = await prisma.printFile.create({
        data: {
          printId: stored.printId,
          role: "PREPARED",
          filename: "Other.gcode",
          mime: "text/x-gcode",
          storagePath: `${path.relative(STORAGE, stored.abs)}.other`,
        },
      });
      await prisma.print.update({ where: { id: stored.printId }, data: { preparedFileId: other.id } });
    });

    expect(answer.status).toBe(404);
  });
});

describe("MCP's get_model_file", () => {
  it("says the size of the file it read, not of one put at the path after", async () => {
    const stored = await siteCase("MCP's get_model_file, for a plate").make();

    const answer = await whileOpen("mcp.file", stored, () =>
      renameOnto(stored.abs, Buffer.concat([stored.bytes, Buffer.from("and more")])),
    );

    expect(answer).toMatchObject({ status: 200, body: stored.bytes, size: stored.bytes.length });
  });
});

describe("sendStored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-send-stored-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = (body: string) => {
    const abs = path.join(dir, `${body}.txt`);
    fs.writeFileSync(abs, body);
    return abs;
  };

  /** How often this process has `abs` open: /proc on Linux, lsof elsewhere, which names a file by its real path. */
  function timesOpen(abs: string): number {
    const real = fs.realpathSync(abs);
    if (process.platform !== "linux") {
      const listing = execFileSync("lsof", ["-p", String(process.pid), "-Fn"], { encoding: "utf8" });
      return listing.split("\n").filter((line) => line === `n${real}`).length;
    }
    return fs.readdirSync("/proc/self/fd").filter((fd) => {
      try {
        return fs.readlinkSync(`/proc/self/fd/${fd}`) === real;
      } catch {
        return false;
      }
    }).length;
  }

  /** A response that notes what it's asked to send and how often that file is open then, and answers as send would
   *  with `outcome`. */
  const response = (outcome?: Partial<NodeJS.ErrnoException>, watched?: string) => {
    const res = {
      sentFrom: "",
      openWhileSent: 0,
      headersSent: false,
      removed: [] as string[],
      removeHeader(name: string) {
        res.removed.push(name);
      },
      sendFile(filePath: string, done: (err?: unknown) => void) {
        res.sentFrom = filePath;
        if (watched) res.openWhileSent = timesOpen(watched);
        done(outcome && Object.assign(new Error(outcome.code), outcome));
      },
    };
    return res;
  };

  it("reads by the file's own path where the system can't reopen a handle, and drops the attachment from a 404", async () => {
    const abs = file("by-path");
    const row = { filePath: abs, site: "serve.supporting" as const, stillNames: async () => true, headers: () => {} };
    const realStat = fsp.stat.bind(fsp);
    const noFdPaths = vi
      .spyOn(fsp, "stat")
      .mockImplementation(((target: string, options?: never) =>
        /^\/(dev|proc\/self)\/fd\//.test(String(target))
          ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
          : realStat(target, options)) as typeof fsp.stat);
    const byPath = response();
    await sendStored(byPath as never, row);
    noFdPaths.mockRestore();
    expect(byPath.sentFrom).toBe(abs);
    const gone = response({ code: "ENOENT", syscall: "stat" });
    await expect(sendStored(gone as never, row)).rejects.toMatchObject({ status: 404 });
    expect(gone.removed).toEqual(["Content-Disposition"]);
  });

  it("closes the file it opened: once sent, when its row changed, and when reading the row failed", async () => {
    const abs = file("kept");
    let headersSet = 0;
    const row = (stillNames: () => Promise<boolean>) => ({
      filePath: abs,
      site: "serve.supporting" as const,
      stillNames,
      headers: () => void headersSet++,
    });

    const sent = response(undefined, abs);
    await sendStored(
      sent as never,
      row(async () => true),
    );
    await expect(
      sendStored(
        response() as never,
        row(async () => false),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      sendStored(
        response() as never,
        row(() => Promise.reject(new Error("The database went away"))),
      ),
    ).rejects.toThrow(/database/);

    // Open while it was sent, from the handle's path, and closed after; each time.
    expect(sent.sentFrom).toMatch(/^\/(dev|proc\/self)\/fd\/\d+$/);
    expect(sent.openWhileSent).toBe(1);
    expect(headersSet).toBe(1);
    expect(timesOpen(abs)).toBe(0);
  });

  it("passes on what send fails with, and answers 404 only for a file that isn't there", async () => {
    const row = { filePath: file("sent"), site: "serve.supporting" as const, stillNames: async () => true };
    const send = (outcome: Partial<NodeJS.ErrnoException>) =>
      sendStored(response(outcome) as never, { ...row, headers: () => undefined });

    await expect(send({ code: "EIO", syscall: "read" })).rejects.toMatchObject({ code: "EIO" });
    await expect(send({ code: "ENOENT", syscall: "stat" })).rejects.toMatchObject({ status: 404 });
    // A client that went away, or a write that failed, only ends the answer, as express has it.
    await expect(send({ code: "ECONNABORTED" })).resolves.toBeUndefined();
    await expect(send({ code: "EPIPE", syscall: "write" })).resolves.toBeUndefined();
  });
});
