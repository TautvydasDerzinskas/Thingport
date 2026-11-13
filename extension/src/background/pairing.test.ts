import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS, type PairingIntent, type PendingPairing } from "../shared/storage";

const store: Record<string, unknown> = {};
const operations: string[] = [];
let permissionGranted = false;
let nextTabId = 40;
let updateFails = false;
const fetchUrls: string[] = [];

function valuesFor(keys: string | string[]): Record<string, unknown> {
  const wanted = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(wanted.filter((key) => key in store).map((key) => [key, store[key]]));
}

vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0" });
vi.stubGlobal("fetch", async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  fetchUrls.push(url);
  if (url.endsWith("/api/grab/pairings/claim")) {
    return new Response(
      JSON.stringify({
        connection_token: "connection",
        token: "session",
        expires_in: 3600,
        user: { email: "maker@example.com", role: "MEMBER" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ ok: true, grab_pairing: true, import_queue: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (keys: string | string[]) => valuesFor(keys),
      set: async (values: Record<string, unknown>) => {
        operations.push(`set:${Object.keys(values).join(",")}`);
        Object.assign(store, values);
      },
      remove: async (keys: string | string[]) => {
        const wanted = Array.isArray(keys) ? keys : [keys];
        operations.push(`remove:${wanted.join(",")}`);
        for (const key of wanted) delete store[key];
      },
    },
  },
  permissions: {
    contains: async () => permissionGranted,
  },
  action: {
    setBadgeText: async () => undefined,
    setBadgeBackgroundColor: async () => undefined,
  },
  tabs: {
    create: async (options: { url: string; active: boolean }) => {
      operations.push(`create:${options.url}:${options.active}`);
      return { id: ++nextTabId };
    },
    update: async (_tabId: number, options: { url: string; active: boolean }) => {
      operations.push(`update:${new URL(options.url).pathname}:${options.active}`);
      if (updateFails) throw new Error("tab update failed");
      return {};
    },
    remove: async (tabId: number) => {
      operations.push(`remove-tab:${tabId}`);
    },
  },
});

const { onPairingTabUrl, resumePairingIntent } = await import("./pairing");

function intent(instanceUrl = "https://thingport.example.com"): PairingIntent {
  return { instanceUrl, startedAt: Date.now() };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  operations.length = 0;
  fetchUrls.length = 0;
  permissionGranted = false;
  updateFails = false;
});

describe("pairing permission continuity", () => {
  it("keeps the intent while host access has not been granted", async () => {
    store[STORAGE_KEYS.pairingIntent] = intent();

    await resumePairingIntent();

    expect(store[STORAGE_KEYS.pairingIntent]).toBeDefined();
    expect(operations).toEqual([]);
  });

  it("opens the approval tab once after access is granted", async () => {
    store[STORAGE_KEYS.pairingIntent] = intent();
    permissionGranted = true;

    await Promise.all([resumePairingIntent(), resumePairingIntent()]);

    expect(store[STORAGE_KEYS.pairingIntent]).toBeUndefined();
    const pending = store[STORAGE_KEYS.pendingPairing] as PendingPairing;
    expect(pending).toMatchObject({ instanceUrl: "https://thingport.example.com", tabId: nextTabId });
    expect(pending.verifier).toBeTruthy();
    expect(operations).toEqual([
      `remove:${STORAGE_KEYS.pairingIntent}`,
      "create:about:blank:false",
      `set:${STORAGE_KEYS.pendingPairing}`,
      "update:/connect-grab:true",
    ]);
  });

  it("does not replace an approval tab already in progress", async () => {
    store[STORAGE_KEYS.pairingIntent] = intent();
    store[STORAGE_KEYS.pendingPairing] = {
      instanceUrl: "https://thingport.example.com",
      verifier: "secret",
      tabId: 9,
      startedAt: Date.now(),
    } satisfies PendingPairing;
    permissionGranted = true;

    await resumePairingIntent();

    expect(operations).toEqual([`remove:${STORAGE_KEYS.pairingIntent}`]);
    expect((store[STORAGE_KEYS.pendingPairing] as PendingPairing).tabId).toBe(9);
  });

  it("drops an expired intent instead of surprising the user with a late tab", async () => {
    store[STORAGE_KEYS.pairingIntent] = {
      instanceUrl: "https://thingport.example.com",
      startedAt: Date.now() - 16 * 60 * 1000,
    } satisfies PairingIntent;
    permissionGranted = true;

    await resumePairingIntent();

    expect(store[STORAGE_KEYS.pairingIntent]).toBeUndefined();
    expect(operations).toEqual([`remove:${STORAGE_KEYS.pairingIntent}`]);
  });

  it("restores the address and removes the placeholder tab when navigation fails", async () => {
    const saved = intent();
    store[STORAGE_KEYS.pairingIntent] = saved;
    permissionGranted = true;
    updateFails = true;

    await expect(resumePairingIntent()).rejects.toThrow("tab update failed");

    expect(store[STORAGE_KEYS.pairingIntent]).toEqual(saved);
    expect(store[STORAGE_KEYS.pendingPairing]).toBeUndefined();
    expect(operations).toContain(`remove:${STORAGE_KEYS.pendingPairing}`);
    expect(operations.some((operation) => operation.startsWith("remove-tab:"))).toBe(true);
  });

  it("claims one approval code once when Chrome reports the fragment twice", async () => {
    store[STORAGE_KEYS.pendingPairing] = {
      instanceUrl: "https://thingport.example.com",
      verifier: "secret",
      tabId: 7,
      startedAt: Date.now(),
    } satisfies PendingPairing;
    const approved = "https://thingport.example.com/connect-grab#grab_code=approved";

    await Promise.all([onPairingTabUrl(7, approved), onPairingTabUrl(7, approved)]);

    expect(fetchUrls.filter((url) => url.endsWith("/api/grab/pairings/claim"))).toHaveLength(1);
    expect(store[STORAGE_KEYS.connectionToken]).toBe("connection");
    expect(store[STORAGE_KEYS.pendingPairing]).toBeUndefined();
  });
});
