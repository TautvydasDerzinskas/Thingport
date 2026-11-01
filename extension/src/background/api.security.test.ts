import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { apiCall, fetchInstance } from "./api";
import { apiUrl, normalizeInstanceUrl } from "../shared/storage";

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

test("apiCall sends a redirected request once, without replaying its token", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let cancelled = false;
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async () => ({
          instanceUrl: "https://thingport.example",
          email: "user@example.test",
          password: "secret",
          token: "valid-token",
          tokenExpiresAt: Date.now() + 60 * 60 * 1000,
        }),
      },
    },
  });
  globalThis.fetch = async () => {
    calls++;
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
      apiCall("PATCH", "/settings/snapmaker-session", { token: "secret" }),
      /redirected a credential-bearing request/,
    );
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
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
    const res = await fetchInstance("http://lan-upgrade.example/api/login", {
      method: "POST",
      body: "secret",
      headers: { Authorization: "Bearer t" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(
      calls.map((c) => [c.url, c.init?.redirect, c.init?.body ?? null]),
      [
        ["http://lan-upgrade.example/api/login", "manual", "secret"],
        ["http://lan-upgrade.example/api/login", "follow", null],
        ["https://lan-upgrade.example/api/login", "manual", "secret"],
      ],
    );
    assert.equal(calls[1].init?.headers, undefined);
    assert.equal(calls[1].init?.credentials, "omit");
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

function fakeUpgradingInstance(upgrades: () => boolean, https: () => Promise<Response>) {
  const sent: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.redirect === "follow") {
      const probe = new Response(null, { status: 404 });
      Object.defineProperties(probe, {
        redirected: { value: true },
        url: { value: url.replace("http://", "https://") },
      });
      return probe;
    }
    sent.push(url);
    if (url.startsWith("https://")) return https();
    return upgrades() ? ({ type: "opaqueredirect", status: 0 } as Response) : new Response("{}", { status: 200 });
  };
  return sent;
}

test("a failed upgraded request forgets the upgrade, so the next one asks the configured address again", async () => {
  const originalFetch = globalThis.fetch;
  let upgrades = true;
  const sent = fakeUpgradingInstance(
    () => upgrades,
    () => Promise.reject(new TypeError("Failed to fetch")),
  );
  try {
    await assert.rejects(fetchInstance("http://gone-upgrade.example/api/me", {}), /connect Grab again/);
    upgrades = false;
    sent.length = 0;
    const res = await fetchInstance("http://gone-upgrade.example/api/me", {});
    assert.equal(res.status, 200);
    assert.deepEqual(sent, ["http://gone-upgrade.example/api/me"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an aborted upgraded request keeps the upgrade: it says nothing about the https:// origin", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const reason = new DOMException("Request aborted", "AbortError");
  let attempts = 0;
  const sent = fakeUpgradingInstance(
    () => true,
    () => {
      if (++attempts > 1) return Promise.resolve(new Response("{}", { status: 200 }));
      controller.abort(reason);
      return Promise.reject(reason);
    },
  );
  try {
    await assert.rejects(
      fetchInstance("http://abort-keeps-upgrade.example/api/me", { signal: controller.signal }),
      (err) => err === reason,
    );
    sent.length = 0;
    await fetchInstance("http://abort-keeps-upgrade.example/api/me", {});
    assert.deepEqual(sent, ["https://abort-keeps-upgrade.example/api/me"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.each([false, true])("upgrade keeps a leading double slash in the instance path (cached: %s)", async (cached) => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  const origin = `http://path-upgrade-${cached}.example`;
  const instanceUrl = normalizeInstanceUrl(`${origin}//other.example/`);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (init?.redirect === "follow") {
      const probe = new Response(null, { status: 404 });
      Object.defineProperties(probe, {
        redirected: { value: true },
        url: { value: url.replace("http://", "https://") },
      });
      return probe;
    }
    if (url.startsWith("http://")) return { type: "opaqueredirect", status: 0 } as Response;
    return new Response("{}", { status: 200 });
  };
  try {
    if (cached) {
      await fetchInstance(`${origin}/api/me`, {});
      calls.length = 0;
    }
    await fetchInstance(apiUrl(instanceUrl, "/login?next=%2Fmodels"), { method: "POST", body: "secret" });
    const expected = [
      [`${origin}//other.example/api/login?next=%2Fmodels`, "secret"],
      [`${origin}//other.example/api/login?next=%2Fmodels`, null],
      [`${origin.replace("http://", "https://")}//other.example/api/login?next=%2Fmodels`, "secret"],
    ];
    assert.deepEqual(
      calls.map((c) => [c.url, c.init?.body ?? null]),
      cached ? expected.slice(-1) : expected,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aborting the caller aborts the upgrade probe without replaying credentials", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const reason = new DOMException("Request timed out", "TimeoutError");
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if (init?.redirect === "follow") {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        controller.abort(reason);
        // Fail promptly even if the probe lost the caller's signal.
        if (!init.signal) reject(new Error("Probe has no abort signal"));
      });
    }
    return { type: "opaqueredirect", status: 0 } as Response;
  };
  try {
    await assert.rejects(
      fetchInstance("http://abort-upgrade.example/api/grab/disconnect", {
        method: "POST",
        body: "secret",
        signal: controller.signal,
      }),
      (err) => err === reason,
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init?.signal, controller.signal);
    assert.equal(calls[1].init?.body, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an abort as the probe completes prevents the upgraded credential request", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const reason = new DOMException("Request aborted", "AbortError");
  const sent: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    sent.push(url);
    if (init?.redirect === "follow") {
      const probe = new Response(null, { status: 404 });
      Object.defineProperties(probe, {
        redirected: { value: true },
        url: { value: url.replace("http://", "https://") },
      });
      controller.abort(reason);
      return probe;
    }
    return new Response(null, { status: 307 });
  };
  try {
    await assert.rejects(
      fetchInstance("http://abort-complete.example/api/logout", { method: "POST", signal: controller.signal }),
      (err) => err === reason,
    );
    assert.deepEqual(sent, ["http://abort-complete.example/api/logout", "http://abort-complete.example/api/logout"]);
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
