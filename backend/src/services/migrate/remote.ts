import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { MigrateError } from "./errors";
import type { SourceFiles } from "./sourceFiles";

// Copying another Thingport instance online, with a token its admin made there (services/migrate/export.ts is that
// side). The address is the admin's to give, often on the local network and over plain HTTP, so it's fetched as
// given; a redirect is refused, so the token only ever goes where the admin said.

export type Remote = { address: string; token: string };

const INFO_TIMEOUT_MS = 15_000;
const MISSING_BATCH = 500;
/** How long the old instance may send nothing, once asked, before it's taken to have stopped answering: a big file
 *  takes as long as it takes, as long as it keeps coming. Without one, a merge reading a file that never finishes
 *  would hold the migration until a restart. */
export const remoteTuning = { idleMs: 5 * 60_000 };

/** The address as the requests start: http or https, without a trailing slash, query or fragment. */
export function normalizeAddress(given: string): string {
  let url: URL;
  try {
    url = new URL(given.trim());
  } catch {
    throw new MigrateError("online_address", "Give the old instance's address, starting with http:// or https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MigrateError("online_address", "Give the old instance's address, starting with http:// or https://.");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

const stoppedAnswering = (remote: Remote) =>
  new MigrateError("online_lost", "The old instance stopped answering.", { address: remote.address });

/** A deadline that moves on each time something comes, and stops the request when it passes. */
type Idle = { signal: AbortSignal; touch: () => void; done: () => void; passed: () => boolean };

function idleDeadline(...others: (AbortSignal | null | undefined)[]): Idle {
  const idle = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), remoteTuning.idleMs);
  };
  touch();
  return {
    signal: AbortSignal.any([idle.signal, ...others.filter((other): other is AbortSignal => Boolean(other))]),
    touch,
    done: () => clearTimeout(timer),
    passed: () => idle.signal.aborted,
  };
}

/** Asks the old instance, its answer's body to be read with `idle` moved on as it comes and `done` once it's read.
 *  `signal` aborting is the run's own stop, passed on as it is; `init.signal` is a deadline, which reads as the old
 *  instance not being reachable. */
async function call(
  remote: Remote,
  route: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<{ res: Response; idle: Idle }> {
  const idle = idleDeadline(signal, init.signal);
  try {
    const res = await fetch(`${remote.address}/api/migrate-export${route}`, {
      ...init,
      headers: { Authorization: `Bearer ${remote.token}`, ...(init.headers as Record<string, string> | undefined) },
      redirect: "error",
      signal: idle.signal,
    });
    idle.touch();
    return { res, idle };
  } catch (err) {
    idle.done();
    if (signal?.aborted) throw err;
    if (idle.passed()) throw stoppedAnswering(remote);
    throw new MigrateError("online_unreachable", `This server can't reach ${remote.address}.`, {
      address: remote.address,
    });
  }
}

/** The answer's JSON, or the old instance stopped answering while it came. One that isn't JSON fails as it is. */
async function readJson<T>(res: Response, idle: Idle, remote: Remote, signal?: AbortSignal): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (err) {
    if (signal?.aborted || err instanceof SyntaxError) throw err;
    throw stoppedAnswering(remote);
  } finally {
    idle.done();
  }
}

/** Why the old instance said no, as the reason the app shows. */
async function refusal(res: Response, remote: Remote): Promise<MigrateError> {
  let body: { detail?: unknown; code?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Not one of its own answers: a proxy's, or no Thingport at all.
  }
  if (res.status === 401) {
    return new MigrateError("online_token", "The old instance turned the token down. Create a new one there.");
  }
  if (res.status === 404 && body.code === undefined) {
    return new MigrateError(
      "online_old",
      "The old instance can't be copied online: update it, or bring it over with a database dump.",
    );
  }
  if (body.code === "folder_too_large") {
    return new MigrateError("online_folder", "A folder on the old instance has more files than can be copied online.", {
      limit: Number((body as { limit?: unknown }).limit) || 0,
    });
  }
  if (body.code === "no_dump_tool" || body.code === "dump_failed" || body.code === "no_database") {
    return new MigrateError(
      "online_dump",
      typeof body.detail === "string" ? body.detail : "The old instance couldn't make its database dump.",
    );
  }
  return new MigrateError("online_lost", `The old instance answered ${res.status}.`, { address: remote.address });
}

export type RemoteInfo = { version: string | null; people: number; models: number };

/** What the old instance says of itself, which also proves the address and the token. */
export async function remoteInfo(remote: Remote): Promise<RemoteInfo> {
  const { res, idle } = await call(remote, "/info", { signal: AbortSignal.timeout(INFO_TIMEOUT_MS) });
  if (!res.ok) throw await refused(res, idle, remote);
  const body = await readJson<Partial<RemoteInfo>>(res, idle, remote);
  return {
    version: typeof body.version === "string" ? body.version : null,
    people: Number(body.people) || 0,
    models: Number(body.models) || 0,
  };
}

/** Why it said no, once its answer is read. */
async function refused(res: Response, idle: Idle, remote: Remote): Promise<MigrateError> {
  try {
    return await refusal(res, remote);
  } finally {
    idle.done();
  }
}

/** Saves the body to `to`, under another name until it's whole. */
async function save(res: Response, idle: Idle, to: string, onBytes?: (bytes: number) => void): Promise<void> {
  try {
    if (!res.body) throw new Error("An empty answer");
    await fs.mkdir(path.dirname(to), { recursive: true });
    const part = `${to}.part`;
    let bytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        idle.touch();
        bytes += chunk.length;
        onBytes?.(bytes);
        done(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), counter, createWriteStream(part));
      await fs.rename(part, to);
    } catch (err) {
      await fs.rm(part, { force: true }).catch(() => undefined);
      throw err;
    }
  } finally {
    idle.done();
  }
}

/** Downloads the old instance's database dump to `file`. */
export async function downloadDump(
  remote: Remote,
  file: string,
  onBytes: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { res, idle } = await call(remote, "/dump", {}, signal);
  if (!res.ok) throw await refused(res, idle, remote);
  try {
    await save(res, idle, file, onBytes);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new MigrateError("online_lost", "The old instance stopped answering while its dump came.", {
      address: remote.address,
    });
  }
}

/** The old instance's files, read over the network by the paths its database gives them. A file it hasn't got is
 *  missing; one it can't send stops the migration, which can be started again once it can. Every request stops when
 *  `signal` aborts, as when the run is discarded, and when the old instance sends nothing for a while. */
export function httpSource(remote: Remote, signal?: AbortSignal): SourceFiles {
  const file = (relative: string) => `/file?path=${encodeURIComponent(relative)}`;
  const copy = async (relative: string, to: string): Promise<boolean> => {
    signal?.throwIfAborted();
    const { res, idle } = await call(remote, file(relative), {}, signal);
    if (res.status === 404) {
      idle.done();
      return false;
    }
    if (!res.ok) throw await refused(res, idle, remote);
    try {
      await save(res, idle, to);
    } catch (err) {
      if (signal?.aborted) throw err;
      throw stoppedAnswering(remote);
    }
    return true;
  };
  return {
    exists: async (relative) => {
      signal?.throwIfAborted();
      const { res, idle } = await call(remote, file(relative), { method: "HEAD" }, signal);
      if (!res.ok && res.status !== 404) throw await refused(res, idle, remote);
      idle.done();
      return res.status !== 404;
    },
    missing: async (paths) => {
      const missing: string[] = [];
      for (let start = 0; start < paths.length; start += MISSING_BATCH) {
        signal?.throwIfAborted();
        const { res, idle } = await call(
          remote,
          "/missing",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: paths.slice(start, start + MISSING_BATCH) }),
          },
          signal,
        );
        if (!res.ok) throw await refused(res, idle, remote);
        missing.push(...(await readJson<{ missing: string[] }>(res, idle, remote, signal)).missing);
      }
      return missing;
    },
    copy,
    copyFolder: async (relative, to) => {
      signal?.throwIfAborted();
      const { res, idle } = await call(remote, `/folder?path=${encodeURIComponent(relative)}`, {}, signal);
      if (!res.ok) throw await refused(res, idle, remote);
      const { files } = await readJson<{ files: string[] }>(res, idle, remote, signal);
      let copied = 0;
      for (const name of files) {
        // Only names inside the folder: they're the old instance's to give.
        const target = path.resolve(to, name);
        if (!target.startsWith(path.resolve(to) + path.sep)) continue;
        if (await copy(path.posix.join(relative.split(path.sep).join("/"), name), target)) copied += 1;
      }
      return copied;
    },
  };
}
