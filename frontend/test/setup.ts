// In the browser, an asset imported with `?url` is a path the server answers; under Vitest there is no server,
// so `fetch("/src/assets/...")` has nothing to reach. Rather than teaching the SDK about tests, the paths Vite
// would serve are answered here from the files they came from.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/src/") || url.startsWith("/@fs/")) {
    const file = url.startsWith("/@fs/") ? url.slice("/@fs".length) : path.join(root, url);
    try {
      const bytes = await readFile(file.split("?")[0]);
      return new Response(bytes as unknown as BodyInit, { status: 200 });
    } catch {
      return new Response(null, { status: 404 });
    }
  }
  return realFetch(input, init);
}) as typeof fetch;
