import assert from "node:assert/strict";
import { test } from "vitest";
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

test.each(["opaque", "same-origin"])("instance rejects %s redirects without replaying credentials", async (kind) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (kind === "opaque") return { type: "opaqueredirect" } as Response;
    return new Response(null, { status: 307, headers: { Location: "/new-path" } });
  };
  try {
    await assert.rejects(
      fetchInstance("https://thingport.example/api/login", { method: "POST", body: "secret" }),
      /configure its final URL/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
