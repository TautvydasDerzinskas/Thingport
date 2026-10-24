import assert from "node:assert/strict";
import { test } from "node:test";
import { providerCredentialRequest } from "./providerCredentialRequest";

test("provider credentials use only listed HTTPS hosts and never follow redirects", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; redirect: RequestRedirect | undefined }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), redirect: init?.redirect });
    return new Response("ok");
  };
  try {
    await providerCredentialRequest("printables-api", "https://api.printables.com/graphql/", {});
    await providerCredentialRequest("thangs-site", "https://www.thangs.com/api/v4/models/1", {});
    assert.deepEqual(calls, [
      { url: "https://api.printables.com/graphql/", redirect: "error" },
      { url: "https://www.thangs.com/api/v4/models/1", redirect: "error" },
    ]);
    for (const url of [
      "http://api.printables.com/graphql/",
      "https://fake-api.printables.com/graphql/",
      "https://api.printables.com:444/graphql/",
    ]) {
      assert.throws(() => providerCredentialRequest("printables-api", url, {}), /Refusing to send/);
    }
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
