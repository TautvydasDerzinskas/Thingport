import { beforeEach, describe, expect, it, vi } from "vitest";

// Snapmaker's sign-in on each of its sites: read from that site's cookies, renewed with that site's token endpoint
// and written back there. Tokens are made up.
type Cookie = { name: string; value: string; domain?: string };
let jars: Record<string, Record<string, string>> = {};
const written: Cookie[] = [];
let granted: string[] = [];
const posted: { url: string; body: string }[] = [];

vi.stubGlobal("chrome", {
  cookies: {
    get: async ({ url, name }: { url: string; name: string }) => {
      const value = jars[url]?.[name];
      return value == null ? null : { name, value };
    },
    set: async (cookie: Cookie & { url: string }) => {
      written.push({ name: cookie.name, value: cookie.value, domain: cookie.domain });
    },
  },
  permissions: {
    contains: async ({ origins }: { origins: string[] }) => origins.every((origin) => granted.includes(origin)),
  },
});
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string, init: RequestInit) => {
    posted.push({ url, body: String(init.body) });
    return Response.json({ code: 200, data: { access_token: fresh, refresh_token: "next-refresh" } });
  }),
);

const { snapmakerChinaSession, snapmakerSession } = await import("./session");

const jwt = (payload: Record<string, unknown>) =>
  `${btoa(JSON.stringify({ alg: "RS256" }))}.${btoa(JSON.stringify(payload))}.sig`;
const hours = (n: number) => Math.floor(Date.now() / 1000) + n * 3600;
const fresh = jwt({ exp: hours(24), userId: 9990001 });

const MAIN = ["*://space.snapmaker.com/*", "*://id.snapmaker.com/*"];
const CHINA = ["*://space.snapmaker.cn/*", "*://id.snapmaker.cn/*"];

beforeEach(() => {
  jars = {};
  written.length = 0;
  posted.length = 0;
  granted = [...MAIN, ...CHINA];
});

describe("Snapmaker's China sign-in", () => {
  it("is read from the China site's cookies, for the sign-in named after it", async () => {
    const token = jwt({ exp: hours(20), userId: 9990001 });
    jars["https://space.snapmaker.cn"] = { login_access_token: token };
    expect(await snapmakerChinaSession.read()).toEqual({ value: token, body: { token }, userId: "9990001" });
    expect(snapmakerChinaSession.slot).toBe("cn");
    expect(snapmakerSession.slot).toBeUndefined();
    expect(posted).toEqual([]);
  });

  it("is renewed by the China site's own token endpoint, and written back on its domain", async () => {
    jars["https://space.snapmaker.cn"] = { login_refresh_token: "cn-refresh" };
    expect((await snapmakerChinaSession.read())?.value).toBe(fresh);
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe("https://id.snapmaker.cn/api/oauth2/token");
    expect(posted[0].body).toContain("refresh_token=cn-refresh");
    expect(written.map((cookie) => [cookie.name, cookie.domain])).toEqual([
      ["login_access_token", ".snapmaker.cn"],
      ["login_refresh_token", ".snapmaker.cn"],
    ]);
  });

  it("never spends the main site's refresh token for it", async () => {
    jars["https://space.snapmaker.com"] = { login_refresh_token: "main-refresh" };
    expect(await snapmakerChinaSession.read()).toBeUndefined();
    expect(posted).toEqual([]);
  });

  it("is left alone where the China site isn't allowed, while the main one still reads", async () => {
    granted = [...MAIN];
    const token = jwt({ exp: hours(20), userId: 1 });
    jars["https://space.snapmaker.cn"] = { login_access_token: token };
    jars["https://space.snapmaker.com"] = { login_access_token: token };
    expect(await snapmakerChinaSession.read()).toBeUndefined();
    expect((await snapmakerSession.read())?.value).toBe(token);
  });
});
