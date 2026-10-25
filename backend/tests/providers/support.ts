import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { writeZip } from "../../src/utils/zipWriter";

// Shared by the provider contract suite (contract.ts) and the provider test files: recorded-fixture loading, a
// fetch stub that records what the code under test sent, and the binary files (3MF, STL, zip, PNG) the stubbed
// providers hand out. Nothing here talks to a real site.

export const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const FIXTURES = path.join(__dirname, "..", "fixtures", "providers");

/** A recorded response (or request-body sample) from `tests/fixtures/providers/<provider>/<name>.json`. A fresh copy
 *  on every call, so a test can edit it. */
export function loadFixture<T = Record<string, any>>(provider: string, name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, provider, `${name}.json`), "utf8")) as T;
}

/** A recorded page (`<name>.html`) from the same folder. */
export function loadFixtureHtml(provider: string, name: string): string {
  return fs.readFileSync(path.join(FIXTURES, provider, `${name}.html`), "utf8");
}

/** Fails the test with `message` when `condition` doesn't hold, from where `expect` can't be (a stub's handler). */
export function assertThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The response's status, with its body in the failure when it isn't `status`. */
export function expectStatus(res: { status: number; body: unknown }, status: number): void {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function text(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });
}

export function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}

export function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

export function binary(bytes: Buffer, contentType = "application/octet-stream"): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });
}

export function cloudflareChallenge(): Response {
  return new Response("<!DOCTYPE html><title>Just a moment...</title>", {
    status: 403,
    headers: { "content-type": "text/html", "cf-mitigated": "challenge", server: "cloudflare" },
  });
}

// ---- Binary files ----

const files = new Map<string, Buffer>();

async function cached(key: string, build: () => Promise<Buffer>): Promise<Buffer> {
  const hit = files.get(key);
  if (hit) return hit;
  const made = await build();
  files.set(key, made);
  return made;
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "thingport-contract-"));
  try {
    return await run(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A valid 3MF (one tetrahedron and a plate picture). `seed` goes into it as a comment, so files built from
 *  different seeds differ byte for byte and are never taken for the same file. */
export function threeMf(seed = "a"): Promise<Buffer> {
  return cached(`3mf:${seed}`, () =>
    withTempDir(async (dir) => {
      const modelPath = path.join(dir, "3dmodel.model");
      await fsp.writeFile(
        modelPath,
        `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${seed} -->
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter">
 <resources><object id="1" type="model"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices>
  <triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/></triangles>
 </mesh></object></resources>
 <build><item objectid="1"/></build>
</model>`,
      );
      const thumbPath = path.join(dir, "plate_1.png");
      await fsp.writeFile(thumbPath, ONE_PIXEL_PNG);
      const zipPath = path.join(dir, "model.3mf");
      await writeZip(zipPath, [
        { arcname: "3D/3dmodel.model", filePath: modelPath },
        { arcname: "Metadata/plate_1.png", filePath: thumbPath },
      ]);
      return fsp.readFile(zipPath);
    }),
  );
}

/** A tiny ASCII STL, different for every `seed`. */
export function stl(seed = "a"): Buffer {
  return Buffer.from(
    `solid ${seed}\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid ${seed}\n`,
  );
}

/** A zip of `entries` (archive name to bytes). */
export function zip(key: string, entries: Record<string, Buffer>): Promise<Buffer> {
  return cached(`zip:${key}`, () =>
    withTempDir(async (dir) => {
      const described: { arcname: string; filePath: string }[] = [];
      let index = 0;
      for (const [arcname, bytes] of Object.entries(entries)) {
        const filePath = path.join(dir, `entry-${index++}`);
        await fsp.writeFile(filePath, bytes);
        described.push({ arcname, filePath });
      }
      const zipPath = path.join(dir, "out.zip");
      await writeZip(zipPath, described);
      return fsp.readFile(zipPath);
    }),
  );
}

// ---- Stubbing fetch ----

/** What the code under test sent: headers' names in lower case, the body as the text it was. */
export type RecordedCall = {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  /** The JSON body, when it was one. */
  json: any;
};

/** Answers a call, or returns undefined for one it doesn't know (a picture still gets a PNG; anything else fails). */
export type FetchHandler = (call: RecordedCall) => Response | Promise<Response | undefined> | undefined;

export type FetchStub = { calls: RecordedCall[]; restore(): void; callsTo(host: string): RecordedCall[] };

const IMAGE_PATH = /\.(png|jpe?g|webp|gif)$/i;

function headerRecord(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = init?.headers;
  if (!raw) return out;
  const entries = raw instanceof Headers ? [...raw.entries()] : Array.isArray(raw) ? raw : Object.entries(raw);
  for (const [name, value] of entries) out[name.toLowerCase()] = String(value);
  return out;
}

/** Replaces global fetch with `handler` for the test. Every call is recorded; a call nobody answers throws, so a
 *  provider never reaches a real site by accident. Pictures (by file extension) are answered with a PNG when the
 *  handler leaves them. `restore` puts the real fetch back. */
export function installFetch(handler: FetchHandler): FetchStub {
  const original = global.fetch;
  const calls: RecordedCall[] = [];
  global.fetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" ? init.body : null;
    let parsed: unknown = null;
    if (body) {
      try {
        parsed = JSON.parse(body);
      } catch {}
    }
    const call: RecordedCall = {
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: headerRecord(init),
      body,
      json: parsed,
    };
    calls.push(call);
    const answer = await handler(call);
    if (answer) return answer;
    if (IMAGE_PATH.test(url.pathname)) return binary(ONE_PIXEL_PNG, "image/png");
    throw new Error(`Unexpected fetch to ${call.method} ${url}`);
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      global.fetch = original;
    },
    callsTo: (host) => calls.filter((call) => call.url.hostname === host),
  };
}
