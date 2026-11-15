import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS, type PairingIntent, type PendingPairing } from "../shared/storage";

const store: Record<string, unknown> = {};
const operations: string[] = [];
let permissionGranted = false;
let blockPermissionCheck = false;
let releasePermissionCheck: (() => void) | null = null;
let nextTabId = 40;
let updateFails = false;
// Runs as the next tab update starts; throwing from it fails that update.
let onNextUpdate: (() => Promise<void>) | null = null;
let claimHeld: Promise<void> | null = null;
let claimRefused = false;
const fetchUrls: string[] = [];
type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
const storageListeners: StorageListener[] = [];

/** As Chrome does: after the write, in a task of its own. */
function storageChanged(changes: Record<string, chrome.storage.StorageChange>): void {
  for (const listener of storageListeners) setTimeout(() => listener(changes, "local"), 0);
}

function valuesFor(keys: string | string[]): Record<string, unknown> {
  const wanted = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(wanted.filter((key) => key in store).map((key) => [key, store[key]]));
}

vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", languages: ["en-US"] });
vi.stubGlobal("fetch", async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  fetchUrls.push(url);
  if (url.endsWith("/api/grab/pairings/claim")) {
    if (claimHeld) await claimHeld;
    if (claimRefused) return new Response(JSON.stringify({ detail: "refused" }), { status: 400 });
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
        const changes = Object.fromEntries(
          Object.entries(values).map(([key, newValue]) => [key, { oldValue: store[key], newValue }]),
        );
        Object.assign(store, values);
        storageChanged(changes);
      },
      remove: async (keys: string | string[]) => {
        const wanted = Array.isArray(keys) ? keys : [keys];
        operations.push(`remove:${wanted.join(",")}`);
        const changes = Object.fromEntries(
          wanted.filter((key) => key in store).map((key) => [key, { oldValue: store[key] }]),
        );
        for (const key of wanted) delete store[key];
        storageChanged(changes);
      },
    },
  },
  permissions: {
    contains: async () => {
      const result = permissionGranted;
      if (blockPermissionCheck) await new Promise<void>((resolve) => (releasePermissionCheck = resolve));
      return result;
    },
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
      const hook = onNextUpdate;
      onNextUpdate = null;
      if (hook) await hook();
      if (updateFails) throw new Error("tab update failed");
      return {};
    },
    remove: async (tabId: number) => {
      operations.push(`remove-tab:${tabId}`);
    },
  },
});

const { onPairingStorageChanged, onPairingTabClosed, onPairingTabUrl, resumePairingIntent } = await import("./pairing");
const { getState } = await import("./config");

function intent(instanceUrl = "https://thingport.example.com"): PairingIntent {
  return { instanceUrl, startedAt: Date.now() };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  operations.length = 0;
  fetchUrls.length = 0;
  permissionGranted = false;
  blockPermissionCheck = false;
  releasePermissionCheck = null;
  updateFails = false;
  onNextUpdate = null;
  claimHeld = null;
  claimRefused = false;
  storageListeners.length = 0;
});

const tabsOpened = () => operations.filter((operation) => operation === "create:about:blank:false");

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

  it("reruns when access is granted during the active permission check", async () => {
    store[STORAGE_KEYS.pairingIntent] = intent();
    blockPermissionCheck = true;

    const first = resumePairingIntent();
    await vi.waitFor(() => expect(releasePermissionCheck).not.toBeNull());
    permissionGranted = true;
    blockPermissionCheck = false;
    const second = resumePairingIntent();
    releasePermissionCheck!();
    await Promise.all([first, second]);

    expect(store[STORAGE_KEYS.pairingIntent]).toBeUndefined();
    expect(store[STORAGE_KEYS.pendingPairing]).toMatchObject({ instanceUrl: "https://thingport.example.com" });
    expect(operations.filter((operation) => operation === "create:about:blank:false")).toHaveLength(1);
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

  it("starts over where the approval tab left behind is past its time", async () => {
    store[STORAGE_KEYS.pairingIntent] = intent();
    store[STORAGE_KEYS.pendingPairing] = {
      instanceUrl: "https://thingport.example.com",
      verifier: "secret",
      tabId: 9,
      startedAt: Date.now() - 16 * 60 * 1000,
    } satisfies PendingPairing;
    permissionGranted = true;

    await resumePairingIntent();

    expect((store[STORAGE_KEYS.pendingPairing] as PendingPairing).tabId).toBe(nextTabId);
    expect(operations).toContain("create:about:blank:false");
  });

  it("tells the popup a pairing is waiting only while it's in time", async () => {
    const pending = {
      instanceUrl: "https://thingport.example.com",
      verifier: "secret",
      tabId: 9,
      startedAt: Date.now(),
    } satisfies PendingPairing;
    store[STORAGE_KEYS.pendingPairing] = pending;
    await expect(getState()).resolves.toMatchObject({ pairing: true });

    store[STORAGE_KEYS.pendingPairing] = { ...pending, startedAt: Date.now() - 16 * 60 * 1000 };
    await expect(getState()).resolves.toMatchObject({
      pairing: false,
      pairingInstanceUrl: "https://thingport.example.com",
    });
  });

  it("restores the address and removes the placeholder tab when navigation fails", async () => {
    const saved = intent();
    store[STORAGE_KEYS.pairingIntent] = saved;
    permissionGranted = true;
    updateFails = true;

    await expect(resumePairingIntent()).rejects.toThrow("tab update failed");

    expect(store[STORAGE_KEYS.pairingIntent]).toEqual({ ...saved, failed: true });
    expect(store[STORAGE_KEYS.pendingPairing]).toBeUndefined();
    expect(operations).toContain(`remove:${STORAGE_KEYS.pendingPairing}`);
    expect(operations.some((operation) => operation.startsWith("remove-tab:"))).toBe(true);
  });

  it("doesn't start again on putting back an intent whose tab couldn't be opened", async () => {
    store[STORAGE_KEYS.pairingIntent] = intent();
    permissionGranted = true;
    updateFails = true;
    storageListeners.push(onPairingStorageChanged);

    await expect(resumePairingIntent()).rejects.toThrow("tab update failed");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(tabsOpened()).toHaveLength(1);
    expect(store[STORAGE_KEYS.pairingIntent]).toMatchObject({ failed: true });
  });

  it("tries an intent whose tab couldn't be opened again only for Connect", async () => {
    store[STORAGE_KEYS.pairingIntent] = { ...intent(), failed: true } satisfies PairingIntent;
    permissionGranted = true;

    await resumePairingIntent();
    expect(tabsOpened()).toHaveLength(0);

    await resumePairingIntent(true);
    expect(tabsOpened()).toHaveLength(1);
    expect(store[STORAGE_KEYS.pairingIntent]).toBeUndefined();
    expect(store[STORAGE_KEYS.pendingPairing]).toMatchObject({ instanceUrl: "https://thingport.example.com" });
  });

  it("still tries it for a Connect that arrives while a browser event is passing it over", async () => {
    store[STORAGE_KEYS.pairingIntent] = { ...intent(), failed: true } satisfies PairingIntent;
    permissionGranted = true;

    await Promise.all([resumePairingIntent(), resumePairingIntent(true)]);

    expect(tabsOpened()).toHaveLength(1);
  });

  it("shows the address typed last, not a left-over approval tab's", async () => {
    const pending = {
      instanceUrl: "https://old.example.com",
      verifier: "secret",
      tabId: 9,
      startedAt: Date.now() - 16 * 60 * 1000,
    } satisfies PendingPairing;
    store[STORAGE_KEYS.pendingPairing] = pending;
    store[STORAGE_KEYS.pairingIntent] = intent("https://new.example.com");
    await expect(getState()).resolves.toMatchObject({ pairing: false, pairingInstanceUrl: "https://new.example.com" });

    store[STORAGE_KEYS.pendingPairing] = { ...pending, startedAt: Date.now() };
    await expect(getState()).resolves.toMatchObject({ pairing: true, pairingInstanceUrl: "https://old.example.com" });
  });

  it("still answers the pair button with its failure when an event's pass after it has nothing to do", async () => {
    store[STORAGE_KEYS.pairingIntent] = intent();
    permissionGranted = true;
    updateFails = true;

    const pressed = resumePairingIntent(true);
    void resumePairingIntent().catch(() => undefined);

    await expect(pressed).rejects.toThrow("tab update failed");
    expect(tabsOpened()).toHaveLength(1);
  });

  it("keeps the pairing until its code is claimed, so another can't start meanwhile", async () => {
    store[STORAGE_KEYS.pendingPairing] = {
      instanceUrl: "https://thingport.example.com",
      verifier: "secret",
      tabId: 7,
      startedAt: Date.now(),
    } satisfies PendingPairing;
    let releaseClaim!: () => void;
    claimHeld = new Promise<void>((resolve) => (releaseClaim = resolve));
    const claiming = onPairingTabUrl(7, "https://thingport.example.com/connect-grab#grab_code=approved");
    await vi.waitFor(() => expect(fetchUrls.some((url) => url.endsWith("/api/grab/pairings/claim"))).toBe(true));

    store[STORAGE_KEYS.pairingIntent] = intent("https://other.example.com");
    permissionGranted = true;
    await expect(getState()).resolves.toMatchObject({ pairing: true });
    await resumePairingIntent();
    releaseClaim();
    await claiming;

    expect(tabsOpened()).toHaveLength(0);
    expect(store[STORAGE_KEYS.connectionToken]).toBe("connection");
    expect(store[STORAGE_KEYS.pendingPairing]).toBeUndefined();
  });

  it("forgets the pairing when its code is refused", async () => {
    store[STORAGE_KEYS.pendingPairing] = {
      instanceUrl: "https://thingport.example.com",
      verifier: "secret",
      tabId: 7,
      startedAt: Date.now(),
    } satisfies PendingPairing;
    claimRefused = true;

    await onPairingTabUrl(7, "https://thingport.example.com/connect-grab#grab_code=approved");

    expect(store[STORAGE_KEYS.pendingPairing]).toBeUndefined();
    expect(store[STORAGE_KEYS.connectionToken]).toBeUndefined();
    expect(operations).toContain("update:/connect-grab:undefined");
  });

  it("leaves a pairing started after its tab was closed alone when its code is refused", async () => {
    store[STORAGE_KEYS.pendingPairing] = {
      instanceUrl: "https://thingport.example.com",
      verifier: "first",
      tabId: 7,
      startedAt: Date.now(),
    } satisfies PendingPairing;
    let releaseClaim!: () => void;
    claimHeld = new Promise<void>((resolve) => (releaseClaim = resolve));
    const claiming = onPairingTabUrl(7, "https://thingport.example.com/connect-grab#grab_code=approved");
    await vi.waitFor(() => expect(fetchUrls.some((url) => url.endsWith("/api/grab/pairings/claim"))).toBe(true));

    await onPairingTabClosed(7);
    const next = {
      instanceUrl: "https://thingport.example.com",
      verifier: "second",
      tabId: 8,
      startedAt: Date.now(),
    } satisfies PendingPairing;
    store[STORAGE_KEYS.pendingPairing] = next;
    claimRefused = true;
    releaseClaim();
    await claiming;

    expect(store[STORAGE_KEYS.pendingPairing]).toEqual(next);
  });

  it("leaves an address saved during the permission check to its own pass", async () => {
    store[STORAGE_KEYS.pairingIntent] = intent("https://first.example.com");
    permissionGranted = true;
    blockPermissionCheck = true;
    storageListeners.push(onPairingStorageChanged);

    const first = resumePairingIntent();
    await vi.waitFor(() => expect(releasePermissionCheck).not.toBeNull());
    await chrome.storage.local.set({ [STORAGE_KEYS.pairingIntent]: intent("https://second.example.com") });
    await new Promise((resolve) => setTimeout(resolve, 0));
    blockPermissionCheck = false;
    releasePermissionCheck!();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(tabsOpened()).toHaveLength(1);
    expect(store[STORAGE_KEYS.pendingPairing]).toMatchObject({ instanceUrl: "https://second.example.com" });
    expect(store[STORAGE_KEYS.pairingIntent]).toBeUndefined();
  });

  it("doesn't put a failed address back over one saved meanwhile, and goes on to that one", async () => {
    store[STORAGE_KEYS.pairingIntent] = intent("https://first.example.com");
    permissionGranted = true;
    storageListeners.push(onPairingStorageChanged);
    onNextUpdate = async () => {
      await chrome.storage.local.set({ [STORAGE_KEYS.pairingIntent]: intent("https://second.example.com") });
      await new Promise((resolve) => setTimeout(resolve, 0));
      throw new Error("tab update failed");
    };

    await resumePairingIntent().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(tabsOpened()).toHaveLength(2);
    expect(store[STORAGE_KEYS.pendingPairing]).toMatchObject({ instanceUrl: "https://second.example.com" });
    expect(store[STORAGE_KEYS.pairingIntent]).toBeUndefined();
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
