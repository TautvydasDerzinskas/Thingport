import { afterEach, describe, expect, it, vi } from "vitest";
import { shortDate } from "./ClockCard";

afterEach(() => vi.restoreAllMocks());

describe("shortDate", () => {
  it("uses Belarusian parts when Chromium lacks the be locale", () => {
    vi.spyOn(Intl.DateTimeFormat, "supportedLocalesOf").mockReturnValue([]);
    expect(shortDate("be", new Date(2026, 10, 8, 12))).toEqual({ weekday: "нд", day: "8 ліс" });
    expect(shortDate("be", new Date(2026, 4, 12, 12))).toEqual({ weekday: "аў", day: "12 мая" });
  });

  it("matches what a browser with Belarusian data writes", () => {
    for (const date of [new Date(2026, 4, 12, 12), new Date(2026, 10, 8, 12)]) {
      const own = shortDate("be", date);
      vi.spyOn(Intl.DateTimeFormat, "supportedLocalesOf").mockReturnValue([]);
      expect(shortDate("be", date)).toEqual(own);
      vi.restoreAllMocks();
    }
  });
});
