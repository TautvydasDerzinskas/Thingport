import http from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { readCapped } from "../src/utils/readCapped";

afterEach(() => vi.useRealTimers());

it("waits for cancellation to finish before releasing a timed out page", async () => {
  vi.useFakeTimers();
  let finishCancellation!: () => void;
  const cancel = vi.fn<() => Promise<void>>(
    () =>
      new Promise<void>((resolve) => {
        finishCancellation = resolve;
      }),
  );
  const response = new Response(new ReadableStream({ cancel }));
  let settled = false;
  const result = readCapped(response, 1024, 50).catch((err) => {
    settled = true;
    return err;
  });
  await vi.advanceTimersByTimeAsync(50);
  expect(cancel).toHaveBeenCalledOnce();
  expect(settled).toBe(false);
  finishCancellation();
  expect(await result).toMatchObject({ status: 408, message: "Imported page download timed out" });
  expect(response.body?.locked).toBe(false);
});

it("closes a real HTTP body that sends headers and then stalls", async () => {
  let bodyClosed = false;
  const server = http.createServer((_req, res) => {
    res.on("close", () => {
      bodyClosed = true;
    });
    res.writeHead(200, { "content-type": "text/html" });
    res.write("<html>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as import("node:net").AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}`);
    await expect(readCapped(response, 1024, 25)).rejects.toMatchObject({ status: 408 });
    expect(response.body?.locked).toBe(false);
    await vi.waitFor(() => expect(bodyClosed).toBe(true));
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

it("still returns complete and capped bodies with a deadline", async () => {
  await expect(readCapped(new Response("hello"), 10, 1000)).resolves.toEqual({
    buffer: Buffer.from("hello"),
    truncated: false,
  });
  await expect(readCapped(new Response("hello"), 3, 1000)).resolves.toEqual({
    buffer: Buffer.from("hel"),
    truncated: true,
  });
});
