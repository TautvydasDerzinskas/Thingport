import fs from "node:fs";
import type { Server } from "node:http";
import os from "node:os";
import { join } from "node:path";
import { Test } from "supertest";
import { vi } from "vitest";

// backend/.env is the dev instance's: its database, its storage folder and its FlareSolverr. config.ts loads it, but
// never over a variable already set, so the suite sets its own first. The database has to be given, as CI does: the
// suite registers accounts and deletes rows. An empty FLARESOLVERR_URL counts as set, so .env's stays out.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "Set DATABASE_URL to a test database (see docs/DEVELOPMENT.md): the one in backend/.env is the dev instance's.",
  );
}
const storage = process.env.FILE_STORAGE || join(os.tmpdir(), "thingport-test-storage");
fs.mkdirSync(storage, { recursive: true });
// By its real path: services compare the real paths of what they move, and macOS's temp folders are behind links.
process.env.FILE_STORAGE = fs.realpathSync(storage);
process.env.FLARESOLVERR_URL ??= "";

// supertest's request(app) listens on port 0 on every interface, then connects to 127.0.0.1 on the
// port it got. On macOS a wildcard bind succeeds even when another program already holds that port
// on 127.0.0.1 alone (VS Code helpers and limactl do), and that program takes the connection: the
// test then gets someone else's reply -- "Parse Error: Expected HTTP/", or a body without the field
// it expects -- in whichever test happens to draw the port.
//
// Binding to 127.0.0.1 itself means the port it's given is free there. That bind is asynchronous,
// though, and supertest reads the port the moment the request is built, so the bind waits until
// the request is sent and the port is filled into its URL then.
const PLACEHOLDER = "127.0.0.1:0";

type DeferredTest = InstanceType<typeof Test> & {
  url: string;
  _server?: Server;
  unboundApp?: Server;
};

const proto = Test.prototype as unknown as {
  serverAddress(this: DeferredTest, app: Server, path: string): string;
  end(this: DeferredTest, fn?: (err: unknown, res: unknown) => void): DeferredTest;
};
const { serverAddress, end } = proto;

proto.serverAddress = function (app, path) {
  if (app.address()) return serverAddress.call(this, app, path);
  this.unboundApp = app;
  return `http://${PLACEHOLDER}${path}`;
};

proto.end = function (fn) {
  const app = this.unboundApp;
  if (!app) return end.call(this, fn);
  this.unboundApp = undefined;
  app.once("error", (err) => fn?.(err, undefined));
  app.listen(0, "127.0.0.1", () => {
    const { port } = app.address() as { port: number };
    // supertest's own field: it closes this server once the response is in.
    // eslint-disable-next-line no-underscore-dangle
    this._server = app;
    this.url = this.url.replace(PLACEHOLDER, `127.0.0.1:${port}`);
    end.call(this, fn);
  });
  return this;
};

// Tests mock global.fetch; send browserFetch through it too, read at call time so each test's mock applies.
vi.mock("../src/utils/browserFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/browserFetch")>()),
  browserFetch: (
    url: string,
    {
      method,
      body,
      headers,
      signal,
      redirect,
    }: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
      signal?: AbortSignal;
      redirect?: RequestRedirect;
    },
  ) => fetch(url, { method, body, headers, signal, redirect }),
}));
