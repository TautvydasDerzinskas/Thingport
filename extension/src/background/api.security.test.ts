import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchInstance } from "./api";

test("instance redirects cannot replay a provider session", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let cancelled = false;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, "manual");
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { status: 307, headers: { Location: "https://other.example/receive" } },
    );
  };
  try {
    await assert.rejects(
      fetchInstance("https://thingport.example/api/settings/snapmaker-session", {
        method: "PATCH",
        body: JSON.stringify({ token: "secret" }),
      }),
      /redirected a credential-bearing request/,
    );
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
