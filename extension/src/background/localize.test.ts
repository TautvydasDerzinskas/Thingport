import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, unknown> = {};

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
    },
  },
});

const { backgroundText } = await import("./localize");

describe("background localization", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it("falls back to English when saved locale storage is missing or invalid", async () => {
    store.locale = "not-a-locale";
    await expect(backgroundText("requestFailed", { status: 500 })).resolves.toBe("Request failed (500)");
  });

  it("uses the saved locale for an error that can outlive a page", async () => {
    store.locale = "be";
    await expect(backgroundText("importFailed")).resolves.toBe("Імпарт не выкананы");
  });

  it("uses browser languages before a manual choice is saved", async () => {
    vi.stubGlobal("navigator", { languages: ["ru-RU"] });
    try {
      await expect(backgroundText("importFailed")).resolves.toBe("Импорт не выполнен");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
