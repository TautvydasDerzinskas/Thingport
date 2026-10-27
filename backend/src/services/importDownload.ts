import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "../utils/fileUtils";

/** Stores an already resolved response. URL validation, authentication and retries belong to the caller. */
export async function downloadResponseToTemp(
  response: Response,
  filename: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const tooLarge = () => new HttpError(413, "Imported file exceeds size limit");
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  const tempPath = path.join(
    os.tmpdir(),
    `thingport-import-${crypto.randomBytes(16).toString("hex")}${path.extname(filename)}`,
  );
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tempPath, "wx", 0o600);
    let total = 0;
    const capped = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        total += chunk.length;
        callback(total > maxBytes ? tooLarge() : null, chunk);
      },
    });
    await pipeline(
      response.body ? Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]) : Readable.from([]),
      capped,
      handle.createWriteStream(),
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    return tempPath;
  } catch (err) {
    await response.body?.cancel().catch(() => undefined);
    if (handle) {
      await handle.close();
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
    if (err instanceof Error && err.name === "AbortError") throw new HttpError(408, "Imported file download timed out");
    throw err;
  } finally {
    await handle?.close();
  }
}
