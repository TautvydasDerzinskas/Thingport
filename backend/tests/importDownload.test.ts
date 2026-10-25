import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadResponseToTemp } from "../src/services/importDownload";

const paths: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(paths.splice(0).map((file) => fs.rm(file, { force: true })));
});

describe("downloadResponseToTemp", () => {
  it("stores every streamed byte in an independent private temporary file", async () => {
    const bytes = Buffer.from("solid example\nendsolid\n");
    const first = await downloadResponseToTemp(new Response(bytes), "../part.stl", bytes.length, 1000);
    paths.push(first);
    const second = await downloadResponseToTemp(new Response(bytes), "part.stl", bytes.length, 1000);
    paths.push(second);
    expect(first).not.toBe(second);
    expect(first).toMatch(/thingport-import-[a-f0-9]+\.stl$/);
    expect(await fs.readFile(first)).toEqual(bytes);
    expect((await fs.stat(first)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(first)).ino).not.toBe((await fs.stat(second)).ino);
  });

  it("rejects an oversized declared response before creating a file", async () => {
    const cancel = vi.fn<() => void>();
    const response = new Response(new ReadableStream({ cancel }), { headers: { "content-length": "20" } });
    const open = vi.spyOn(fs, "open");
    await expect(downloadResponseToTemp(response, "part.stl", 10, 1000)).rejects.toMatchObject({ status: 413 });
    expect(open).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["oversize", "disconnect", "timeout"])("removes partial files after %s", async (failure) => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn<() => void>();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
        cancel,
      }),
    );
    const open = vi.spyOn(fs, "open");
    const pending = downloadResponseToTemp(response, "part.stl", 10, failure === "timeout" ? 30 : 1000).catch(
      (error: unknown) => error,
    );
    controller!.enqueue(Buffer.from("partial"));
    if (failure === "oversize") controller!.enqueue(Buffer.from("too much"));
    if (failure === "disconnect") controller!.error(new Error("connection lost"));
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      failure === "oversize"
        ? "Imported file exceeds size limit"
        : failure === "timeout"
          ? "Imported file download timed out"
          : "connection lost",
    );
    expect(open).toHaveBeenCalledOnce();
    const tempPath = String(open.mock.calls[0][0]);
    await expect(fs.stat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(cancel).toHaveBeenCalledTimes(failure === "disconnect" ? 0 : 1);
  });
});
