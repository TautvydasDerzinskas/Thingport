import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolsApi } from "./tools";

// A Headers object spreads to nothing -- `{ ...authHeaders() }` silently drops the bearer token and the request
// comes back 401, which the app reads as a session that ended and sends the user to the sign-in form. Every call
// is driven here and asked for its Authorization header, so the next one written that way fails in CI instead.

const TOKEN = "test-token";

function fakeStorage(): Storage {
  const values = new Map<string, string>([["thingport_auth_token", TOKEN]]);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    key: () => null,
    length: values.size,
  } as Storage;
}

/** Every toolsApi call, by the name it has in the module. */
const calls: Record<string, () => Promise<unknown>> = {
  list: () => toolsApi.list(),
  save: () => toolsApi.save({ slug: "t", metadata: "{}", script: "", html: null }),
  remove: () => toolsApi.remove("id"),
  models: () => toolsApi.models("id"),
  fetchNeededModels: () => toolsApi.fetchNeededModels("id", ["key"]),
  storageKeys: () => toolsApi.storageKeys("id"),
  storageGet: () => toolsApi.storageGet("id", "key"),
  storageSet: () => toolsApi.storageSet("id", "key", { a: 1 }),
  storageDelete: () => toolsApi.storageDelete("id", "key"),
  fetchVia: () => toolsApi.fetchVia("id", "https://example.test/"),
  catalog: () => toolsApi.catalog(),
  install: () => toolsApi.install("slug", true),
  importModels: () => toolsApi.importModels("slug"),
  uninstall: () => toolsApi.uninstall("slug"),
  fetchModels: () => toolsApi.fetchModels("slug"),
  getAccess: () => toolsApi.getAccess(),
  setAccess: () => toolsApi.setAccess({ audience: "everyone" }),
  ownInUse: () => toolsApi.ownInUse(),
};

describe("toolsApi", () => {
  let sent: Request[];

  beforeEach(() => {
    sent = [];
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push(new Request(new URL(String(input), "http://test.local"), init));
      // fetchVia unwraps the answer it gets; the rest only need valid JSON.
      return Promise.resolve(
        new Response(JSON.stringify({ models: [], keys: [], status: 200, contentType: null, body: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(Object.keys(calls))("sends the bearer token on %s", async (name) => {
    await calls[name]();
    expect(sent).toHaveLength(1);
    expect(sent[0].headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it.each(["save", "fetchNeededModels", "storageSet", "fetchVia", "install", "setAccess"])(
    "sends %s as JSON, with its body",
    async (name) => {
      await calls[name]();
      expect(sent[0].headers.get("Content-Type")).toBe("application/json");
      await expect(sent[0].text()).resolves.not.toBe("");
    },
  );
});
