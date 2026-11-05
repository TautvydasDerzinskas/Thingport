import { noteImportActivity } from "../services/importActivity";
import { HttpError } from "./fileUtils";

/** Mutable, and read when used, so a test needn't wait a minute. */
export const bodyReadTuning = {
  /** How long a body may send nothing. Not how long it may take: a slow big file finishes however long that is. */
  idleMs: 60_000,
};

/** The next chunk of a body, or a failure worth trying again once the sender has gone silent. */
export async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new HttpError(400, "The site stopped sending data", undefined, true));
      // Hangs up, or the connection stays open with nobody reading it.
      void reader.cancel().catch(() => undefined);
    }, bodyReadTuning.idleMs);
  });
  try {
    const chunk = await Promise.race([reader.read(), stalled]);
    noteImportActivity();
    return chunk;
  } finally {
    clearTimeout(timer);
  }
}

/** The same body with that limit built in, for a source with no limit of its own, whatever ends up reading it. */
export function withIdleLimit(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const { done, value } = await readChunk(reader);
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel: (reason) => reader.cancel(reason),
    },
    // Reads only when asked, so a reader busy with the last chunk isn't taken for a silent sender.
    { highWaterMark: 0 },
  );
}

/** Reads at most `maxBytes` of a response body, whatever its Content-Length claims. */
export async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ buffer: Buffer; truncated: boolean }> {
  if (!response.body) return { buffer: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await readChunk(reader);
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      const allowed = chunk.length - (total - maxBytes);
      if (allowed > 0) chunks.push(chunk.subarray(0, allowed));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks), truncated };
}
