import { HttpError } from "./fileUtils";

/** Reads at most `maxBytes` of a response body, whatever its Content-Length claims. */
export async function readCapped(
  response: Response,
  maxBytes: number,
  timeoutMs?: number,
): Promise<{ buffer: Buffer; truncated: boolean }> {
  if (!response.body) return { buffer: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  let timedOut = false;
  let cancellation: Promise<void> | undefined;
  const timeout =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          cancellation = reader.cancel().catch(() => undefined);
        }, timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
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
    if (timedOut) throw new HttpError(408, "Imported page download timed out");
  } catch (err) {
    if (timedOut) throw new HttpError(408, "Imported page download timed out");
    throw err;
  } finally {
    clearTimeout(timeout);
    // Keep the caller's worker until the underlying stream has stopped.
    await cancellation;
    reader.releaseLock();
  }
  return { buffer: Buffer.concat(chunks), truncated };
}
