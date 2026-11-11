import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { CollectionSync } from "../api/collections";
import type { ImportProvider } from "../api/settings";
import { isSourceOff, syncHealth, syncsLabel } from "./syncSources";

// Each string as its key and options, so the test reads which one was picked.
const t = ((key: string, options?: Record<string, unknown>) =>
  `${key.split(".").pop()}(${Object.values(options ?? {}).join(",")})`) as unknown as TFunction;

const source = (id: string, provider: string, title: string): CollectionSync => ({
  id,
  provider,
  source_url: `https://example.com/${id}`,
  title,
  profile_scope: "url",
  last_checked_at: null,
  last_error: null,
  likes_of: null,
  interval_hours: 24,
  next_sync_at: null,
  sync_now_at: null,
});

const makerworld = source("a", "makerworld", "Printer");
const thingiverse = source("b", "thingiverse", "Bits");
const off = new Set<ImportProvider>(["thingiverse"]);

describe("sync sources", () => {
  it("says a turned-off site holds up only its own sources while others still sync", () => {
    expect(syncHealth([makerworld, thingiverse], off)).toBe("partial");
    expect(syncsLabel([makerworld, thingiverse], off, t)).toContain("badgeSourceOff(Thingiverse)");
    expect(syncsLabel([makerworld, thingiverse], off, t)).not.toContain("badgeOff(");
  });

  it("says nothing syncs when every source's site is off", () => {
    expect(syncHealth([thingiverse], off)).toBe("off");
    expect(syncsLabel([thingiverse], off, t)).toContain("badgeOff(Thingiverse)");
  });

  it("treats a provider it doesn't know as on", () => {
    expect(isSourceOff(source("c", "gone-site", "Old"), off)).toBe(false);
  });
});
