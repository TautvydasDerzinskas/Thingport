import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetRetiredSettings } from "./settings";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("forgetRetiredSettings", () => {
  it("takes away the old copy of the MakerWorld cookie, and nothing else", () => {
    const stored = new Map([
      ["thingport_settings", '{"makerworld":{"cookie":"token=secret"}}'],
      ["thingport_auth_token", "kept"],
    ]);
    vi.stubGlobal("window", { localStorage: { removeItem: (key: string) => stored.delete(key) } });
    forgetRetiredSettings();
    expect([...stored.keys()]).toEqual(["thingport_auth_token"]);
  });

  it("doesn't stop the app from starting where storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    expect(() => forgetRetiredSettings()).not.toThrow();
  });
});
