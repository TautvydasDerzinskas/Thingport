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

test("follows a reverse proxy's http to https upgrade on the same host, found out without the credentials", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("http://")) {
      if (init?.redirect === "follow") {
        const probe = new Response(null, { status: 404 });
        Object.defineProperties(probe, {
          redirected: { value: true },
          url: { value: url.replace("http://", "https://") },
        });
        return probe;
      }
      return { type: "opaqueredirect", status: 0 } as Response;
    }
    return new Response("{}", { status: 200 });
  };
  try {
    const res = await fetchInstance("http://lan-upgrade.example/api/login", { method: "POST", body: "secret" });
    assert.equal(res.status, 200);
    assert.deepEqual(
      calls.map((c) => [c.url, c.init?.redirect, c.init?.body ?? null]),
      [
        ["http://lan-upgrade.example/api/login", "manual", "secret"],
        ["http://lan-upgrade.example/api/login", "follow", null],
        ["https://lan-upgrade.example/api/login", "manual", "secret"],
      ],
    );
    // Remembered: the next request goes to https:// straight away.
    calls.length = 0;
    await fetchInstance("http://lan-upgrade.example/api/me", { headers: { Authorization: "Bearer t" } });
    assert.deepEqual(
      calls.map((c) => c.url),
      ["https://lan-upgrade.example/api/me"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.each([
  ["another host", "https://other.example/api/login"],
  ["another path", "https://lan-other.example/login"],
  ["plain http", "http://lan-other.example:8080/api/login"],
])("still refuses a redirect to %s", async (_kind, finalUrl) => {
  const originalFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (init?.redirect === "follow") {
      const probe = new Response(null, { status: 404 });
      Object.defineProperties(probe, { redirected: { value: true }, url: { value: finalUrl } });
      return probe;
    }
    sent.push(String(input));
    return { type: "opaqueredirect", status: 0 } as Response;
  };
  try {
    await assert.rejects(
      fetchInstance("http://lan-other.example/api/login", { method: "POST", body: "secret" }),
      /configure its final URL/,
    );
    assert.deepEqual(sent, ["http://lan-other.example/api/login"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
