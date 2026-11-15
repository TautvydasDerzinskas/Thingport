import i18next from "i18next";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import type { CollectionSync } from "../api/collections";
import type { ImportProvider } from "../api/settings";
import { isSourceOff, syncHealth, syncsLabel } from "./syncSources";

const i18n = i18next.createInstance();
await i18n.init({ lng: "en", resources: { en: { models: en.models } } });
const { t } = i18n;

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
    const label = syncsLabel([makerworld, thingiverse], off, t);
    expect(label).toContain("Thingiverse is turned off on this Thingport instance, so its sources wait");
    expect(label).not.toContain("nothing syncs");
  });

  it("says nothing syncs when every source's site is off", () => {
    expect(syncHealth([thingiverse], off)).toBe("off");
    expect(syncsLabel([thingiverse], off, t)).toContain(
      "Thingiverse is turned off on this Thingport instance, so nothing syncs until an admin turns it back on",
    );
  });

  it("treats a provider it doesn't know as on", () => {
    expect(isSourceOff(source("c", "gone-site", "Old"), off)).toBe(false);
  });
});
