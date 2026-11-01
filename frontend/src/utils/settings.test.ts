import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providersApi, type ProviderState } from "../api/providers";
import { UnauthorizedError } from "../api/client";
import { settleRetiredSettings } from "./settings";

const OLD_COPY = '{"makerworld":{"cookie":"token=secret"}}';
let stored: Map<string, string>;

function makerworldIs(status: "connected" | "expired" | "disconnected") {
  const state = { id: "makerworld", enabled: true, slots: { default: { status, account: null } } } as ProviderState;
  vi.spyOn(providersApi, "list").mockResolvedValue([state]);
  return vi.spyOn(providersApi, "saveConnection").mockResolvedValue();
}

beforeEach(() => {
  stored = new Map([
    ["thingport_settings", OLD_COPY],
    ["thingport_auth_token", "kept"],
  ]);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      removeItem: (key: string) => stored.delete(key),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settleRetiredSettings", () => {
  it("hands the old copy to a server that has no sign-in, then forgets it", async () => {
    const save = makerworldIs("disconnected");
    await settleRetiredSettings();
    expect(save).toHaveBeenCalledWith("makerworld", "default", { cookie: "token=secret" });
    expect([...stored.keys()]).toEqual(["thingport_auth_token"]);
  });

  it("doesn't overwrite a sign-in the server already has", async () => {
    const save = makerworldIs("connected");
    await settleRetiredSettings();
    expect(save).not.toHaveBeenCalled();
    expect([...stored.keys()]).toEqual(["thingport_auth_token"]);
  });

  it("forgets a copy the server turned down, as it would only be turned down again", async () => {
    makerworldIs("disconnected").mockRejectedValue(new Error("This cookie doesn't work"));
    await settleRetiredSettings();
    expect(stored.has("thingport_settings")).toBe(false);
  });

  it("forgets it after a signed-out answer too, as the next sign-in has no way of knowing whose it was", async () => {
    vi.spyOn(providersApi, "list").mockRejectedValue(new UnauthorizedError());
    await settleRetiredSettings();
    expect(stored.has("thingport_settings")).toBe(false);
  });

  it("keeps it for the next visit when the server can't be reached", async () => {
    vi.spyOn(providersApi, "list").mockRejectedValue(new TypeError("Failed to fetch"));
    await settleRetiredSettings();
    expect(stored.get("thingport_settings")).toBe(OLD_COPY);
  });

  it("asks nothing when there's no copy, and survives a broken one", async () => {
    const list = vi.spyOn(providersApi, "list");
    stored.delete("thingport_settings");
    await settleRetiredSettings();
    stored.set("thingport_settings", "{not json");
    await settleRetiredSettings();
    expect(list).not.toHaveBeenCalled();
    expect(stored.has("thingport_settings")).toBe(false);
  });

  it("doesn't throw where storage is blocked", async () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    await expect(settleRetiredSettings()).resolves.toBeUndefined();
  });
});
