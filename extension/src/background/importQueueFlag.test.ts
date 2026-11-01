import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginResult } from "../shared/api";
import { CONFIG_CHANGE_KEYS, STORAGE_KEYS } from "../shared/storage";

// Whether the instance gives everyone an import queue: read from /health, stored, and what canQueue makes of it.
const INSTANCE = "http://192.168.1.20:8080";
const OTHER_INSTANCE = "http://thingport.home.arpa";

type Health = Response | "unreachable" | Promise<Response>;

const answered = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let health: Health;
let login: Response;
const fetches: { url: string; init: RequestInit }[] = [];
const store: Record<string, unknown> = {};
const writes: Record<string, unknown>[] = [];

vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
  fetches.push({ url, init });
  if (url.endsWith("/api/health")) {
    if (health === "unreachable") throw new TypeError("Failed to fetch");
    return (await health).clone();
  }
  if (url.endsWith("/api/login") || url.endsWith("/api/grab/session")) return login.clone();
  if (url.endsWith("/api/logout")) return answered({});
  throw new Error(`Unexpected request: ${url}`);
});

vi.stubGlobal("chrome", {
  action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined },
  storage: {
    local: {
      get: async () => ({ ...store }),
      set: async (values: Record<string, unknown>) => {
        writes.push(values);
        Object.assign(store, values);
      },
      remove: async (keys: string | string[]) => {
        for (const key of [keys].flat()) delete store[key];
      },
    },
  },
});

const { disconnect, loginAndStoreToken, storeApprovedConnection } = await import("./api");
const { getState, saveConfig } = await import("./config");

const healthCalls = () => fetches.filter(({ url }) => url.endsWith("/api/health"));
const flagWrites = () => writes.filter((values) => "importQueue" in values);
const credentials = { instanceUrl: INSTANCE, email: "me@example.com", password: "secret" };
const memberLogin: LoginResult = { token: "new", expires_in: 3600, user: { role: "MEMBER", email: "me@example.com" } };

function reset(values: Record<string, unknown> = {}): void {
  for (const key of Object.keys(store)) delete store[key];
  Object.assign(store, values);
  fetches.length = 0;
  writes.length = 0;
  health = answered({ ok: true, grab_pairing: true, import_queue: true });
  login = answered(memberLogin);
}

describe("learning the flag at sign-in", () => {
  beforeEach(() => reset({ ...credentials, isAdmin: false }));

  it("stores what /health says", async () => {
    await loginAndStoreToken(credentials);
    expect(store.importQueue).toBe(true);
  });

  it("reads an answer without the flag as an older instance", async () => {
    health = answered({ ok: true, grab_pairing: true });
    await loginAndStoreToken(credentials);
    expect(store.importQueue).toBe(false);
  });

  it.each([[false], ["yes"], [1], [null]])("takes only true for the flag, not %s", async (value) => {
    store.importQueue = true;
    health = answered({ ok: true, import_queue: value });
    await loginAndStoreToken(credentials);
    expect(store.importQueue).toBe(false);
  });

  it("asks with no credentials, and gives up rather than hang", async () => {
    await loginAndStoreToken(credentials);
    const [{ url, init }] = healthCalls();
    expect(url).toBe(`${INSTANCE}/api/health`);
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("never fails the sign-in, and keeps what's known, when the instance doesn't answer", async () => {
    store.importQueue = true;
    health = "unreachable";
    await expect(loginAndStoreToken(credentials)).resolves.toBe("new");
    expect(store.token).toBe("new");
    expect(store.importQueue).toBe(true);
  });

  it("stays unlearned when there's nothing yet to keep", async () => {
    health = "unreachable";
    await expect(loginAndStoreToken(credentials)).resolves.toBe("new");
    expect("importQueue" in store).toBe(false);
  });

  it.each([
    ["an error", () => answered({ detail: "Database is restarting" }, 500)],
    ["a proxy's own page", () => new Response("<html>Bad gateway</html>", { status: 200 })],
    ["null", () => answered(null)],
  ])("takes %s for no answer, not for an older instance", async (_name, answer) => {
    store.importQueue = true;
    health = answer();
    await expect(loginAndStoreToken(credentials)).resolves.toBe("new");
    expect(store.importQueue).toBe(true);
  });

  it("writes only on a change: rewriting it would re-initialize every open tab", async () => {
    store.importQueue = true;
    await loginAndStoreToken(credentials);
    expect(flagWrites()).toEqual([]);

    health = answered({ ok: true });
    await loginAndStoreToken(credentials);
    expect(flagWrites()).toEqual([{ importQueue: false }]);
  });

  it("notices an upgrade and a downgrade at the next sign-in", async () => {
    store.importQueue = false;
    await loginAndStoreToken(credentials);
    expect(store.importQueue).toBe(true);

    health = answered({ ok: true });
    await loginAndStoreToken(credentials);
    expect(store.importQueue).toBe(false);
  });

  it("is a key open tabs re-render on", () => {
    expect(CONFIG_CHANGE_KEYS).toContain(STORAGE_KEYS.importQueue);
  });

  it("doesn't ask when the sign-in itself fails", async () => {
    login = answered({ detail: "Wrong password" }, 401);
    await expect(loginAndStoreToken(credentials)).rejects.toThrow("Wrong password");
    expect(healthCalls()).toEqual([]);
  });

  it("forgets what another instance said when this one doesn't answer", async () => {
    reset({ ...credentials, instanceUrl: OTHER_INSTANCE, isAdmin: false, importQueue: true });
    health = "unreachable";
    await saveConfig(credentials);
    expect(store.instanceUrl).toBe(INSTANCE);
    expect("importQueue" in store).toBe(false);
  });

  it("learns at a connection made by approval too, and never fails it", async () => {
    await storeApprovedConnection(OTHER_INSTANCE, "connection", memberLogin);
    expect(store.importQueue).toBe(true);

    reset({ ...credentials, importQueue: true });
    health = "unreachable";
    await expect(storeApprovedConnection(OTHER_INSTANCE, "connection", memberLogin)).resolves.toBeUndefined();
    expect(store.instanceUrl).toBe(OTHER_INSTANCE);
    expect("importQueue" in store).toBe(false);
  });

  it("is forgotten on disconnecting", async () => {
    store.importQueue = true;
    store.token = "old";
    await disconnect();
    expect("importQueue" in store).toBe(false);
  });
});

describe("what getState makes of it", () => {
  beforeEach(() => reset({ ...credentials, isAdmin: false }));

  it.each([
    { isAdmin: false, importQueue: undefined, canQueue: false, wording: false },
    { isAdmin: false, importQueue: false, canQueue: false, wording: false },
    { isAdmin: false, importQueue: true, canQueue: true, wording: true },
    { isAdmin: true, importQueue: undefined, canQueue: true, wording: false },
    { isAdmin: true, importQueue: false, canQueue: true, wording: false },
    { isAdmin: true, importQueue: true, canQueue: true, wording: true },
  ])(
    "isAdmin $isAdmin, flag $importQueue: canQueue $canQueue, new wording $wording",
    async ({ isAdmin, importQueue, canQueue, wording }) => {
      health = "unreachable";
      Object.assign(store, { isAdmin, ...(importQueue === undefined ? {} : { importQueue }) });
      expect(await getState()).toMatchObject({ canQueue, importQueue: wording });
    },
  );

  it("asks when it was never learned, and open tabs get the answer from storage", async () => {
    await getState();
    await vi.waitFor(() => expect(store.importQueue).toBe(true));
    expect(flagWrites()).toEqual([{ importQueue: true }]);
    expect(await getState()).toMatchObject({ canQueue: true, importQueue: true });
    expect(healthCalls()).toHaveLength(1);
  });

  it("doesn't wait for the instance: the popup and offline features can't hang on it", async () => {
    let answer!: (res: Response) => void;
    health = new Promise<Response>((resolve) => (answer = resolve));

    await expect(getState()).resolves.toMatchObject({ configured: true, canQueue: false });

    answer(answered({ ok: true, import_queue: true }));
    await vi.waitFor(() => expect(store.importQueue).toBe(true));
  });

  it("asks once for a burst of tabs", async () => {
    let answer!: (res: Response) => void;
    health = new Promise<Response>((resolve) => (answer = resolve));

    await Promise.all([getState(), getState(), getState()]);
    answer(answered({ ok: true }));
    await vi.waitFor(() => expect(store.importQueue).toBe(false));

    expect(healthCalls()).toHaveLength(1);
    expect(flagWrites()).toEqual([{ importQueue: false }]);
  });

  it("tries again later when the instance couldn't be reached", async () => {
    health = "unreachable";
    await getState();
    await vi.waitFor(() => expect(healthCalls()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve));
    expect("importQueue" in store).toBe(false);

    health = answered({ ok: true, import_queue: true });
    await getState();
    await vi.waitFor(() => expect(store.importQueue).toBe(true));
  });

  it.each([
    ["once known", { importQueue: false }],
    ["while disabled", { disabled: true }],
    ["before it's set up", { instanceUrl: undefined }],
  ])("doesn't ask %s", async (_when, stored) => {
    Object.assign(store, stored);
    await getState();
    await new Promise((resolve) => setTimeout(resolve));
    expect(healthCalls()).toEqual([]);
  });
});
