import { beforeEach, describe, expect, it, vi } from "vitest";

const apiCall = vi.fn<(method: string, path: string, body?: unknown) => Promise<unknown>>();
let config: Record<string, unknown>;

vi.mock("./api", () => ({
  apiCall: (method: string, path: string, body?: unknown) => apiCall(method, path, body),
  requireConfig: async () => ({ ...config }),
}));

const cookies = new Map<string, string>();
const store: Record<string, unknown> = {};

vi.stubGlobal("chrome", {
  cookies: {
    get: async ({ url, name }: { url: string; name: string }) => {
      const value = cookies.get(`${new URL(url).hostname} ${name}`);
      return value === undefined ? null : { value };
    },
    getAll: async () => [],
  },
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (values: Record<string, unknown>) => {
        Object.assign(store, values);
        Object.assign(config, values);
      },
    },
  },
  permissions: { contains: async () => true },
});

const { syncSession } = await import("./sessionSync");

const NEXPRINT_TOKEN = "a".repeat(32);

describe("syncSession", () => {
  beforeEach(() => {
    apiCall.mockReset().mockResolvedValue(null);
    cookies.clear();
    for (const key of Object.keys(store)) delete store[key];
    config = { instanceUrl: "https://thingport.test", email: "me@example.com" };
  });

  it("sends a sign-in once, at the endpoint its manifest names", async () => {
    cookies.set("www.nexprint.com auth_token", NEXPRINT_TOKEN);
    await syncSession("nexprint");
    await syncSession("nexprint");
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledWith("PATCH", "/settings/nexprint-session", {
      token: NEXPRINT_TOKEN,
      expires_at: null,
    });
  });

  it("sends it again to another Thingport account", async () => {
    cookies.set("www.nexprint.com auth_token", NEXPRINT_TOKEN);
    await syncSession("nexprint");
    config.email = "someone@example.com";
    await syncSession("nexprint");
    expect(apiCall).toHaveBeenCalledTimes(2);
  });

  it("clears on signing out the sign-in Grab sent, and only that one", async () => {
    await syncSession("nexprint");
    expect(apiCall).not.toHaveBeenCalled();

    cookies.set("www.nexprint.com auth_token", NEXPRINT_TOKEN);
    await syncSession("nexprint");
    cookies.clear();
    await syncSession("nexprint");
    expect(apiCall).toHaveBeenLastCalledWith("PATCH", "/settings/nexprint-session", { token: null });
    expect(store.lastSyncedSessions).toEqual({});
  });

  it("sends a credential other than the default one at its own endpoint", async () => {
    cookies.set("cults3d.com _session_id", "abc");
    await syncSession("cults3d");
    expect(apiCall).toHaveBeenCalledWith("PATCH", "/settings/cults3d-session", {
      session: "_session_id=abc",
      user_agent: navigator.userAgent,
    });
  });

  it("says who's signed in, and keeps every provider's last sign-in when they sync at once", async () => {
    cookies.set("www.crealitycloud.com model_token", "t");
    cookies.set("www.crealitycloud.com model_user_id", "42");
    cookies.set("www.nexprint.com auth_token", NEXPRINT_TOKEN);
    const [creality] = await Promise.all([syncSession("crealitycloud"), syncSession("nexprint")]);
    expect(creality).toEqual({ userId: "42" });
    expect(Object.keys(store.lastSyncedSessions as object).toSorted()).toEqual(["crealitycloud", "nexprint"]);
  });

  it("does nothing for a provider with no sign-in to send", async () => {
    expect(await syncSession("printables")).toEqual({ userId: null });
    expect(apiCall).not.toHaveBeenCalled();
  });
});
