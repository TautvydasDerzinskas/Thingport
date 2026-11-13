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

async function call(remote: Remote, route: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${remote.address}/api/migrate-export${route}`, {
      ...init,
      headers: { Authorization: `Bearer ${remote.token}`, ...(init.headers as Record<string, string> | undefined) },
      redirect: "error",
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new MigrateError("online_unreachable", `This server can't reach ${remote.address}.`, {
      address: remote.address,
    });
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
  const res = await call(remote, "/info", { signal: AbortSignal.timeout(INFO_TIMEOUT_MS) });
  if (!res.ok) throw await refusal(res, remote);
  const body = (await res.json()) as Partial<RemoteInfo>;
  return {
    version: typeof body.version === "string" ? body.version : null,
    people: Number(body.people) || 0,
    models: Number(body.models) || 0,
  };
}

/** Saves the body to `to`, under another name until it's whole. */
async function save(res: Response, to: string, onBytes?: (bytes: number) => void): Promise<void> {
  if (!res.body) throw new Error("An empty answer");
  await fs.mkdir(path.dirname(to), { recursive: true });
  const part = `${to}.part`;
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
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
}

/** Downloads the old instance's database dump to `file`. */
export async function downloadDump(
  remote: Remote,
  file: string,
  onBytes: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await call(remote, "/dump", { signal });
  if (!res.ok) throw await refusal(res, remote);
  try {
    await save(res, file, onBytes);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new MigrateError("online_lost", "The old instance stopped answering while its dump came.", {
      address: remote.address,
    });
  }
}

/** The old instance's files, read over the network by the paths its database gives them. A file it hasn't got is
 *  missing; one it can't send stops the migration, which can be started again once it can. */
export function httpSource(remote: Remote): SourceFiles {
  const file = (relative: string) => `/file?path=${encodeURIComponent(relative)}`;
  const copy = async (relative: string, to: string): Promise<boolean> => {
    const res = await call(remote, file(relative));
    if (res.status === 404) return false;
    if (!res.ok) throw await refusal(res, remote);
    try {
      await save(res, to);
    } catch {
      throw new MigrateError("online_lost", "The old instance stopped answering.", { address: remote.address });
    }
    return true;
  };
  return {
    exists: async (relative) => {
      const res = await call(remote, file(relative), { method: "HEAD" });
      if (res.status === 404) return false;
      if (!res.ok) throw await refusal(res, remote);
      return true;
    },
    missing: async (paths) => {
      const missing: string[] = [];
      for (let start = 0; start < paths.length; start += MISSING_BATCH) {
        const res = await call(remote, "/missing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: paths.slice(start, start + MISSING_BATCH) }),
        });
        if (!res.ok) throw await refusal(res, remote);
        missing.push(...((await res.json()) as { missing: string[] }).missing);
      }
      return missing;
    },
    copy,
    copyFolder: async (relative, to) => {
      const res = await call(remote, `/folder?path=${encodeURIComponent(relative)}`);
      if (!res.ok) throw await refusal(res, remote);
      const { files } = (await res.json()) as { files: string[] };
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
